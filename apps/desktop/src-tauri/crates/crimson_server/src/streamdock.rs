use std::sync::Arc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use crate::spotify::SpotifyService;

pub async fn start_streamdock_client(port: u16, uuid: String, register_event: String, spotify: Arc<SpotifyService>) {
    let ws_url = format!("ws://127.0.0.1:{}", port);
    println!("Connecting to StreamDock at: {}", ws_url);

    let (ws_stream, _) = match connect_async(&ws_url).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Failed to connect to StreamDock: {}", e);
            return;
        }
    };
    
    println!("Connected to StreamDock!");
    let (mut write, mut read) = ws_stream.split();

    let (tx_ws, mut rx_ws) = tokio::sync::mpsc::channel::<String>(100);

    tokio::spawn(async move {
        while let Some(msg) = rx_ws.recv().await {
            let _ = write.send(Message::Text(msg.into())).await;
        }
    });

    // Register with StreamDock
    let register_msg = json!({
        "event": register_event,
        "uuid": uuid
    });
    
    let _ = tx_ws.send(register_msg.to_string()).await;
    println!("Registered with StreamDock Plugin UUID: {}", uuid);

    let auth_spotify_clone = spotify.clone();
    let auth_tx_ws_clone = tx_ws.clone();
    let auth_uuid_clone = uuid.clone();
    let uuid_for_log = uuid.clone();
    tokio::spawn(async move {
        static AUTH_SERVER_STARTED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
        if !AUTH_SERVER_STARTED.swap(true, std::sync::atomic::Ordering::SeqCst) {
            start_mirabox_auth_server(auth_spotify_clone, Some(auth_tx_ws_clone), Some(auth_uuid_clone)).await;
        } else {
            println!("Mirabox Auth Server already running, skipping bind for client {}", uuid_for_log);
        }
    });

    let has_token = spotify.get_client().read().await.access_token.is_some();
    if has_token {
        // Inject fake auth token so Mirabox UI doesn't try to open authorization.html
        let auth_bypass_msg = json!({
            "event": "setGlobalSettings",
            "context": uuid.clone(),
            "payload": {
                "access_token": "crimson_hijacked_token"
            }
        });
        let _ = tx_ws.send(auth_bypass_msg.to_string()).await;
    }

    let contexts = Arc::new(tokio::sync::Mutex::new(std::collections::HashMap::<String, String>::new()));
    let contexts_clone = contexts.clone();
    let contexts_render = contexts.clone();
    let tx_ws_clone = tx_ws.clone();
    let tx_ws_render = tx_ws.clone();
    let mut rx_spotify = spotify.subscribe_events();

    // Shared cache: stores last known Spotify data for immediate delivery on willAppear
    let last_state_cache: Arc<tokio::sync::Mutex<Option<serde_json::Value>>> = Arc::new(tokio::sync::Mutex::new(None));
    let last_state_cache_clone = last_state_cache.clone();

    // Cache the last composed PNG image (base64) for instant willAppear delivery
    let last_composed_cache: Arc<tokio::sync::Mutex<Option<String>>> = Arc::new(tokio::sync::Mutex::new(None));
    let last_composed_cache_clone = last_composed_cache.clone();
    let last_composed_cache_wa = last_composed_cache.clone();

    // ─── Shared Render State (for smooth 250ms timer interpolation) ───────────
    #[derive(Clone)]
    struct RenderState {
        album_jpeg: Vec<u8>,
        progress_ms_at_poll: u64,
        duration_ms: u64,
        is_playing: bool,
        polled_at: std::time::Instant,
        track_name: String,
        scroll_counter: u32,
    }

    let render_state: Arc<tokio::sync::Mutex<Option<RenderState>>> = Arc::new(tokio::sync::Mutex::new(None));
    let render_state_poll = render_state.clone();
    let render_state_render = render_state.clone();

    // ─── API Poll Loop: updates shared state, handles non-timer buttons ───────
    tokio::spawn(async move {
        let mut last_album_url = String::new();
        let mut last_base64_jpeg: Vec<u8> = Vec::new();
        let mut scroll_counter = 0u32;
        let top_track_img: Option<String> = None;

        while let Ok(state_json) = rx_spotify.recv().await {
            scroll_counter = scroll_counter.wrapping_add(1);
            let parsed: Result<serde_json::Value, _> = serde_json::from_str(&state_json);
            if let Ok(v) = parsed {
                if let Some(data) = v.get("data") {
                    *last_state_cache_clone.lock().await = Some(data.clone());

                    // Note: Top track fetch moved to a separate task.

                    let has_art = if let Some(album_art_url) = data["album_art"].as_str() {
                        if !album_art_url.is_empty() {
                            if album_art_url != last_album_url {
                                let client = reqwest::Client::new();
                                if let Ok(resp) = client.get(album_art_url).send().await {
                                    if let Ok(bytes) = resp.bytes().await {
                                        last_base64_jpeg = bytes.to_vec();
                                        last_album_url = album_art_url.to_string();
                                    }
                                }
                            }
                            true
                        } else { false }
                    } else { false };

                    // If no art, try to load default Spotify icon as fallback for display
                    if !has_art || last_base64_jpeg.is_empty() {
                        let icon_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str())
                            .join("HotSpot").join("StreamDock").join("plugins")
                            .join("com.mirabox.streamdock.spotify.sdPlugin").join("static").join("btn").join("btn_spotify_144_spot.png");
                        if let Ok(bytes) = std::fs::read(icon_path) {
                            last_base64_jpeg = bytes;
                            last_album_url = "default_spot".to_string();
                        }
                    }

                    // Always update shared render state if we have some image (even fallback)
                    if !last_base64_jpeg.is_empty() {
                        let mut rs = render_state_poll.lock().await;
                        *rs = Some(RenderState {
                            album_jpeg: last_base64_jpeg.clone(),
                            progress_ms_at_poll: data["progress_ms"].as_u64().unwrap_or(0),
                            duration_ms: data["duration_ms"].as_u64().unwrap_or(0),
                            is_playing: data["is_playing"].as_bool().unwrap_or(false),
                            polled_at: std::time::Instant::now(),
                            track_name: data["track_name"].as_str().unwrap_or("Spotify").to_string(),
                            scroll_counter,
                        });
                    }

                    // Handle non-timer buttons - ALWAYS update if context is active
                    let active_ctx = contexts_clone.lock().await.clone();
                    for (ctx, action_name) in &active_ctx {
                        if action_name.ends_with("likesong") {
                            let is_liked = data["is_liked"].as_bool().unwrap_or(false);
                            let msg = json!({ "event": "setState", "context": ctx, "payload": { "state": if is_liked { 1 } else { 0 } }}).to_string();
                            let _ = tx_ws_clone.send(msg).await;
                        }

                        if action_name.ends_with("info_toptrack") {
                            if let Some(ref img) = top_track_img {
                                let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": img, "target": 0 }}).to_string();
                                let _ = tx_ws_clone.send(msg).await;
                            }
                        }

                        if action_name.ends_with("info_artist") {
                            let artist = data["artist_name"].as_str().unwrap_or("Ready");
                            let img = compose_info_image(artist, if last_base64_jpeg.is_empty() { None } else { Some(&last_base64_jpeg) });
                            let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": img, "target": 0 }}).to_string();
                            let _ = tx_ws_clone.send(msg).await;
                        }

                        if action_name.ends_with("shuffle") {
                            let shuffle_state = data["shuffle_state"].as_bool().unwrap_or(false);
                            let smart_shuffle = data["smart_shuffle"].as_bool().unwrap_or(false);
                            let icon_name = if smart_shuffle {
                                "btn_spotify_144_smart_shuffle.png"
                            } else if shuffle_state {
                                "btn_spotify_144_shuffle.png"
                            } else {
                                "btn_spotify_144_shuffle_off.png"
                            };
                            let icon_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str())
                                .join("HotSpot").join("StreamDock").join("plugins")
                                .join("com.mirabox.streamdock.spotify.sdPlugin").join("static").join("btn").join(icon_name);
                            if let Ok(bytes) = std::fs::read(icon_path) {
                                use base64::{Engine as _, engine::general_purpose::STANDARD};
                                let b64 = STANDARD.encode(&bytes);
                                let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": format!("data:image/png;base64,{}", b64), "target": 0 }}).to_string();
                                let _ = tx_ws_clone.send(msg).await;
                            }
                        }

                        if action_name.ends_with("repeat") {
                            let repeat_state = data["repeat_state"].as_str().unwrap_or("off");
                            let state_idx = match repeat_state { "context" => 1, "track" => 2, _ => 0 };
                            let msg = json!({ "event": "setState", "context": ctx, "payload": { "state": state_idx }}).to_string();
                            let _ = tx_ws_clone.send(msg).await;
                        }
                    }
                }
            }
        }
    });

    // ─── Top Track Fetching Loop ──────────────────────────────────────────────
    let top_track_spotify = spotify.clone();
    let top_track_img_cache: Arc<tokio::sync::Mutex<Option<String>>> = Arc::new(tokio::sync::Mutex::new(None));
    let top_track_img_cache_clone = top_track_img_cache.clone();
    let tx_ws_toptrack = tx_ws.clone();
    let contexts_toptrack = contexts.clone();
    tokio::spawn(async move {
        loop {
            // Wait 5 seconds before first fetch to allow token refresh if needed
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            if let Some((art_url, name)) = top_track_spotify.get_top_track().await {
                let client = reqwest::Client::new();
                if let Ok(resp) = client.get(&art_url).send().await {
                    if let Ok(bytes) = resp.bytes().await {
                        let img = compose_toptrack_image(&bytes, &name);
                        *top_track_img_cache_clone.lock().await = Some(img.clone());
                        
                        // Push to active contexts
                        let active_ctx = contexts_toptrack.lock().await.clone();
                        for (ctx, action_name) in &active_ctx {
                            if action_name.ends_with("info_toptrack") {
                                let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": &img, "target": 0 }}).to_string();
                                let _ = tx_ws_toptrack.send(msg).await;
                            }
                        }
                    }
                }
            }
            tokio::time::sleep(tokio::time::Duration::from_secs(600)).await;
        }
    });

    // ─── Fast Render Loop: 250ms interpolated timer for playpause + progress ──
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(250));
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        let mut last_composed_key = String::new(); // avoid duplicate setImage for playpause

        loop {
            interval.tick().await;

            let snap = render_state_render.lock().await.clone();
            let Some(s) = snap else { continue };

            // Interpolate current position using wall-clock elapsed since last Spotify poll
            let elapsed_ms = if s.is_playing {
                s.polled_at.elapsed().as_millis() as u64
            } else {
                0
            };
            let current_progress = (s.progress_ms_at_poll + elapsed_ms).min(s.duration_ms);
            let remaining_s = s.duration_ms.saturating_sub(current_progress) / 1000;
            let timer_str = format!("{:}:{:02}", remaining_s / 60, remaining_s % 60);

            // Build a key to skip unchanged frames for playpause
            let compose_key = format!("{}-{}", s.track_name, timer_str);

            let active_ctx = contexts_render.lock().await.clone();

            for (ctx, action_name) in &active_ctx {
                if action_name.ends_with("playpause") {
                    if compose_key != last_composed_key {
                        let composed = compose_timer_on_image(&s.album_jpeg, &timer_str);
                        // Update willAppear cache
                        *last_composed_cache_clone.lock().await = Some(composed.clone());
                        let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": composed, "target": 0 }}).to_string();
                        let _ = tx_ws_render.send(msg).await;
                        let clear = json!({ "event": "setTitle", "context": ctx, "payload": { "title": "", "target": 0 }}).to_string();
                        let _ = tx_ws_render.send(clear).await;
                    }
                }

                if action_name.ends_with("info_progress") {
                    let img = compose_progress_image(current_progress, s.duration_ms);
                    let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": img, "target": 0 }}).to_string();
                    let _ = tx_ws_render.send(msg).await;
                }

                if action_name.ends_with("info_title") {
                    let img = compose_marquee_image(&s.track_name, s.scroll_counter);
                    let msg = json!({ "event": "setImage", "context": ctx, "payload": { "image": img, "target": 0 }}).to_string();
                    let _ = tx_ws_render.send(msg).await;
                }
            }

            if compose_key != last_composed_key {
                last_composed_key = compose_key;
            }
        }
    });

    while let Some(msg) = read.next().await {
        match msg {
            Ok(Message::Text(text)) => {
                let text_str = text.to_string(); // Keep string for easy printing
                let parsed: Result<serde_json::Value, _> = serde_json::from_str(&text_str);
                
                if let Ok(value) = parsed {
                    let event = value["event"].as_str().unwrap_or("");
                    let action = value["action"].as_str().unwrap_or("");
                    let context = value["context"].as_str().unwrap_or("");
                    
                    if event == "willAppear" || event == "didReceiveSettings" {
                        if action.ends_with("playpause") || action.ends_with("likesong") || action.ends_with("shuffle") || action.ends_with("repeat")
                            || action.ends_with("info_title") || action.ends_with("info_artist") || action.ends_with("info_progress") || action.ends_with("info_toptrack") {
                            contexts.lock().await.insert(context.to_string(), action.to_string());
                        }

                        // For playpause: immediately push last composed image on willAppear
                        if action.ends_with("playpause") {
                            // Try pre-composed cache first (instant)
                            let cached_composed = last_composed_cache_wa.lock().await.clone();
                            if let Some(composed_img) = cached_composed {
                                let ctx_clone = context.to_string();
                                let tx_clone = tx_ws.clone();
                                tokio::spawn(async move {
                                    let msg = json!({
                                        "event": "setImage",
                                        "context": ctx_clone,
                                        "payload": { "image": composed_img, "target": 0 }
                                    }).to_string();
                                    let _ = tx_clone.send(msg).await;
                                });
                            } else {
                                // Cold start: query Spotify API directly right now
                                let ctx_clone = context.to_string();
                                let tx_clone = tx_ws.clone();
                                let spotify_clone = spotify.clone();
                                tokio::spawn(async move {
                                    if let Some((art_url, timer_str)) = spotify_clone.get_current_state().await {
                                        let client = reqwest::Client::new();
                                        if let Ok(resp) = client.get(&art_url).send().await {
                                            if let Ok(bytes) = resp.bytes().await {
                                                let composed = compose_timer_on_image(&bytes, &timer_str);
                                                let msg = json!({
                                                    "event": "setImage",
                                                    "context": ctx_clone,
                                                    "payload": { "image": composed, "target": 0 }
                                                }).to_string();
                                                let _ = tx_clone.send(msg).await;
                                            }
                                        }
                                    }
                                });
                            }
                        }

                        if action.ends_with("playplaylist") {
                            // Track context if it wants cover
                            let show_cover = value["payload"]["settings"]["showCover"].as_bool().unwrap_or(false);
                            if show_cover {
                                contexts.lock().await.insert(context.to_string(), action.to_string());
                            } else {
                                contexts.lock().await.remove(context);
                            }
                            
                            // playplaylist specific logic: if showCover is true, get image and set it statically!
                            if show_cover {
                                if let Some(uri) = value["payload"]["settings"]["uri"].as_str() {
                                    let uri_clone = uri.to_string();
                                    let ctx_clone = context.to_string();
                                    let spotify_c = spotify.clone();
                                    let tx_clone = tx_ws.clone();
                                    tokio::spawn(async move {
                                        if let Some(img_url) = spotify_c.get_playlist_cover(&uri_clone).await {
                                            if !img_url.is_empty() {
                                                let client = reqwest::Client::new();
                                                if let Ok(resp) = client.get(&img_url).send().await {
                                                    if let Ok(bytes) = resp.bytes().await {
                                                        use base64::{Engine as _, engine::general_purpose::STANDARD};
                                                        let b64 = STANDARD.encode(&bytes);
                                                        let base64_image = format!("data:image/jpeg;base64,{}", b64);
                                                        let msg = json!({
                                                            "event": "setImage",
                                                            "context": ctx_clone,
                                                            "payload": {
                                                                "image": base64_image,
                                                                "target": 0
                                                            }
                                                        }).to_string();
                                                        let _ = tx_clone.send(msg).await;
                                                    }
                                                }
                                            }
                                        }
                                    });
                                }
                            }
                        }

                        // Send cached logic on willAppear so buttons don't get stuck loading
                        if action.ends_with("info_toptrack") {
                            let cached_top = top_track_img_cache.lock().await.clone();
                            if let Some(img) = cached_top {
                                let msg = json!({ "event": "setImage", "context": context, "payload": { "image": img, "target": 0 }}).to_string();
                                let _ = tx_ws.send(msg).await;
                            }
                        }

                        if let Some(last) = last_state_cache.lock().await.as_ref() {
                            if action.ends_with("info_artist") {
                                let artist = last["artist_name"].as_str().unwrap_or("Artist");
                                let img = compose_info_image(artist, None); 
                                let msg = json!({ "event": "setImage", "context": context, "payload": { "image": img, "target": 0 }}).to_string();
                                let _ = tx_ws.send(msg).await;
                            } else if action.ends_with("info_title") {
                                let title = last["track_name"].as_str().unwrap_or("");
                                let img = compose_marquee_image(title, 0);
                                let msg = json!({ "event": "setImage", "context": context, "payload": { "image": img, "target": 0 }}).to_string();
                                let _ = tx_ws.send(msg).await;
                            } else if action.ends_with("likesong") {
                                let is_liked = last["is_liked"].as_bool().unwrap_or(false);
                                let msg = json!({ "event": "setState", "context": context, "payload": { "state": if is_liked { 1 } else { 0 } }}).to_string();
                                let _ = tx_ws.send(msg).await;
                            } else if action.ends_with("shuffle") {
                                let smart_shuffle = last["smart_shuffle"].as_bool().unwrap_or(false);
                                let shuffle_state = last["shuffle_state"].as_bool().unwrap_or(false);
                                let icon_name = if smart_shuffle { "btn_spotify_144_smart_shuffle.png" } else if shuffle_state { "btn_spotify_144_shuffle.png" } else { "btn_spotify_144_shuffle_off.png" };
                                let icon_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("HotSpot").join("StreamDock").join("plugins").join("com.mirabox.streamdock.spotify.sdPlugin").join("static").join("btn").join(icon_name);
                                if let Ok(bytes) = std::fs::read(icon_path) {
                                    use base64::{Engine as _, engine::general_purpose::STANDARD};
                                    let b64 = STANDARD.encode(&bytes);
                                    let msg = json!({ "event": "setImage", "context": context, "payload": { "image": format!("data:image/png;base64,{}", b64), "target": 0 }}).to_string();
                                    let _ = tx_ws.send(msg).await;
                                }
                            } else if action.ends_with("repeat") {
                                let repeat_state = last["repeat_state"].as_str().unwrap_or("off");
                                let state_idx = match repeat_state { "context" => 1, "track" => 2, _ => 0 };
                                let msg = json!({ "event": "setState", "context": context, "payload": { "state": state_idx }}).to_string();
                                let _ = tx_ws.send(msg).await;
                            }
                        }
                    } else if event == "willDisappear" {
                        contexts.lock().await.remove(context);
                    }

                    // Dump to log file for debugging
                    let log_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("streamdock.log");
                    use std::io::Write;
                    if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                        let _ = writeln!(log_file, "Received Event: {} Action: {} Payload: {}", event, action, text_str);
                    }

                    // If the property inspector appears or asks for refresh, send data
                    let is_refresh = event == "sendToPlugin" && value["payload"]["type"] == "refresh";
                    
                    if event == "propertyInspectorDidAppear" || is_refresh {
                        if action.ends_with("playplaylist") || action.ends_with("playpause") || action.ends_with("playuri") || action.ends_with("changedevice") || action.ends_with("likesong") {
                            println!("Property inspector data requested for: {} (refresh={})", event, is_refresh);
                            
                            let playlists = spotify.get_user_playlists().await.unwrap_or_default();
                            let devices = spotify.get_user_devices().await.unwrap_or_default();
                            
                            let p_msg = json!({
                                "event": "sendToPropertyInspector",
                                "context": context,
                                "payload": {
                                    "playlists": playlists,
                                    "devices": devices
                                }
                            });
                            
                            let _ = tx_ws.send(p_msg.to_string()).await;
                        } else {
                            // Essential for stability: Send empty lists to actions like Volume to satisfy Property Inspector
                            let p_msg = json!({
                                "event": "sendToPropertyInspector",
                                "context": context,
                                "payload": {
                                    "playlists": [],
                                    "devices": []
                                }
                            });
                            let _ = tx_ws.send(p_msg.to_string()).await;
                        }
                    }

                    // Map StreamDock KeyUps/Dial Rotations to Spotify actions
                    if event == "keyUp" || event == "dialRotate" || event == "dialDown" {
                        println!("Action trigger detected: {}", action);
                        
                        let base_action = action.split('.').last().unwrap_or("");
                        let endpoint = match base_action {
                            "playpause" => "playpause",
                            "previous" => "previous",
                            "next" => "next",
                            "changedevice" => "switch-device",
                            "likesong" => "like",
                            "playuri" | "playplaylist" => "play",
                            "removeplaylistsong" => "unlike",
                            "addtoplaylist" => "add-to-playlist",
                            "repeat" => "repeat",
                            "shuffle" => "shuffle",
                            "volumeup" => "volumeup",
                            "volumedown" => "volumedown",
                            "volumeset" => "volumeset",
                            "volumecontrol" => "volumeup", // Map dial rotation to volumeup logic which handles ticks later?
                            "mute" => "mute",
                            "previousornext" => "skip", // dial rotation determines if next/prev
                            _ => ""
                        };

                        if !endpoint.is_empty() {
                            let _ = spotify.handle_command(endpoint, Some(value.clone())).await;
                        }
                    }
                } else {
                    println!("Failed to parse StreamDock JSON: {}", text_str);
                }
            }
            Ok(Message::Close(_)) => {
                println!("StreamDock connection closed.");
                break;
            }
            Err(e) => {
                eprintln!("Error reading from StreamDock WS: {}", e);
                break;
            }
            _ => {}
        }
    }
}

