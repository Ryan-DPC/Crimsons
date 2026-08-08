use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use crate::db::StreamDockDB;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use crate::spotify::SpotifyService;
use crate::discord::DiscordService;
use dashmap::DashMap;
use std::collections::{HashSet, HashMap};
use tokio::sync::{mpsc, broadcast};

lazy_static::lazy_static! {
    pub static ref ACTIVE_BRIDGES: DashMap<String, HardwareBridge> = DashMap::new();
    pub static ref LAST_DIAL_EVENTS: DashMap<String, std::time::Instant> = DashMap::new();
}

#[derive(Clone)]
pub struct HardwareBridge {
    pub tx: mpsc::Sender<String>,
    pub alive: Arc<AtomicBool>,
    pub contexts: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    pub last_state_cache: Arc<tokio::sync::Mutex<Option<serde_json::Value>>>,
    pub pi_contexts: Arc<tokio::sync::Mutex<HashSet<String>>>,
    pub last_image_per_ctx: Arc<tokio::sync::Mutex<HashMap<String, String>>>,
    pub settings_per_ctx: Arc<tokio::sync::Mutex<HashMap<String, serde_json::Value>>>,
    pub hue: Arc<crate::hue::HueService>,
    pub twitch: Arc<crate::twitch::TwitchService>,
}

pub async fn try_acquire_handover(
    port: u16, 
    uuid: String, 
    register_event: String,
    spotify: Arc<SpotifyService>,
    discord: Arc<DiscordService>,
    hue: Arc<crate::hue::HueService>,
    twitch: Arc<crate::twitch::TwitchService>,
    db: Arc<StreamDockDB>,
    broadcast_tx: broadcast::Sender<String>
) -> bool {
    let mut stale = Vec::new();
    for bridge in ACTIVE_BRIDGES.iter() { if !bridge.alive.load(Ordering::Relaxed) { stale.push(bridge.key().clone()); } }
    for s in stale { ACTIVE_BRIDGES.remove(&s); }
    if let Some(bridge) = ACTIVE_BRIDGES.get(&uuid) {
        if bridge.alive.load(Ordering::Relaxed) {
            tracing::info!("[SD HANDOVER] Bridge for UUID {} is already alive and active. Skipping handover.", uuid);
            return true;
        }
    }
    if let Some((_, old_bridge)) = ACTIVE_BRIDGES.remove(&uuid) {
        old_bridge.alive.store(false, Ordering::Relaxed);
    }
    let (tx_ws, mut rx_ws_master) = mpsc::channel::<String>(500);
    let bridge_alive = Arc::new(AtomicBool::new(true));
    let contexts = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let last_state_cache = Arc::new(tokio::sync::Mutex::new(None));
    let pi_contexts = Arc::new(tokio::sync::Mutex::new(HashSet::new()));
    let last_image_per_ctx = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    let settings_per_ctx = Arc::new(tokio::sync::Mutex::new(HashMap::new()));
    ACTIVE_BRIDGES.insert(uuid.clone(), HardwareBridge { tx: tx_ws.clone(), alive: bridge_alive.clone(), contexts: contexts.clone(), last_state_cache: last_state_cache.clone(), pi_contexts: pi_contexts.clone(), last_image_per_ctx: last_image_per_ctx.clone(), settings_per_ctx: settings_per_ctx.clone(), hue: hue.clone(), twitch: twitch.clone() });
    let uuid_spawn = uuid.clone();
    let reg_event_spawn = register_event.clone();
    tokio::spawn(async move {
        let ws_url = format!("ws://127.0.0.1:{}", port);
        if let Ok((ws_stream, _)) = connect_async(&ws_url).await {
            let (mut write, mut read) = ws_stream.split();
            let _ = write.send(Message::Text(json!({ "event": reg_event_spawn, "uuid": uuid_spawn }).to_string())).await;
            
            let app_data = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
            if let Some(last_rank) = app_data.other.get("last_rank") {
                let _ = write.send(Message::Text(last_rank.to_string())).await;
            }
            if let Some(last_summoner) = app_data.other.get("last_summoner") {
                let _ = write.send(Message::Text(last_summoner.to_string())).await;
            }
            
            let mut rx_broadcast = broadcast_tx.subscribe();
            loop {
                tokio::select! {
                    msg = rx_broadcast.recv() => { if let Ok(text) = msg { if let Err(_) = write.send(Message::Text(text)).await { break; } } }
                    msg = rx_ws_master.recv() => { if let Some(text) = msg { if let Err(_) = write.send(Message::Text(text)).await { break; } } }
                    msg = read.next() => {
                        match msg {
                            Some(Ok(Message::Text(t))) => {
                                // Broadcast raw hardware events to all JS instances (app.js)
                                let _ = broadcast_tx.send(t.clone());
                                
                                if let Ok(val) = serde_json::from_str::<serde_json::Value>(&t) {
                                    let event = val["event"].as_str().unwrap_or("");
                                    let context = val["context"].as_str().unwrap_or("");
                                    let action = val["action"].as_str().unwrap_or("");
                                    if event == "willAppear" && !context.is_empty() {
                                        contexts.lock().await.insert(context.to_string(), action.to_string());
                                        if let Some(settings) = val["payload"].get("settings") {
                                            settings_per_ctx.lock().await.insert(context.to_string(), settings.clone());
                                        }
                                    }
                                    if event == "willDisappear" && !context.is_empty() {
                                        contexts.lock().await.remove(context);
                                        settings_per_ctx.lock().await.remove(context);
                                    }
                                    if (event == "setSettings" || event == "didReceiveSettings") && !context.is_empty() {
                                        if let Some(settings) = val["payload"].get("settings") {
                                            settings_per_ctx.lock().await.insert(context.to_string(), settings.clone());
                                        }
                                    }
                                    process_streamdeck_event(val, spotify.clone(), discord.clone(), tx_ws.clone(), contexts.clone(), pi_contexts.clone(), last_state_cache.clone(), settings_per_ctx.clone(), hue.clone(), twitch.clone(), db.clone()).await;
                                }
                            }
                            _ => break,
                        }
                    }
                }
            }
        }
        bridge_alive.store(false, Ordering::Relaxed);
        ACTIVE_BRIDGES.remove(&uuid_spawn);
    });
    true
}

