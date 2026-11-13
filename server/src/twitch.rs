//! Twitch Helix integration (MVP).
//!
//! Credentials (first match wins):
//! 1. Env `TWITCH_CLIENT_ID` + `TWITCH_ACCESS_TOKEN` (alias `TWITCH_OAUTH_TOKEN`)
//! 2. `data.json` fields `twitchClientId` / `twitchAccessToken` (Hub Settings)
//!
//! Optional: `TWITCH_BROADCASTER_ID` / `TWITCH_USER_LOGIN`.
//! Without credentials → deterministic mock for Hub / StreamDock.
//!
//! Required user-token scopes (Helix MVP):
//! - `clips:edit` — Create Clip
//! - `channel:manage:broadcast` — Create Stream Marker
//! Viewers / live status use the same user token (no extra scope for public streams).

use crate::events::WsSender;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

const HELIX_BASE: &str = "https://api.twitch.tv/helix";

/// Documented OAuth scopes for the shippable Helix MVP.
pub const REQUIRED_SCOPES: &[&str] = &["clips:edit", "channel:manage:broadcast"];

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct TwitchState {
    pub connected: bool,
    /// True when serving mock / fallback data (no token or API failure).
    pub mock: bool,
    /// True when Client-Id + token are available (env or data.json).
    pub has_credentials: bool,
    pub live: bool,
    pub viewers: u32,
    pub username: Option<String>,
    pub broadcaster_id: Option<String>,
    pub title: Option<String>,
    pub game_name: Option<String>,
    pub last_clip_id: Option<String>,
    pub last_clip_url: Option<String>,
    pub last_marker_id: Option<String>,
    pub follower_goal_current: u32,
    pub follower_goal_target: u32,
    pub alerts_muted: bool,
    /// Short machine-ish code for StreamDock titles (e.g. `clip_failed`).
    pub error: Option<String>,
    /// Human-readable detail for Hub Settings (optional).
    pub error_detail: Option<String>,
}

pub fn mock_state() -> TwitchState {
    TwitchState {
        connected: true,
        mock: true,
        has_credentials: false,
        live: true,
        viewers: 42,
        username: Some("MockStreamer".into()),
        broadcaster_id: Some("mock-broadcaster".into()),
        title: Some("CRIMSONS mock stream".into()),
        game_name: Some("Just Chatting".into()),
        last_clip_id: None,
        last_clip_url: None,
        last_marker_id: None,
        follower_goal_current: 120,
        follower_goal_target: 200,
        alerts_muted: false,
        error: None,
        error_detail: None,
    }
}

/// Parse Helix `/streams` JSON into live + viewer fields.
pub fn parse_stream_from_json(value: &serde_json::Value) -> (bool, u32, Option<String>, Option<String>) {
    let arr = value
        .get("data")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if let Some(first) = arr.first() {
        let viewers = first
            .get("viewer_count")
            .and_then(|v| v.as_u64())
            .unwrap_or(0) as u32;
        let title = first
            .get("title")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let game = first
            .get("game_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        (true, viewers, title, game)
    } else {
        (false, 0, None, None)
    }
}

/// Parse Helix create-clip response.
pub fn parse_clip_from_json(value: &serde_json::Value) -> Option<(String, String)> {
    let first = value.get("data")?.as_array()?.first()?;
    let id = first.get("id")?.as_str()?.to_string();
    let edit_url = first
        .get("edit_url")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| format!("https://clips.twitch.tv/{}", id));
    Some((id, edit_url))
}