pub async fn start_mirabox_auth_server(spotify: Arc<SpotifyService>, tx_ws: Option<tokio::sync::mpsc::Sender<String>>, streamdock_uuid: Option<String>) {
    use tokio::net::TcpListener;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    let addr = "127.0.0.1:26433";
    if let Ok(listener) = TcpListener::bind(addr).await {
        println!("Mirabox Spotify Auth Server listening on {}", addr);
        while let Ok((mut stream, _)) = listener.accept().await {
            let spotify_clone = spotify.clone();
            let tx_ws_clone = tx_ws.clone();
            let uuid_clone = streamdock_uuid.clone();
            tokio::spawn(async move {
                let mut buffer = [0; 4096];
                if let Ok(size) = stream.read(&mut buffer).await {
                    let request = String::from_utf8_lossy(&buffer[..size]);
                    
                    if request.starts_with("GET /authorization") {
                        // Extract clientId and clientSecret
                        let mut client_id = "";
                        let mut client_secret = "";
                        
                        if let Some(query_start) = request.find('?') {
                            let query_end = request.find(" HTTP").unwrap_or(request.len());
                            let query = &request[query_start + 1..query_end];
                            for pair in query.split('&') {
                                let mut kv = pair.split('=');
                                if let (Some(k), Some(v)) = (kv.next(), kv.next()) {
                                    if k == "clientId" { client_id = v; }
                                    if k == "clientSecret" { client_secret = v; }
                                }
                            }
                        }

                        if !client_id.is_empty() && !client_secret.is_empty() {
                            // Save globally to spotify service
                            spotify_clone.set_client_credentials(client_id.to_string(), client_secret.to_string()).await;
                            
                            let scopes = "user-read-playback-state user-modify-playback-state user-read-currently-playing playlist-read-private playlist-read-collaborative user-library-read user-library-modify";
                            let redirect_uri = "http://127.0.0.1:26433/callback";
                            let url = format!("https://accounts.spotify.com/authorize?client_id={}&response_type=code&redirect_uri={}&scope={}", client_id, redirect_uri, scopes);
                            
                            let response = format!("HTTP/1.1 302 Found\r\nLocation: {}\r\n\r\n", url);
                            let _ = stream.write_all(response.as_bytes()).await;
                        } else {
                            let _ = stream.write_all(b"HTTP/1.1 400 Bad Request\r\n\r\nMissing Id/Secret").await;
                        }
                    } else if request.starts_with("GET /callback") {
                        // We received the code!
                        if let Some(code_start) = request.find("code=") {
                            let code_end = request.find(" HTTP").unwrap_or(request.len());
                            let code_full = &request[code_start..code_end];
                            let code = code_full.split('&').next().unwrap_or("").replace("code=", "");
                            
                            if !code.is_empty() {
                                // Trigger token exchange
                                let _ = spotify_clone.exchange_code(code).await;
                                
                                let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div><h1>Spotify Connected to Crimson Server!</h1><p>You can close this window now.</p></div></body></html>";
                                let _ = stream.write_all(response.as_bytes()).await;
                                
                                if let (Some(tx), Some(uuid)) = (tx_ws_clone, uuid_clone) {
                                    let auth_bypass_msg = json!({
                                        "event": "setGlobalSettings",
                                        "context": uuid,
                                        "payload": {
                                            "access_token": "crimson_hijacked_token"
                                        }
                                    });
                                    let _ = tx.send(auth_bypass_msg.to_string()).await;
                                }
                            }
                        }
                    } else {
                        let _ = stream.write_all(b"HTTP/1.1 404 Not Found\r\n\r\n").await;
                    }
                }
            });
        }
    }
}

