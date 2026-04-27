use serde::{Deserialize, Serialize};
use reqwest::header::{AUTHORIZATION, CONTENT_TYPE};
use std::time::{SystemTime, UNIX_EPOCH, Duration};
use tokio::sync::RwLock;
use std::sync::Arc;
use crate::events::WsSender;
use serde_json::json;
use sysinfo::{System, ProcessRefreshKind, RefreshKind};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct SpotifyState {
    pub is_playing: bool,
    pub track_name: String,
    pub artist_name: String,
    pub album_art: String,
    pub progress_ms: u32,
    pub duration_ms: u32,
    pub has_token: bool,
    pub volume_percent: u32,
    pub shuffle_state: bool,
    pub smart_shuffle: bool,
    pub repeat_state: String,
    pub track_uri: String,
    pub track_id: String,
    pub is_liked: bool,
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
        let path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("spotify_cache.json");
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
    }

    pub fn save(&self) {
        let path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("spotify_cache.json");
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
    }
}

pub struct SpotifyService {
    client: Arc<RwLock<SpotifyClient>>,
    sender: WsSender,
}

impl SpotifyService {
    pub async fn update_tokens_js(&self) {
        let (access, refresh, id, secret) = {
            let lock = self.client.read().await;
            (lock.access_token.clone(), lock.refresh_token.clone(), lock.client_id.clone(), lock.client_secret.clone())
        };

        let playlists = self.get_user_playlists().await.unwrap_or_default();
        let devices = self.get_user_devices().await.unwrap_or_default();
        let playlists_json = serde_json::to_string(&playlists).unwrap_or_else(|_| "[]".to_string());
        let devices_json = serde_json::to_string(&devices).unwrap_or_else(|_| "[]".to_string());

        let tokens_js_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str())
            .join("HotSpot").join("StreamDock").join("plugins").join("com.laoy.streamdock.spotify.sdPlugin")
            .join("propertyInspector").join("utils").join("tokens.js");
        
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
                        clientSecret: '{}',\n\
                        client_secret: '{}',\n\
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
            access.unwrap_or_default(),
            refresh.clone().unwrap_or_default(),
            refresh.unwrap_or_default(),
            id.clone(),
            id,
            secret.clone(),
            secret,
            playlists_json,
            devices_json
        );
        let _ = std::fs::write(tokens_js_path, js_content);
    }

    pub fn new(sender: WsSender) -> Self {
        Self {
            client: Arc::new(RwLock::new(SpotifyClient::new())),
            sender,
        }
    }

    pub fn get_client(&self) -> Arc<RwLock<SpotifyClient>> {
        self.client.clone()
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
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::new())
        );
        sys.refresh_processes();
        sys.processes_by_exact_name("Spotify.exe").next().is_some() ||
        sys.processes_by_exact_name("spotify.exe").next().is_some()
    }

    pub async fn start_background_polling(&self) {
        let self_access_token = self.client.clone();
        let self_sender = self.sender.clone();
        let self_arc = Arc::new(Self { client: self.client.clone(), sender: self.sender.clone() });

        tokio::spawn(async move {
            let mut last_state: Option<SpotifyState> = None;
            let mut first_poll = true;
            let mut poll_count = 0u64;
            let mut force_poll = false;
            let mut last_running_check = std::time::Instant::now() - Duration::from_secs(60);
            let mut is_running = false;
            
            loop {
                if first_poll {
                    self_arc.update_tokens_js().await;
                }
                poll_count = poll_count.wrapping_add(1);

                // Throttled process check (every 5 seconds)
                if last_running_check.elapsed() > Duration::from_secs(5) {
                    is_running = self_arc.is_spotify_running();
                    last_running_check = std::time::Instant::now();
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
                if let Some(token) = access_token {
                    if let Ok(state) = Self::fetch_current_playback(&token).await {
                        let is_idle = state.track_id.is_empty();
                        
                        // AUTO-WAKE: If idle but Spotify is running, try to activate a device
                        // Frequency: Every poll if we just started, or every 5 polls later
                        let wake_interval = if poll_count < 60 { 2 } else { 10 };
                        if is_idle && is_running && poll_count % wake_interval == 0 {
                            let client = reqwest::Client::new();
                            if let Ok(resp) = client.get("https://api.spotify.com/v1/me/player/devices").header(AUTHORIZATION, format!("Bearer {}", token)).send().await {
                                if let Ok(json) = resp.json::<serde_json::Value>().await {
                                    if let Some(devices) = json["devices"].as_array() {
                                        if !devices.is_empty() {
                                            // Prioritize "Computer" (PC), then "Smartphone", then anything
                                            let target_device = devices.iter().find(|d| d["type"].as_str() == Some("Computer"))
                                                .or_else(|| devices.iter().find(|d| d["type"].as_str() == Some("Smartphone")))
                                                .or_else(|| devices.get(0));
                                            
                                            if let Some(device) = target_device {
                                                let id = device["id"].as_str().unwrap_or("");
                                                if !id.is_empty() {
                                                    let log_msg = format!("Spotify Auto-Wake: Activating device {} ({})", device["name"].as_str().unwrap_or("Unknown"), id);
                                                    println!("{}", log_msg);
                                                    
                                                    let _ = client.put("https://api.spotify.com/v1/me/player")
                                                        .header(AUTHORIZATION, format!("Bearer {}", token))
                                                        .json(&json!({ "device_ids": [id], "play": false }))
                                                        .send().await;
                                                    
                                                    force_poll = true; // Trigger immediate re-poll to capture active status
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        let state_json = json!({
                            "type": "SPOTIFY_STATE",
                            "data": state
                        }).to_string();

                        let changed = {
                            let diff = if let Some(l) = &last_state {
                                l.is_playing != state.is_playing ||
                                l.track_id != state.track_id ||
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
                                let path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("spotify_state.json");
                                if let Ok(json_str) = serde_json::to_string(&state) {
                                    let _ = std::fs::write(path, json_str);
                                }
                            }
                            diff
                        };

                        if first_poll || changed || force_poll {
                            let _ = self_sender.0.send(state_json.clone());
                            first_poll = false;
                            force_poll = false;
                        }
                    }
                }

                // Fast poll (150ms) for fluidity, 100ms if forced
                let sleep_ms = if force_poll { 100 } else { 150 };
                tokio::time::sleep(Duration::from_millis(sleep_ms)).await;
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
        let path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("spotify_state.json");
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
            // Idle state: Clear everything but keep the token status
            return Ok(SpotifyState { 
                has_token: true, 
                is_playing: false,
                track_id: String::new(),
                track_name: String::new(),
                artist_name: String::new(),
                album_art: String::new(),
                progress_ms: 0,
                duration_ms: 0,
                ..Default::default() 
            });
        }

        if !resp.status().is_success() {
            let status = resp.status();
            let body = resp.text().await.unwrap_or_default();
            let log_path = crate::storage::get_data_dir().join("streamdock.log");
            if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                use std::io::Write;
                let _ = writeln!(log_file, "[{:?}] Spotify error: {} - Body: {}", std::time::SystemTime::now(), status, body);
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
            album_art: track["album"]["images"][0]["url"].as_str().unwrap_or("").to_string(),
            progress_ms: json["progress_ms"].as_u64().unwrap_or(0) as u32,
            duration_ms: track["duration_ms"].as_u64().unwrap_or(0) as u32,
            has_token: true,
            volume_percent: json["device"]["volume_percent"].as_u64().unwrap_or(50) as u32,
            shuffle_state: json["shuffle_state"].as_bool().unwrap_or(false),
            smart_shuffle: json["smart_shuffle"].as_bool().unwrap_or(false),
            repeat_state: json["repeat_state"].as_str().unwrap_or("off").to_string(),
            track_uri: track["uri"].as_str().unwrap_or("").to_string(),
            track_id: track["id"].as_str().unwrap_or("").to_string(),
            is_liked: false,
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
        if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            use std::io::Write;
            let _ = writeln!(log_file, "[Spotify] Fetched {} devices successfully", d_list.len());
        }

        Some(d_list)
    }

    pub async fn try_activate_any_device(&self) -> bool {
        let token = match self.ensure_valid_token().await {
            Some(t) => t,
            None => return false,
        };

        let client = reqwest::Client::new();
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
        false
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error>> {
        let (success, status) = self.handle_command_once(endpoint, params.clone()).await?;
        
        // If it failed because no active player was found (404/403), try to wake up one and retry
        if !success && (status == 404 || status == 403) {
            println!("No active Spotify player found for command {}. Attempting Auto-Wake...", endpoint);
            if self.try_activate_any_device().await {
                // Wait a bit for Spotify to register the device as active
                tokio::time::sleep(std::time::Duration::from_millis(800)).await;
                self.handle_command_once(endpoint, params).await?;
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
            "play" => {
                // Resilient extraction for playlist/uri (handles both direct commands and proxied events)
                let p = params.as_ref();
                let uri_opt = p.and_then(|p| p["payload"]["settings"]["playlist"].as_str())
                    .or_else(|| p.and_then(|p| p["payload"]["settings"]["uri"].as_str()))
                    .or_else(|| p.and_then(|p| p["payload"]["playlist"].as_str()))
                    .or_else(|| p.and_then(|p| p["payload"]["uri"].as_str()))
                    .or_else(|| p.and_then(|p| p["playlist"].as_str()))
                    .or_else(|| p.and_then(|p| p["uri"].as_str()));

                if let Some(uri) = uri_opt {
                    println!("[SPOTIFY PLAY] URI: {}", uri);
                    crate::storage::log_to_file("spotify.log", &format!("[SPOTIFY PLAY] URI: {}", uri));
                    if uri.contains("spotify:track:") {
                        payload_json = Some(json!({ "uris": [uri] }));
                    } else if !uri.is_empty() {
                        payload_json = Some(json!({ "context_uri": uri }));
                    }
                } else {
                    println!("[SPOTIFY PLAY] WARNING: No URI found in params!");
                    crate::storage::log_to_file("spotify.log", "[SPOTIFY PLAY] WARNING: No URI found in params!");
                }

                // Support device targeting
                if let Some(p) = params.as_ref() {
                    if let Some(device) = p["payload"]["settings"]["device_id"].as_str()
                        .or_else(|| p["device_id"].as_str()) {
                        url.push_str(&format!("?device_id={}", device));
                    }
                }

                "PUT"
            },
            "pause" | "next" | "previous" => {
                if endpoint == "next" || endpoint == "previous" { "POST" } else { "PUT" }
            },
            "playpause" => {
                // Actively fetch state instead of guessing from token
                let is_playing = Self::fetch_current_playback(&token).await.unwrap_or_default().is_playing;
                url = if is_playing { format!("https://api.spotify.com/v1/me/player/pause") } else { format!("https://api.spotify.com/v1/me/player/play") };
                "PUT"
            },
            "volumeup" | "volumedown" | "volumecontrol" => {
                let playback = Self::fetch_current_playback(&token).await.unwrap_or_default();
                let current_vol = playback.volume_percent;
                
                let mut step = 5;
                if let Some(p) = params.as_ref() {
                    if let Some(s) = p["payload"]["settings"]["step"].as_u64() {
                        step = s as i32;
                    }
                    if let Some(ticks) = p["payload"]["ticks"].as_i64() {
                        step = (ticks as i32) * step;
                    }
                }
                
                if endpoint == "volumedown" && step > 0 {
                    step = -step;
                }
                
                let new_vol = (current_vol as i32 + step).clamp(0, 100) as u32;
                crate::storage::log_to_file("spotify.log", &format!("Volume CMD: {} ({} -> {}) Step: {} (Params: {:?})", endpoint, current_vol, new_vol, step, params));
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", new_vol);
                "PUT"
            },
            "volumeset" => {
                let target_vol = params.as_ref().and_then(|p| p["payload"]["settings"]["volume"].as_u64()).unwrap_or(50) as u32;
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", target_vol);
                "PUT"
            },
            "mute" => {
                let current_playback = Self::fetch_current_playback(&token).await.unwrap_or_default();
                let target_vol = if current_playback.volume_percent > 0 { 0 } else { 50 };
                url = format!("https://api.spotify.com/v1/me/player/volume?volume_percent={}", target_vol);
                "PUT"
            },
            "skip" => {
                if let Some(p) = params.as_ref() {
                    if let Some(ticks) = p["payload"]["ticks"].as_i64() {
                        if ticks > 0 { url = format!("https://api.spotify.com/v1/me/player/next"); }
                        else { url = format!("https://api.spotify.com/v1/me/player/previous"); }
                    }
                }
                "POST"
            },
            "shuffle" => {
                let playback = Self::fetch_current_playback(&token).await.unwrap_or_default();
                let current_shuffle = playback.shuffle_state;
                let current_smart = playback.smart_shuffle;
                
                if !current_shuffle && !current_smart {
                    // Off -> On
                    url = format!("https://api.spotify.com/v1/me/player/shuffle?state=true");
                } else if current_shuffle && !current_smart {
                    // On -> Smart (API might not natively support it, but we try sending true again)
                    url = format!("https://api.spotify.com/v1/me/player/shuffle?state=true");
                } else {
                    // Smart -> Off
                    url = format!("https://api.spotify.com/v1/me/player/shuffle?state=false");
                }
                "PUT"
            },
            "repeat" => {
                if let Some(state) = params.as_ref().and_then(|p| p["payload"]["state"].as_str()) {
                    url = format!("https://api.spotify.com/v1/me/player/repeat?state={}", state);
                }
                "PUT"
            },
            "add-to-playlist" => {
                // This is a special case, uses /v1/playlists/{playlist_id}/tracks
                if let (Some(pid), Some(uri)) = (params.as_ref().and_then(|p| p["payload"]["playlist_id"].as_str()), params.as_ref().and_then(|p| p["payload"]["track_uri"].as_str())) {
                    url = format!("https://api.spotify.com/v1/playlists/{}/tracks?uris={}", pid, uri);
                }
                "POST"
            },
            "like" | "unlike" => {
                 let mut id = params.as_ref().and_then(|p| p["payload"]["track_id"].as_str()).map(|s| s.to_string());
                 
                 // Fallback to current track if no ID provided (common for the heart button)
                 if id.is_none() {
                     if let Ok(playback) = Self::fetch_current_playback(&token).await {
                         if !playback.track_id.is_empty() {
                             id = Some(playback.track_id);
                         }
                     }
                 }

                 if let Some(track_id) = id {
                    url = format!("https://api.spotify.com/v1/me/tracks?ids={}", track_id);
                 } else {
                    return Err("No active track to like/unlike".into());
                 }
                 if endpoint == "like" { "PUT" } else { "DELETE" }
            },
            "switch-device" => {
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
            "playlist" => {
                let p = params.as_ref();
                let context_uri = p.and_then(|p| p["payload"]["settings"]["playlist"].as_str())
                    .or_else(|| p.and_then(|p| p["payload"]["settings"]["uri"].as_str()))
                    .or_else(|| p.and_then(|p| p["payload"]["playlist"].as_str()))
                    .or_else(|| p.and_then(|p| p["payload"]["uri"].as_str()))
                    .or_else(|| p.and_then(|p| p["playlist"].as_str()))
                    .or_else(|| p.and_then(|p| p["uri"].as_str()));
                
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

        if let Some(json) = payload_json {
            rb = rb.json(&json);
        } else {
            rb = rb.header(reqwest::header::CONTENT_LENGTH, "0");
            rb = rb.body("");
        }

        let r = rb.send().await?;
        let status = r.status();
        let body_text = r.text().await.unwrap_or_default();
        
        let log_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("streamdock.log");
        use std::io::Write;
        if let Ok(mut log_file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            if !status.is_success() {
                let _ = writeln!(log_file, "[SPOTIFY ERR] {} {} returned {} - Body: {}", method, url, status, body_text);
            } else {
                let _ = writeln!(log_file, "Spotify API {} {} returned {}", method, url, status);
            }
        }

        Ok((status.is_success(), status.as_u16()))
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
        let (client_id, client_secret) = {
            let lock = self.client.read().await;
            (lock.client_id.clone(), lock.client_secret.clone())
        };

        let log_path = std::path::Path::new(std::env::var("APPDATA").unwrap_or_default().as_str()).join("Crimson").join("streamdock.log");
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
            ("redirect_uri", "http://127.0.0.1:26433/callback"),
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
                let self_arc = Arc::new(Self { client: s_arc, sender });

                tokio::spawn(async move {
                    let _ = self_arc.fetch_user_profile().await;
                    let _ = self_arc.get_user_playlists().await; // Pre-cache playlists
                    let _ = self_arc.update_tokens_js().await;   // Update PI data
                    if let Ok(state) = Self::fetch_current_playback(&s_clone_acc).await {
                        let _ = self_arc.sender.0.send(json!({ "type": "SPOTIFY_STATE", "data": state }).to_string());
                    }
                });
            }
        } else {
            eprintln!("Failed to exchange Spotify code: {:?}", resp.text().await?);
        }

        Ok(())
    }
}
