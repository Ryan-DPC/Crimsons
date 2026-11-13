//! OBS Studio control via obs-websocket **v5** (raw JSON over WebSocket).
//!
//! Env:
//! - `OBS_WEBSOCKET_URL` — default `ws://127.0.0.1:4455`
//! - `OBS_WEBSOCKET_PASSWORD` — optional (required if OBS auth enabled)
//! - `OBS_MOCK=1` — force mock even when OBS is reachable
//! - `OBS_SCENE_START` / `OBS_SCENE_PAUSE` / `OBS_SCENE_LIVE` / `OBS_SCENE_END`
//!   — configurable HoopsLive scene names (defaults: Start / Pause / Live / End)
//!
//! Without a reachable OBS (typical Linux CI), the service serves deterministic
//! mock state so StreamDock / Hub can be exercised end-to-end.

use crate::events::WsSender;
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, OnceLock};
use tokio::sync::RwLock;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use uuid::Uuid;

static GLOBAL: OnceLock<Arc<ObsService>> = OnceLock::new();

pub fn set_global(svc: Arc<ObsService>) {
    let _ = GLOBAL.set(svc);
}

pub fn global() -> Option<Arc<ObsService>> {
    GLOBAL.get().cloned()
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq, Eq)]
pub struct ObsState {
    pub connected: bool,
    /// True when serving mock / fallback data (OBS absent or `OBS_MOCK=1`).
    pub mock: bool,
    pub current_scene: Option<String>,
    pub scenes: Vec<String>,
    /// Mapped HL role → scene name (Start/Pause/Live/End).
    pub scene_start: String,
    pub scene_pause: String,
    pub scene_live: String,
    pub scene_end: String,
    pub websocket_url: String,
    pub error: Option<String>,
}

/// Default HoopsLive scene names (overridable via env / OBS_COMMAND payload).
pub fn default_scene_names() -> (String, String, String, String) {
    let start = env_nonempty("OBS_SCENE_START").unwrap_or_else(|| "Start".into());
    let pause = env_nonempty("OBS_SCENE_PAUSE").unwrap_or_else(|| "Pause".into());
    let live = env_nonempty("OBS_SCENE_LIVE").unwrap_or_else(|| "Live".into());
    let end = env_nonempty("OBS_SCENE_END").unwrap_or_else(|| "End".into());
    (start, pause, live, end)
}

pub fn websocket_url() -> String {
    env_nonempty("OBS_WEBSOCKET_URL").unwrap_or_else(|| "ws://127.0.0.1:4455".into())
}

fn env_nonempty(key: &str) -> Option<String> {
    std::env::var(key)
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

fn force_mock() -> bool {
    std::env::var("OBS_MOCK")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false)
}

/// Deterministic mock (Linux CI + Hub/StreamDock preview without OBS).
pub fn mock_state() -> ObsState {
    let (start, pause, live, end) = default_scene_names();
    ObsState {
        connected: true,
        mock: true,
        current_scene: Some(start.clone()),
        scenes: vec![start.clone(), pause.clone(), live.clone(), end.clone()],
        scene_start: start,
        scene_pause: pause,
        scene_live: live,
        scene_end: end,
        websocket_url: websocket_url(),
        error: None,
    }
}

/// Build obs-websocket v5 authentication string from Hello challenge/salt.
pub fn obs_auth_response(password: &str, salt: &str, challenge: &str) -> String {
    let mut h1 = Sha256::new();
    h1.update(password.as_bytes());
    h1.update(salt.as_bytes());
    let secret = B64.encode(h1.finalize());
    let mut h2 = Sha256::new();
    h2.update(secret.as_bytes());
    h2.update(challenge.as_bytes());
    B64.encode(h2.finalize())
}