/// Decode JPEG bytes, draw timer text with drop-shadow directly on the image, return base64-encoded PNG.
fn compose_timer_on_image(jpeg_bytes: &[u8], timer_str: &str) -> String {
    use image::Rgb;
    use imageproc::drawing::draw_text_mut;
    use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let img = match image::load_from_memory(jpeg_bytes) {
        Ok(i) => i.resize_exact(144, 144, image::imageops::FilterType::Lanczos3),
        Err(_) => return format!("data:image/jpeg;base64,{}", STANDARD.encode(jpeg_bytes)),
    };

    let mut rgb = img.to_rgb8();

    let font_bytes = include_bytes!("../assets/font.ttf");
    if let Ok(font) = FontRef::try_from_slice(font_bytes) {
        let scale = PxScale::from(42.0); // Slightly bigger for better legibility
        let scaled = font.as_scaled(scale);

        // Measure exact pixel width using glyph advance widths
        let text_width: f32 = timer_str.chars().map(|c| {
            scaled.h_advance(font.glyph_id(c))
        }).sum();

        let x = ((144.0 - text_width) / 2.0).max(0.0) as i32;
        let y = 90i32; // Positioning it nicely above the bottom edge

        let black = Rgb([0u8, 0u8, 0u8]);
        let white = Rgb([255u8, 255u8, 255u8]);

        // 8-direction thick drop shadow/outline for legibility on any background
        for (dx, dy) in &[(-2i32,0i32),(2,0),(0,-2),(0,2),(-2,-2),(2,-2),(-2,2),(2,2)] {
            draw_text_mut(&mut rgb, black, x + dx, y + dy, scale, &font, timer_str);
        }
        draw_text_mut(&mut rgb, white, x, y, scale, &font, timer_str);
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = rgb.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png);
    format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes))
}

