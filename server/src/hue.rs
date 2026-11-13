//! Philips Hue local bridge control (CLIP v1) + deterministic mock for Linux/CI.
//!
//! Credentials via env:
//! - `HUE_BRIDGE_IP` — bridge LAN address
//! - `HUE_USERNAME` — local API username (bridge link button)
//! - `HUE_MOCK=1` — force mock even when credentials are set
//!
//! Without credentials (typical Linux VM), the service serves a mock home with
//! rooms + scenes so StreamDock / Hub UI can be exercised end-to-end.

use crate::events::WsSender;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Brightness step (~10% of Hue bri 1–254).
pub const BRI_STEP: u8 = 25;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct HueGroup {
    pub id: String,
    pub name: String,
    /// `"Room"` | `"Zone"` | `"LightGroup"` | `"Entertainment"` | `"mock"`
    pub kind: String,
    pub on: bool,
    /// 1–254 (Hue scale)
    pub bri: u8,
    /// Mireds when known (153 warm … 500 cool-ish for typical bulbs)
    #[serde(default)]
    pub ct: Option<u16>,
    pub light_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct HueScene {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct HueState {
    pub connected: bool,
    /// True when serving mock data (no bridge creds / forced mock / API failure).
    pub mock: bool,
    pub bridge_ip: Option<String>,
    pub username: Option<String>,
    pub groups: Vec<HueGroup>,
    pub scenes: Vec<HueScene>,
    /// Index into `groups` for StreamDock room/group selection.
    pub selected_group_index: usize,
    /// Index into scenes filtered for the selected group (or all scenes).
    pub selected_scene_index: usize,
    pub error: Option<String>,
}

impl HueState {
    pub fn selected_group(&self) -> Option<&HueGroup> {
        self.groups.get(self.selected_group_index)
    }

    pub fn scenes_for_selected(&self) -> Vec<&HueScene> {
        let gid = self.selected_group().map(|g| g.id.as_str());
        self.scenes
            .iter()
            .filter(|s| match (&s.group, gid) {
                (Some(g), Some(sel)) => g == sel,
                (None, _) => true,
                (Some(_), None) => true,
            })
            .collect()
    }

    pub fn selected_scene(&self) -> Option<&HueScene> {
        let list = self.scenes_for_selected();
        list.get(self.selected_scene_index).copied()
    }
}

/// Clamp / wrap scroll index. Pure helper for unit tests + commands.
pub fn scroll_index(len: usize, current: usize, delta: i32) -> usize {
    if len == 0 {
        return 0;
    }
    let cur = current.min(len - 1) as i32;
    let next = cur + delta;
    if next < 0 {
        (len - 1) as usize
    } else if next as usize >= len {
        0
    } else {
        next as usize
    }
}

pub fn clamp_bri(bri: i32) -> u8 {
    bri.clamp(1, 254) as u8
}

/// Warm / cool / mid color-temperature presets (mireds).
pub fn ct_preset_mireds(name: &str) -> Option<u16> {
    match name {
        "warm" | "ct_warm" => Some(400),
        "cool" | "ct_cool" => Some(200),
        "daylight" | "ct_daylight" => Some(153),
        "neutral" | "ct_neutral" | "preset" | "ct_preset" => Some(300),
        _ => None,
    }
}

fn env_bridge() -> (Option<String>, Option<String>, bool) {
    let force_mock = std::env::var("HUE_MOCK")
        .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
        .unwrap_or(false);
    let ip = std::env::var("HUE_BRIDGE_IP")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    let user = std::env::var("HUE_USERNAME")
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());
    (ip, user, force_mock)
}

/// Deterministic mock home (Linux CI + Hub/StreamDock preview).
pub fn mock_state() -> HueState {
    let groups = vec![
        HueGroup {
            id: "1".into(),
            name: "Living Room".into(),
            kind: "Room".into(),
            on: true,
            bri: 180,
            ct: Some(320),
            light_ids: vec!["1".into(), "2".into()],
        },
        HueGroup {
            id: "2".into(),
            name: "Bedroom".into(),
            kind: "Room".into(),
            on: false,
            bri: 80,
            ct: Some(400),
            light_ids: vec!["3".into()],
        },
        HueGroup {
            id: "3".into(),
            name: "Gaming Den".into(),
            kind: "Room".into(),
            on: true,
            bri: 220,
            ct: Some(250),
            light_ids: vec!["4".into(), "5".into(), "6".into()],
        },
    ];
    let scenes = vec![
        HueScene {
            id: "relax".into(),
            name: "Relax".into(),
            group: Some("1".into()),
        },
        HueScene {
            id: "concentrate".into(),
            name: "Concentrate".into(),
            group: Some("1".into()),
        },
        HueScene {
            id: "energize".into(),
            name: "Energize".into(),
            group: Some("3".into()),
        },
        HueScene {
            id: "nightlight".into(),
            name: "Nightlight".into(),
            group: Some("2".into()),
        },
        HueScene {
            id: "dimmed".into(),
            name: "Dimmed".into(),
            group: None,
        },
        HueScene {
            id: "read".into(),
            name: "Read".into(),
            group: Some("1".into()),
        },
    ];
    HueState {
        connected: true,
        mock: true,
        bridge_ip: None,
        username: None,
        groups,
        scenes,
        selected_group_index: 0,
        selected_scene_index: 0,
        error: None,
    }
}

pub struct HueService {
    state: Arc<RwLock<HueState>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
}

impl HueService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(mock_state())),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn snapshot(&self) -> HueState {
        self.state.read().await.clone()
    }

    async fn broadcast(&self) {
        let data = self.state.read().await.clone();
        let _ = self
            .sender
            .0
            .send(serde_json::json!({ "type": "HUE_STATE", "data": data }).to_string());
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            tracing::info!("[HUE] Command '{}' ignored: service disabled", endpoint);
            return Ok(());
        }
        match endpoint {
            "refresh" => {
                self.refresh().await;
            }
            "toggle" | "lights_toggle" | "on_off" => {
                self.toggle_selected().await;
            }
            "on" | "lights_on" => {
                self.set_selected_on(true).await;
            }
            "off" | "lights_off" => {
                self.set_selected_on(false).await;
            }
            "bri_up" | "brightness_up" => {
                self.adjust_bri(BRI_STEP as i32).await;
            }
            "bri_down" | "brightness_down" => {
                self.adjust_bri(-(BRI_STEP as i32)).await;
            }
            "scene_next" => {
                self.scroll_scene(1).await;
            }
            "scene_prev" => {
                self.scroll_scene(-1).await;
            }
            "scene_apply" | "apply_scene" => {
                self.apply_selected_scene().await;
            }
            "group_next" | "room_next" => {
                self.scroll_group(1).await;
            }
            "group_prev" | "room_prev" => {
                self.scroll_group(-1).await;
            }
            "select_group" | "select_room" => {
                if let Some(idx) = params
                    .as_ref()
                    .and_then(|p| p.get("index").or_else(|| p.get("group_index")))
                    .and_then(|v| v.as_u64())
                {
                    let mut st = self.state.write().await;
                    if !st.groups.is_empty() {
                        st.selected_group_index = (idx as usize).min(st.groups.len() - 1);
                        st.selected_scene_index = 0;
                    }
                    drop(st);
                    self.broadcast().await;
                }
            }
            "ct_warm" | "ct_cool" | "ct_daylight" | "ct_neutral" | "ct_preset" | "color_temp" => {
                let key = params
                    .as_ref()
                    .and_then(|p| p.get("preset").or_else(|| p.get("name")))
                    .and_then(|v| v.as_str())
                    .unwrap_or(endpoint);
                self.apply_ct_preset(key).await;
            }
            "set_bri" | "set_brightness" => {
                if let Some(bri) = params
                    .as_ref()
                    .and_then(|p| p.get("bri").or_else(|| p.get("brightness")))
                    .and_then(|v| v.as_u64())
                {
                    self.set_bri(bri as u8).await;
                }
            }
            other => {
                tracing::warn!("[HUE] Unknown endpoint '{}'", other);
            }
        }
        Ok(())
    }

    pub async fn refresh(&self) {
        let keep_group = self.state.read().await.selected_group_index;
        let keep_scene = self.state.read().await.selected_scene_index;
        let next = read_bridge_or_mock().await;
        {
            let mut st = self.state.write().await;
            let gidx = if next.groups.is_empty() {
                0
            } else {
                keep_group.min(next.groups.len() - 1)
            };
            *st = next;
            st.selected_group_index = gidx;
            let scene_len = st.scenes_for_selected().len();
            st.selected_scene_index = if scene_len == 0 {
                0
            } else {
                keep_scene.min(scene_len - 1)
            };
        }
        self.broadcast().await;
    }

    async fn scroll_group(&self, delta: i32) {
        {
            let mut st = self.state.write().await;
            st.selected_group_index = scroll_index(st.groups.len(), st.selected_group_index, delta);
            st.selected_scene_index = 0;
        }
        self.broadcast().await;
    }

    async fn scroll_scene(&self, delta: i32) {
        {
            let mut st = self.state.write().await;
            let len = st.scenes_for_selected().len();
            st.selected_scene_index = scroll_index(len, st.selected_scene_index, delta);
        }
        // Applying on scroll matches StreamDock "scene next/prev" UX.
        self.apply_selected_scene().await;
    }

    async fn toggle_selected(&self) {
        let on = {
            let st = self.state.read().await;
            match st.selected_group() {
                Some(g) => !g.on,
                None => return,
            }
        };
        self.set_selected_on(on).await;
    }

    async fn set_selected_on(&self, on: bool) {
        let (gid, is_mock, bri) = {
            let st = self.state.read().await;
            match st.selected_group() {
                Some(g) => (g.id.clone(), st.mock, g.bri),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(g) = st.groups.iter_mut().find(|g| g.id == gid) {
                g.on = on;
            }
            drop(st);
            self.broadcast().await;
            return;
        }
        let _ = bridge_put_group_action(&gid, serde_json::json!({ "on": on, "bri": bri })).await;
        self.refresh().await;
    }

    async fn adjust_bri(&self, delta: i32) {
        let (gid, bri, is_mock, was_on) = {
            let st = self.state.read().await;
            match st.selected_group() {
                Some(g) => (
                    g.id.clone(),
                    clamp_bri(g.bri as i32 + delta),
                    st.mock,
                    g.on,
                ),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(g) = st.groups.iter_mut().find(|g| g.id == gid) {
                g.bri = bri;
                g.on = true;
            }
            drop(st);
            self.broadcast().await;
            return;
        }
        let body = if was_on {
            serde_json::json!({ "bri": bri })
        } else {
            serde_json::json!({ "on": true, "bri": bri })
        };
        let _ = bridge_put_group_action(&gid, body).await;
        self.refresh().await;
    }

    async fn set_bri(&self, bri: u8) {
        let bri = clamp_bri(bri as i32);
        let (gid, is_mock) = {
            let st = self.state.read().await;
            match st.selected_group() {
                Some(g) => (g.id.clone(), st.mock),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(g) = st.groups.iter_mut().find(|g| g.id == gid) {
                g.bri = bri;
                g.on = true;
            }
            drop(st);
            self.broadcast().await;
            return;
        }
        let _ = bridge_put_group_action(&gid, serde_json::json!({ "on": true, "bri": bri })).await;
        self.refresh().await;
    }

    async fn apply_selected_scene(&self) {
        let (scene_id, gid, is_mock) = {
            let st = self.state.read().await;
            let scene = match st.selected_scene() {
                Some(s) => s.clone(),
                None => return,
            };
            let gid = st.selected_group().map(|g| g.id.clone());
            (scene.id, gid, st.mock)
        };
        if is_mock {
            // Mock: turn selected group on + bump bri slightly to show "applied".
            let mut st = self.state.write().await;
            let idx = st.selected_group_index;
            if let Some(g) = st.groups.get_mut(idx) {
                g.on = true;
                g.bri = clamp_bri(g.bri as i32 + 5);
            }
            drop(st);
            self.broadcast().await;
            return;
        }
        if let Some(gid) = gid {
            let _ = bridge_put_group_action(&gid, serde_json::json!({ "scene": scene_id })).await;
            self.refresh().await;
        }
    }

    async fn apply_ct_preset(&self, preset: &str) {
        let Some(ct) = ct_preset_mireds(preset) else {
            tracing::warn!("[HUE] Unknown CT preset '{}'", preset);
            return;
        };
        let (gid, is_mock) = {
            let st = self.state.read().await;
            match st.selected_group() {
                Some(g) => (g.id.clone(), st.mock),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(g) = st.groups.iter_mut().find(|g| g.id == gid) {
                g.ct = Some(ct);
                g.on = true;
            }
            drop(st);
            self.broadcast().await;
            return;
        }
        let _ = bridge_put_group_action(
            &gid,
            serde_json::json!({ "on": true, "ct": ct }),
        )
        .await;
        self.refresh().await;
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
                    .send(serde_json::json!({ "type": "HUE_STATE", "data": data }).to_string());
            }
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
                if !enabled.load(Ordering::Relaxed) {
                    continue;
                }
                let was_mock = this_state.read().await.mock;
                if was_mock {
                    // Preserve in-memory mock mutations; credentials may appear later.
                    let (ip, user, force_mock) = env_bridge();
                    if !force_mock && ip.is_some() && user.is_some() {
                        let keep_group = this_state.read().await.selected_group_index;
                        let keep_scene = this_state.read().await.selected_scene_index;
                        let next = read_bridge_or_mock().await;
                        let mut st = this_state.write().await;
                        let gidx = if next.groups.is_empty() {
                            0
                        } else {
                            keep_group.min(next.groups.len() - 1)
                        };
                        *st = next;
                        st.selected_group_index = gidx;
                        let scene_len = st.scenes_for_selected().len();
                        st.selected_scene_index = if scene_len == 0 {
                            0
                        } else {
                            keep_scene.min(scene_len - 1)
                        };
                    }
                } else {
                    let keep_group = this_state.read().await.selected_group_index;
                    let keep_scene = this_state.read().await.selected_scene_index;
                    let next = read_bridge_or_mock().await;
                    {
                        let mut st = this_state.write().await;
                        let gidx = if next.groups.is_empty() {
                            0
                        } else {
                            keep_group.min(next.groups.len() - 1)
                        };
                        *st = next;
                        st.selected_group_index = gidx;
                        let scene_len = st.scenes_for_selected().len();
                        st.selected_scene_index = if scene_len == 0 {
                            0
                        } else {
                            keep_scene.min(scene_len - 1)
                        };
                    }
                }
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "HUE_STATE", "data": data }).to_string());
            }
        });
    }
}