/// Map HL role / action suffix → scene name using current mapping.
pub fn resolve_hl_scene(role: &str, state: &ObsState) -> Option<String> {
    match role.trim().to_ascii_lowercase().as_str() {
        "start" | "scene_start" | "hl_start" => Some(state.scene_start.clone()),
        "pause" | "scene_pause" | "hl_pause" => Some(state.scene_pause.clone()),
        "live" | "scene_live" | "hl_live" => Some(state.scene_live.clone()),
        "end" | "scene_end" | "hl_end" | "stop" => Some(state.scene_end.clone()),
        _ => None,
    }
}

pub struct ObsService {
    state: Arc<RwLock<ObsState>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
}

impl ObsService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(mock_state())),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn snapshot(&self) -> ObsState {
        self.state.read().await.clone()
    }

    async fn broadcast(&self) {
        let data = self.state.read().await.clone();
        let _ = self
            .sender
            .0
            .send(serde_json::json!({ "type": "OBS_STATE", "data": data }).to_string());
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            tracing::info!("[OBS] Command '{}' ignored: service disabled", endpoint);
            return Ok(());
        }

        let scene_from_params = params.as_ref().and_then(|p| {
            p.get("scene")
                .or_else(|| p.get("sceneName"))
                .or_else(|| p.get("payload").and_then(|x| x.get("scene")))
                .or_else(|| p.get("payload").and_then(|x| x.get("sceneName")))
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
        });

        if let Some(p) = params.as_ref() {
            let mut st = self.state.write().await;
            apply_scene_remap(&mut st, p);
        }

        match endpoint {
            "refresh" | "status" | "get_status" => {
                self.refresh().await;
            }
            "set_scene" | "scene" | "obs_scene" => {
                let Some(name) = scene_from_params else {
                    tracing::warn!("[OBS] set_scene missing scene/sceneName");
                    return Ok(());
                };
                self.set_scene(&name).await;
            }
            "start" | "scene_start" | "hl_start" => {
                let name = match scene_from_params {
                    Some(s) => s,
                    None => self.state.read().await.scene_start.clone(),
                };
                self.set_scene(&name).await;
            }
            "pause" | "scene_pause" | "hl_pause" => {
                let name = match scene_from_params {
                    Some(s) => s,
                    None => self.state.read().await.scene_pause.clone(),
                };
                self.set_scene(&name).await;
            }
            "live" | "scene_live" | "hl_live" => {
                let name = match scene_from_params {
                    Some(s) => s,
                    None => self.state.read().await.scene_live.clone(),
                };
                self.set_scene(&name).await;
            }
            "end" | "scene_end" | "hl_end" | "stop" => {
                let name = match scene_from_params {
                    Some(s) => s,
                    None => self.state.read().await.scene_end.clone(),
                };
                self.set_scene(&name).await;
            }
            "openhub" | "open_store" => {
                tracing::info!("[OBS] open endpoint '{}' (client-side)", endpoint);
            }
            other => {
                let st = self.state.read().await.clone();
                if let Some(name) = resolve_hl_scene(other, &st) {
                    drop(st);
                    self.set_scene(&name).await;
                } else {
                    tracing::warn!("[OBS] Unknown endpoint '{}'", other);
                }
            }
        }
        Ok(())
    }

    pub async fn refresh(&self) {
        let next = fetch_or_mock().await;
        {
            let mut st = self.state.write().await;
            let map = (
                st.scene_start.clone(),
                st.scene_pause.clone(),
                st.scene_live.clone(),
                st.scene_end.clone(),
            );
            *st = next;
            preserve_custom_mapping(&mut st, map);
        }
        self.broadcast().await;
    }

    pub async fn set_scene(&self, scene_name: &str) {
        match set_current_scene(scene_name).await {
            Ok(()) => {
                let mut st = self.state.write().await;
                st.current_scene = Some(scene_name.to_string());
                if !st.scenes.iter().any(|s| s == scene_name) {
                    st.scenes.push(scene_name.to_string());
                }
                st.connected = true;
                st.mock = false;
                st.error = None;
                drop(st);
                self.broadcast().await;
            }
            Err(e) => {
                tracing::warn!("[OBS] set_scene('{}') failed: {}", scene_name, e);
                if force_mock() || is_unreachable(&e) {
                    let mut st = self.state.write().await;
                    st.current_scene = Some(scene_name.to_string());
                    if !st.scenes.iter().any(|s| s == scene_name) {
                        st.scenes.push(scene_name.to_string());
                    }
                    st.connected = true;
                    st.mock = true;
                    st.error = None;
                    drop(st);
                    self.broadcast().await;
                } else {
                    let mut st = self.state.write().await;
                    st.error = Some(format!("set_scene: {}", e));
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
                    .send(serde_json::json!({ "type": "OBS_STATE", "data": data }).to_string());
            }
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(15)).await;
                if !enabled.load(Ordering::Relaxed) {
                    continue;
                }
                let next = fetch_or_mock().await;
                {
                    let mut st = this_state.write().await;
                    let map = (
                        st.scene_start.clone(),
                        st.scene_pause.clone(),
                        st.scene_live.clone(),
                        st.scene_end.clone(),
                    );
                    *st = next;
                    preserve_custom_mapping(&mut st, map);
                }
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "OBS_STATE", "data": data }).to_string());
            }
        });
    }
}