// ─── Info Board: Scrolling Title ───────────────────────────────────────────
/// Dark background, title scrolls with soft fade-out on edges, Spotify green accent.
fn compose_marquee_image(text: &str, counter: u32) -> String {
    use image::{RgbImage, Rgb};
    use imageproc::drawing::{draw_text_mut, draw_filled_rect_mut};
    use imageproc::rect::Rect;
    use ab_glyph::{FontRef, PxScale, Font, ScaleFont};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    const W: u32 = 144;
    const H: u32 = 144;
    const BG: Rgb<u8> = Rgb([10u8, 10, 10]);
    const GREEN: Rgb<u8> = Rgb([30u8, 215, 96]);
    const FADE_W: u32 = 20; // width of fade zone on each side

    let mut img = RgbImage::from_pixel(W, H, BG);

    // Thin Spotify green accent line at top
    draw_filled_rect_mut(&mut img, Rect::at(0, 0).of_size(W, 3), GREEN);

    // Subtle separator line above title zone
    let sep_color = Rgb([35u8, 35, 35]);
    draw_filled_rect_mut(&mut img, Rect::at(8, 58).of_size(W - 16, 1), sep_color);
    draw_filled_rect_mut(&mut img, Rect::at(8, 96).of_size(W - 16, 1), sep_color);

    let font_bytes = include_bytes!("../assets/font.ttf");
    if let Ok(font) = FontRef::try_from_slice(font_bytes) {
        // "NOW PLAYING" label in green
        let label_scale = PxScale::from(13.0);
        let label = "NOW PLAYING";
        let label_scaled = font.as_scaled(label_scale);
        let label_w: f32 = label.chars().map(|c| label_scaled.h_advance(font.glyph_id(c))).sum();
        let label_x = ((W as f32 - label_w) / 2.0).max(0.0) as i32;
        draw_text_mut(&mut img, GREEN, label_x, 20, label_scale, &font, label);

        // Small music note left of label
        draw_text_mut(&mut img, GREEN, label_x - 16, 19, label_scale, &font, "\u{266a}");

        // Title text — compute width for scroll/center decision
        let title_scale = PxScale::from(28.0);
        let title_scaled = font.as_scaled(title_scale);
        let text_width: f32 = text.chars().map(|c| title_scaled.h_advance(font.glyph_id(c))).sum();
        let usable_w = W - (FADE_W * 2); // inner usable area

        let x = if text_width > usable_w as f32 {
            // Smooth scroll: 2px per tick (250ms interval), full cycle = text_width + gap
            let gap = 40u32;
            let total = text_width as u32 + gap;
            let shift = (counter * 4) % total;
            (FADE_W as i32) - shift as i32
        } else {
            // Centered
            ((W as f32 - text_width) / 2.0) as i32
        };

        // Draw title with subtle shadow for depth
        draw_text_mut(&mut img, Rgb([0, 0, 0]), x + 1, 69, title_scale, &font, text);
        draw_text_mut(&mut img, Rgb([255, 255, 255]), x, 68, title_scale, &font, text);

        // Gradient fade-out effect on left and right edges
        // We darken pixels near edges proportionally to create a smooth vanish effect
        for px_x in 0..FADE_W {
            let fade = 1.0 - (px_x as f32 / FADE_W as f32); // 1.0 at edge, 0.0 at inner
            let darken = (fade * fade * 255.0) as u8; // quadratic for smooth feel
            for py in 40..100u32 {
                // Left edge
                let pl = img.get_pixel_mut(px_x, py);
                pl[0] = pl[0].saturating_sub(darken);
                pl[1] = pl[1].saturating_sub(darken);
                pl[2] = pl[2].saturating_sub(darken);
                // Right edge
                let pr = img.get_pixel_mut(W - 1 - px_x, py);
                pr[0] = pr[0].saturating_sub(darken);
                pr[1] = pr[1].saturating_sub(darken);
                pr[2] = pr[2].saturating_sub(darken);
            }
        }
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = img.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png);
    format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes))
}

