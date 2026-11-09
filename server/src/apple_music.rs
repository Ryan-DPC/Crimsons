use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use crate::events::WsSender;

const CIDER_BASE: &str = "http://127.0.0.1:10767";
const DEFAULT_VOLUME_STEP: f64 = 0.05;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct AppleMusicState {
    pub is_playing: bool,
    pub track_name: String,
    pub artist_name: String,
    pub album_name: String,
    pub album_art: String,
    pub progress_ms: u32,
    pub duration_ms: u32,
    pub volume_percent: u32,
    pub shuffle_state: bool,
    pub repeat_state: String,
    pub cider_connected: bool,
    pub has_token: bool,
    pub track_id: String,
    #[serde(default)]
    pub in_favorites: bool,
    #[serde(default)]
    pub in_library: bool,
}

struct CiderClient {
    app_token: String,
    http: reqwest::Client,
}

impl CiderClient {
    fn new(app_token: String) -> Self {
        Self {
            app_token,
            http: reqwest::Client::builder()
                .timeout(Duration::from_secs(3))
                .build()
                .unwrap_or_else(|_| reqwest::Client::new()),
        }
    }

    fn with_auth(&self, req: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        if self.app_token.is_empty() {
            req
        } else {
            req.header("apptoken", &self.app_token)
        }
    }

    async fn get_json(&self, path: &str) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}{}", CIDER_BASE, path);
        let resp = self.with_auth(self.http.get(&url)).send().await?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(format!("Cider GET {} -> {} {}", path, status, body).into());
        }
        if body.trim().is_empty() {
            return Ok(json!({}));
        }
        Ok(serde_json::from_str(&body).unwrap_or(json!({})))
    }

    async fn post_json(
        &self,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}{}", CIDER_BASE, path);
        let b = body.unwrap_or_else(|| json!({}));
        let resp = self
            .with_auth(self.http.post(&url))
            .header("Content-Type", "application/json")
            .json(&b)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 204 {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Cider POST {} -> {} {}", path, status, text).into());
        }
        Ok(())
    }

    async fn patch_json(
        &self,
        path: &str,
        body: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}{}", CIDER_BASE, path);
        let resp = self
            .with_auth(self.http.patch(&url))
            .header("Content-Type", "application/json")
            .json(&body)
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 204 {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Cider PATCH {} -> {} {}", path, status, text).into());
        }
        Ok(())
    }

    async fn delete_json(&self, path: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let url = format!("{}{}", CIDER_BASE, path);
        let resp = self
            .with_auth(self.http.delete(&url))
            .header("Content-Type", "application/json")
            .send()
            .await?;
        let status = resp.status();
        if !status.is_success() && status.as_u16() != 204 {
            let text = resp.text().await.unwrap_or_default();
            return Err(format!("Cider DELETE {} -> {} {}", path, status, text).into());
        }
        Ok(())
    }
}

pub struct AppleMusicService {
    client: Arc<RwLock<CiderClient>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
    pub cached_state: Arc<RwLock<AppleMusicState>>,
    last_volume_before_mute: Arc<RwLock<f64>>,
}

impl AppleMusicService {
    pub fn new(sender: WsSender) -> Self {
        let token = load_cider_token();
        Self {
            client: Arc::new(RwLock::new(CiderClient::new(token))),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
            cached_state: Arc::new(RwLock::new(AppleMusicState::default())),
            last_volume_before_mute: Arc::new(RwLock::new(0.5)),
        }
    }

    pub async fn set_app_token(&self, token: String) {
        save_cider_token(&token);
        let mut lock = self.client.write().await;
        lock.app_token = token;
    }

    pub async fn auth_snapshot_state(&self) -> AppleMusicState {
        let token = self.client.read().await.app_token.clone();
        AppleMusicState {
            has_token: !token.is_empty(),
            cider_connected: false,
            ..Default::default()
        }
    }

    pub fn is_cider_running(&self) -> bool {
        if let Ok(sys) = crate::process_scanner::GLOBAL_SYSTEM.lock() {
            sys.processes().values().any(|process| {
                let name = process.name().to_lowercase();
                name.contains("cider")
            })
        } else {
            false
        }
    }

