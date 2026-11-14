use serde::{Deserialize, Serialize};
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use crate::events::WsSender;

const CIDER_BASE: &str = "http://127.0.0.1:10767";
const DEFAULT_VOLUME_STEP: f64 = 0.05;
/// Background poll while Hub toggle is ON. Documented for alignment with other
/// plugin poll loops (Hue ~5s, Twitch ~30s, Valorant ~60s, Volume ~2s).
const POLL_INTERVAL: Duration = Duration::from_millis(900);
const POLL_DISABLED_INTERVAL: Duration = Duration::from_secs(2);

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
            .or_else(|| now.get("info").cloned())
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
                    tokio::time::sleep(POLL_DISABLED_INTERVAL).await;
                    continue;
                }

                let state = self_arc.fetch_state().await;
                let payload = json!({ "type": "APPLE_MUSIC_STATE", "data": &state });
                let encoded = payload.to_string();
                // Skip cache write + WS fan-out when the serialized snapshot is unchanged.
                if encoded != last_json {
                    {
                        let mut cache = self_arc.cached_state.write().await;
                        *cache = state;
                    }
                    let _ = self_arc.sender.0.send(encoded.clone());
                    last_json = encoded;
                }
                tokio::time::sleep(POLL_INTERVAL).await;
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
            "volumecontrol" => {
                let ticks = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("ticks")
                            .or_else(|| p.get("payload").and_then(|v| v.get("ticks")))
                            .and_then(|v| v.as_i64())
                    })
                    .unwrap_or(0);
                let step = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("step")
                            .or_else(|| p.get("payload").and_then(|v| v.get("step")))
                            .and_then(|v| v.as_f64())
                    })
                    .unwrap_or(DEFAULT_VOLUME_STEP);
                let delta = (ticks as f64) * step;
                if delta != 0.0 {
                    self.adjust_volume(&client, delta).await?;
                }
            }
            "skip" => {
                let ticks = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("ticks")
                            .or_else(|| p.get("payload").and_then(|v| v.get("ticks")))
                            .and_then(|v| v.as_i64())
                    })
                    .unwrap_or(1);
                if ticks > 0 {
                    if client.post_json("/api/v2/playback/next", None).await.is_err() {
                        client.post_json("/api/v1/playback/next", None).await?;
                    }
                } else {
                    if client.post_json("/api/v2/playback/previous", None).await.is_err() {
                        client.post_json("/api/v1/playback/previous", None).await?;
                    }
                }
            }
            "seekrelative" => {
                let ticks = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("ticks")
                            .or_else(|| p.get("payload").and_then(|v| v.get("ticks")))
                            .and_then(|v| v.as_i64())
                    })
                    .unwrap_or(0);
                let step_sec = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("step")
                            .or_else(|| p.get("payload").and_then(|v| v.get("step")))
                            .and_then(|v| v.as_f64())
                    })
                    .unwrap_or(5.0);
                let delta_sec = (ticks as f64) * step_sec;
                let current_sec = self.fetch_state().await.progress_ms as f64 / 1000.0;
                let target_sec = (current_sec + delta_sec).max(0.0);
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
            "playplaylist" | "playlist" | "play_playlist" => {
                self.play_playlist(&client, params.as_ref()).await?;
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

    /// Resolve settings and start a playlist via Cider play-url / play-collection.
    async fn play_playlist(
        &self,
        client: &CiderClient,
        params: Option<&serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let shuffle = extract_playlist_shuffle(params);
        let raw = extract_playlist_raw(params).unwrap_or_default();
        let parsed = parse_playlist_ref(&raw);
        match parsed {
            PlaylistRef::Empty => {
                return Err("Play Playlist: missing playlist id, URL, or name".into());
            }
            PlaylistRef::Url { url, id } => {
                // Prefer play-url (Cider resolves song/album/playlist from the share link).
                if client
                    .post_json("/api/v2/playback/play-url", Some(json!({ "url": url })))
                    .await
                    .is_ok()
                {
                    return Ok(());
                }
                if client
                    .post_json("/api/v1/playback/play-url", Some(json!({ "url": url })))
                    .await
                    .is_ok()
                {
                    return Ok(());
                }
                // Fallback: extracted id → play-collection
                if let Some(pid) = id {
                    return self
                        .play_collection_playlist(client, &pid, shuffle)
                        .await;
                }
                return Err(format!("Cider rejected play-url for {}", url).into());
            }
            PlaylistRef::Id(id) => {
                self.play_collection_playlist(client, &id, shuffle).await?;
            }
            PlaylistRef::Name(name) => {
                let id = self.resolve_playlist_name(client, &name).await?;
                self.play_collection_playlist(client, &id, shuffle).await?;
            }
        }
        Ok(())
    }

    async fn play_collection_playlist(
        &self,
        client: &CiderClient,
        id: &str,
        shuffle: bool,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let body = json!({ "type": "playlists", "id": id, "shuffle": shuffle });
        if client
            .post_json("/api/v2/playback/play-collection", Some(body.clone()))
            .await
            .is_ok()
        {
            return Ok(());
        }
        // Older Cider builds exposed play-url only; synthesize an Apple Music URL.
        let url = format!("https://music.apple.com/playlist/{}", id);
        if client
            .post_json("/api/v2/playback/play-url", Some(json!({ "url": url.clone() })))
            .await
            .is_ok()
        {
            return Ok(());
        }
        client
            .post_json("/api/v1/playback/play-url", Some(json!({ "url": url })))
            .await
    }

    async fn resolve_playlist_name(
        &self,
        client: &CiderClient,
        name: &str,
    ) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
        let needle = name.trim().to_lowercase();
        // 1) Library playlists (requires Library scope)
        if let Ok(raw) = client.get_json("/api/v2/library/playlists?limit=100").await {
            if let Some(id) = find_playlist_id_in_list(&raw, &needle) {
                return Ok(id);
            }
        }
        // 2) Catalog search via Cider amapi proxy
        let q = urlencoding_lite(&needle);
        let path = format!(
            "/api/v2/amapi/search?term={}&types=playlists&limit=10",
            q
        );
        if let Ok(raw) = client.get_json(&path).await {
            if let Some(id) = find_playlist_id_in_search(&raw, &needle) {
                return Ok(id);
            }
        }
        Err(format!(
            "No playlist named '{}' found in library or Apple Music search",
            name
        )
        .into())
    }
}