/// Parse Helix create stream marker response.
pub fn parse_marker_from_json(value: &serde_json::Value) -> Option<String> {
    value
        .get("data")?
        .as_array()?
        .first()?
        .get("id")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn normalize_token(raw: &str) -> String {
    raw.trim().trim_start_matches("oauth:").trim().to_string()
}

fn credentials_from_env() -> Option<(String, String)> {
    let client_id = std::env::var("TWITCH_CLIENT_ID").ok()?;
    let client_id = client_id.trim().to_string();
    if client_id.is_empty() {
        return None;
    }
    let token = std::env::var("TWITCH_ACCESS_TOKEN")
        .or_else(|_| std::env::var("TWITCH_OAUTH_TOKEN"))
        .ok()?;
    let token = normalize_token(&token);
    if token.is_empty() {
        return None;
    }
    Some((client_id, token))
}

fn credentials_from_disk() -> Option<(String, String)> {
    let app = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
    let client_id = app
        .twitch_client_id
        .as_ref()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;
    let token = app
        .twitch_access_token
        .as_ref()
        .map(|s| normalize_token(s))
        .filter(|s| !s.is_empty())?;
    Some((client_id, token))
}

/// Env overrides data.json. Used by Helix calls and Hub status.
pub fn credentials() -> Option<(String, String)> {
    credentials_from_env().or_else(credentials_from_disk)
}

pub fn has_credentials() -> bool {
    credentials().is_some()
}

/// Persist Hub-entered credentials into data.json (does not clear env overrides).
pub fn save_credentials_to_disk(client_id: &str, access_token: &str) -> Result<(), String> {
    let path = crate::storage::get_data_path_from_env();
    let mut app = crate::storage::load_data_from_path(path.clone());
    let id = client_id.trim();
    let token = normalize_token(access_token);
    if id.is_empty() || token.is_empty() {
        return Err("client_id and access_token required".into());
    }
    app.twitch_client_id = Some(id.to_string());
    app.twitch_access_token = Some(token);
    crate::storage::save_data_to_path(path, &app);
    crate::storage::invalidate_cache();
    Ok(())
}

pub fn clear_credentials_on_disk() {
    let path = crate::storage::get_data_path_from_env();
    let mut app = crate::storage::load_data_from_path(path.clone());
    app.twitch_client_id = None;
    app.twitch_access_token = None;
    crate::storage::save_data_to_path(path, &app);
    crate::storage::invalidate_cache();
}

pub struct TwitchService {
    state: Arc<RwLock<TwitchState>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
}

impl TwitchService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(mock_state())),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn snapshot(&self) -> TwitchState {
        self.state.read().await.clone()
    }

    async fn broadcast(&self) {
        let data = self.state.read().await.clone();
        let _ = self
            .sender
            .0
            .send(serde_json::json!({ "type": "TWITCH_STATE", "data": data }).to_string());
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            tracing::info!("[TWITCH] Command '{}' ignored: service disabled", endpoint);
            return Ok(());
        }
        match endpoint {
            "refresh" | "viewers" => {
                self.refresh().await;
            }
            "create_clip" | "clip" => {
                self.create_clip().await;
            }
            "create_marker" | "marker" => {
                let desc = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("description")
                            .or_else(|| p.get("payload").and_then(|x| x.get("description")))
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("CRIMSONS marker")
                    .to_string();
                self.create_marker(&desc).await;
            }
            "set_credentials" => {
                let client_id = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("client_id")
                            .or_else(|| p.get("clientId"))
                            .or_else(|| p.get("payload").and_then(|x| x.get("client_id")))
                            .or_else(|| p.get("payload").and_then(|x| x.get("clientId")))
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("")
                    .to_string();
                let token = params
                    .as_ref()
                    .and_then(|p| {
                        p.get("access_token")
                            .or_else(|| p.get("accessToken"))
                            .or_else(|| p.get("token"))
                            .or_else(|| p.get("payload").and_then(|x| x.get("access_token")))
                            .or_else(|| p.get("payload").and_then(|x| x.get("accessToken")))
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("")
                    .to_string();
                match save_credentials_to_disk(&client_id, &token) {
                    Ok(()) => {
                        tracing::info!("[TWITCH] credentials saved to data.json");
                        self.refresh().await;
                    }
                    Err(e) => {
                        let mut st = self.state.write().await;
                        st.error = Some("creds_invalid".into());
                        st.error_detail = Some(e);
                        drop(st);
                        self.broadcast().await;
                    }
                }
            }
            "clear_credentials" => {
                clear_credentials_on_disk();
                tracing::info!("[TWITCH] credentials cleared from data.json");
                self.refresh().await;
            }
            "mute_alerts" | "toggle_alerts" => {
                let mut st = self.state.write().await;
                st.alerts_muted = !st.alerts_muted;
                drop(st);
                self.broadcast().await;
                tracing::info!("[TWITCH] mute_alerts stub toggled (no Helix chat alerts API)");
            }
            "follower_goal" => {
                // Stub: bump display only; real goals need EventSub / channel points goals.
                let mut st = self.state.write().await;
                if st.follower_goal_current < st.follower_goal_target {
                    st.follower_goal_current = (st.follower_goal_current + 1).min(st.follower_goal_target);
                }
                drop(st);
                self.broadcast().await;
                tracing::info!("[TWITCH] follower_goal stub (no live Helix goal write)");
            }
            "clear_chat" => {
                tracing::warn!("[TWITCH] clear_chat stub — requires IRC/mod scopes (not Helix MVP)");
                let mut st = self.state.write().await;
                st.error = Some("clear_chat_stub".into());
                st.error_detail = Some(
                    "Clear chat n’est pas dans le MVP Helix (IRC + scopes mod requis).".into(),
                );
                drop(st);
                self.broadcast().await;
            }
            "open_twitch" | "openhub" | "open_store" => {
                // StreamDock / Hub open URLs client-side; sidecar no-ops.
                tracing::info!("[TWITCH] open endpoint '{}' (client-side)", endpoint);
            }
            other => {
                tracing::warn!("[TWITCH] Unknown endpoint '{}'", other);
            }
        }
        Ok(())
    }

    pub async fn refresh(&self) {
        let next = fetch_or_mock().await;
        {
            let mut st = self.state.write().await;
            // Preserve stub UI toggles across refresh when mock→mock.
            let alerts = st.alerts_muted;
            let goal_cur = st.follower_goal_current;
            let goal_tgt = st.follower_goal_target;
            let last_clip_id = st.last_clip_id.clone();
            let last_clip_url = st.last_clip_url.clone();
            let last_marker_id = st.last_marker_id.clone();
            *st = next;
            st.alerts_muted = alerts;
            if st.mock {
                st.follower_goal_current = goal_cur;
                st.follower_goal_target = goal_tgt;
            }
            st.last_clip_id = last_clip_id.or(st.last_clip_id.clone());
            st.last_clip_url = last_clip_url.or(st.last_clip_url.clone());
            st.last_marker_id = last_marker_id.or(st.last_marker_id.clone());
        }
        self.broadcast().await;
    }

    async fn create_clip(&self) {
        match create_clip_helix().await {
            Ok((id, url)) => {
                let mut st = self.state.write().await;
                st.last_clip_id = Some(id);
                st.last_clip_url = Some(url);
                st.has_credentials = true;
                st.error = None;
                st.error_detail = None;
                drop(st);
                self.broadcast().await;
            }
            Err(e) => {
                tracing::warn!("[TWITCH] create_clip failed: {}", e);
                if credentials().is_none() {
                    // Mock success for deck UX without credentials.
                    let mut st = self.state.write().await;
                    let id = format!("mock-clip-{}", chrono::Utc::now().timestamp());
                    st.last_clip_id = Some(id.clone());
                    st.last_clip_url = Some(format!("https://clips.twitch.tv/{}", id));
                    st.mock = true;
                    st.has_credentials = false;
                    st.error = None;
                    st.error_detail = None;
                    drop(st);
                    self.broadcast().await;
                } else {
                    let mut st = self.state.write().await;
                    st.has_credentials = true;
                    st.error = Some("clip_failed".into());
                    st.error_detail = Some(format!(
                        "Création clip échouée ({e}). Scope requis : clips:edit. Stream live ?"
                    ));
                    drop(st);
                    self.broadcast().await;
                }
            }
        }
    }

    async fn create_marker(&self, description: &str) {
        match create_marker_helix(description).await {
            Ok(id) => {
                let mut st = self.state.write().await;
                st.last_marker_id = Some(id);
                st.has_credentials = true;
                st.error = None;
                st.error_detail = None;
                drop(st);
                self.broadcast().await;
            }
            Err(e) => {
                tracing::warn!("[TWITCH] create_marker failed: {}", e);
                if credentials().is_none() {
                    let mut st = self.state.write().await;
                    let id = format!("mock-marker-{}", chrono::Utc::now().timestamp());
                    st.last_marker_id = Some(id);
                    st.mock = true;
                    st.has_credentials = false;
                    st.error = None;
                    st.error_detail = None;
                    drop(st);
                    self.broadcast().await;
                } else {
                    let mut st = self.state.write().await;
                    st.has_credentials = true;
                    st.error = Some("marker_failed".into());
                    st.error_detail = Some(format!(
                        "Marker échoué ({e}). Scope requis : channel:manage:broadcast. Stream live ?"
                    ));
                    drop(st);
                    self.broadcast().await;
                }
            }
        }
    }

    pub async fn start_background_polling(&self) {
        let enabled = self.is_enabled.clone();
        let this_state = self.state.clone();
        let sender = self.sender.clone();
        tokio::spawn(async move {
            {
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "TWITCH_STATE", "data": data }).to_string());
            }
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(30)).await;
                if !enabled.load(Ordering::Relaxed) {
                    continue;
                }
                let next = fetch_or_mock().await;
                {
                    let mut st = this_state.write().await;
                    let alerts = st.alerts_muted;
                    let last_clip_id = st.last_clip_id.clone();
                    let last_clip_url = st.last_clip_url.clone();
                    let last_marker_id = st.last_marker_id.clone();
                    let goal_cur = st.follower_goal_current;
                    let goal_tgt = st.follower_goal_target;
                    *st = next;
                    st.alerts_muted = alerts;
                    st.last_clip_id = last_clip_id.or(st.last_clip_id.clone());
                    st.last_clip_url = last_clip_url.or(st.last_clip_url.clone());
                    st.last_marker_id = last_marker_id.or(st.last_marker_id.clone());
                    if st.mock {
                        st.follower_goal_current = goal_cur;
                        st.follower_goal_target = goal_tgt;
                    }
                }
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "TWITCH_STATE", "data": data }).to_string());
            }
        });
    }
}