    async fn fetch_state_v2(
        &self,
        client: &CiderClient,
    ) -> Result<AppleMusicState, Box<dyn std::error::Error + Send + Sync>> {
        let raw = client.get_json("/api/v2/playback").await?;
        let data = raw.get("data").cloned().unwrap_or(raw);
        let state_str = data["state"].as_str().unwrap_or("").to_lowercase();
        let now = &data["nowPlaying"];
        let artwork = now["artwork"]["url"]
            .as_str()
            .or_else(|| now["artwork"].as_str())
            .unwrap_or("")
            .replace("{w}", "300")
            .replace("{h}", "300");
        let progress_ms = data["time"]["currentTime"]
            .as_f64()
            .map(|s| (s * 1000.0) as u32)
            .or_else(|| data["time"]["currentTime"].as_u64().map(|v| v as u32))
            .unwrap_or(0);
        let duration_ms = now["durationInMillis"]
            .as_u64()
            .map(|v| v as u32)
            .or_else(|| {
                data["time"]["duration"]
                    .as_f64()
                    .map(|s| (s * 1000.0) as u32)
            })
            .unwrap_or(0);
        let volume = data["volume"].as_f64().unwrap_or(0.0);
        let repeat = data["repeatMode"]
            .as_str()
            .unwrap_or("none")
            .to_string();
        Ok(AppleMusicState {
            is_playing: state_str == "playing" || state_str == "play",
            track_name: now["name"].as_str().unwrap_or("").to_string(),
            artist_name: now["artistName"].as_str().unwrap_or("").to_string(),
            album_name: now["albumName"].as_str().unwrap_or("").to_string(),
            album_art: artwork,
            progress_ms,
            duration_ms,
            volume_percent: (volume.clamp(0.0, 1.0) * 100.0).round() as u32,
            shuffle_state: data["shuffleMode"].as_bool().unwrap_or(false),
            repeat_state: repeat,
            cider_connected: true,
            has_token: !client.app_token.is_empty(),
            track_id: now["id"].as_str().or_else(|| now["playParams"]["id"].as_str()).unwrap_or("").to_string(),
            in_favorites: now["inFavorites"].as_bool().unwrap_or(false),
            in_library: now["inLibrary"].as_bool().unwrap_or(false),
        })
    }

    async fn fetch_state_v1(
        &self,
        client: &CiderClient,
    ) -> Result<AppleMusicState, Box<dyn std::error::Error + Send + Sync>> {
        let playing_raw = client.get_json("/api/v1/playback/is-playing").await.unwrap_or(json!({}));
        let is_playing = playing_raw
            .as_bool()
            .or_else(|| playing_raw["is_playing"].as_bool())
            .or_else(|| playing_raw["data"].as_bool())
            .unwrap_or(false);

        let now = client
            .get_json("/api/v1/playback/now-playing")
            .await
            .unwrap_or(json!({}));
        let attrs = now
            .get("attributes")
            .cloned()
            .or_else(|| now.get("data").and_then(|d| d.get("attributes")).cloned())
            .unwrap_or(now.clone());
        let artwork = attrs["artwork"]["url"]
            .as_str()
            .unwrap_or("")
            .replace("{w}", "300")
            .replace("{h}", "300");

        let volume_raw = client.get_json("/api/v1/playback/volume").await.unwrap_or(json!({}));
        let volume = volume_raw["volume"]
            .as_f64()
            .or_else(|| volume_raw.as_f64())
            .unwrap_or(0.0);

        let shuffle_raw = client
            .get_json("/api/v1/playback/shuffle-mode")
            .await
            .unwrap_or(json!({}));
        let shuffle = shuffle_raw["value"].as_u64().unwrap_or(0) == 1;

        let repeat_raw = client
            .get_json("/api/v1/playback/repeat-mode")
            .await
            .unwrap_or(json!({}));
        let repeat = match repeat_raw["value"].as_u64().unwrap_or(0) {
            1 => "one".to_string(),
            2 => "all".to_string(),
            _ => "none".to_string(),
        };

        Ok(AppleMusicState {
            is_playing,
            track_name: attrs["name"].as_str().unwrap_or("").to_string(),
            artist_name: attrs["artistName"].as_str().unwrap_or("").to_string(),
            album_name: attrs["albumName"].as_str().unwrap_or("").to_string(),
            album_art: artwork,
            progress_ms: 0,
            duration_ms: attrs["durationInMillis"].as_u64().unwrap_or(0) as u32,
            volume_percent: (volume.clamp(0.0, 1.0) * 100.0).round() as u32,
            shuffle_state: shuffle,
            repeat_state: repeat,
            cider_connected: true,
            has_token: !client.app_token.is_empty(),
            track_id: now["id"].as_str().unwrap_or("").to_string(),
            in_favorites: false,
            in_library: false,
        })
    }