fn apply_scene_remap(st: &mut ObsState, p: &serde_json::Value) {
    if let Some(s) = p
        .get("scene_start")
        .or_else(|| p.get("sceneStart"))
        .and_then(|v| v.as_str())
    {
        if !s.trim().is_empty() {
            st.scene_start = s.trim().to_string();
        }
    }
    if let Some(s) = p
        .get("scene_pause")
        .or_else(|| p.get("scenePause"))
        .and_then(|v| v.as_str())
    {
        if !s.trim().is_empty() {
            st.scene_pause = s.trim().to_string();
        }
    }
    if let Some(s) = p
        .get("scene_live")
        .or_else(|| p.get("sceneLive"))
        .and_then(|v| v.as_str())
    {
        if !s.trim().is_empty() {
            st.scene_live = s.trim().to_string();
        }
    }
    if let Some(s) = p
        .get("scene_end")
        .or_else(|| p.get("sceneEnd"))
        .and_then(|v| v.as_str())
    {
        if !s.trim().is_empty() {
            st.scene_end = s.trim().to_string();
        }
    }
}

fn preserve_custom_mapping(st: &mut ObsState, map: (String, String, String, String)) {
    if env_nonempty("OBS_SCENE_START").is_none() {
        st.scene_start = map.0;
    }
    if env_nonempty("OBS_SCENE_PAUSE").is_none() {
        st.scene_pause = map.1;
    }
    if env_nonempty("OBS_SCENE_LIVE").is_none() {
        st.scene_live = map.2;
    }
    if env_nonempty("OBS_SCENE_END").is_none() {
        st.scene_end = map.3;
    }
}

fn is_unreachable(err: &str) -> bool {
    let e = err.to_ascii_lowercase();
    e.contains("connection")
        || e.contains("connect")
        || e.contains("timed out")
        || e.contains("timeout")
        || e.contains("refused")
        || e.contains("os error")
        || e.contains("no obs")
        || force_mock()
}

async fn fetch_or_mock() -> ObsState {
    if force_mock() {
        tracing::info!("[OBS] OBS_MOCK=1 — mock state");
        return mock_state();
    }
    match fetch_live().await {
        Ok(st) => st,
        Err(e) => {
            tracing::info!("[OBS] OBS unreachable ({}), using mock", e);
            let mut m = mock_state();
            m.error = Some(format!("obs_unreachable: {}", e));
            m
        }
    }
}