/// Minimal query escaping for Cider search paths (spaces + reserved chars).
fn urlencoding_lite(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 2);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char)
            }
            b' ' => out.push_str("%20"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

fn find_playlist_id_in_list(raw: &serde_json::Value, needle_lc: &str) -> Option<String> {
    let items = raw
        .get("data")
        .and_then(|d| d.as_array())
        .or_else(|| raw.get("data").and_then(|d| d.get("data")).and_then(|a| a.as_array()))
        .or_else(|| raw.as_array())?;
    let mut exact: Option<String> = None;
    let mut partial: Option<String> = None;
    for item in items {
        let id = item
            .get("id")
            .and_then(|v| v.as_str())
            .or_else(|| item.get("attributes").and_then(|a| a.get("playParams")).and_then(|p| p.get("id")).and_then(|v| v.as_str()))
            .unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let name = item
            .get("attributes")
            .and_then(|a| a.get("name"))
            .and_then(|v| v.as_str())
            .or_else(|| item.get("name").and_then(|v| v.as_str()))
            .unwrap_or("")
            .to_lowercase();
        if name == needle_lc {
            exact = Some(id.to_string());
            break;
        }
        if partial.is_none() && name.contains(needle_lc) {
            partial = Some(id.to_string());
        }
    }
    exact.or(partial)
}

fn find_playlist_id_in_search(raw: &serde_json::Value, needle_lc: &str) -> Option<String> {
    let playlists = raw
        .pointer("/data/results/playlists/data")
        .or_else(|| raw.pointer("/results/playlists/data"))
        .and_then(|v| v.as_array())?;
    let mut exact: Option<String> = None;
    let mut partial: Option<String> = None;
    for item in playlists {
        let id = item.get("id").and_then(|v| v.as_str()).unwrap_or("");
        if id.is_empty() {
            continue;
        }
        let name = item
            .pointer("/attributes/name")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_lowercase();
        if name == needle_lc {
            exact = Some(id.to_string());
            break;
        }
        if partial.is_none() && name.contains(needle_lc) {
            partial = Some(id.to_string());
        }
    }
    exact.or(partial)
}

fn extract_playlist_shuffle(params: Option<&serde_json::Value>) -> bool {
    let p = match params {
        Some(v) => v,
        None => return false,
    };
    p.get("shuffle")
        .or_else(|| p.pointer("/payload/shuffle"))
        .or_else(|| p.pointer("/payload/settings/shuffle"))
        .or_else(|| p.pointer("/settings/shuffle"))
        .and_then(|v| v.as_bool())
        .unwrap_or(false)
}

fn extract_playlist_raw(params: Option<&serde_json::Value>) -> Option<String> {
    let p = params?;
    const KEYS: &[&str] = &[
        "playlist",
        "playlistId",
        "playlist_id",
        "url",
        "id",
        "name",
        "uri",
    ];
    for key in KEYS {
        if let Some(s) = p.get(*key).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    // Nested: payload.settings.* / payload.* / settings.*
    for path in [
        "/payload/settings/playlist",
        "/payload/settings/playlistId",
        "/payload/settings/playlist_id",
        "/payload/settings/url",
        "/payload/settings/id",
        "/payload/settings/name",
        "/payload/settings/uri",
        "/payload/playlist",
        "/payload/playlistId",
        "/payload/url",
        "/payload/id",
        "/payload/name",
        "/settings/playlist",
        "/settings/playlistId",
        "/settings/url",
        "/settings/id",
        "/settings/name",
    ] {
        if let Some(s) = p.pointer(path).and_then(|v| v.as_str()) {
            let t = s.trim();
            if !t.is_empty() {
                return Some(t.to_string());
            }
        }
    }
    None
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum PlaylistRef {
    Empty,
    Url { url: String, id: Option<String> },
    Id(String),
    Name(String),
}

fn extract_id_from_apple_url(url: &str) -> Option<String> {
    // …/playlist/<name>/<id> or …/playlist/<id>
    let lower = url;
    if let Some(idx) = lower.find("/playlist/") {
        let rest = &lower[idx + "/playlist/".len()..];
        let rest = rest.split(['?', '#']).next().unwrap_or(rest);
        let parts: Vec<&str> = rest.split('/').filter(|p| !p.is_empty()).collect();
        for part in parts.iter().rev() {
            if part.starts_with("pl.") || part.starts_with("p.") {
                return Some((*part).to_string());
            }
        }
        // Numeric catalog id as last segment
        if let Some(last) = parts.last() {
            if !last.is_empty() && last.chars().all(|c| c.is_ascii_digit()) {
                return Some((*last).to_string());
            }
        }
    }
    // Loose fallback anywhere in the string
    for token in url.split(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '-' && c != '_') {
        if token.starts_with("pl.") || token.starts_with("p.") {
            return Some(token.to_string());
        }
    }
    None
}

fn parse_playlist_ref(raw: &str) -> PlaylistRef {
    let s = raw.trim();
    if s.is_empty() {
        return PlaylistRef::Empty;
    }
    let lower = s.to_lowercase();
    if lower.contains("music.apple.com")
        || lower.starts_with("http://")
        || lower.starts_with("https://")
    {
        return PlaylistRef::Url {
            url: s.to_string(),
            id: extract_id_from_apple_url(s),
        };
    }
    if s.starts_with("pl.") || s.starts_with("p.") || s.chars().all(|c| c.is_ascii_digit()) {
        return PlaylistRef::Id(s.to_string());
    }
    PlaylistRef::Name(s.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_url_with_name_and_id() {
        let r = parse_playlist_ref(
            "https://music.apple.com/fr/playlist/favoris/pl.u-aZb123?i=1",
        );
        match r {
            PlaylistRef::Url { url, id } => {
                assert!(url.contains("music.apple.com"));
                assert_eq!(id.as_deref(), Some("pl.u-aZb123"));
            }
            other => panic!("unexpected {:?}", other),
        }
    }

    #[test]
    fn parse_url_id_only_segment() {
        let r = parse_playlist_ref("https://music.apple.com/us/playlist/pl.u-xxx");
        match r {
            PlaylistRef::Url { id, .. } => assert_eq!(id.as_deref(), Some("pl.u-xxx")),
            other => panic!("unexpected {:?}", other),
        }
    }

    #[test]
    fn parse_bare_ids() {
        assert_eq!(
            parse_playlist_ref("pl.u-aZb123"),
            PlaylistRef::Id("pl.u-aZb123".into())
        );
        assert_eq!(parse_playlist_ref("p.xxx"), PlaylistRef::Id("p.xxx".into()));
        assert_eq!(
            parse_playlist_ref("1440833098"),
            PlaylistRef::Id("1440833098".into())
        );
    }

    #[test]
    fn parse_name_and_empty() {
        assert_eq!(
            parse_playlist_ref("Late Night"),
            PlaylistRef::Name("Late Night".into())
        );
        assert_eq!(parse_playlist_ref("  "), PlaylistRef::Empty);
    }

    #[test]
    fn extract_from_nested_settings() {
        let v = json!({
            "payload": {
                "settings": {
                    "playlist": "pl.u-nested",
                    "shuffle": true
                }
            }
        });
        assert_eq!(
            extract_playlist_raw(Some(&v)).as_deref(),
            Some("pl.u-nested")
        );
        assert!(extract_playlist_shuffle(Some(&v)));
    }

    #[test]
    fn find_playlist_in_library_list() {
        let raw = json!({
            "data": [
                { "id": "p.1", "attributes": { "name": "Workout" } },
                { "id": "p.2", "attributes": { "name": "Late Night Coding" } }
            ]
        });
        assert_eq!(
            find_playlist_id_in_list(&raw, "late night coding").as_deref(),
            Some("p.2")
        );
        assert_eq!(
            find_playlist_id_in_list(&raw, "night").as_deref(),
            Some("p.2")
        );
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
