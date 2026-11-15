use serde::{Deserialize, Serialize};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use tokio::sync::RwLock;
use std::sync::Arc;
use crate::events::WsSender;
use serde_json::json;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SpotifyState {
    pub is_playing: bool,
    pub track_name: String,
    pub artist_name: String,
    pub track_artist: String,
    pub album_art: String,
    pub progress_ms: u32,
    pub duration_ms: u32,
    pub has_token: bool,
    /// Client ID + Secret already on disk (data.json / spotify_cache). UI must
    /// not force a re-paste when this is true.
    #[serde(default)]
    pub has_credentials: bool,
    /// Public Client ID only — never the secret — so Settings can prefill.
    #[serde(default)]
    pub saved_client_id: String,
    pub volume_percent: u32,
    pub shuffle_state: bool,
    pub smart_shuffle: bool,
    pub repeat_state: String,
    pub track_uri: String,
    pub track_id: String,
    pub is_liked: bool,
}

/// Spotify may return `smart_shuffle` as a bool or (rarely) a non-empty array.
fn parse_smart_shuffle(json: &serde_json::Value) -> bool {
    if json["smart_shuffle"].as_bool() == Some(true) {
        return true;
    }
    if let Some(arr) = json["smart_shuffle"].as_array() {
        return !arr.is_empty();
    }
    false
}

pub struct SpotifyClient {
    pub access_token: Option<String>,
    pub refresh_token: Option<String>,
    pub expires_at: u64,
    pub client_id: String,
    pub client_secret: String,
    pub display_name: Option<String>,
}

impl SpotifyClient {
    pub fn new() -> Self {
        let mut client = Self {
            access_token: None,
            refresh_token: None,
            expires_at: 0,
            client_id: String::new(),
            client_secret: String::new(),
            display_name: None,
        };
        client.load();
        client
    }

    pub fn load(&mut self) {
        let path = crate::storage::get_data_dir().join("spotify_cache.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(json) = serde_json::from_str::<serde_json::Value>(&data) {
                self.access_token = json["access_token"].as_str().map(|s| s.to_string());
                self.refresh_token = json["refresh_token"].as_str().map(|s| s.to_string());
                self.expires_at = json["expires_at"].as_u64().unwrap_or(0);
                self.client_id = json["client_id"].as_str().unwrap_or("").to_string();
                self.client_secret = json["client_secret"].as_str().unwrap_or("").to_string();
                self.display_name = json["display_name"].as_str().map(|s| s.to_string());
            }
        }
        // data.json is the canonical place the UI writes Client ID / Secret.
        let app = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
        if self.client_id.is_empty() && !app.spotify_client_id.is_empty() {
            self.client_id = app.spotify_client_id;
        }
        if self.client_secret.is_empty() && !app.spotify_client_secret.is_empty() {
            self.client_secret = app.spotify_client_secret;
        }
        // Fallback: Tauri may have written only flatten-other keys before the
        // sidecar typed fields were populated.
        if self.client_id.is_empty() {
            if let Some(id) = app.other.get("spotifyClientId").and_then(|v| v.as_str()) {
                self.client_id = id.to_string();
            }
        }
        if self.client_secret.is_empty() {
            if let Some(secret) = app.other.get("spotifyClientSecret").and_then(|v| v.as_str()) {
                self.client_secret = secret.to_string();
            }
        }
    }

    pub fn save(&self) {
        let path = crate::storage::get_data_dir().join("spotify_cache.json");
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        let json = json!({
            "access_token": self.access_token,
            "refresh_token": self.refresh_token,
            "expires_at": self.expires_at,
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "display_name": self.display_name,
        });
        let _ = std::fs::write(path, json.to_string());

        // Mirror credentials into data.json so the UI and sidecar stay aligned
        // without ever putting the secret in localStorage or URL queries.
        self.mirror_credentials_to_data_json();
    }

    /// If spotify_cache has Client ID/Secret but data.json was wiped (UI race /
    /// Default AppData overwrite), restore them so Settings shows association.
    /// Patches the JSON document in-place so unrelated keys (plugins, hist,
    /// firstLaunchFinished) cannot be dropped by an AppData round-trip.
    fn mirror_credentials_to_data_json(&self) {
        if self.client_id.is_empty() && self.client_secret.is_empty() {
            return;
        }
        let path = crate::storage::get_data_path_from_env();
        let mut root: serde_json::Value = match std::fs::read_to_string(&path) {
            Ok(content) if !content.trim().is_empty() => {
                serde_json::from_str(&content).unwrap_or_else(|_| serde_json::json!({}))
            }
            _ => serde_json::json!({}),
        };
        if !root.is_object() {
            root = serde_json::json!({});
        }
        let obj = root.as_object_mut().unwrap();
        let mut dirty = false;
        if !self.client_id.is_empty() {
            let cur = obj.get("spotifyClientId").and_then(|v| v.as_str()).unwrap_or("");
            if cur.is_empty() || cur != self.client_id {
                obj.insert(
                    "spotifyClientId".into(),
                    serde_json::Value::String(self.client_id.clone()),
                );
                dirty = true;
            }
        }
        if !self.client_secret.is_empty() {
            let cur = obj
                .get("spotifyClientSecret")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            if cur.is_empty() || cur != self.client_secret {
                obj.insert(
                    "spotifyClientSecret".into(),
                    serde_json::Value::String(self.client_secret.clone()),
                );
                dirty = true;
            }
        }
        if dirty {
            if let Ok(content) = serde_json::to_string_pretty(&root) {
                let _ = std::fs::write(&path, content);
                // Invalidate sidecar AppData cache so subsequent loads see the patch.
                crate::storage::invalidate_cache();
                tracing::info!("[SPOTIFY] Identifiants resynchronises vers data.json depuis le cache");
            }
        }
    }
}

pub struct SpotifyService {
    client: Arc<RwLock<SpotifyClient>>,
    sender: WsSender,
    playlists_cache: Arc<tokio::sync::Mutex<Option<(Vec<serde_json::Value>, std::time::Instant)>>>,
    devices_cache: Arc<tokio::sync::Mutex<Option<(Vec<serde_json::Value>, std::time::Instant)>>>,
    smart_shuffle_active: Arc<std::sync::atomic::AtomicBool>,
    cached_volume: Arc<std::sync::atomic::AtomicU32>,
    last_volume_change: Arc<std::sync::Mutex<std::time::Instant>>,
    last_command_time: Arc<std::sync::Mutex<std::collections::HashMap<String, std::time::Instant>>>,
    pub is_enabled: Arc<std::sync::atomic::AtomicBool>,
    pub cached_state: Arc<tokio::sync::RwLock<Option<SpotifyState>>>,
    pub notify: Arc<tokio::sync::Notify>,
}

impl SpotifyService {
    pub async fn update_tokens_js(&self) {
        let (access, refresh, id, _secret) = {
            let lock = self.client.read().await;
            (lock.access_token.clone(), lock.refresh_token.clone(), lock.client_id.clone(), lock.client_secret.clone())
        };

        let playlists = self.get_user_playlists().await.unwrap_or_default();
        let devices = self.get_user_devices().await.unwrap_or_default();
        let playlists_json = serde_json::to_string(&playlists).unwrap_or_else(|_| "[]".to_string());
        let devices_json = serde_json::to_string(&devices).unwrap_or_else(|_| "[]".to_string());

        let plugins_base = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str())
            .join("HotSpot").join("StreamDock").join("plugins");
        
        let target_plugins = vec![
            "com.laoy.streamdock.spotify.sdPlugin",
            "com.laoy.streamdock.crimson.sdPlugin"
        ];