async fn fetch_live() -> Result<ObsState, String> {
    let mut session = ObsSession::connect().await?;
    let scenes = session.get_scene_list().await?;
    let current = session.get_current_program_scene().await?;
    let (start, pause, live, end) = default_scene_names();
    Ok(ObsState {
        connected: true,
        mock: false,
        current_scene: current,
        scenes,
        scene_start: start,
        scene_pause: pause,
        scene_live: live,
        scene_end: end,
        websocket_url: websocket_url(),
        error: None,
    })
}

async fn set_current_scene(scene_name: &str) -> Result<(), String> {
    if force_mock() {
        return Err("no obs (OBS_MOCK=1)".into());
    }
    let mut session = ObsSession::connect().await?;
    session.set_current_program_scene(scene_name).await
}

type ObsWs = tokio_tungstenite::WebSocketStream<
    tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
>;

struct ObsSession {
    write: futures_util::stream::SplitSink<ObsWs, Message>,
    read: futures_util::stream::SplitStream<ObsWs>,
}

impl ObsSession {
    async fn connect() -> Result<Self, String> {
        let url = websocket_url();
        let (ws, _) = tokio::time::timeout(std::time::Duration::from_secs(2), connect_async(&url))
            .await
            .map_err(|_| "connect timed out".to_string())?
            .map_err(|e| format!("connect: {}", e))?;
        let (mut write, mut read) = ws.split();

        let hello = read_op(&mut read, 0).await?;
        let rpc_version = hello
            .pointer("/d/rpcVersion")
            .and_then(|v| v.as_i64())
            .unwrap_or(1);

        let mut identify = serde_json::json!({
            "op": 1,
            "d": { "rpcVersion": rpc_version }
        });

        if let Some(auth) = hello.get("d").and_then(|d| d.get("authentication")) {
            let password = env_nonempty("OBS_WEBSOCKET_PASSWORD").unwrap_or_default();
            let salt = auth.get("salt").and_then(|v| v.as_str()).unwrap_or("");
            let challenge = auth.get("challenge").and_then(|v| v.as_str()).unwrap_or("");
            if password.is_empty() {
                return Err("OBS auth required but OBS_WEBSOCKET_PASSWORD empty".into());
            }
            let token = obs_auth_response(&password, salt, challenge);
            identify["d"]["authentication"] = serde_json::json!(token);
        }

        write
            .send(Message::Text(identify.to_string()))
            .await
            .map_err(|e| format!("identify send: {}", e))?;
        let _identified = read_op(&mut read, 2).await?;

        Ok(Self { write, read })
    }