pub async fn start_streamdock_client(_p: u16, _u: String, _r: String, _s: Arc<SpotifyService>, _d: Arc<DiscordService>, _h: Arc<crate::hue::HueService>, _t: Arc<crate::twitch::TwitchService>, _db: Arc<StreamDockDB>) {
    // Stub
}

pub async fn start_mirabox_auth_server<T>(_auth: Arc<T>, _tx: Option<mpsc::Sender<String>>, _rx: Option<Arc<tokio::sync::Mutex<HashMap<String, String>>>>) {
    // Stub with generic type
}

/// Returns true if the image is new for this context and should be pushed.
/// Used to avoid re-sending the same cover (or empty/default) which flashes the
/// stock Spotify logo on StreamDock keys.
pub async fn push_image_if_changed(context: &str, image: &str) -> bool {
    if image.is_empty() {
        return false;
    }
    for bridge in ACTIVE_BRIDGES.iter() {
        let mut last = bridge.last_image_per_ctx.lock().await;
        if last.get(context).map(|s| s.as_str()) == Some(image) {
            return false;
        }
        last.insert(context.to_string(), image.to_string());
    }
    true
}

pub async fn process_streamdeck_event(value: serde_json::Value, spotify: Arc<SpotifyService>, _d: Arc<DiscordService>, _tx: mpsc::Sender<String>, contexts: Arc<tokio::sync::Mutex<HashMap<String, String>>>, _pi: Arc<tokio::sync::Mutex<HashSet<String>>>, _ls: Arc<tokio::sync::Mutex<Option<serde_json::Value>>>, _spc: Arc<tokio::sync::Mutex<HashMap<String, serde_json::Value>>>, _h: Arc<crate::hue::HueService>, _t: Arc<crate::twitch::TwitchService>, _db: Arc<StreamDockDB>) {
    let event = value["event"].as_str().unwrap_or("");
    let context = value["context"].as_str().unwrap_or("");
    let mut action = value["action"].as_str().unwrap_or("").to_string();
    if action.is_empty() && !context.is_empty() { if let Some(act) = contexts.lock().await.get(context) { action = act.clone(); } }
    
    if action.starts_with("com.laoy.streamdock.spotify") || 
       action.starts_with("com.laoy.streamdock.discord") || 
       action.starts_with("com.laoy.streamdock.hue") || 
       action.starts_with("com.laoy.streamdock.twitch") {
        // Meme regle que pour les commandes WebSocket : le verdict vient de
        // Supabase, jamais de data.json.
        if !crate::entitlement::is_premium().await {
            tracing::warn!("[AUTH] Blocked StreamDock action {} for free user", action);
            return;
        }
    }

    // Property Inspectors are HTML-only (no Node/ActiveX), so they cannot read
    // auth.token for a direct ws://40510 connection under strict auth. Push
    // Spotify PI data over the StreamDeck bridge instead.
    let pi_refresh = event == "sendToPlugin"
        && matches!(
            value["payload"]["type"].as_str(),
            Some("refresh") | Some("requestPiData")
        );
    if action.starts_with("com.laoy.streamdock.spotify")
        && (event == "propertyInspectorDidAppear" || pi_refresh)
    {
        let ctx = context.to_string();
        let act = action.clone();
        let s = spotify.clone();
        let tx = _tx.clone();
        tokio::spawn(async move {
            let playlists = s.get_user_playlists().await.unwrap_or_default();
            let devices = s.get_user_devices().await.unwrap_or_default();
            let _ = tx
                .send(
                    json!({
                        "event": "sendToPropertyInspector",
                        "context": ctx,
                        "action": act,
                        "payload": {
                            "playlists": playlists,
                            "devices": devices,
                            "authorized": true
                        }
                    })
                    .to_string(),
                )
                .await;
        });
    }

    // Never clear a key image to empty/null during sync — that flashes the default
    // Spotify logo. Dedup helper is available for outbound callers.
    if event == "setImage" {
        let img = value["payload"]["image"].as_str();
        if img.map(|s| s.is_empty()).unwrap_or(true) {
            return;
        }
        if let (Some(ctx), Some(image)) = (value["context"].as_str(), img) {
            let _ = push_image_if_changed(ctx, image).await;
        }
    }

    let pressed = value["payload"]["pressed"].as_bool().unwrap_or(true);
    if event == "keyDown" || (event == "dialPress" && pressed) {
        match action.as_str() {
            "com.laoy.streamdock.spotify.playpause" |
            "com.laoy.streamdock.spotify.next" |
            "com.laoy.streamdock.spotify.previous" |
            "com.laoy.streamdock.spotify.shuffle" |
            "com.laoy.streamdock.spotify.repeat" |
            "com.laoy.streamdock.spotify.volumecontrol" |
            "com.laoy.streamdock.spotify.previousornext" |
            "com.laoy.streamdock.spotify.likesong" |
            "com.laoy.streamdock.spotify.changedevice" |
            "com.laoy.streamdock.spotify.playuri" |
            "com.laoy.streamdock.spotify.playplaylist" => {
                if !spotify.is_enabled.load(Ordering::Relaxed) {
                    tracing::info!("[SPOTIFY] Key action ignored: service disabled");
                    return;
                }
            }
            _ => {}
        }
        match action.as_str() {
            "com.laoy.streamdock.spotify.playpause" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("playpause", None).await; });
            }
            "com.laoy.streamdock.spotify.next" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("next", None).await; });
            }
            "com.laoy.streamdock.spotify.previous" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("prev", None).await; });
            }
            "com.laoy.streamdock.spotify.shuffle" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("shuffle", None).await; });
            }
            "com.laoy.streamdock.spotify.repeat" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("repeat", None).await; });
            }
            "com.laoy.streamdock.spotify.volumecontrol" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("mute", None).await; });
            }
            "com.laoy.streamdock.spotify.previousornext" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("playpause", None).await; });
            }
            "com.laoy.streamdock.spotify.likesong" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("likesong", None).await; });
            }
            "com.laoy.streamdock.spotify.changedevice" => {
                let s = spotify.clone();
                tokio::spawn(async move { let _ = s.handle_command("changedevice", None).await; });
            }
            "com.laoy.streamdock.spotify.playuri" => {
                let s = spotify.clone();
                let settings = value["payload"]["settings"].clone();
                tokio::spawn(async move { let _ = s.handle_command("playuri", Some(settings)).await; });
            }
            "com.laoy.streamdock.spotify.playplaylist" => {
                let s = spotify.clone();
                let settings = value["payload"]["settings"].clone();
                tokio::spawn(async move { let _ = s.handle_command("play", Some(settings)).await; });
            }
            "com.laoy.streamdock.discord.togglemute" => {
                if _d.is_enabled.load(Ordering::Relaxed) {
                    let d = _d.clone();
                    tokio::spawn(async move { let _ = d.handle_command("toggleMute", None).await; });
                }
            }
            "com.laoy.streamdock.discord.toggledeafen" => {
                if _d.is_enabled.load(Ordering::Relaxed) {
                    let d = _d.clone();
                    tokio::spawn(async move { let _ = d.handle_command("toggleDeafen", None).await; });
                }
            }
            "com.laoy.streamdock.discord.togglecamera" => {
                if _d.is_enabled.load(Ordering::Relaxed) {
                    let d = _d.clone();
                    tokio::spawn(async move { let _ = d.handle_command("toggleCamera", None).await; });
                }
            }
            "com.laoy.streamdock.discord.joinvoice" => {
                if _d.is_enabled.load(Ordering::Relaxed) {
                    let d = _d.clone();
                    let mut settings = value["payload"]["settings"].clone();
                    if settings.get("channelId").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
                        if let Some(cached) = _spc.lock().await.get(context) {
                            settings = cached.clone();
                        }
                    }
                    tokio::spawn(async move {
                        let _ = d.handle_command("joinVoiceChannel", Some(settings)).await;
                    });
                }
            }
            a if a.starts_with("com.laoy.streamdock.hue.") => {
                tracing::warn!("[HUE] StreamDock key rejected: {}", crate::hue::UNAVAILABLE_MSG);
                let h = _h.clone();
                let endpoint = a.rsplit('.').next().unwrap_or("").to_string();
                tokio::spawn(async move { let _ = h.handle_command(&endpoint, None).await; });
            }
            a if a.starts_with("com.laoy.streamdock.twitch.") => {
                tracing::warn!("[TWITCH] StreamDock key rejected: {}", crate::twitch::UNAVAILABLE_MSG);
                let t = _t.clone();
                let endpoint = a.rsplit('.').next().unwrap_or("").to_string();
                tokio::spawn(async move { let _ = t.handle_command(&endpoint, None).await; });
            }
            _ => {}
        }
    }

    if event == "dialRotate" {
        let ticks = value["payload"]["ticks"].as_i64().unwrap_or(0);
        let context_str = context.to_string();
        
        let now = std::time::Instant::now();
        let should_process = {
            if let Some(entry) = LAST_DIAL_EVENTS.get(&context_str) {
                let last_time = entry.value();
                now.checked_duration_since(*last_time).unwrap_or_default() >= std::time::Duration::from_millis(120)
            } else {
                true
            }
        };
        
        if should_process {
            LAST_DIAL_EVENTS.insert(context_str, now);
            match action.as_str() {
                "com.laoy.streamdock.spotify.volumecontrol" => {
                    if spotify.is_enabled.load(Ordering::Relaxed) {
                        let s = spotify.clone();
                        tokio::spawn(async move {
                            let _ = s.handle_command("volumecontrol", Some(json!({ "ticks": ticks }))).await;
                        });
                    }
                }
                "com.laoy.streamdock.spotify.previousornext" => {
                    if spotify.is_enabled.load(Ordering::Relaxed) {
                        let s = spotify.clone();
                        let direction = if ticks > 0 { 1 } else { -1 };
                        tokio::spawn(async move {
                            let _ = s.handle_command("skip", Some(json!({ "ticks": direction }))).await;
                        });
                    }
                }
                _ => {}
            }
        }
    }

    // Explicit command forwarding via JS API
    if value["type"] == "SPOTIFY_COMMAND" {
        if let Some(endpoint) = value["endpoint"].as_str() {
            if spotify.is_enabled.load(Ordering::Relaxed) {
                let s = spotify.clone();
                let endpoint_str = endpoint.to_string();
                let val_clone = value.clone();
                tokio::spawn(async move {
                    let _ = s.handle_command(&endpoint_str, Some(val_clone)).await;
                });
            }
        }
    }
    if value["type"] == "DISCORD_COMMAND" {
        if let Some(endpoint) = value["endpoint"].as_str() {
            if _d.is_enabled.load(Ordering::Relaxed) {
                let d = _d.clone();
                let endpoint_str = endpoint.to_string();
                let val_clone = value.clone();
                tokio::spawn(async move {
                    let _ = d.handle_command(&endpoint_str, Some(val_clone)).await;
                });
            }
        }
    }
    if value["type"] == "HUE_COMMAND" {
        tracing::warn!("[HUE] StreamDock command rejected: {}", crate::hue::UNAVAILABLE_MSG);
        let _ = _h.handle_command(value["endpoint"].as_str().unwrap_or(""), Some(value.clone())).await;
    }
    if value["type"] == "TWITCH_COMMAND" {
        tracing::warn!("[TWITCH] StreamDock command rejected: {}", crate::twitch::UNAVAILABLE_MSG);
        let _ = _t.handle_command(value["endpoint"].as_str().unwrap_or(""), Some(value.clone())).await;
    }
    if value["type"] == "ADJUST_AUDIO" {
        if _d.is_enabled.load(Ordering::Relaxed) {
            let ticks = value["ticks"].as_i64().unwrap_or(0);
            tokio::spawn(async move {
                let _ = crate::discord::DiscordService::adjust_aux_volume(ticks).await;
            });
        }
    }
    if value["type"] == "TOGGLE_AUDIO_MUTE" {
        if _d.is_enabled.load(Ordering::Relaxed) {
            tokio::spawn(async move {
                let _ = crate::discord::DiscordService::toggle_aux_mute().await;
            });
        }
    }
}