    async fn fetch_state(&self) -> AppleMusicState {
        let client = self.client.read().await;
        match self.fetch_state_v2(&client).await {
            Ok(s) => s,
            Err(_) => match self.fetch_state_v1(&client).await {
                Ok(s) => s,
                Err(e) => {
                    tracing::debug!("[APPLE_MUSIC] Cider unreachable: {}", e);
                    AppleMusicState {
                        has_token: !client.app_token.is_empty(),
                        cider_connected: false,
                        ..Default::default()
                    }
                }
            },
        }
    }

    pub async fn start_background_polling(self: &Arc<Self>) {
        let self_arc = self.clone();
        tokio::spawn(async move {
            let mut last_json = String::new();
            loop {
                if !self_arc.is_enabled.load(Ordering::Relaxed) {
                    tokio::time::sleep(Duration::from_secs(2)).await;
                    continue;
                }

                let state = self_arc.fetch_state().await;
                {
                    let mut cache = self_arc.cached_state.write().await;
                    *cache = state.clone();
                }
                let payload = json!({ "type": "APPLE_MUSIC_STATE", "data": state });
                let encoded = payload.to_string();
                if encoded != last_json {
                    let _ = self_arc.sender.0.send(encoded.clone());
                    last_json = encoded;
                }
                tokio::time::sleep(Duration::from_millis(900)).await;
            }
        });
    }