    async fn request(
        &mut self,
        request_type: &str,
        request_data: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, String> {
        let request_id = Uuid::new_v4().to_string();
        let mut body = serde_json::json!({
            "op": 6,
            "d": {
                "requestType": request_type,
                "requestId": request_id,
            }
        });
        if let Some(data) = request_data {
            body["d"]["requestData"] = data;
        }
        self.write
            .send(Message::Text(body.to_string()))
            .await
            .map_err(|e| format!("request send: {}", e))?;

        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
        loop {
            let left = deadline.saturating_duration_since(tokio::time::Instant::now());
            if left.is_zero() {
                return Err("request timed out".into());
            }
            let msg = tokio::time::timeout(left, self.read.next())
                .await
                .map_err(|_| "request timed out".to_string())?
                .ok_or_else(|| "obs closed".to_string())?
                .map_err(|e| format!("read: {}", e))?;
            let text = match msg {
                Message::Text(t) => t,
                Message::Ping(p) => {
                    let _ = self.write.send(Message::Pong(p)).await;
                    continue;
                }
                _ => continue,
            };
            let v: serde_json::Value =
                serde_json::from_str(&text).map_err(|e| format!("json: {}", e))?;
            if v.get("op").and_then(|o| o.as_i64()) != Some(7) {
                continue;
            }
            let d = v.get("d").cloned().unwrap_or(serde_json::json!({}));
            if d.get("requestId").and_then(|r| r.as_str()) != Some(request_id.as_str()) {
                continue;
            }
            let ok = d
                .pointer("/requestStatus/result")
                .and_then(|r| r.as_bool())
                .unwrap_or(false);
            if !ok {
                let code = d
                    .pointer("/requestStatus/code")
                    .and_then(|c| c.as_i64())
                    .unwrap_or(-1);
                let comment = d
                    .pointer("/requestStatus/comment")
                    .and_then(|c| c.as_str())
                    .unwrap_or("failed");
                return Err(format!("{} failed ({}): {}", request_type, code, comment));
            }
            return Ok(d
                .get("responseData")
                .cloned()
                .unwrap_or(serde_json::json!({})));
        }
    }

    async fn get_scene_list(&mut self) -> Result<Vec<String>, String> {
        let data = self.request("GetSceneList", None).await?;
        let arr = data
            .get("scenes")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        Ok(arr
            .iter()
            .filter_map(|s| {
                s.get("sceneName")
                    .and_then(|n| n.as_str())
                    .map(|n| n.to_string())
            })
            .collect())
    }

    async fn get_current_program_scene(&mut self) -> Result<Option<String>, String> {
        let data = self.request("GetCurrentProgramScene", None).await?;
        Ok(data
            .get("currentProgramSceneName")
            .or_else(|| data.get("sceneName"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()))
    }

    async fn set_current_program_scene(&mut self, scene_name: &str) -> Result<(), String> {
        self.request(
            "SetCurrentProgramScene",
            Some(serde_json::json!({ "sceneName": scene_name })),
        )
        .await?;
        Ok(())
    }
}

async fn read_op(
    read: &mut futures_util::stream::SplitStream<ObsWs>,
    expected: i64,
) -> Result<serde_json::Value, String> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(3);
    loop {
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            return Err(format!("wait op {} timed out", expected));
        }
        let msg = tokio::time::timeout(left, read.next())
            .await
            .map_err(|_| format!("wait op {} timed out", expected))?
            .ok_or_else(|| "obs closed during handshake".to_string())?
            .map_err(|e| format!("read: {}", e))?;
        let text = match msg {
            Message::Text(t) => t,
            _ => continue,
        };
        let v: serde_json::Value =
            serde_json::from_str(&text).map_err(|e| format!("json: {}", e))?;
        if v.get("op").and_then(|o| o.as_i64()) == Some(expected) {
            return Ok(v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mock_state_has_hl_scenes() {
        let st = mock_state();
        assert!(st.mock);
        assert!(st.connected);
        assert_eq!(st.scene_start, "Start");
        assert_eq!(st.scene_pause, "Pause");
        assert_eq!(st.scene_live, "Live");
        assert_eq!(st.scene_end, "End");
        assert_eq!(st.scenes.len(), 4);
        assert_eq!(st.current_scene.as_deref(), Some("Start"));
        assert_eq!(st.websocket_url, "ws://127.0.0.1:4455");
    }

    #[test]
    fn resolve_hl_roles() {
        let st = mock_state();
        assert_eq!(resolve_hl_scene("start", &st).as_deref(), Some("Start"));
        assert_eq!(resolve_hl_scene("PAUSE", &st).as_deref(), Some("Pause"));
        assert_eq!(resolve_hl_scene("hl_live", &st).as_deref(), Some("Live"));
        assert_eq!(resolve_hl_scene("end", &st).as_deref(), Some("End"));
        assert!(resolve_hl_scene("nope", &st).is_none());
    }

    #[test]
    fn obs_auth_matches_protocol_example_shape() {
        let a = obs_auth_response("secret", "salt", "challenge");
        let b = obs_auth_response("secret", "salt", "challenge");
        assert_eq!(a, b);
        assert!(!a.is_empty());
        let c = obs_auth_response("secret", "salt", "other");
        assert_ne!(a, c);
    }

    #[test]
    fn default_url() {
        assert_eq!(websocket_url(), "ws://127.0.0.1:4455");
    }
}