async fn fetch_or_mock() -> TwitchState {
    match credentials() {
        Some((client_id, token)) => match fetch_helix(&client_id, &token).await {
            Ok(st) => st,
            Err(e) => {
                tracing::warn!("[TWITCH] Helix fetch failed ({}), using mock", e);
                let mut m = mock_state();
                m.has_credentials = true;
                m.error = Some("refresh_failed".into());
                m.error_detail = Some(format!(
                    "Helix indisponible ({e}). Vérifiez Client-Id, token et scopes."
                ));
                m
            }
        },
        None => {
            tracing::info!("[TWITCH] No credentials (env/data.json) — mock state");
            mock_state()
        }
    }
}

async fn fetch_helix(client_id: &str, token: &str) -> Result<TwitchState, String> {
    let agent = ureq::agent();
    let (user_id, login) = resolve_user(&agent, client_id, token)?;

    let url = if let Ok(login_override) = std::env::var("TWITCH_USER_LOGIN") {
        if !login_override.trim().is_empty() {
            format!(
                "{}/streams?user_login={}",
                HELIX_BASE,
                urlencoding::encode(login_override.trim())
            )
        } else {
            format!("{}/streams?user_id={}", HELIX_BASE, urlencoding::encode(&user_id))
        }
    } else {
        format!("{}/streams?user_id={}", HELIX_BASE, urlencoding::encode(&user_id))
    };

    let resp = agent
        .get(&url)
        .set("Client-Id", client_id)
        .set("Authorization", &format!("Bearer {}", token))
        .call()
        .map_err(|e| format!("streams: {}", e))?;
    let body: serde_json::Value = resp
        .into_json()
        .map_err(|e| format!("json: {}", e))?;
    let (live, viewers, title, game) = parse_stream_from_json(&body);

    Ok(TwitchState {
        connected: true,
        mock: false,
        has_credentials: true,
        live,
        viewers,
        username: Some(login),
        broadcaster_id: Some(user_id),
        title,
        game_name: game,
        last_clip_id: None,
        last_clip_url: None,
        last_marker_id: None,
        follower_goal_current: 0,
        follower_goal_target: 0,
        alerts_muted: false,
        error: None,
        error_detail: None,
    })
}

