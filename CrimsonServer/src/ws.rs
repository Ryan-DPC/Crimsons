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


pub async fn start_ws_server(sender: WsSender, spotify_service: Arc<SpotifyService>, discord_service: Arc<DiscordService>) {

    let addr = "127.0.0.1:40510".parse::<SocketAddr>().expect("Invalid address");
    if let Ok(listener) = TcpListener::bind(&addr).await {
        while let Ok((stream, _)) = listener.accept().await {
            let sender_clone = WsSender(sender.0.clone());
            let spotify_clone = spotify_service.clone();
            let discord_clone = discord_service.clone();
            tokio::spawn(async move {

                // Peek for HTTP GET
                let mut buffer = [0; 1024];
                if stream.peek(&mut buffer).await.is_ok() {
                    let request = String::from_utf8_lossy(&buffer);
                    if request.starts_with("GET /callback") {
                        // Extract code from query
                        if let Some(code_start) = request.find("code=") {
                            let code = request[code_start + 5..].split_whitespace().next().unwrap_or("");
                            let code = code.split('&').next().unwrap_or(code);
                            
                            // Broadcast the code to the UI
                            let _ = sender_clone.0.send(json!({
                                "type": "SPOTIFY_CALLBACK_CODE",
                                "code": code
                            }).to_string());
                            
                            // Send a "Success" HTML response
                            use tokio::io::AsyncWriteExt;
                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div><h1>Spotify Connected!</h1><p>You can close this window now.</p></div></body></html>";
                            let mut stream = stream;
                            let _ = stream.write_all(response.as_bytes()).await;
                            return;
                        }
                    }
                }
                handle_connection(stream, sender_clone, spotify_clone, discord_clone).await;
            });

        }
    }
}

async fn handle_connection(stream: TcpStream, sender: WsSender, spotify: Arc<SpotifyService>, discord: Arc<DiscordService>) {

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
                                        if let Some(settings) = value["payload"]["settings"].as_object() {
                                            crate::storage::log_to_file("streamdock.log", &format!("[DEBUG SETTINGS] Received for context {}: {:?}", ctx, settings));
                                            for bridge in crate::streamdock::ACTIVE_BRIDGES.iter_mut() {
                                                let mut s = bridge.settings_per_ctx.lock().await;
                                                s.insert(ctx.to_string(), serde_json::Value::Object(settings.clone()));
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

                                     if value["type"] == "SAVE_SETTINGS" {
                                         println!("[WS] SAVE_SETTINGS received: {}", text);
                                         if let (Some(ctx), Some(settings)) = (value["context"].as_str(), value["settings"].as_object()) {
                                             crate::streamdock::update_settings(ctx.to_string(), json!(settings)).await;
                                             println!("[WS] Settings updated for context {}", ctx);
                                         } else {
                                             println!("[WS] Invalid SAVE_SETTINGS payload (missing context or settings)");
                                         }
                                         continue;
                                     }

                                     if value["type"] == "SPOTIFY_COMMAND" {
                                         println!("[WS] SPOTIFY_COMMAND received: {}", text);
                                         if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = spotify.handle_command(endpoint, Some(value.clone())).await;
                                            let ack = json!({ "type": "COMMAND_ACK", "action": "SPOTIFY_COMMAND", "status": "ok" }).to_string();
                                            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(ack.into())).await;
                                        }
                                        continue;
                                    }

                                    if value["type"] == "DISCORD_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = discord.handle_command(endpoint, Some(value.clone())).await;
                                            let ack = json!({ "type": "COMMAND_ACK", "action": "DISCORD_COMMAND", "status": "ok" }).to_string();
                                            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(ack.into())).await;
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
                                            };
                                            crate::streamdock::ACTIVE_BRIDGES.insert(uuid_str.clone(), bridge_data);
                                            
                                            // IMMEDIATE SYNC: Push credentials and playlists as soon as the bridge connects
                                            let sync_val = json!({ "event": "registerPropertyInspector", "uuid": &uuid_str });
                                            crate::streamdock::process_streamdeck_event(sync_val, s_clone.clone(), d_clone.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone()).await;

                                            while let Some(msg_res) = ws_stream.next().await {
                                                match msg_res {
                                                    Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                                                        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
                                                            crate::streamdock::process_streamdeck_event(val, s_clone.clone(), d_clone.clone(), sender_clone.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone()).await;
                                                        }
                                                    }
                                                    _ => break,
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
                                            let s_clone = spotify.clone();
                                            let d_clone = discord.clone();
                                            let uuid_str = u.to_string();
                                            let reg_str = r.to_string();
                                            tokio::spawn(async move {
                                                crate::streamdock::start_streamdock_client(p as u16, uuid_str, reg_str, s_clone, d_clone).await;
                                            });

                                            
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
