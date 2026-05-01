use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use std::sync::Arc;
use crate::storage;
use crate::events::WsSender;
use crate::sd_commands::StreamDeckCommand;
use crate::spotify::SpotifyService;
use crate::discord::DiscordService;
use crate::hue::HueService;
use crate::twitch::TwitchService;

pub async fn start_ws_server(
    sender: WsSender, 
    spotify_service: Arc<SpotifyService>, 
    discord_service: Arc<DiscordService>, 
    hue_service: Arc<HueService>,
    twitch_service: Arc<TwitchService>,
    db: Arc<crate::db::StreamDockDB>
) {
    let addr = "127.0.0.1:40510".parse::<SocketAddr>().expect("Invalid address");
    if let Ok(listener) = TcpListener::bind(&addr).await {
        while let Ok((stream, _)) = listener.accept().await {
            let sender_clone = WsSender(sender.0.clone());
            let spotify_clone = spotify_service.clone();
            let discord_clone = discord_service.clone();
            let hue_clone = hue_service.clone();
            let twitch_clone = twitch_service.clone();
            let db_clone = db.clone();
            tokio::spawn(async move {
                // Peek for HTTP GET (Spotify Callback)
                let mut buffer = [0; 1024];
                if stream.peek(&mut buffer).await.is_ok() {
                    let request = String::from_utf8_lossy(&buffer);
                    if request.starts_with("GET /callback") {
                        if let Some(code_start) = request.find("code=") {
                            let code = request[code_start + 5..].split_whitespace().next().unwrap_or("");
                            let code = code.split('&').next().unwrap_or(code);
                            let _ = sender_clone.0.send(json!({ "type": "SPOTIFY_CALLBACK_CODE", "code": code }).to_string());
                            use tokio::io::AsyncWriteExt;
                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div><h1>Spotify Connected!</h1><p>You can close this window now.</p></div></body></html>";
                            let mut stream = stream;
                            let _ = stream.write_all(response.as_bytes()).await;
                            return;
                        }
                    }
                }
                handle_connection(stream, sender_clone, spotify_clone, discord_clone, hue_clone, twitch_clone, db_clone).await;
            });
        }
    }
}