fn resolve_user(
    agent: &ureq::Agent,
    client_id: &str,
    token: &str,
) -> Result<(String, String), String> {
    if let Ok(id) = std::env::var("TWITCH_BROADCASTER_ID") {
        if !id.trim().is_empty() {
            let login = std::env::var("TWITCH_USER_LOGIN").unwrap_or_else(|_| id.clone());
            return Ok((id, login));
        }
    }
    let resp = agent
        .get(&format!("{}/users", HELIX_BASE))
        .set("Client-Id", client_id)
        .set("Authorization", &format!("Bearer {}", token))
        .call()
        .map_err(|e| format!("users: {}", e))?;
    let body: serde_json::Value = resp.into_json().map_err(|e| format!("json: {}", e))?;
    let first = body
        .get("data")
        .and_then(|v| v.as_array())
        .and_then(|a| a.first())
        .ok_or_else(|| "users response empty".to_string())?;
    let id = first
        .get("id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "missing user id".to_string())?
        .to_string();
    let login = first
        .get("login")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    Ok((id, login))
}

async fn create_clip_helix() -> Result<(String, String), String> {
    let (client_id, token) = credentials().ok_or_else(|| "no credentials".to_string())?;
    let agent = ureq::agent();
    let (user_id, _) = resolve_user(&agent, &client_id, &token)?;
    let url = format!(
        "{}/clips?broadcaster_id={}",
        HELIX_BASE,
        urlencoding::encode(&user_id)
    );
    let resp = agent
        .post(&url)
        .set("Client-Id", &client_id)
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .send_string("{}")
        .map_err(|e| format!("clips: {}", e))?;
    let body: serde_json::Value = resp.into_json().map_err(|e| format!("json: {}", e))?;
    parse_clip_from_json(&body).ok_or_else(|| "clip response missing id".into())
}

async fn create_marker_helix(description: &str) -> Result<String, String> {
    let (client_id, token) = credentials().ok_or_else(|| "no credentials".to_string())?;
    let agent = ureq::agent();
    let (user_id, _) = resolve_user(&agent, &client_id, &token)?;
    let payload = serde_json::json!({
        "user_id": user_id,
        "description": description,
    });
    let resp = agent
        .post(&format!("{}/streams/markers", HELIX_BASE))
        .set("Client-Id", &client_id)
        .set("Authorization", &format!("Bearer {}", token))
        .set("Content-Type", "application/json")
        .send_string(&payload.to_string())
        .map_err(|e| format!("markers: {}", e))?;
    let body: serde_json::Value = resp.into_json().map_err(|e| format!("json: {}", e))?;
    parse_marker_from_json(&body).ok_or_else(|| "marker response missing id".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_state_is_live_with_viewers() {
        let st = mock_state();
        assert!(st.mock);
        assert!(!st.has_credentials);
        assert!(st.live);
        assert_eq!(st.viewers, 42);
        assert_eq!(st.username.as_deref(), Some("MockStreamer"));
    }

    #[test]
    fn required_scopes_documented() {
        assert!(REQUIRED_SCOPES.contains(&"clips:edit"));
        assert!(REQUIRED_SCOPES.contains(&"channel:manage:broadcast"));
    }

    #[test]
    fn normalize_token_strips_oauth_prefix() {
        assert_eq!(normalize_token("oauth:abc"), "abc");
        assert_eq!(normalize_token("  xyz  "), "xyz");
    }

    #[test]
    fn parse_stream_live() {
        let v = serde_json::json!({
            "data": [{
                "viewer_count": 1337,
                "title": "Ranked",
                "game_name": "League of Legends"
            }]
        });
        let (live, viewers, title, game) = parse_stream_from_json(&v);
        assert!(live);
        assert_eq!(viewers, 1337);
        assert_eq!(title.as_deref(), Some("Ranked"));
        assert_eq!(game.as_deref(), Some("League of Legends"));
    }

    #[test]
    fn parse_stream_offline() {
        let v = serde_json::json!({ "data": [] });
        let (live, viewers, title, game) = parse_stream_from_json(&v);
        assert!(!live);
        assert_eq!(viewers, 0);
        assert!(title.is_none());
        assert!(game.is_none());
    }

    #[test]
    fn parse_clip_response() {
        let v = serde_json::json!({
            "data": [{ "id": "AwkwardHelplessSoftmangoGnuNazgul", "edit_url": "https://clips.twitch.tv/AwkwardHelplessSoftmangoGnuNazgul/edit" }]
        });
        let (id, url) = parse_clip_from_json(&v).expect("clip");
        assert_eq!(id, "AwkwardHelplessSoftmangoGnuNazgul");
        assert!(url.contains("AwkwardHelplessSoftmangoGnuNazgul"));
    }

    #[test]
    fn parse_marker_response() {
        let v = serde_json::json!({
            "data": [{ "id": "123", "created_at": "2026-01-01T00:00:00Z", "description": "boss", "position_seconds": 10 }]
        });
        assert_eq!(parse_marker_from_json(&v).as_deref(), Some("123"));
    }
}