// ─── Info Board: Artist ─────────────────────────────────────────────────────
/// Dimmed cover art background, solid band at bottom with artist name.
fn compose_info_image(text: &str, cover_bytes: Option<&[u8]>) -> String {
    use image::{Rgb, RgbImage};
    use imageproc::drawing::{draw_text_mut, draw_filled_rect_mut};
    use imageproc::rect::Rect;
    use ab_glyph::{FontRef, PxScale, Font, ScaleFont};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let mut rgb = if let Some(bytes) = cover_bytes {
        match image::load_from_memory(bytes) {
            Ok(i) => {
                let mut resized = i.resize_exact(144, 144, image::imageops::FilterType::Lanczos3).to_rgb8();
                for px in resized.pixels_mut() {
                    px[0] = (px[0] as u32 * 55 / 100) as u8;
                    px[1] = (px[1] as u32 * 55 / 100) as u8;
                    px[2] = (px[2] as u32 * 55 / 100) as u8;
                }
                resized
            }
            Err(_) => RgbImage::from_pixel(144, 144, Rgb([20, 20, 20])),
        }
    } else {
        RgbImage::from_pixel(144, 144, Rgb([20, 20, 20]))
    };

    draw_filled_rect_mut(&mut rgb, Rect::at(0, 98).of_size(144, 46), Rgb([10, 10, 10]));

    let font_bytes = include_bytes!("../assets/font.ttf");
    if let Ok(font) = FontRef::try_from_slice(font_bytes) {
        let label_scale = PxScale::from(13.0);
        let label = "ARTIST";
        let label_scaled = font.as_scaled(label_scale);
        let label_w: f32 = label.chars().map(|c| label_scaled.h_advance(font.glyph_id(c))).sum();
        draw_text_mut(&mut rgb, Rgb([30, 215, 96]), ((144.0 - label_w) / 2.0) as i32, 101, label_scale, &font, label);

        let scale = PxScale::from(22.0);
        let scaled = font.as_scaled(scale);
        let display: String = if text.chars().count() > 18 {
            let truncated: String = text.chars().take(16).collect();
            format!("{}\u{2026}", truncated)
        } else {
            text.to_string()
        };
        let text_width: f32 = display.chars().map(|c| scaled.h_advance(font.glyph_id(c))).sum();
        let x = ((144.0 - text_width) / 2.0).max(2.0) as i32;

        draw_text_mut(&mut rgb, Rgb([0, 0, 0]), x + 1, 119, scale, &font, &display);
        draw_text_mut(&mut rgb, Rgb([255, 255, 255]), x, 118, scale, &font, &display);
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = rgb.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png);
    format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes))
}