    async fn adjust_volume(
        &self,
        client: &CiderClient,
        delta: f64,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let current = self.fetch_state().await.volume_percent as f64 / 100.0;
        let next = (current + delta).clamp(0.0, 1.0);
        if client
            .patch_json("/api/v2/audio/volume", json!({ "volume": next }))
            .await
            .is_ok()
        {
            return Ok(());
        }
        client
            .post_json("/api/v1/playback/volume", Some(json!({ "volume": next })))
            .await
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            return Err("Apple Music service disabled".into());
        }
        let client = self.client.read().await;
        let ep = endpoint.to_lowercase();
        match ep.as_str() {
            "play" => {
                if client.post_json("/api/v2/playback/play", None).await.is_err() {
                    client.post_json("/api/v1/playback/play", None).await?;
                }
            }
            "pause" => {
                if client.post_json("/api/v2/playback/pause", None).await.is_err() {
                    client.post_json("/api/v1/playback/pause", None).await?;
                }
            }
            "playpause" | "toggle" => {
                if client.post_json("/api/v2/playback/toggle", None).await.is_err() {
                    client.post_json("/api/v1/playback/playpause", None).await?;
                }
            }
            "next" => {
                if client.post_json("/api/v2/playback/next", None).await.is_err() {
                    client.post_json("/api/v1/playback/next", None).await?;
                }
            }
            "previous" | "prev" => {
                let force = params
                    .as_ref()
                    .and_then(|p| p.get("force").and_then(|v| v.as_bool()))
                    .unwrap_or(false);
                let body = if force {
                    Some(json!({ "force": true }))
                } else {
                    None
                };
                if client
                    .post_json("/api/v2/playback/previous", body.clone())
                    .await
                    .is_err()
                {
                    client.post_json("/api/v1/playback/previous", None).await?;
                }
            }
            "stop" => {
                if client.post_json("/api/v2/playback/stop", None).await.is_err() {
                    client.post_json("/api/v1/playback/stop", None).await?;
                }
            }
            "volumeup" => {
                let step = params
                    .as_ref()
                    .and_then(|p| p.get("step").and_then(|v| v.as_f64()))
                    .unwrap_or(DEFAULT_VOLUME_STEP);
                self.adjust_volume(&client, step).await?;
            }
            "volumedown" => {
                let step = params
                    .as_ref()
                    .and_then(|p| p.get("step").and_then(|v| v.as_f64()))
                    .unwrap_or(DEFAULT_VOLUME_STEP);
                self.adjust_volume(&client, -step).await?;
            }
            "volumeset" => {
                let pct = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("volume")
                            .or_else(|| p.get("volume_percent"))
                            .and_then(|v| v.as_f64())
                    })
                    .unwrap_or(50.0);
                let vol = if pct > 1.0 { pct / 100.0 } else { pct }.clamp(0.0, 1.0);
                if client
                    .patch_json("/api/v2/audio/volume", json!({ "volume": vol }))
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/volume", Some(json!({ "volume": vol })))
                        .await?;
                }
            }
            "mute" => {
                let state = self.fetch_state().await;
                let current = state.volume_percent as f64 / 100.0;
                if current > 0.001 {
                    *self.last_volume_before_mute.write().await = current;
                    if client
                        .patch_json("/api/v2/audio/volume", json!({ "volume": 0.0 }))
                        .await
                        .is_err()
                    {
                        client
                            .post_json("/api/v1/playback/volume", Some(json!({ "volume": 0.0 })))
                            .await?;
                    }
                } else {
                    let restore = *self.last_volume_before_mute.read().await;
                    if client
                        .patch_json("/api/v2/audio/volume", json!({ "volume": restore }))
                        .await
                        .is_err()
                    {
                        client
                            .post_json(
                                "/api/v1/playback/volume",
                                Some(json!({ "volume": restore })),
                            )
                            .await?;
                    }
                }
            }
            "shuffle" => {
                if client
                    .post_json("/api/v2/playback/shuffle/toggle", None)
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/toggle-shuffle", None)
                        .await?;
                }
            }
            "repeat" => {
                if client
                    .post_json("/api/v2/playback/repeat/toggle", None)
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/toggle-repeat", None)
                        .await?;
                }
            }
            "seekforward" | "forward" => {
                let offset_sec = params
                    .as_ref()
                    .and_then(|p| p.get("seconds").or_else(|| p.get("offset")).and_then(|v| v.as_f64()))
                    .unwrap_or(15.0);
                let current_sec = self.fetch_state().await.progress_ms as f64 / 1000.0;
                let target_sec = current_sec + offset_sec;
                if client
                    .post_json("/api/v2/playback/seek", Some(json!({ "position": target_sec })))
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/seek", Some(json!({ "position": target_sec })))
                        .await?;
                }
            }
            "seekbackward" | "rewind" => {
                let offset_sec = params
                    .as_ref()
                    .and_then(|p| p.get("seconds").or_else(|| p.get("offset")).and_then(|v| v.as_f64()))
                    .unwrap_or(15.0);
                let current_sec = self.fetch_state().await.progress_ms as f64 / 1000.0;
                let target_sec = (current_sec - offset_sec).max(0.0);
                if client
                    .post_json("/api/v2/playback/seek", Some(json!({ "position": target_sec })))
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/seek", Some(json!({ "position": target_sec })))
                        .await?;
                }
            }
            "seek" => {
                let pos_sec = params
                    .as_ref()
                    .and_then(|p| p.get("position").or_else(|| p.get("time")).and_then(|v| v.as_f64()))
                    .unwrap_or(0.0);
                if client
                    .post_json("/api/v2/playback/seek", Some(json!({ "position": pos_sec })))
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/seek", Some(json!({ "position": pos_sec })))
                        .await?;
                }
            }
            "love" | "like" => {
                if client
                    .post_json("/api/v2/library/now-playing/love", None)
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/love", None)
                        .await?;
                }
            }
            "dislike" | "unlike" => {
                if client
                    .post_json("/api/v2/library/now-playing/dislike", None)
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/dislike", None)
                        .await?;
                }
            }
            "togglelove" => {
                let state = self.fetch_state().await;
                if state.in_favorites {
                    if client
                        .post_json("/api/v2/library/now-playing/dislike", None)
                        .await
                        .is_err()
                    {
                        client
                            .post_json("/api/v1/playback/dislike", None)
                            .await?;
                    }
                } else {
                    if client
                        .post_json("/api/v2/library/now-playing/love", None)
                        .await
                        .is_err()
                    {
                        client
                            .post_json("/api/v1/playback/love", None)
                            .await?;
                    }
                }
            }
            "addtolibrary" | "addlibrary" => {
                if client
                    .post_json("/api/v2/library/now-playing/add", None)
                    .await
                    .is_err()
                {
                    client
                        .post_json("/api/v1/playback/add-to-library", None)
                        .await?;
                }
            }
            "removefromlibrary" => {
                client.delete_json("/api/v2/library/now-playing").await?;
            }
            "clearqueue" => {
                if client.delete_json("/api/v2/queue").await.is_err() {
                    client
                        .post_json("/api/v1/playback/queue/clear-queue", None)
                        .await?;
                }
            }
            "songinfo" | "nowplaying" => {
                let state = self.fetch_state().await;
                let _ = self.sender.0.send(
                    json!({
                        "type": "APPLE_MUSIC_STATE",
                        "data": state
                    })
                    .to_string(),
                );
            }
            other => {
                tracing::warn!("[APPLE_MUSIC] Unknown command '{}'", other);
                return Err(format!("Unknown Apple Music command: {}", other).into());
            }
        }
        Ok(())
    }
}