async fn handle_connection(
    stream: TcpStream, 
    sender: WsSender, 
    spotify: Arc<SpotifyService>, 
    discord: Arc<DiscordService>, 
    hue: Arc<HueService>,
    twitch: Arc<TwitchService>,
    db: Arc<crate::db::StreamDockDB>
) {

    if let Ok(mut ws_stream) = accept_async(stream).await {
        crate::storage::log_to_file("streamdock.log", "[WS] New client connection accepted");
        println!("Client connected to WebSocket server");
        
        let (ws_stream_sender, mut ws_stream_receiver) = tokio::sync::mpsc::channel::<String>(100);
        // Load persistent data to push initial state
        let data_path = storage::get_data_path_from_env();
        let data = storage::load_data_from_path(data_path);
        
        // Push initial state immediately
        let initial_state = json!({
            "type": "AUTO_ACCEPT_STATE",
            "enabled": data.auto_accept
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(initial_state.to_string().into())).await;

        // Push heartbeat immediately (v1.0.8)
        let heartbeat = json!({
            "type": "HEARTBEAT_STATUS",
            "server": true,
            "lol": crate::lcu::is_lcu_connected(),
            "discord": discord.is_connected().await
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(heartbeat.to_string().into())).await;

        if let Some(last_rank) = data.other.get("last_rank") {
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(last_rank.to_string().into())).await;
        }

        let mut rx = sender.0.subscribe();

        loop {
            tokio::select! {
                // Outgoing messages to this client
                out_msg = ws_stream_receiver.recv() => {
                    if let Some(text) = out_msg {
                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(text.into())).await;
                    } else {
                        break;
                    }
                }
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(msg)) => {
                            if let Ok(text) = msg.into_text() {
                                if text.trim().is_empty() { continue; }
                                // Parse Command and Dispatch
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                    // 1. Log incoming command for diagnostics
                                    let evt_name = value["event"].as_str().unwrap_or("N/A");
                                    let type_name = value["type"].as_str().unwrap_or("N/A");
                                     
                                    // Universal Settings Extraction
                                    if let Some(ctx) = value["context"].as_str() {
                                        if let Some(settings) = value["payload"]["settings"]
                                            .as_object()
                                            .or_else(|| value["payload"].as_object())
                                        {
                                            crate::storage::log_to_file("streamdock.log", &format!("[DEBUG SETTINGS] Received for context {}: {:?}", ctx, settings));
                                            
                                            // 1. Persist settings in-memory
                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                let mut s = bridge.settings_per_ctx.lock().await;
                                                s.insert(ctx.to_string(), serde_json::Value::Object(settings.clone()));
                                            }

                                            // 2. Persist to DB (v1.2.0)
                                            let db_c = db.clone();
                                            let ctx_c = ctx.to_string();
                                            let settings_c = serde_json::Value::Object(settings.clone());
                                            let action_c = value["action"].as_str().map(|s| s.to_string());
                                            let img_c = settings.get("image").and_then(|v| v.as_str())
                                                .or_else(|| settings.get("playlist_image").and_then(|v| v.as_str()))
                                                .map(|s| s.to_string());
                                            
                                            tokio::spawn(async move {
                                                let _ = db_c.save_button(&ctx_c, action_c.as_deref(), &settings_c, img_c.as_deref());
                                            });

                                            // 3. IMMEDIATE IMAGE PUSH (v1.1.5)
                                            if let Some(img_url) = settings.get("image").and_then(|v| v.as_str())
                                                .or_else(|| settings.get("playlist_image").and_then(|v| v.as_str())) {
                                                
                                                crate::storage::log_to_file("streamdock.log", &format!("[SD IMAGE PUSH] Pushing cover to context {}", ctx));
                                                let bridge_tx = ws_stream_sender.clone();
                                                let ctx_str = ctx.to_string();
                                                let img_str = img_url.to_string();
                                                tokio::spawn(async move {
                                                    let _ = bridge_tx.send(json!({
                                                        "event": "setImage",
                                                        "context": ctx_str,
                                                        "payload": { "image": img_str, "target": 0 }
                                                    }).to_string()).await;
                                                });
                                            }
                                        }
                                        // Update context mapping if action is present
                                        if let Some(action) = value["action"].as_str() {
                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                let mut c = bridge.contexts.lock().await;
                                                c.insert(ctx.to_string(), action.to_string());
                                            }
                                        }
                                    }

                                    crate::storage::log_to_file("streamdock.log", &format!("[SD IN] Event: {} Type: {} Payload: {}", evt_name, type_name, text));

                                    if value["type"] == "UPDATE_RESOURCE_MODE" {
                                        if let Some(low) = value["low_resource"].as_bool() {
                                            crate::state::set_low_resource_mode(low);
                                            println!("Resource optimization: {}", if low { "ENABLED" } else { "DISABLED" });
                                        }
                                        continue;
                                    }

                                    if value["type"] == "SPOTIFY_AUTH" {
                                        if let (Some(access), Some(refresh)) = (value["access_token"].as_str(), value["refresh_token"].as_str()) {
                                            let expires_in = value["expires_in"].as_u64().unwrap_or(3600);
                                            spotify.update_tokens(access.to_string(), refresh.to_string(), expires_in).await;
                                            println!("Spotify tokens updated from client");
                                        }
                                        continue;
                                    }

                                    if value["type"] == "SPOTIFY_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let mut command_val = value.clone();
                                            
                                            // Fallback to persisted settings if payload is empty (v1.1.5)
                                            if let Some(ctx) = command_val["context"].as_str() {
                                                let mut payload = command_val["payload"].clone();
                                                if payload["playlist"].is_null() && payload["uri"].is_null() {
                                                    for bridge in crate::streamdock::ACTIVE_BRIDGES.iter() {
                                                        let settings_lock = bridge.settings_per_ctx.lock().await;
                                                        if let Some(s) = settings_lock.get(ctx) {
                                                            crate::storage::log_to_file("streamdock.log", &format!("[SD CMD] Falling back to persisted settings for context {}", ctx));
                                                            payload = s.clone();
                                                        }
                                                    }
                                                }
                                                
                                                if endpoint == "play" {
                                                    if let Some(uri) = payload["playlist"].as_str().or(payload["uri"].as_str()) {
                                                         let mut p = payload.clone();
                                                         p["context_uri"] = json!(uri);
                                                         let _ = spotify.handle_command(endpoint, Some(p)).await;
                                                    } else {
                                                         crate::storage::log_to_file("streamdock.log", "[SD ERROR] Play command missing playlist/uri");
                                                    }
                                                } else {
                                                    let _ = spotify.handle_command(endpoint, Some(payload)).await;
                                                }
                                            } else {
                                                let _ = spotify.handle_command(endpoint, Some(command_val.clone())).await;
                                            }
                                        }
                                        continue;
                                    }

                                    if value["type"] == "DISCORD_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = discord.handle_command(endpoint, Some(value.clone())).await;
                                        }
                                        continue;
                                    }

                                    if value["type"] == "HUE_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = hue.handle_command(endpoint, Some(value.clone())).await;
                                        }
                                        continue;
                                    }

                                    if value["type"] == "TWITCH_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = twitch.handle_command(endpoint, Some(value.clone())).await;
                                        }
                                        continue;
                                    }

                                    if value["type"] == "REGISTER_STREAMDOCK_BRIDGE" {
                                        let port_id = value["port"].as_u64()
                                            .or_else(|| value["port"].as_str().and_then(|s| s.parse::<u64>().ok()));

                                        if let (Some(p), Some(u)) = (port_id, value["uuid"].as_str()) {
                                            println!("WebSocket: Proxy BRIDGE registered for UUID {} on port {}", u, p);
                                            let s_clone = spotify.clone();
                                            let d_clone = discord.clone();
                                            let h_clone = hue.clone();
                                            let t_clone = twitch.clone();
                                            let uuid_str = u.to_string();
                                            let sender_clone = ws_stream_sender.clone();
                                            let contexts = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            let pi_contexts = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashSet::new()));
                                            let last_state_cache = std::sync::Arc::new(tokio::sync::Mutex::new(None));
                                            let last_image_per_ctx = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            let settings_per_ctx = std::sync::Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::new()));
                                            
                                            let bridge_data = crate::streamdock::HardwareBridge {
                                                tx: sender_clone.clone(),
                                                contexts: contexts.clone(),
                                                last_state_cache: last_state_cache.clone(),
                                                pi_contexts: pi_contexts.clone(),
                                                last_image_per_ctx: last_image_per_ctx.clone(),
                                                settings_per_ctx: settings_per_ctx.clone(),
                                                hue: h_clone.clone(),
                                                twitch: t_clone.clone(),
                                            };

                                            // RESTORE FROM DB (v1.2.0)
                                            if let Ok(saved_buttons) = db.get_all_buttons() {
                                                let mut settings_lock = settings_per_ctx.lock().await;
                                                let mut contexts_lock = contexts.lock().await;
                                                for (ctx, action, mut settings, image) in saved_buttons {
                                                    // v1.2.3: Merge image into settings for better sync persistence
                                                    if let Some(img) = &image {
                                                        if let Some(obj) = settings.as_object_mut() {
                                                            if !obj.contains_key("image") { obj.insert("image".to_string(), json!(img)); }
                                                            if !obj.contains_key("playlist_image") { obj.insert("playlist_image".to_string(), json!(img)); }
                                                        }
                                                    }

                                                    settings_lock.insert(ctx.clone(), settings.clone());
                                                    contexts_lock.insert(ctx.clone(), action);
                                                    
                                                    // Push image if saved
                                                    if let Some(img) = image {
                                                        let _ = sender_clone.send(json!({
                                                            "event": "setImage",
                                                            "context": ctx,
                                                            "payload": { "image": img, "target": 0 }
                                                        }).to_string()).await;
                                                    }
                                                }
                                            }

                                            crate::streamdock::ACTIVE_BRIDGES.insert(uuid_str.clone(), bridge_data);
                                            
                                            // IMMEDIATE SYNC: Push credentials and playlists as soon as the bridge connects
                                            let sync_val = json!({ "event": "registerPropertyInspector", "uuid": &uuid_str });
                                            crate::streamdock::process_streamdeck_event(sync_val, s_clone.clone(), d_clone.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone(), settings_per_ctx.clone(), h_clone.clone(), t_clone.clone(), db.clone()).await;

                                            loop {
                                                tokio::select! {
                                                    msg_res = ws_stream.next() => {
                                                        match msg_res {
                                                            Some(Ok(tokio_tungstenite::tungstenite::Message::Text(text))) => {
                                                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                                                    crate::streamdock::process_streamdeck_event(val, s_clone.clone(), d_clone.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone(), settings_per_ctx.clone(), h_clone.clone(), t_clone.clone(), db.clone()).await;
                                                                }
                                                            }
                                                            _ => break,
                                                        }
                                                    }
                                                    Ok(broadcast_msg) = rx.recv() => {
                                                        if let Err(_) = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(broadcast_msg.into())).await {
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                            crate::streamdock::ACTIVE_BRIDGES.remove(&uuid_str);
                                            println!("WebSocket: Proxy BRIDGE disconnected for UUID {}", uuid_str);
                                            break;
                                        }
                                    }

                                     if value["event"] == "registerPropertyInspector" {
                                        let s_clone = spotify.clone();
                                        let ws_sender = ws_stream_sender.clone();
                                        tokio::spawn(async move {
                                            let playlists = s_clone.get_user_playlists().await.unwrap_or_default();
                                            let devices = s_clone.get_user_devices().await.unwrap_or_default();
                                            let data = json!({
                                                "event": "sendToPropertyInspector",
                                                "payload": {
                                                    "playlists": playlists,
                                                    "devices": devices,
                                                    "authorized": true
                                                }
                                            });
                                            let _ = ws_sender.send(data.to_string()).await;
                                        });
                                        continue;
                                    }

                                    if value["type"] == "REGISTER_STREAMDOCK" {
                                        let port_opt = value["port"].as_u64()
                                            .or_else(|| value["port"].as_str().and_then(|s| s.parse::<u64>().ok()));

                                        if let (Some(p), Some(u), Some(r)) = (port_opt, value["uuid"].as_str(), value["register_event"].as_str()) {
                                            crate::storage::log_to_file("streamdock.log", &format!("[SD HANDOVER] Port: {} UUID: {} Event: {}", p, u, r));
                                            println!("WebSocket: Handover REQUEST received for StreamDock context {} on port {}", u, p);
                                            let uuid_str = u.to_string();
                                            if !crate::streamdock::try_acquire_handover(&uuid_str) {
                                                crate::storage::log_to_file(
                                                    "streamdock.log",
                                                    &format!("[SD HANDOVER] Duplicate request ignored for UUID {}", uuid_str),
                                                );
                                                println!("WebSocket: Duplicate handover ignored for StreamDock context {}", u);
                                            } else {
                                                let s_clone = spotify.clone();
                                                let d_clone = discord.clone();
                                                let h_clone = hue.clone();
                                                let t_clone = twitch.clone();
                                                let db_reg = db.clone();
                                                let reg_str = r.to_string();
                                                tokio::spawn(async move {
                                                    crate::streamdock::start_streamdock_client(p as u16, uuid_str, reg_str, s_clone, d_clone, h_clone, t_clone, db_reg).await;
                                                });
                                            }

                                            
                                            let response_json = json!({
                                                "type": "COMMAND_ACK",
                                                "action": "REGISTER_STREAMDOCK",
                                                "status": "ok"
                                            });
                                            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                            println!("WebSocket: Handover ACK sent to client.");
                                            continue;
                                        }
                                    }

                                    // Broadcast direct action requests from StreamDock so the Tauri UI can handle them
                                    // 4. Handle generic StreamDeck events (willAppear, etc.)
                                    if let Some(event) = value["event"].as_str() {
                                        if event == "willAppear" {
                                            if let (Some(ctx), Some(action)) = (value["context"].as_str(), value["action"].as_str()) {
                                                // Update context mapping
                                                for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                    let mut c = bridge.contexts.lock().await;
                                                    c.insert(ctx.to_string(), action.to_string());
                                                    
                                                    // Update settings
                                                    if let Some(settings) = value["payload"]["settings"].as_object() {
                                                        let mut s = bridge.settings_per_ctx.lock().await;
                                                        s.insert(ctx.to_string(), serde_json::Value::Object(settings.clone()));
                                                    }
                                                }
                                            }
                                        }
                                        if event == "willDisappear" {
                                            if let Some(ctx) = value["context"].as_str() {
                                                for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                    let mut c = bridge.contexts.lock().await;
                                                    c.remove(ctx);
                                                }
                                            }
                                        }
                                    }

                                    if value["type"] == "TOGGLE_AUTO_ACCEPT" || value["type"] == "TOGGLE_AUTO_BAN" || value["type"] == "TOGGLE_AUTO_PICK" || value["type"] == "INJECT_BUILD" || value["type"] == "DODGE_GAME" || value["type"] == "RUNE_BUILDS_READY" {
                                        let _ = sender.0.send(text.clone());
                                        // Also directly acknowledge it
                                        let response_json = json!({
                                            "type": "COMMAND_ACK",
                                            "action": value["type"],
                                            "status": "ok"
                                        });
                                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                        continue;
                                    }

                                    if let Ok(command) = serde_json::from_str::<StreamDeckCommand>(&text) {
                                        // Simple command acknowledgement
                                        let response_json = json!({
                                            "type": "COMMAND_ACK",
                                            "action": command.action,
                                            "status": "ok"
                                        });
                                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                    }
                                } else {
                                    // Fallback: Log unknown JSON structure
                                    let log_path = crate::storage::get_data_dir().join("streamdock.log");
                                    if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                                        use std::io::Write;
                                        let _ = writeln!(log_file, "[PRIMARY WS UNKNOWN] Payload: {}", text);
                                    }
                                    println!("Failed to parse command from Client: {}", text);
                                }
                            }
                        }
                        _ => break,
                    }
                }
                Ok(broadcast_msg) = rx.recv() => {
                    if let Err(_) = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(broadcast_msg.into())).await {
                        break;
                    }
                }
            }
        }
    }
}