// ─── Info Board: Barre de progression ──────────────────────────────────────
/// Pochette miniature en haut, barre vert Spotify au milieu, temps écoulé/restant.
fn compose_progress_image(progress_ms: u64, duration_ms: u64) -> String {
    use image::{RgbImage, Rgb};
    use imageproc::drawing::{draw_filled_rect_mut, draw_text_mut};
    use imageproc::rect::Rect;
    use ab_glyph::{FontRef, PxScale, Font, ScaleFont};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let mut img = RgbImage::from_pixel(144, 144, Rgb([15u8, 15, 15]));

    let percent = if duration_ms > 0 {
        (progress_ms as f64 / duration_ms as f64).clamp(0.0, 1.0)
    } else {
        0.0
    };

    // Barre de fond (gris foncé, arrondie simulée)
    draw_filled_rect_mut(&mut img, Rect::at(8, 65).of_size(128, 8), Rgb([50, 50, 50]));

    // Barre de progression verte
    let fill_w = ((128.0 * percent) as u32).max(0);
    if fill_w > 0 {
        draw_filled_rect_mut(&mut img, Rect::at(8, 65).of_size(fill_w, 8), Rgb([30, 215, 96]));
    }

    // Curseur rond (simulé par un carré plus haut)
    let cursor_x = (8.0 + 128.0 * percent - 4.0).max(8.0) as i32;
    draw_filled_rect_mut(&mut img, Rect::at(cursor_x, 61).of_size(8, 16), Rgb([255, 255, 255]));

    let font_bytes = include_bytes!("../assets/font.ttf");
    if let Ok(font) = FontRef::try_from_slice(font_bytes) {
        let scale = PxScale::from(18.0);

        // Temps écoulé (gauche)
        let elapsed_s = progress_ms / 1000;
        let elapsed_str = format!("{:}:{:02}", elapsed_s / 60, elapsed_s % 60);
        draw_text_mut(&mut img, Rgb([180, 180, 180]), 8, 82, scale, &font, &elapsed_str);

        // Temps restant (droite)
        let remaining_s = duration_ms.saturating_sub(progress_ms) / 1000;
        let remaining_str = format!("-{:}:{:02}", remaining_s / 60, remaining_s % 60);
        let scaled = font.as_scaled(scale);
        let rw: f32 = remaining_str.chars().map(|c| scaled.h_advance(font.glyph_id(c))).sum();
        let rx = (136.0 - rw) as i32;
        draw_text_mut(&mut img, Rgb([180, 180, 180]), rx, 82, scale, &font, &remaining_str);

        // Pourcentage centré grand
        let big_scale = PxScale::from(32.0);
        let pct_str = format!("{:.0}%", percent * 100.0);
        let big_scaled = font.as_scaled(big_scale);
        let pw: f32 = pct_str.chars().map(|c| big_scaled.h_advance(font.glyph_id(c))).sum();
        let px = ((144.0 - pw) / 2.0).max(0.0) as i32;
        // Ombre
        draw_text_mut(&mut img, Rgb([0, 80, 40]), px + 1, 21, big_scale, &font, &pct_str);
        draw_text_mut(&mut img, Rgb([30, 215, 96]), px, 20, big_scale, &font, &pct_str);

        // Label PROGRESS
        let label_scale = PxScale::from(13.0);
        let label = "PROGRESS";
        let label_scaled = font.as_scaled(label_scale);
        let label_w: f32 = label.chars().map(|c| label_scaled.h_advance(font.glyph_id(c))).sum();
        draw_text_mut(&mut img, Rgb([120, 120, 120]), ((144.0 - label_w) / 2.0) as i32, 106, label_scale, &font, label);
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = img.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png);
    format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes))
}