        // Never inject client_secret into plugin JS — the sidecar alone holds it.
        let js_content = format!(
            "if (typeof $websocket !== 'undefined' && $websocket && $websocket.readyState === 1) {{\n\
                if (!window.crimsonInjected) {{\n\
                    $websocket.setGlobalSettings({{\n\
                        access_token: '{}',\n\
                        accessToken: '{}',\n\
                        token: '{}',\n\
                        refresh_token: '{}',\n\
                        refreshToken: '{}',\n\
                        clientId: '{}',\n\
                        client_id: '{}',\n\
                        authorized: true,\n\
                        authenticated: true\n\
                    }});\n\
                    const data = {{ playlists: {}, devices: {}, authorized: true }};\n\
                    if (typeof $propEvent !== 'undefined' && $propEvent.sendToPropertyInspector) {{\n\
                        $propEvent.sendToPropertyInspector(data);\n\
                    }} else {{\n\
                        window.crimsonPendingData = data;\n\
                    }}\n\
                    window.crimsonInjected = true;\n\
                }}\n\
            }}",
            access.clone().unwrap_or_default(),
            access.clone().unwrap_or_default(),
            access.clone().unwrap_or_default(),
            refresh.clone().unwrap_or_default(),
            refresh.clone().unwrap_or_default(),
            id,
            id,
            playlists_json,
            devices_json
        );