async fn read_bridge_or_mock() -> HueState {
    let (ip, user, force_mock) = env_bridge();
    if force_mock || ip.is_none() || user.is_none() {
        let mut m = mock_state();
        if force_mock {
            m.error = Some("HUE_MOCK=1".into());
        } else {
            m.error = Some("Set HUE_BRIDGE_IP + HUE_USERNAME (or use mock)".into());
        }
        return m;
    }
    let ip = ip.unwrap();
    let user = user.unwrap();
    match fetch_bridge_state(&ip, &user).await {
        Ok(mut st) => {
            st.bridge_ip = Some(ip);
            st.username = Some(user);
            st.connected = true;
            st.mock = false;
            st
        }
        Err(e) => {
            tracing::warn!("[HUE] Bridge fetch failed ({}), using mock", e);
            let mut m = mock_state();
            m.bridge_ip = Some(ip);
            m.username = Some(user);
            m.error = Some(format!("bridge: {}", e));
            m
        }
    }
}

async fn fetch_bridge_state(ip: &str, user: &str) -> Result<HueState, String> {
    let base = format!("http://{}/api/{}", ip, user);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;

    let groups_url = format!("{}/groups", base);
    let scenes_url = format!("{}/scenes", base);

    let groups_val: serde_json::Value = client
        .get(&groups_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    let scenes_val: serde_json::Value = client
        .get(&scenes_url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .json()
        .await
        .map_err(|e| e.to_string())?;

    // Bridge errors come back as arrays: [{"error":{...}}]
    if groups_val.is_array() {
        return Err(format!("groups API error: {}", groups_val));
    }

    let mut groups = Vec::new();
    if let Some(obj) = groups_val.as_object() {
        for (id, g) in obj {
            let name = g
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Group")
                .to_string();
            let kind = g
                .get("type")
                .and_then(|v| v.as_str())
                .unwrap_or("LightGroup")
                .to_string();
            let action = g.get("action").cloned().unwrap_or(serde_json::json!({}));
            let on = action.get("on").and_then(|v| v.as_bool()).unwrap_or(false);
            let bri = action
                .get("bri")
                .and_then(|v| v.as_u64())
                .map(|v| v as u8)
                .unwrap_or(128);
            let ct = action
                .get("ct")
                .and_then(|v| v.as_u64())
                .map(|v| v as u16);
            let light_ids = g
                .get("lights")
                .and_then(|v| v.as_array())
                .map(|arr| {
                    arr.iter()
                        .filter_map(|x| x.as_str().map(|s| s.to_string()))
                        .collect()
                })
                .unwrap_or_default();
            groups.push(HueGroup {
                id: id.clone(),
                name,
                kind,
                on,
                bri,
                ct,
                light_ids,
            });
        }
    }
    groups.sort_by(|a, b| a.name.cmp(&b.name));

    let mut scenes = Vec::new();
    if let Some(obj) = scenes_val.as_object() {
        for (id, s) in obj {
            let name = s
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("Scene")
                .to_string();
            let group = s
                .get("group")
                .and_then(|v| v.as_str())
                .map(|g| g.to_string());
            scenes.push(HueScene {
                id: id.clone(),
                name,
                group,
            });
        }
    }
    scenes.sort_by(|a, b| a.name.cmp(&b.name));

    Ok(HueState {
        connected: true,
        mock: false,
        bridge_ip: Some(ip.to_string()),
        username: Some(user.to_string()),
        groups,
        scenes,
        selected_group_index: 0,
        selected_scene_index: 0,
        error: None,
    })
}

async fn bridge_put_group_action(group_id: &str, body: serde_json::Value) -> Result<(), String> {
    let (ip, user, force_mock) = env_bridge();
    if force_mock || ip.is_none() || user.is_none() {
        return Ok(());
    }
    let ip = ip.unwrap();
    let user = user.unwrap();
    let url = format!("http://{}/api/{}/groups/{}/action", ip, user, group_id);
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(3))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .put(&url)
        .json(&body)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("PUT {} -> {}", url, resp.status()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_wraps_at_edges() {
        assert_eq!(scroll_index(0, 0, 1), 0);
        assert_eq!(scroll_index(5, 0, -1), 4);
        assert_eq!(scroll_index(5, 4, 1), 0);
        assert_eq!(scroll_index(5, 2, 1), 3);
        assert_eq!(scroll_index(5, 2, -1), 1);
    }

    #[test]
    fn clamp_bri_bounds() {
        assert_eq!(clamp_bri(0), 1);
        assert_eq!(clamp_bri(300), 254);
        assert_eq!(clamp_bri(128), 128);
    }

    #[test]
    fn ct_presets_known() {
        assert_eq!(ct_preset_mireds("warm"), Some(400));
        assert_eq!(ct_preset_mireds("ct_cool"), Some(200));
        assert_eq!(ct_preset_mireds("ct_preset"), Some(300));
        assert_eq!(ct_preset_mireds("nope"), None);
    }

    #[test]
    fn mock_state_has_rooms_and_scenes() {
        let st = mock_state();
        assert!(st.mock);
        assert!(st.connected);
        assert!(st.groups.len() >= 3);
        assert!(st.scenes.len() >= 4);
        assert_eq!(st.selected_group().unwrap().name, "Living Room");
        let filtered = st.scenes_for_selected();
        assert!(!filtered.is_empty());
    }

    #[test]
    fn scene_scroll_then_name() {
        let mut st = mock_state();
        // Living Room scenes include Relax, Concentrate, Read (+ Dimmed global).
        let len = st.scenes_for_selected().len();
        assert!(len >= 3);
        st.selected_scene_index = scroll_index(len, st.selected_scene_index, 1);
        assert_eq!(st.selected_scene_index, 1);
        assert!(st.selected_scene().is_some());
    }

    #[test]
    fn hue_state_serializes_for_ws() {
        let st = mock_state();
        let v = serde_json::to_value(&st).unwrap();
        assert_eq!(v["mock"], true);
        assert!(v["groups"].as_array().unwrap().len() >= 3);
        assert!(v["scenes"].as_array().unwrap().len() >= 4);
    }
}