fn cider_cache_path() -> std::path::PathBuf {
    crate::storage::get_data_dir().join("cider_cache.json")
}

fn load_cider_token() -> String {
    // 1. Prefer dedicated cache
    if let Ok(raw) = std::fs::read_to_string(cider_cache_path()) {
        if let Ok(v) = serde_json::from_str::<serde_json::Value>(&raw) {
            if let Some(t) = v.get("appToken").and_then(|x| x.as_str()) {
                if !t.is_empty() {
                    return t.to_string();
                }
            }
        }
    }
    // 2. data.json other.ciderAppToken
    let data = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
    if let Some(t) = data.other.get("ciderAppToken").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            return t.to_string();
        }
    }
    // 3. Auto-discover from Cider config (%APPDATA%\sh.cider.dotnet\spa-config.yml)
    if let Ok(appdata) = std::env::var("APPDATA") {
        let cfg_path = std::path::PathBuf::from(appdata).join("sh.cider.dotnet").join("spa-config.yml");
        if let Ok(cfg_content) = std::fs::read_to_string(cfg_path) {
            let mut in_tokens = false;
            for line in cfg_content.lines() {
                let trimmed = line.trim();
                if trimmed.starts_with("apiTokens:") {
                    in_tokens = true;
                    continue;
                }
                if in_tokens {
                    if trimmed.starts_with("token:") {
                        let tok = trimmed.trim_start_matches("token:").trim().trim_matches('"').trim_matches('\'');
                        if !tok.is_empty() {
                            return tok.to_string();
                        }
                    }
                    if !line.starts_with(' ') && !line.starts_with('\t') && !line.is_empty() {
                        in_tokens = false;
                    }
                }
            }
        }
    }
    String::new()
}

fn save_cider_token(token: &str) {
    let path = cider_cache_path();
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let _ = std::fs::write(
        &path,
        serde_json::to_string_pretty(&json!({ "appToken": token })).unwrap_or_default(),
    );

    let path = crate::storage::get_data_path_from_env();
    let mut data = crate::storage::load_data_from_path(path.clone());
    data.other
        .insert("ciderAppToken".into(), json!(token));
    crate::storage::save_data_to_path(path, &data);
}