        for plugin_id in target_plugins {
            let path = plugins_base.join(plugin_id).join("propertyInspector").join("utils").join("tokens.js");
            if let Some(parent) = path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(path, &js_content);
        }
    }

    pub fn new(sender: WsSender) -> Self {
        let client = SpotifyClient::new();
        // Heal data.json if tokens/creds only survive in spotify_cache.json.
        client.mirror_credentials_to_data_json();
        Self {
            client: Arc::new(RwLock::new(client)),
            sender,
            playlists_cache: Arc::new(tokio::sync::Mutex::new(None)),
            devices_cache: Arc::new(tokio::sync::Mutex::new(None)),
            smart_shuffle_active: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cached_volume: Arc::new(std::sync::atomic::AtomicU32::new(50)),
            last_volume_change: Arc::new(std::sync::Mutex::new(std::time::Instant::now().checked_sub(std::time::Duration::from_secs(10)).unwrap_or_else(|| std::time::Instant::now()))),
            last_command_time: Arc::new(std::sync::Mutex::new(std::collections::HashMap::new())),
            is_enabled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            cached_state: Arc::new(tokio::sync::RwLock::new(None)),
            notify: Arc::new(tokio::sync::Notify::new()),
        }
    }

    pub fn get_client(&self) -> Arc<RwLock<SpotifyClient>> {
        self.client.clone()
    }

    /// Auth snapshot for UI hydrate — works even when Hub toggle is off
    /// (polling is paused, so SPOTIFY_STATE would otherwise never arrive).
    pub async fn auth_snapshot_state(&self) -> SpotifyState {
        let (has_token, has_credentials, saved_client_id) = {
            let lock = self.client.read().await;
            (
                lock.access_token.is_some() || lock.refresh_token.is_some(),
                !lock.client_id.is_empty() && !lock.client_secret.is_empty(),
                lock.client_id.clone(),
            )
        };
        if let Some(mut cached) = self.cached_state.read().await.clone() {
            cached.has_token = has_token || cached.has_token;
            cached.has_credentials = has_credentials || cached.has_credentials;
            if cached.saved_client_id.is_empty() {
                cached.saved_client_id = saved_client_id;
            }
            return cached;
        }
        SpotifyState {
            has_token,
            has_credentials,
            saved_client_id,
            ..Default::default()
        }
    }

    pub fn subscribe_events(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.sender.0.subscribe()
    }

    pub fn broadcast_external_event(&self, event: String) -> Result<usize, tokio::sync::broadcast::error::SendError<String>> {
        self.sender.0.send(event)
    }

    pub async fn ensure_valid_token(&self) -> Option<String> {
        let (access, refresh, expires_at, id, secret) = {
            let lock = self.client.read().await;
            (lock.access_token.clone(), lock.refresh_token.clone(), lock.expires_at, lock.client_id.clone(), lock.client_secret.clone())
        };

        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        
        // If we have a token and it's not expired (with 30s buffer), return it
        if let Some(token) = access {
            if expires_at > 0 && now < expires_at.saturating_sub(30) {
                return Some(token);
            }
        }

        // Otherwise try to refresh
        if let (Some(r_token), id, secret) = (refresh, id, secret) {
            if !id.is_empty() && !secret.is_empty() {
                let client = reqwest::Client::new();
                let auth_str = format!("{}:{}", id, secret);
                let b64 = STANDARD.encode(auth_str.as_bytes());
                let params = [("grant_type", "refresh_token"), ("refresh_token", &r_token)];
                
                if let Ok(resp) = client.post("https://accounts.spotify.com/api/token")
                    .header(AUTHORIZATION, format!("Basic {}", b64))
                    .form(&params)
                    .send()
                    .await {
                    if resp.status().is_success() {
                        if let Ok(json) = resp.json::<serde_json::Value>().await {
                            if let (Some(acc), Some(expire)) = (json["access_token"].as_str(), json["expires_in"].as_u64()) {
                                let new_refresh = json["refresh_token"].as_str().unwrap_or(&r_token).to_string();
                                let mut lock = self.client.write().await;
                                lock.access_token = Some(acc.to_string());
                                lock.refresh_token = Some(new_refresh);
                                lock.expires_at = now + expire;
                                lock.save();
                                return Some(acc.to_string());
                            }
                        }
                    }
                }
            }
        }
        None
    }

    pub async fn get_credentials(&self) -> (String, String, Option<String>) {
        let token = self.ensure_valid_token().await;
        let lock = self.client.read().await;
        (lock.client_id.clone(), lock.client_secret.clone(), token)
    }

    pub async fn get_display_name(&self) -> String {
        let lock = self.client.read().await;
        lock.display_name.clone().unwrap_or_else(|| "Spotify User".to_string())
    }

    pub async fn fetch_user_profile(&self) -> Result<String, Box<dyn std::error::Error>> {
        let token = self.ensure_valid_token().await.ok_or("No token")?;
        let client = reqwest::Client::new();
        let resp = client.get("https://api.spotify.com/v1/me")
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send().await?;
        
        if resp.status().is_success() {
            let json: serde_json::Value = resp.json().await?;
            if let Some(name) = json["display_name"].as_str() {
                let mut lock = self.client.write().await;
                lock.display_name = Some(name.to_string());
                lock.save();
                return Ok(name.to_string());
            }
        }
        Ok("Spotify User".to_string())
    }

    pub async fn get_playlists_json(&self) -> String {
        let token = match self.ensure_valid_token().await {
            Some(t) => t,
            None => return json!({ "playlists": [], "error": "No token" }).to_string(),
        };
        let client = reqwest::Client::new();
        if let Ok(resp) = client.get("https://api.spotify.com/v1/me/playlists?limit=50")
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send().await {
            if let Ok(json) = resp.json::<serde_json::Value>().await {
                if let Some(items) = json["items"].as_array() {
                    return json!({ "playlists": items }).to_string();
                }
            }
        }
        json!({ "playlists": [] }).to_string()
    }

    pub fn is_spotify_running(&self) -> bool {
        if let Ok(sys) = crate::process_scanner::GLOBAL_SYSTEM.lock() {
            sys.processes().values().any(|process| {
                let name = process.name();
                name == "Spotify.exe" || name == "spotify.exe" || name == "spotifyd.exe" || name == "spotifyd"
            })
        } else {
            false
        }
    }

    pub async fn start_background_polling(&self) {
        let self_access_token = self.client.clone();
        let self_sender = self.sender.clone();
        let self_arc = Arc::new(Self {
            client: self.client.clone(),
            sender: self.sender.clone(),
            playlists_cache: self.playlists_cache.clone(),
            devices_cache: self.devices_cache.clone(),
            smart_shuffle_active: self.smart_shuffle_active.clone(),
            cached_volume: self.cached_volume.clone(),
            last_volume_change: self.last_volume_change.clone(),
            last_command_time: self.last_command_time.clone(),
            is_enabled: self.is_enabled.clone(),
            cached_state: self.cached_state.clone(),
            notify: self.notify.clone(),
        });

        tokio::spawn(async move {
            let mut last_state: Option<SpotifyState> = None;
            let mut first_poll = true;
            let mut poll_count = 0u64;
            let mut force_poll = false;
            let mut last_running_check = std::time::Instant::now().checked_sub(Duration::from_secs(60)).unwrap_or_else(|| std::time::Instant::now());
            
            loop {
                if !self_arc.is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                    tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                    continue;
                }

                if first_poll {
                    self_arc.update_tokens_js().await;
                }
                poll_count = poll_count.wrapping_add(1);

                // Keep spotifyd available as a Connect target, but never transfer
                // playback to it from this poll loop (see idle handling below).
                if last_running_check.elapsed() > Duration::from_secs(5) {
                    last_running_check = std::time::Instant::now();
                    if !self_arc.is_spotify_running() {
                        self_arc.start_spotifyd();
                    }
                }
                
                // --- TOKEN MANAGEMENT ---
                let access_token = {
                    let (access, refresh, expires_at, id, secret) = {
                        let lock = self_access_token.read().await;
                        (lock.access_token.clone(), lock.refresh_token.clone(), lock.expires_at, lock.client_id.clone(), lock.client_secret.clone())
                    };
                    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
                    
                    if let (Some(token), Some(r_token), id, secret) = (access, refresh, id, secret) {
                        if !id.is_empty() && !secret.is_empty() && (expires_at == 0 || now >= expires_at.saturating_sub(60)) {
                             // Refresh logic
                             let client = reqwest::Client::new();
                             let auth_str = format!("{}:{}", id, secret);
                             use base64::engine::general_purpose::STANDARD;
                             use base64::Engine;
                             let b64 = STANDARD.encode(auth_str.as_bytes());
                             let params = [("grant_type", "refresh_token"), ("refresh_token", &r_token)];
                             
                             if let Ok(resp) = client.post("https://accounts.spotify.com/api/token").header(AUTHORIZATION, format!("Basic {}", b64)).form(&params).send().await {
                                 if resp.status().is_success() {
                                     if let Ok(json) = resp.json::<serde_json::Value>().await {
                                         if let (Some(acc), Some(expire)) = (json["access_token"].as_str(), json["expires_in"].as_u64()) {
                                             let new_refresh = json["refresh_token"].as_str().unwrap_or(&r_token).to_string();
                                             let mut lock = self_access_token.write().await;
                                             lock.access_token = Some(acc.to_string());
                                             lock.refresh_token = Some(new_refresh);
                                             lock.expires_at = now + expire;
                                             lock.save();
                                             Some(acc.to_string())
                                         } else { None }
                                     } else { None }
                                 } else { None }
                             } else { None }
                        } else {
                            Some(token)
                        }
                    } else {
                        None
                    }
                };

                // --- DATA POLLING ---
                let mut is_backoff = false;
                if let Some(token) = access_token {
                    match Self::fetch_current_playback(&token).await {
                        Ok(mut state) => {
                            // Keep last cover during brief empty interim states so StreamDock
                            // does not flash the default Spotify logo.
                            if state.album_art.is_empty() {
                                if let Some(prev) = last_state.as_ref() {
                                    if !prev.album_art.is_empty()
                                        && (state.is_playing || !state.track_id.is_empty() || prev.is_playing)
                                    {
                                        state.album_art = prev.album_art.clone();
                                    }
                                }
                            }

                            if !state.shuffle_state {
                                self_arc.smart_shuffle_active.store(false, std::sync::atomic::Ordering::Relaxed);
                            } else if state.smart_shuffle {
                                // Don't resurrect Smart during the post-command settle window
                                // after the user pressed Smart → Off (API can lag).
                                let settling = self_arc.last_command_time.lock().ok()
                                    .and_then(|m| m.get("shuffle").copied())
                                    .map(|t| t.elapsed() < std::time::Duration::from_secs(4))
                                    .unwrap_or(false);
                                if !settling || self_arc.smart_shuffle_active.load(std::sync::atomic::Ordering::Relaxed) {
                                    self_arc.smart_shuffle_active.store(true, std::sync::atomic::Ordering::Relaxed);
                                }
                            }
                            // Prefer optimistic Off while settling after Smart → Off.
                            let prefer_off = {
                                let settling = self_arc.last_command_time.lock().ok()
                                    .and_then(|m| m.get("shuffle").copied())
                                    .map(|t| t.elapsed() < std::time::Duration::from_secs(4))
                                    .unwrap_or(false);
                                settling
                                    && !self_arc.smart_shuffle_active.load(std::sync::atomic::Ordering::Relaxed)
                                    && self_arc.cached_state.read().await.as_ref().map(|c| !c.shuffle_state).unwrap_or(false)
                            };
                            if prefer_off {
                                state.shuffle_state = false;
                                state.smart_shuffle = false;
                            } else {
                                state.smart_shuffle = state.smart_shuffle
                                    || (state.shuffle_state
                                        && self_arc.smart_shuffle_active.load(std::sync::atomic::Ordering::Relaxed));
                            }

                            {
                                let mut cache = self_arc.cached_state.write().await;
                                *cache = Some(state.clone());
                            }
                            let now = std::time::Instant::now();
                            let elapsed = {
                                if let Ok(time) = self_arc.last_volume_change.lock() {
                                    now.checked_duration_since(*time).unwrap_or_default()
                                } else {
                                    std::time::Duration::from_secs(10)
                                }
                            };
                            if elapsed > std::time::Duration::from_secs(3) {
                                self_arc.cached_volume.store(state.volume_percent, std::sync::atomic::Ordering::Relaxed);
                            } else {
                                state.volume_percent = self_arc.cached_volume.load(std::sync::atomic::Ordering::Relaxed);
                            }

                            // Plugin health = valid token + successful API poll (including 204 idle).
                            // Do NOT transfer/activate a Connect device from the background poll:
                            // that retargets playback onto Crimsons/spotifyd and breaks Spotify on
                            // phone and other devices. Device wake stays on-demand only (StreamDock
                            // / hotkey commands that hit 404/403 "no active device").

                            let state_json = json!({
                                "type": "SPOTIFY_STATE",
                                "data": state
                            }).to_string();

                            let (changed, image_changed) = {
                                let mut img_changed = true;
                                let diff = if let Some(l) = &last_state {
                                    img_changed = l.album_art != state.album_art;
                                    l.is_playing != state.is_playing ||
                                    l.track_name != state.track_name ||
                                    l.artist_name != state.artist_name ||
                                    l.album_art != state.album_art ||
                                    l.track_id != state.track_id ||
                                    (state.is_playing && l.progress_ms / 1000 != state.progress_ms / 1000) ||
                                    l.progress_ms.abs_diff(state.progress_ms) > 1500 ||
                                    l.shuffle_state != state.shuffle_state ||
                                    l.smart_shuffle != state.smart_shuffle ||
                                    l.repeat_state != state.repeat_state ||
                                    l.is_liked != state.is_liked ||
                                    l.has_token != state.has_token ||
                                    l.volume_percent != state.volume_percent
                                } else {
                                    true
                                };
                                if diff {
                                    last_state = Some(state.clone());
                                    let path = crate::storage::get_data_dir().join("spotify_state.json");
                                    if let Ok(json_str) = serde_json::to_string(&state) {
                                        let _ = std::fs::write(path, json_str);
                                    }
                                }
                                (diff, img_changed)
                            };

                            if first_poll || changed || force_poll {
                                let _ = self_sender.0.send(state_json.clone());
                                // Only push cover when the URL actually changed (or first paint).
                                // Rebroadcasting on every force_poll caused default-logo flicker.
                                if (first_poll || image_changed) && !state.album_art.is_empty() {
                                    let image_broadcast = json!({
                                        "event": "setImageBroadcast",
                                        "payload": { "image": state.album_art.clone() }
                                    }).to_string();
                                    let _ = self_sender.0.send(image_broadcast);
                                }
                            }
                        }
                        Err(e) => {
                            if e.to_string().contains("429") {
                                is_backoff = true;
                                println!("[Spotify] 429 Too Many Requests detected. Entering back-off mode...");
                            }
                        }
                    }
                }
                // Throttled poll:
                // - 200ms if force_poll (e.g. after waking device)
                // - 5000ms if backoff
                // - 1000ms if music is actively playing
                // - 5000ms if paused/idle
                let last_is_playing = last_state.as_ref().map(|s| s.is_playing).unwrap_or(false);
                let sleep_ms = if force_poll {
                    200
                } else if is_backoff {
                    5000
                } else if last_is_playing {
                    1000
                } else {
                    5000
                };
                
                force_poll = false;
                first_poll = false;
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_millis(sleep_ms)) => {},
                    _ = self_arc.notify.notified() => {
                        force_poll = true;
                    }
                }
            }
        });
    }


    /// Convenience method: fetch current playback and return (album_art_url, timer_str) for immediate UI delivery.
    pub async fn get_current_state(&self) -> Option<(String, String)> {
        let token_opt = self.ensure_valid_token().await;

        if let Some(token) = token_opt {
            if let Ok(state) = Self::fetch_current_playback(&token).await {
                if !state.album_art.is_empty() {
                    let remaining_s = (state.duration_ms.saturating_sub(state.progress_ms)) / 1000;
                    let timer_str = format!("{:}:{:02}", remaining_s / 60, remaining_s % 60);
                    return Some((state.album_art, timer_str));
                }
            }
        }

        // Fallback to disk persistence if API fails or token is missing
        let path = crate::storage::get_data_dir().join("spotify_state.json");
        if let Ok(data) = std::fs::read_to_string(path) {
            if let Ok(state) = serde_json::from_str::<SpotifyState>(&data) {
                if !state.album_art.is_empty() {
                    let remaining_s = (state.duration_ms.saturating_sub(state.progress_ms)) / 1000;
                    let timer_str = format!("{:}:{:02}", remaining_s / 60, remaining_s % 60);
                    return Some((state.album_art, timer_str));
                }
            }
        }
        None
    }

    pub async fn get_top_track(&self) -> Option<(String, String)> {
        let token = self.ensure_valid_token().await?;
        let client = reqwest::Client::new();
        let resp = client.get("https://api.spotify.com/v1/me/top/tracks?time_range=short_term&limit=1")
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send()
            .await
            .ok()?;
        
        let json: serde_json::Value = resp.json().await.ok()?;
        let track = json["items"].get(0)?;
        let name = track["name"].as_str()?.to_string();
        let art = track["album"]["images"].get(0)?["url"].as_str()?.to_string();
        Some((art, name))
    }

    pub async fn fetch_current_playback(token: &str) -> Result<SpotifyState, Box<dyn std::error::Error + Send + Sync>> {
        let client = reqwest::Client::new();
        let resp = client.get("https://api.spotify.com/v1/me/player")
            .header(AUTHORIZATION, format!("Bearer {}", token))
            .send()
            .await?;

        if resp.status() == 204 {
            let log_path = crate::storage::get_data_dir().join("streamdock.log");
            if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                use std::io::Write;
                let _ = writeln!(log_file, "[{:?}] Spotify status: 204 (Idle/No active device)", std::time::SystemTime::now());
            }
            return Ok(SpotifyState { has_token: true, ..Default::default() });
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let log_path = crate::storage::get_data_dir().join("streamdock.log");
            if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                use std::io::Write;
                let _ = writeln!(log_file, "[{:?}] Spotify error: {} - Body: {}", std::time::SystemTime::now(), status, body);
            }
            
            if status == 429 {
                return Err(format!("Spotify 429 Too Many Requests: {}", body).into());
            }
            
            return Ok(SpotifyState { has_token: false, ..Default::default() });
        }

        let json: serde_json::Value = resp.json().await?;
        
        // Debug: Log full playback JSON for Smart Shuffle analysis
        
        let track = &json["item"];
        let mut state = SpotifyState {
            is_playing: json["is_playing"].as_bool().unwrap_or(false),
            track_name: track["name"].as_str().unwrap_or("Unknown").to_string(),
            artist_name: track["artists"][0]["name"].as_str().unwrap_or("UnknownArtist").to_string(),
            track_artist: track["artists"][0]["name"].as_str().unwrap_or("UnknownArtist").to_string(),
            album_art: track["album"]["images"][0]["url"].as_str().unwrap_or("").to_string(),
            progress_ms: json["progress_ms"].as_u64().unwrap_or(0) as u32,
            duration_ms: track["duration_ms"].as_u64().unwrap_or(0) as u32,
            has_token: true,
            volume_percent: json["device"]["volume_percent"].as_u64().unwrap_or(50) as u32,
            shuffle_state: json["shuffle_state"].as_bool().unwrap_or(false),
            smart_shuffle: parse_smart_shuffle(&json),
            repeat_state: json["repeat_state"].as_str().unwrap_or("off").to_string(),
            track_uri: track["uri"].as_str().unwrap_or("").to_string(),
            track_id: track["id"].as_str().unwrap_or("").to_string(),
            is_liked: false,
            ..Default::default()
        };

        // Fetch liked status if we have a track ID
        if !state.track_id.is_empty() {
            let liked_resp = client.get("https://api.spotify.com/v1/me/tracks/contains")
                .header(AUTHORIZATION, format!("Bearer {}", token))
                .query(&[("ids", &state.track_id)])
                .send()
                .await?;
            if let Ok(liked_json) = liked_resp.json::<Vec<bool>>().await {
                if !liked_json.is_empty() {
                    state.is_liked = liked_json[0];
                }
            }
        }

        Ok(state)
    }

    pub async fn get_playlist_cover(&self, uri: &str) -> Option<String> {
        let token = self.ensure_valid_token().await?;
        let id = uri.split(':').last()?;
        let client = reqwest::Client::new();
        let url = format!("https://api.spotify.com/v1/playlists/{}", id);
        let resp = client.get(&url)
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
            .send().await.ok()?;
        
        let json: serde_json::Value = resp.json().await.ok()?;
        json["images"].as_array()?.get(0)?.get("url")?.as_str().map(|s| s.to_string())
    }
    
    pub async fn get_user_playlists(&self) -> Option<Vec<serde_json::Value>> {
        let mut cache_lock = self.playlists_cache.lock().await;
        if let Some((cached_lists, timestamp)) = &*cache_lock {
            if timestamp.elapsed().as_secs() < 300 { // 5 minutes cache
                return Some(cached_lists.clone());
            }
        }
        
        let token = self.ensure_valid_token().await?;
        let client = reqwest::Client::new();
        let resp = client.get("https://api.spotify.com/v1/me/playlists")
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
            .send().await.ok()?;
        
        let json: serde_json::Value = resp.json().await.ok()?;
        let items = json["items"].as_array()?;
        
        let mut lists = Vec::new();
        for item in items {
            let img = item["images"].as_array().and_then(|imgs| imgs.get(0)).and_then(|img| img["url"].as_str()).unwrap_or("");
            lists.push(json!({
                "uri": item["uri"].as_str().unwrap_or(""),
                "name": item["name"].as_str().unwrap_or(""),
                "image": img
            }));
        }
        
        // Log results
        let log_path = crate::storage::get_data_dir().join("streamdock.log");
        if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            use std::io::Write;
            let _ = writeln!(log_file, "[Spotify] Fetched {} playlists successfully", lists.len());
        }

        *cache_lock = Some((lists.clone(), std::time::Instant::now()));
        Some(lists)
    }

    pub async fn find_playlist_by_name(&self, name: &str) -> Option<(String, String)> {
        let lists = self.get_user_playlists().await?;
        for list in lists {
            if list["name"].as_str().map(|s| s.to_lowercase()) == Some(name.to_lowercase()) {
                let uri = list["uri"].as_str()?.to_string();
                let img = list["image"].as_str()?.to_string();
                return Some((uri, img));
            }
        }
        None
    }

    pub async fn get_user_devices(&self) -> Option<Vec<serde_json::Value>> {
        let mut cache_lock = self.devices_cache.lock().await;
        if let Some((cached_devices, timestamp)) = &*cache_lock {
            if timestamp.elapsed().as_secs() < 30 { // 30 seconds cache
                return Some(cached_devices.clone());
            }
        }

        let token = self.ensure_valid_token().await?;
        let client = reqwest::Client::new();
        let resp = client.get("https://api.spotify.com/v1/me/player/devices")
            .header(reqwest::header::AUTHORIZATION, format!("Bearer {}", token))
            .send().await.ok()?;
        
        let json: serde_json::Value = resp.json().await.ok()?;
        let devices = json["devices"].as_array()?;
        
        let mut d_list = Vec::new();
        for d in devices {
            d_list.push(json!({
                "id": d["id"].as_str().unwrap_or(""),
                "name": d["name"].as_str().unwrap_or(""),
                "type": d["type"].as_str().unwrap_or("Computer"),
                "is_active": d["is_active"].as_bool().unwrap_or(false)
            }));
        }

        // Log results
        let log_path = crate::storage::get_data_dir().join("streamdock.log");
        if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
            use std::io::Write;
            let _ = writeln!(log_file, "[Spotify] Fetched {} devices successfully", d_list.len());
        }

        *cache_lock = Some((d_list.clone(), std::time::Instant::now()));
        Some(d_list)
    }

    pub async fn try_activate_any_device(&self) -> bool {
        let token = match self.ensure_valid_token().await {
            Some(t) => t,
            None => return false,
        };

        let client = reqwest::Client::new();
        let mut retry_count = 0;
        let mut restart_triggered = false;
        
        while retry_count < 6 {
            if let Ok(resp) = client.get("https://api.spotify.com/v1/me/player/devices").header(AUTHORIZATION, format!("Bearer {}", token)).send().await {
                if let Ok(json) = resp.json::<serde_json::Value>().await {
                    if let Some(devices) = json["devices"].as_array() {
                        if !devices.is_empty() {
                            let target_device = devices.iter().find(|d| d["type"].as_str() == Some("Computer"))
                                .or_else(|| devices.iter().find(|d| d["type"].as_str() == Some("Smartphone")))
                                .or_else(|| devices.get(0));
                            
                            if let Some(device) = target_device {
                                if let Some(id) = device["id"].as_str() {
                                    let _ = client.put("https://api.spotify.com/v1/me/player")
                                        .header(AUTHORIZATION, format!("Bearer {}", token))
                                        .json(&json!({ "device_ids": [id], "play": false }))
                                        .send().await;
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
            
            if !restart_triggered {
                tracing::info!("No devices found in try_activate_any_device. Restarting spotifyd...");
                let _ = std::process::Command::new("taskkill")
                    .args(&["/F", "/IM", "spotifyd.exe"])
                    .output();
                
                self.start_spotifyd();
                restart_triggered = true;
            } else {
                tracing::info!("Still waiting for devices to appear... (attempt {}/6)", retry_count + 1);
            }
            
            tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
            retry_count += 1;
        }
        false
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error>> {
        if !self.is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
            tracing::info!("[SPOTIFY] Spotify command ignored: service disabled");
            return Ok(());
        }

        // Debounce non-dial commands within 300ms to filter out double mechanical or dual-path triggers
        let is_dial_cmd = endpoint == "volumecontrol" || endpoint == "volumeup" || endpoint == "volumedown" || endpoint == "skip";
        if !is_dial_cmd {
            let now = std::time::Instant::now();
            if let Ok(mut map) = self.last_command_time.lock() {
                if let Some(last_time) = map.get(endpoint) {
                    if now.checked_duration_since(*last_time).unwrap_or_default() < std::time::Duration::from_millis(300) {
                        crate::storage::log_to_file("streamdock.log", &format!("[SPOTIFY DEBOUNCE] Ignored duplicate command: {}", endpoint));
                        println!("[Spotify API] Ignored duplicate command '{}' due to 300ms cooldown.", endpoint);
                        return Ok(());
                    }
                }
                map.insert(endpoint.to_string(), now);
            }
        }

        let (success, status) = self.handle_command_once(endpoint, params.clone()).await?;
        
        if success {
            self.notify.notify_one();
        } else if status == 404 || status == 403 {
            // On-demand only: user pressed a StreamDock/hotkey control with no active
            // Connect device. Background polling must never do this transfer.
            println!("No active Spotify player for command {}. Waking a device on demand...", endpoint);
            if self.try_activate_any_device().await {
                // Wait a bit for Spotify to register the device as active
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                if self.handle_command_once(endpoint, params).await?.0 {
                    self.notify.notify_one();
                }
            }
        }
        Ok(())
    }

    async fn handle_command_once(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(bool, u16), Box<dyn std::error::Error>> {
        let token = match self.ensure_valid_token().await {
            Some(t) => t,
            None => return Err("No token".into()),
        };

        let client = reqwest::Client::new();
        let mut url = format!("https://api.spotify.com/v1/me/player/{}", endpoint);
        let mut payload_json: Option<serde_json::Value> = None;
        
        // Handle specific logic for complex commands (volume, shuffle, repeat)
        let method = match endpoint {
            "play" | "playuri" => {
                // Determine if we need to put a uri context
                if let Some(p) = params.as_ref() {
                    let uri = p["context_uri"].as_str()
                        .or_else(|| p["playlist"].as_str())
                        .or_else(|| p["uri"].as_str())
                        .or_else(|| p["payload"]["playlist"].as_str())
                        .or_else(|| p["payload"]["uri"].as_str())
                        .or_else(|| p["payload"]["settings"]["playlist"].as_str())
                        .or_else(|| p["payload"]["settings"]["uri"].as_str());
                        
                    if let Some(uri_str) = uri {
                        if uri_str.contains("spotify:track:") {
                            payload_json = Some(json!({ "uris": [uri_str] }));
                        } else if !uri_str.is_empty() {
                            payload_json = Some(json!({ "context_uri": uri_str }));
                        }
                    }
                }
                "PUT"
            },
            "pause" | "next" | "previous" => {
                if endpoint == "next" || endpoint == "previous" { "POST" } else { "PUT" }
            },
            "playpause" => {
                let is_playing = {
                    let cache = self.cached_state.read().await;
                    cache.as_ref().map(|s| s.is_playing).unwrap_or(false)
                };
                url = if is_playing { format!("https://api.spotify.com/v1/me/player/pause") } else { format!("https://api.spotify.com/v1/me/player/play") };
                "PUT"
            },
            "volumeup" | "volumedown" | "volumecontrol" => {
                let current_vol = self.cached_volume.load(std::sync::atomic::Ordering::Relaxed);
                
                let mut step = 5;
                if let Some(p) = params.as_ref() {
                    let step_val = p["step"].as_u64()
                        .or_else(|| p["payload"]["step"].as_u64())
                        .or_else(|| p["payload"]["settings"]["step"].as_u64());
                    if let Some(s) = step_val {
                        step = s as i32;
                    }
                    
                    let ticks = p["ticks"].as_i64()
                        .or_else(|| p["payload"]["ticks"].as_i64())
                        .or_else(|| p["payload"]["settings"]["ticks"].as_i64());
                    if let Some(t) = ticks {
                        step = (t as i32) * step;
                    }
                }
                
                if endpoint == "volumedown" && step > 0 {
                    step = -step;
                }
                
                let new_vol = (current_vol as i32 + step).clamp(0, 100) as u32;
                self.cached_volume.store(new_vol, std::sync::atomic::Ordering::Relaxed);
                
                if let Ok(mut time) = self.last_volume_change.lock() {
                    *time = std::time::Instant::now();
                }
                
                crate::storage::log_to_file("spotify.log", &format!("Volume CMD: {} ({} -> {}) Step: {} (Params: {:?})", endpoint, current_vol, new_vol, step, params));
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", new_vol);
                "PUT"
            },
            "volumeset" => {
                let target_vol = params.as_ref().and_then(|p| 
                    p["volume"].as_u64()
                    .or_else(|| p["payload"]["volume"].as_u64())
                    .or_else(|| p["payload"]["settings"]["volume"].as_u64())
                ).unwrap_or(50) as u32;
                self.cached_volume.store(target_vol, std::sync::atomic::Ordering::Relaxed);
                
                if let Ok(mut time) = self.last_volume_change.lock() {
                    *time = std::time::Instant::now();
                }
                
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", target_vol);
                "PUT"
            },
            "mute" => {
                let current_vol = self.cached_volume.load(std::sync::atomic::Ordering::Relaxed);
                let target_vol = if current_vol > 0 { 0 } else { 50 };
                self.cached_volume.store(target_vol, std::sync::atomic::Ordering::Relaxed);
                
                if let Ok(mut time) = self.last_volume_change.lock() {
                    *time = std::time::Instant::now();
                }
                
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", target_vol);
                "PUT"
            },
            "skip" => {
                if let Some(p) = params.as_ref() {
                    let ticks = p["ticks"].as_i64()
                        .or_else(|| p["payload"]["ticks"].as_i64())
                        .or_else(|| p["payload"]["settings"]["ticks"].as_i64());
                        
                    if let Some(t) = ticks {
                        if t > 0 { url = format!("https://api.spotify.com/v1/me/player/next"); }
                        else { url = format!("https://api.spotify.com/v1/me/player/previous"); }
                    }
                }
                "POST"
            },
            "shuffle" => {
                // StreamDeck multi-state button: Off (0) → Shuffle (1) → Smart (2) → Off.
                // The Web API only supports shuffle on/off; Smart Shuffle cannot be enabled
                // via API (Spotify limitation). We still cycle a local 3rd state for UX, and
                // when the API reports real smart_shuffle we must turn it fully off.
                let mut playback = {
                    let cache = self.cached_state.read().await;
                    cache.clone().unwrap_or_default()
                };
                if !playback.shuffle_state {
                    self.smart_shuffle_active.store(false, std::sync::atomic::Ordering::Relaxed);
                } else if playback.smart_shuffle {
                    self.smart_shuffle_active.store(true, std::sync::atomic::Ordering::Relaxed);
                }
                playback.smart_shuffle = playback.smart_shuffle
                    || (playback.shuffle_state
                        && self.smart_shuffle_active.load(std::sync::atomic::Ordering::Relaxed));

                println!(
                    "[Shuffle] Current state: shuffle_state={}, smart_shuffle={}",
                    playback.shuffle_state, playback.smart_shuffle
                );

                let mut next = playback.clone();
                if !playback.shuffle_state {
                    // Off -> On (Standard)
                    println!("[Shuffle] Button pressed. Transition: Off -> On (Standard)");
                    url = "https://api.spotify.com/v1/me/player/shuffle?state=true".to_string();
                    self.smart_shuffle_active.store(false, std::sync::atomic::Ordering::Relaxed);
                    next.shuffle_state = true;
                    next.smart_shuffle = false;
                } else if !playback.smart_shuffle {
                    // On (Standard) -> Smart Shuffle (local UX only; API cannot enable Smart)
                    println!("[Shuffle] Button pressed. Transition: On (Standard) -> Smart Shuffle (local; API cannot enable Smart Shuffle)");
                    // Re-assert shuffle on so a laggy client still has shuffle active, then
                    // mark Smart locally so the next press exits cleanly.
                    url = "https://api.spotify.com/v1/me/player/shuffle?state=true".to_string();
                    self.smart_shuffle_active.store(true, std::sync::atomic::Ordering::Relaxed);
                    next.shuffle_state = true;
                    next.smart_shuffle = true;
                } else {
                    // On (Smart Shuffle) -> Off — works for both real API Smart and local flag
                    println!("[Shuffle] Button pressed. Transition: Smart Shuffle -> Off");
                    url = "https://api.spotify.com/v1/me/player/shuffle?state=false".to_string();
                    self.smart_shuffle_active.store(false, std::sync::atomic::Ordering::Relaxed);
                    next.shuffle_state = false;
                    next.smart_shuffle = false;
                }
                // Optimistic cache so the next keypress sees the new mode immediately
                // (background poll used to overwrite cache before smart merge).
                {
                    let cache_art = self.cached_state.clone();
                    let next_state = next.clone();
                    let sender = self.sender.clone();
                    tokio::spawn(async move {
                        {
                            let mut cache = cache_art.write().await;
                            *cache = Some(next_state.clone());
                        }
                        let _ = sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": next_state }).to_string());
                    });
                }
                "PUT"
            },
            "repeat" => {
                let state = if let Some(s) = params.as_ref().and_then(|p| p["payload"]["state"].as_str()) {
                    s.to_string()
                } else {
                    let playback = {
                        let cache = self.cached_state.read().await;
                        cache.clone().unwrap_or_default()
                    };
                    match playback.repeat_state.as_str() {
                        "off" => "context".to_string(),
                        "context" => "track".to_string(),
                        _ => "off".to_string(),
                    }
                };
                url = format!("https://api.spotify.com/v1/me/player/repeat?state={}", state);
                "PUT"
            },
            "add-to-playlist" => {
                // This is a special case, uses /v1/playlists/{playlist_id}/tracks
                if let (Some(pid), Some(uri)) = (params.as_ref().and_then(|p| p["payload"]["playlist_id"].as_str()), params.as_ref().and_then(|p| p["payload"]["track_uri"].as_str())) {
                    url = format!("https://api.spotify.com/v1/playlists/{}/tracks?uris={}", pid, uri);
                }
                "POST"
            },
            "likesong" => {
                let playback = {
                    let cache = self.cached_state.read().await;
                    cache.clone().unwrap_or_default()
                };
                let liked = playback.is_liked;
                url = format!("https://api.spotify.com/v1/me/tracks?ids={}", playback.track_id);
                if liked { "DELETE" } else { "PUT" }
            },
            "like" | "unlike" => {
                 let mut id = params.as_ref().and_then(|p| p["payload"]["track_id"].as_str()).map(|s| s.to_string());
                 
                 // Fallback to current track if no ID provided (common for the heart button)
                 if id.is_none() {
                     let playback = {
                         let cache = self.cached_state.read().await;
                         cache.clone().unwrap_or_default()
                     };
                     if !playback.track_id.is_empty() {
                         id = Some(playback.track_id);
                     }
                 }

                 if let Some(track_id) = id {
                    url = format!("https://api.spotify.com/v1/me/tracks?ids={}", track_id);
                 } else {
                    return Err("No active track to like/unlike".into());
                 }
                 if endpoint == "like" { "PUT" } else { "DELETE" }
            },
            "switch-device" | "changedevice" => {
                // Custom logic: Fetch devices first, then transfer
                let devices_resp = client.get("https://api.spotify.com/v1/me/player/devices")
                    .header(AUTHORIZATION, format!("Bearer {}", token))
                    .send().await?;
                if let Ok(d_json) = devices_resp.json::<serde_json::Value>().await {
                    if let Some(devices) = d_json["devices"].as_array() {
                        if !devices.is_empty() {
                            // Find current active, pick next
                            let current_idx = devices.iter().position(|d| d["is_active"].as_bool().unwrap_or(false)).unwrap_or(0);
                            let next_idx = (current_idx + 1) % devices.len();
                            let next_id = devices[next_idx]["id"].as_str().unwrap_or("");
                            
                            url = "https://api.spotify.com/v1/me/player".to_string();
                            let _ = client.put(url)
                                .header(AUTHORIZATION, format!("Bearer {}", token))
                                .header(CONTENT_TYPE, "application/json")
                                .json(&json!({ "device_ids": [next_id], "play": true }))
                                .send().await;
                            return Ok((true, 200));
                        }
                    }
                }
                return Err("No devices available".into());
            },
            "transfer-to-crimson" => {
                // If not running, start it
                if !self.is_spotify_running() {
                    self.start_spotifyd();
                    // Wait a moment for it to start and register with Spotify connect
                    tokio::time::sleep(std::time::Duration::from_millis(2000)).await;
                }

                let devices_resp = client.get("https://api.spotify.com/v1/me/player/devices")
                    .header(AUTHORIZATION, format!("Bearer {}", token))
                    .send().await?;
                if let Ok(d_json) = devices_resp.json::<serde_json::Value>().await {
                    if let Some(devices) = d_json["devices"].as_array() {
                        let target_device = devices.iter().find(|d| {
                            matches!(
                                d["name"].as_str().map(|n| n.to_lowercase()).as_deref(),
                                Some("crimsons player") | Some("crimson player")
                            )
                        });
                        if let Some(device) = target_device {
                            let device_id = device["id"].as_str().unwrap_or("");
                            url = "https://api.spotify.com/v1/me/player".to_string();
                            payload_json = Some(json!({ "device_ids": [device_id], "play": true }));
                        } else {
                            return Err("Crimsons Player device not found in active devices list".into());
                        }
                    } else {
                        return Err("No devices array found in response".into());
                    }
                } else {
                    return Err("Failed to parse devices list".into());
                }
                "PUT"
            },
            "playlist" => {
                let context_uri = params.as_ref().and_then(|p| p["payload"]["settings"]["playlist"].as_str())
                    .or_else(|| params.as_ref().and_then(|p| p["payload"]["settings"]["uri"].as_str()));
                
                if let Some(uri) = context_uri {
                    url = "https://api.spotify.com/v1/me/player/play".to_string();
                    payload_json = Some(json!({ "context_uri": uri }));
                } else {
                    return Err("No playlist URI provided".into());
                }
                "PUT"
            },
            _ => return Err("Invalid endpoint".into()),
        };

        let device_id = params.as_ref().and_then(|p| p["payload"]["settings"]["device_id"].as_str());
        if let Some(dev) = device_id {
            if !dev.is_empty() {
                if url.contains('?') {
                    url.push_str(&format!("&device_id={}", dev));
                } else {
                    url.push_str(&format!("?device_id={}", dev));
                }
            }
        }

        let mut rb = if method == "PUT" { client.put(&url) } else if method == "DELETE" { client.delete(&url) } else { client.post(&url) };

        rb = rb.header(AUTHORIZATION, format!("Bearer {}", token))
               .header(CONTENT_TYPE, "application/json");

        if let Some(ref json) = payload_json {
            rb = rb.json(json);
        } else {
            rb = rb.header(reqwest::header::CONTENT_LENGTH, "0");
            rb = rb.body("");
        }

        let r = rb.send().await?;
        let mut status = r.status();
        let mut body_text = r.text().await.unwrap_or_default();
        
        // Auto-retry mechanism if no active device is found (e.g. at PC startup)
        if status == reqwest::StatusCode::NOT_FOUND && body_text.contains("No active device") {
            if let Ok(d_resp) = client.get("https://api.spotify.com/v1/me/player/devices")
                .header(AUTHORIZATION, format!("Bearer {}", token))
                .send().await 
            {
                if let Ok(d_json) = d_resp.json::<serde_json::Value>().await {
                    if let Some(devices) = d_json["devices"].as_array() {
                        let mut target_device = devices.iter().find(|d| d["name"].as_str().map(|n| n.to_lowercase()) == Some("crimson player".to_string()));
                        if target_device.is_none() && !devices.is_empty() {
                            target_device = Some(&devices[0]);
                        }
                        
                        if let Some(device) = target_device {
                            if let Some(dev_id) = device["id"].as_str() {
                                let mut retry_url = url.clone();
                                if retry_url.contains('?') {
                                    retry_url.push_str(&format!("&device_id={}", dev_id));
                                } else {
                                    retry_url.push_str(&format!("?device_id={}", dev_id));
                                }
                                
                                let mut retry_rb = if method == "PUT" { client.put(&retry_url) } else if method == "DELETE" { client.delete(&retry_url) } else { client.post(&retry_url) };
                                retry_rb = retry_rb.header(AUTHORIZATION, format!("Bearer {}", token))
                                                   .header(CONTENT_TYPE, "application/json");
                                if let Some(ref json) = payload_json {
                                    retry_rb = retry_rb.json(json);
                                } else {
                                    retry_rb = retry_rb.header(reqwest::header::CONTENT_LENGTH, "0").body("");
                                }
                                
                                if let Ok(retry_r) = retry_rb.send().await {
                                    status = retry_r.status();
                                    body_text = retry_r.text().await.unwrap_or_default();
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Print response to console for diagnosis
        if !body_text.is_empty() {
            println!("[Spotify API] {} {} -> {} | body: {}", method, url, status, body_text);
        } else {
            println!("[Spotify API] {} {} -> {}", method, url, status);
        }
        
        let log_path = crate::storage::get_data_dir().join("streamdock.log");
        use std::io::Write;
        if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            if !status.is_success() {
                let _ = writeln!(log_file, "[SPOTIFY ERR] {} {} returned {} - Body: {}", method, url, status, body_text);
            } else {
                let _ = writeln!(log_file, "Spotify API {} {} returned {}", method, url, status);
            }
        }

        let success = status.is_success();
        if success {
             let sender = self.sender.clone();
             let token_refresh = token.clone();
             let smart_active = self.smart_shuffle_active.clone();
             let cached_state = self.cached_state.clone();
             tokio::spawn(async move {
                 // Multiple polls to catch the state change (Spotify API can be laggy)
                 for delay in [500, 1500, 3000] {
                     tokio::time::sleep(std::time::Duration::from_millis(delay)).await;
                     if let Ok(mut state) = Self::fetch_current_playback(&token_refresh).await {
                          // Preserve cover art across interim empties (avoids logo flicker).
                          if state.album_art.is_empty() {
                              if let Some(prev) = cached_state.read().await.as_ref() {
                                  if !prev.album_art.is_empty() {
                                      state.album_art = prev.album_art.clone();
                                  }
                              }
                          }
                          if !state.shuffle_state {
                              smart_active.store(false, std::sync::atomic::Ordering::Relaxed);
                          } else if state.smart_shuffle
                              && smart_active.load(std::sync::atomic::Ordering::Relaxed)
                          {
                              // Only reinforce Smart if we already consider it active —
                              // never resurrect it after an intentional Off.
                              smart_active.store(true, std::sync::atomic::Ordering::Relaxed);
                          }
                          let prefer_off = !smart_active.load(std::sync::atomic::Ordering::Relaxed)
                              && cached_state.read().await.as_ref().map(|c| !c.shuffle_state).unwrap_or(false);
                          if prefer_off {
                              state.shuffle_state = false;
                              state.smart_shuffle = false;
                          } else {
                              state.smart_shuffle = state.smart_shuffle
                                  || (state.shuffle_state && smart_active.load(std::sync::atomic::Ordering::Relaxed));
                          }
                          {
                              let mut cache = cached_state.write().await;
                              *cache = Some(state.clone());
                          }
                         let _ = sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": state }).to_string());
                     }
                 }
             });
        }

        Ok((success, status.as_u16()))
    }

    pub async fn update_tokens(&self, access: String, refresh: String, expires_in: u64) {
        let mut lock = self.client.write().await;
        lock.access_token = Some(access);
        lock.refresh_token = Some(refresh);
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
        lock.expires_at = now + expires_in;
        lock.save();
    }

    pub async fn set_client_credentials(&self, client_id: String, client_secret: String) {
        let mut lock = self.client.write().await;
        lock.client_id = client_id;
        lock.client_secret = client_secret;
        lock.save();
    }

    pub async fn exchange_code(&self, code: String) -> Result<(), Box<dyn std::error::Error>> {
        let (mut client_id, mut client_secret) = {
            let lock = self.client.read().await;
            (lock.client_id.clone(), lock.client_secret.clone())
        };
        if client_id.is_empty() || client_secret.is_empty() {
            let data = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
            if client_id.is_empty() { client_id = data.spotify_client_id; }
            if client_secret.is_empty() { client_secret = data.spotify_client_secret; }
            if !client_id.is_empty() && !client_secret.is_empty() {
                self.set_client_credentials(client_id.clone(), client_secret.clone()).await;
            }
        }

        let log_path = crate::storage::get_data_dir().join("streamdock.log");
        if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            use std::io::Write;
            let _ = writeln!(f, "[Spotify] Exchange Code - ID len: {}, Secret len: {}", client_id.len(), client_secret.len());
        }

        if client_id.is_empty() || client_secret.is_empty() {
            return Err("Missing client credentials".into());
        }

        let client = reqwest::Client::new();
        let auth_str = format!("{}:{}", client_id, client_secret);
        let b64 = STANDARD.encode(auth_str.as_bytes());

        let params = [
            ("grant_type", "authorization_code"),
            ("code", &code),
            ("redirect_uri", "http://127.0.0.1:40510/callback"),
        ];

        let resp = client.post("https://accounts.spotify.com/api/token")
            .header(AUTHORIZATION, format!("Basic {}", b64))
            .form(&params)
            .send()
            .await?;

        if resp.status().is_success() {
            let json: serde_json::Value = resp.json().await?;
            if let (Some(acc), Some(expire)) = (json["access_token"].as_str(), json["expires_in"].as_u64()) {
                let refresh = json["refresh_token"].as_str().unwrap_or("").to_string();
                self.update_tokens(acc.to_string(), refresh, expire).await;
                println!("Spotify OAuth succeeded! Access token retrieved.");
                
                // OPTIMIZATION: Trigger immediate profile fetch and poll
                let s_clone_acc = acc.to_string();
                let s_arc = self.client.clone();
                let sender = self.sender.clone();
                let self_arc = Arc::new(Self {
                    client: s_arc,
                    sender,
                    playlists_cache: self.playlists_cache.clone(),
                    devices_cache: self.devices_cache.clone(),
                    smart_shuffle_active: self.smart_shuffle_active.clone(),
                    cached_volume: self.cached_volume.clone(),
                    last_volume_change: self.last_volume_change.clone(),
                    last_command_time: self.last_command_time.clone(),
                    is_enabled: self.is_enabled.clone(),
                    cached_state: self.cached_state.clone(),
                    notify: self.notify.clone(),
                });

                // Always announce connected state first so the UI flips to
                // CONNECTÉ even if playback fetch fails (idle / no device).
                let _ = self.sender.0.send(json!({
                    "type": "SPOTIFY_STATE",
                    "data": SpotifyState { has_token: true, ..Default::default() }
                }).to_string());

                tokio::spawn(async move {
                    let _ = self_arc.fetch_user_profile().await;
                    let state = match Self::fetch_current_playback(&s_clone_acc).await {
                        Ok(s) => s,
                        Err(_) => SpotifyState { has_token: true, ..Default::default() },
                    };
                    let _ = self_arc.sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": state }).to_string());
                });
            }
        } else {
            eprintln!("Failed to exchange Spotify code: {:?}", resp.text().await?);
            return Err("Spotify token exchange rejected".into());
        }

        Ok(())
    }

    pub fn start_spotifyd(&self) {
        if let Ok(appdata) = std::env::var("APPDATA") {
            let vbs_path = std::path::Path::new(&appdata)
                .join("Microsoft")
                .join("Windows")
                .join("Start Menu")
                .join("Programs")
                .join("Startup")
                .join("spotifyd_start.vbs");
            if vbs_path.exists() {
                let _ = std::process::Command::new("wscript.exe")
                    .arg(&vbs_path)
                    .spawn();
                tracing::info!("Watchdog started/restarted spotifyd via VBScript");
            } else if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
                let exe_path = std::path::Path::new(&localappdata)
                    .join("spotifyd")
                    .join("spotifyd.exe");
                let conf_path = std::path::Path::new(&localappdata)
                    .join("spotifyd")
                    .join("spotifyd.conf");
                if exe_path.exists() && conf_path.exists() {
                    #[cfg(windows)]
                    {
                        use std::os::windows::process::CommandExt;
                        let _ = std::process::Command::new(exe_path)
                            .arg("--config-path")
                            .arg(conf_path)
                            .creation_flags(0x08000000) // CREATE_NO_WINDOW
                            .spawn();
                    }
                    #[cfg(not(windows))]
                    {
                        let _ = std::process::Command::new(exe_path)
                            .arg("--config-path")
                            .arg(conf_path)
                            .spawn();
                    }
                    tracing::info!("Watchdog started/restarted spotifyd via direct execution");
                } else {
                    tracing::warn!("Watchdog: spotifyd.exe or spotifyd.conf not found");
                }
            }
        }
    }
}