// ─── Info Board: Top Track ──────────────────────────────────────────────────
/// Full cover art, golden #1 badge, MY TOP label, track name centered at bottom.
fn compose_toptrack_image(cover_bytes: &[u8], track_name: &str) -> String {
    use image::{Rgb, RgbImage};
    use imageproc::drawing::{draw_text_mut, draw_filled_rect_mut};
    use imageproc::rect::Rect;
    use ab_glyph::{FontRef, PxScale, Font, ScaleFont};
    use base64::{Engine as _, engine::general_purpose::STANDARD};

    let mut rgb = match image::load_from_memory(cover_bytes) {
        Ok(i) => i.resize_exact(144, 144, image::imageops::FilterType::Lanczos3).to_rgb8(),
        Err(_) => RgbImage::from_pixel(144, 144, Rgb([20, 20, 20])),
    };

    // Bottom band for text
    draw_filled_rect_mut(&mut rgb, Rect::at(0, 96).of_size(144, 48), Rgb([10, 10, 10]));

    let font_bytes = include_bytes!("../assets/font.ttf");
    if let Ok(font) = FontRef::try_from_slice(font_bytes) {
        // Golden #1 badge top-right
        let badge_scale = PxScale::from(28.0);
        draw_filled_rect_mut(&mut rgb, Rect::at(104, 4).of_size(36, 32), Rgb([20, 20, 20]));
        draw_text_mut(&mut rgb, Rgb([255, 215, 0]), 106, 5, badge_scale, &font, "#1");

        // MY TOP label in Spotify green, centered
        let label_scale = PxScale::from(13.0);
        let label = "MY TOP";
        let label_scaled = font.as_scaled(label_scale);
        let label_w: f32 = label.chars().map(|c| label_scaled.h_advance(font.glyph_id(c))).sum();
        draw_text_mut(&mut rgb, Rgb([30, 215, 96]), ((144.0 - label_w) / 2.0) as i32, 98, label_scale, &font, label);

        // Track name, truncated if needed
        let scale = PxScale::from(21.0);
        let scaled = font.as_scaled(scale);
        let display: String = if track_name.chars().count() > 16 {
            let truncated: String = track_name.chars().take(14).collect();
            format!("{}\u{2026}", truncated)
        } else {
            track_name.to_string()
        };
        let tw: f32 = display.chars().map(|c| scaled.h_advance(font.glyph_id(c))).sum();
        let tx = ((144.0 - tw) / 2.0).max(2.0) as i32;

        draw_text_mut(&mut rgb, Rgb([0, 0, 0]), tx + 1, 118, scale, &font, &display);
        draw_text_mut(&mut rgb, Rgb([255, 255, 255]), tx, 117, scale, &font, &display);
    }

    let mut png_bytes: Vec<u8> = Vec::new();
    let _ = rgb.write_to(&mut std::io::Cursor::new(&mut png_bytes), image::ImageFormat::Png);
    format!("data:image/png;base64,{}", STANDARD.encode(&png_bytes))
}
