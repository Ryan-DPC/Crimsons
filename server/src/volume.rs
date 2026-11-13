//! Windows volume control + multi-track mixer model (Wave Link–ready).
//!
//! Layer A — Windows Core Audio (WASAPI sessions + master endpoint) on Windows;
//! Linux / CI uses a deterministic mock that mirrors typical Wave Link tracks.
//!
//! Layer B — Wave Link multi-track: discovery stub in [`crate::wavelink`]; when
//! the JSON-RPC client is wired, channels merge into `tracks`. Until then,
//! Windows sessions (Discord, Chrome, games…) map to the same UX.

use crate::events::WsSender;
use crate::wavelink::{self, WaveLinkState};
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::sync::RwLock;

/// Default volume step for ± commands (5%).
pub const VOLUME_STEP: f32 = 0.05;

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct VolumeTrack {
    pub id: String,
    pub name: String,
    /// `"windows"` | `"wavelink"` | `"mock"`
    pub source: String,
    /// 0.0–1.0
    pub level: f32,
    pub muted: bool,
    #[serde(default)]
    pub process_id: Option<u32>,
    #[serde(default)]
    pub app_names: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct VolumeState {
    pub connected: bool,
    /// True when serving mock data (non-Windows or COM failure).
    pub mock: bool,
    pub master_level: f32,
    pub master_muted: bool,
    pub tracks: Vec<VolumeTrack>,
    /// Index into `tracks` for StreamDock scroll ± volume.
    pub selected_track_index: usize,
    pub wavelink: WaveLinkState,
    pub error: Option<String>,
}

impl VolumeState {
    pub fn selected_track(&self) -> Option<&VolumeTrack> {
        self.tracks.get(self.selected_track_index)
    }
}

/// Clamp / wrap track scroll index. Pure helper for unit tests + commands.
pub fn scroll_track_index(len: usize, current: usize, delta: i32) -> usize {
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

pub fn clamp_level(level: f32) -> f32 {
    if level.is_nan() {
        0.0
    } else {
        level.clamp(0.0, 1.0)
    }
}

/// Deterministic multi-track mock (Linux CI + Wave Link UX preview).
pub fn mock_state() -> VolumeState {
    let names = wavelink::typical_channel_names();
    let levels = [0.72, 0.55, 0.40, 0.35, 0.80, 0.60, 0.25];
    let tracks: Vec<VolumeTrack> = names
        .iter()
        .enumerate()
        .map(|(i, name)| VolumeTrack {
            id: format!("mock-{}", name.to_lowercase().replace(' ', "-")),
            name: (*name).to_string(),
            source: "mock".into(),
            level: levels.get(i).copied().unwrap_or(0.5),
            muted: false,
            process_id: None,
            app_names: vec![(*name).to_string()],
        })
        .collect();
    VolumeState {
        connected: true,
        mock: true,
        master_level: 0.65,
        master_muted: false,
        tracks,
        selected_track_index: 0,
        wavelink: wavelink::discover_state(),
        error: None,
    }
}

pub struct VolumeService {
    state: Arc<RwLock<VolumeState>>,
    sender: WsSender,
    pub is_enabled: Arc<AtomicBool>,
}

impl VolumeService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(mock_state())),
            sender,
            is_enabled: Arc::new(AtomicBool::new(false)),
        }
    }

    pub async fn snapshot(&self) -> VolumeState {
        self.state.read().await.clone()
    }

    async fn broadcast(&self) {
        let data = self.state.read().await.clone();
        let _ = self
            .sender
            .0
            .send(serde_json::json!({ "type": "VOLUME_STATE", "data": data }).to_string());
        // Alias for Wave Link–focused clients / future pack rename.
        let _ = self.sender.0.send(
            serde_json::json!({ "type": "WAVELINK_STATE", "data": data.wavelink }).to_string(),
        );
    }

    pub async fn handle_command(
        &self,
        endpoint: &str,
        params: Option<serde_json::Value>,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(Ordering::Relaxed) {
            tracing::info!("[VOLUME] Command '{}' ignored: service disabled", endpoint);
            return Ok(());
        }
        match endpoint {
            "refresh" => {
                self.refresh().await;
            }
            "master_up" => {
                self.adjust_master(VOLUME_STEP).await;
            }
            "master_down" => {
                self.adjust_master(-VOLUME_STEP).await;
            }
            "master_mute" | "master_toggle_mute" => {
                self.toggle_master_mute().await;
            }
            "track_up" | "volume_up" => {
                self.adjust_selected(VOLUME_STEP).await;
            }
            "track_down" | "volume_down" => {
                self.adjust_selected(-VOLUME_STEP).await;
            }
            "track_mute" | "toggle_mute" => {
                self.toggle_selected_mute().await;
            }
            "track_next" | "select_next" => {
                let mut st = self.state.write().await;
                st.selected_track_index =
                    scroll_track_index(st.tracks.len(), st.selected_track_index, 1);
                drop(st);
                self.broadcast().await;
            }
            "track_prev" | "select_prev" => {
                let mut st = self.state.write().await;
                st.selected_track_index =
                    scroll_track_index(st.tracks.len(), st.selected_track_index, -1);
                drop(st);
                self.broadcast().await;
            }
            "select_track" => {
                if let Some(idx) = params
                    .as_ref()
                    .and_then(|p| p.get("index").or_else(|| p.get("track_index")))
                    .and_then(|v| v.as_u64())
                {
                    let mut st = self.state.write().await;
                    if !st.tracks.is_empty() {
                        st.selected_track_index = (idx as usize).min(st.tracks.len() - 1);
                    }
                    drop(st);
                    self.broadcast().await;
                }
            }
            "set_level" => {
                let level = params
                    .as_ref()
                    .and_then(|p| p.get("level"))
                    .and_then(|v| v.as_f64())
                    .map(|v| v as f32);
                let track_id = params
                    .as_ref()
                    .and_then(|p| p.get("track_id").or_else(|| p.get("id")))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string());
                if let Some(level) = level {
                    self.set_track_level(track_id.as_deref(), level).await;
                }
            }
            other => {
                tracing::warn!("[VOLUME] Unknown endpoint '{}'", other);
            }
        }
        Ok(())
    }

    pub async fn refresh(&self) {
        let keep_index = self.state.read().await.selected_track_index;
        let next = read_platform_state().await;
        {
            let mut st = self.state.write().await;
            let idx = if next.tracks.is_empty() {
                0
            } else {
                keep_index.min(next.tracks.len() - 1)
            };
            *st = next;
            st.selected_track_index = idx;
        }
        self.broadcast().await;
    }

    async fn adjust_master(&self, delta: f32) {
        let (level, muted, is_mock) = {
            let st = self.state.read().await;
            (
                clamp_level(st.master_level + delta),
                st.master_muted,
                st.mock,
            )
        };
        if is_mock {
            let mut st = self.state.write().await;
            st.master_level = level;
            st.wavelink = wavelink::discover_state();
            drop(st);
            self.broadcast().await;
            return;
        }
        apply_master(level, muted).await;
        self.refresh().await;
    }

    async fn toggle_master_mute(&self) {
        let (level, muted, is_mock) = {
            let st = self.state.read().await;
            (st.master_level, !st.master_muted, st.mock)
        };
        if is_mock {
            let mut st = self.state.write().await;
            st.master_muted = muted;
            st.master_level = level;
            st.wavelink = wavelink::discover_state();
            drop(st);
            self.broadcast().await;
            return;
        }
        apply_master(level, muted).await;
        self.refresh().await;
    }

    async fn adjust_selected(&self, delta: f32) {
        let (id, level, muted, is_mock) = {
            let st = self.state.read().await;
            match st.selected_track() {
                Some(t) => (
                    t.id.clone(),
                    clamp_level(t.level + delta),
                    t.muted,
                    st.mock,
                ),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(t) = st.tracks.iter_mut().find(|t| t.id == id) {
                t.level = level;
            }
            st.wavelink = wavelink::discover_state();
            drop(st);
            self.broadcast().await;
            return;
        }
        apply_track(&id, level, muted).await;
        self.refresh().await;
    }

    async fn toggle_selected_mute(&self) {
        let (id, level, muted, is_mock) = {
            let st = self.state.read().await;
            match st.selected_track() {
                Some(t) => (t.id.clone(), t.level, !t.muted, st.mock),
                None => return,
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(t) = st.tracks.iter_mut().find(|t| t.id == id) {
                t.muted = muted;
            }
            st.wavelink = wavelink::discover_state();
            drop(st);
            self.broadcast().await;
            return;
        }
        apply_track(&id, level, muted).await;
        self.refresh().await;
    }

    async fn set_track_level(&self, track_id: Option<&str>, level: f32) {
        let level = clamp_level(level);
        let (id, muted, is_mock) = {
            let st = self.state.read().await;
            if let Some(id) = track_id {
                let muted = st
                    .tracks
                    .iter()
                    .find(|t| t.id == id)
                    .map(|t| t.muted)
                    .unwrap_or(false);
                (id.to_string(), muted, st.mock)
            } else {
                match st.selected_track() {
                    Some(t) => (t.id.clone(), t.muted, st.mock),
                    None => return,
                }
            }
        };
        if is_mock {
            let mut st = self.state.write().await;
            if let Some(t) = st.tracks.iter_mut().find(|t| t.id == id) {
                t.level = level;
            }
            st.wavelink = wavelink::discover_state();
            drop(st);
            self.broadcast().await;
            return;
        }
        apply_track(&id, level, muted).await;
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
                    .send(serde_json::json!({ "type": "VOLUME_STATE", "data": data }).to_string());
            }
            loop {
                tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;
                if !enabled.load(Ordering::Relaxed) {
                    continue;
                }
                let was_mock = this_state.read().await.mock;
                if was_mock {
                    // Preserve in-memory mock levels; only refresh Wave Link discovery.
                    {
                        let mut st = this_state.write().await;
                        st.wavelink = wavelink::discover_state();
                    }
                } else {
                    let keep_index = this_state.read().await.selected_track_index;
                    let next = read_platform_state().await;
                    {
                        let mut st = this_state.write().await;
                        let idx = if next.tracks.is_empty() {
                            0
                        } else {
                            keep_index.min(next.tracks.len() - 1)
                        };
                        *st = next;
                        st.selected_track_index = idx;
                    }
                }
                let data = this_state.read().await.clone();
                let _ = sender
                    .0
                    .send(serde_json::json!({ "type": "VOLUME_STATE", "data": data }).to_string());
                let _ = sender.0.send(
                    serde_json::json!({ "type": "WAVELINK_STATE", "data": data.wavelink })
                        .to_string(),
                );
            }
        });
    }
}

async fn read_platform_state() -> VolumeState {
    #[cfg(windows)]
    {
        match tokio::task::spawn_blocking(windows_audio::read_state).await {
            Ok(Ok(mut st)) => {
                st.wavelink = wavelink::discover_state();
                st
            }
            Ok(Err(e)) => {
                tracing::warn!("[VOLUME] Windows audio read failed ({}), using mock", e);
                let mut m = mock_state();
                m.error = Some(format!("windows_audio: {}", e));
                m
            }
            Err(e) => {
                tracing::warn!("[VOLUME] spawn_blocking join error: {}", e);
                mock_state()
            }
        }
    }
    #[cfg(not(windows))]
    {
        let mut m = mock_state();
        // Re-discover each refresh so status stays current if env changes.
        m.wavelink = wavelink::discover_state();
        m
    }
}

async fn apply_master(level: f32, muted: bool) {
    #[cfg(windows)]
    {
        let _ = tokio::task::spawn_blocking(move || windows_audio::set_master(level, muted)).await;
    }
    #[cfg(not(windows))]
    {
        let _ = (level, muted);
    }
}

async fn apply_track(id: &str, level: f32, muted: bool) {
    #[cfg(windows)]
    {
        let id = id.to_string();
        let _ = tokio::task::spawn_blocking(move || windows_audio::set_session(&id, level, muted))
            .await;
    }
    #[cfg(not(windows))]
    {
        let _ = (id, level, muted);
    }
}

#[cfg(windows)]
mod windows_audio {
    use super::{VolumeState, VolumeTrack};
    use windows::core::Interface;
    use windows::Win32::Media::Audio::{
        eMultimedia, eRender, IAudioEndpointVolume, IAudioSessionControl, IAudioSessionControl2,
        IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    fn ensure_com() -> Result<(), String> {
        unsafe {
            // S_FALSE (already initialized) is fine.
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        Ok(())
    }

    pub fn read_state() -> Result<VolumeState, String> {
        ensure_com()?;
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("MMDeviceEnumerator: {}", e))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?;

            let mut master_level = 0.5f32;
            let mut master_muted = false;
            if let Ok(endpoint) = device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None) {
                if let Ok(v) = endpoint.GetMasterVolumeLevelScalar() {
                    master_level = v;
                }
                if let Ok(m) = endpoint.GetMute() {
                    master_muted = m.as_bool();
                }
            }

            let manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IAudioSessionManager2: {}", e))?;
            let session_enum = manager
                .GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator: {}", e))?;
            let count = session_enum.GetCount().unwrap_or(0);

            let mut tracks = Vec::new();
            for i in 0..count {
                let Ok(control) = session_enum.GetSession(i) else {
                    continue;
                };
                let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                    continue;
                };
                // Skip expired / disconnected sessions when possible.
                let pid = control2.GetProcessId().unwrap_or(0);
                let display = control2
                    .GetDisplayName()
                    .ok()
                    .and_then(|s| s.to_string().ok())
                    .unwrap_or_default();
                let name = if !display.is_empty() && !display.starts_with('@') {
                    display
                } else if pid > 0 {
                    process_name(pid).unwrap_or_else(|| format!("App {}", pid))
                } else {
                    "System Sounds".into()
                };
                let Ok(vol) = control.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                let level = vol.GetMasterVolume().unwrap_or(0.5);
                let muted = vol.GetMute().map(|b| b.as_bool()).unwrap_or(false);
                let id = if pid > 0 {
                    format!("win-pid-{}", pid)
                } else {
                    format!("win-session-{}", i)
                };
                // Deduplicate by process id (multiple streams per app).
                if pid > 0 {
                    if let Some(existing) = tracks.iter_mut().find(|t: &&mut VolumeTrack| {
                        t.process_id == Some(pid)
                    }) {
                        // Keep louder / unmuted preference.
                        if !muted && existing.muted {
                            existing.muted = false;
                            existing.level = level;
                        }
                        continue;
                    }
                }
                tracks.push(VolumeTrack {
                    id,
                    name: name.clone(),
                    source: "windows".into(),
                    level,
                    muted,
                    process_id: if pid > 0 { Some(pid) } else { None },
                    app_names: vec![name],
                });
            }

            // Stable sort: named apps first, then by name.
            tracks.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

            let _ = CoUninitialize();
            Ok(VolumeState {
                connected: true,
                mock: false,
                master_level,
                master_muted,
                tracks,
                selected_track_index: 0,
                wavelink: Default::default(),
                error: None,
            })
        }
    }

    pub fn set_master(level: f32, muted: bool) -> Result<(), String> {
        ensure_com()?;
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("MMDeviceEnumerator: {}", e))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?;
            let endpoint: IAudioEndpointVolume = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IAudioEndpointVolume: {}", e))?;
            endpoint
                .SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), None)
                .map_err(|e| format!("SetMasterVolumeLevelScalar: {}", e))?;
            endpoint
                .SetMute(windows::core::BOOL::from(muted), None)
                .map_err(|e| format!("SetMute: {}", e))?;
        }
        Ok(())
    }

    pub fn set_session(id: &str, level: f32, muted: bool) -> Result<(), String> {
        ensure_com()?;
        let target_pid = id
            .strip_prefix("win-pid-")
            .and_then(|s| s.parse::<u32>().ok());
        let target_idx = id
            .strip_prefix("win-session-")
            .and_then(|s| s.parse::<i32>().ok());
        unsafe {
            let enumerator: IMMDeviceEnumerator =
                CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)
                    .map_err(|e| format!("MMDeviceEnumerator: {}", e))?;
            let device = enumerator
                .GetDefaultAudioEndpoint(eRender, eMultimedia)
                .map_err(|e| format!("GetDefaultAudioEndpoint: {}", e))?;
            let manager: IAudioSessionManager2 = device
                .Activate(CLSCTX_ALL, None)
                .map_err(|e| format!("IAudioSessionManager2: {}", e))?;
            let session_enum = manager
                .GetSessionEnumerator()
                .map_err(|e| format!("GetSessionEnumerator: {}", e))?;
            let count = session_enum.GetCount().unwrap_or(0);
            for i in 0..count {
                let Ok(control) = session_enum.GetSession(i) else {
                    continue;
                };
                let match_session = if let Some(pid) = target_pid {
                    let Ok(control2) = control.cast::<IAudioSessionControl2>() else {
                        continue;
                    };
                    control2.GetProcessId().unwrap_or(0) == pid
                } else if let Some(idx) = target_idx {
                    i == idx
                } else {
                    false
                };
                if !match_session {
                    continue;
                }
                let Ok(vol) = control.cast::<ISimpleAudioVolume>() else {
                    continue;
                };
                let _ = vol.SetMasterVolume(level.clamp(0.0, 1.0), None);
                let _ = vol.SetMute(windows::core::BOOL::from(muted), None);
                return Ok(());
            }
        }
        Err(format!("session not found: {}", id))
    }

    fn process_name(pid: u32) -> Option<String> {
        use sysinfo::{Pid, ProcessRefreshKind, System, UpdateKind};
        let mut sys = System::new();
        sys.refresh_processes_specifics(
            ProcessRefreshKind::new().with_exe(UpdateKind::OnlyIfNotSet),
        );
        sys.process(Pid::from_u32(pid))
            .map(|p| p.name().to_string())
    }

    // Silence unused import warning for IAudioSessionControl (used via GetSession type).
    #[allow(dead_code)]
    fn _touch_control(_: &IAudioSessionControl) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scroll_wraps_at_edges() {
        assert_eq!(scroll_track_index(0, 0, 1), 0);
        assert_eq!(scroll_track_index(5, 0, -1), 4);
        assert_eq!(scroll_track_index(5, 4, 1), 0);
        assert_eq!(scroll_track_index(5, 2, 1), 3);
        assert_eq!(scroll_track_index(5, 2, -1), 1);
    }

    #[test]
    fn clamp_level_bounds() {
        assert_eq!(clamp_level(-0.2), 0.0);
        assert_eq!(clamp_level(1.5), 1.0);
        assert_eq!(clamp_level(0.4), 0.4);
    }

    #[test]
    fn mock_state_has_wavelike_tracks() {
        let st = mock_state();
        assert!(st.mock);
        assert!(st.connected);
        assert!(st.tracks.len() >= 5);
        assert!(st.selected_track().unwrap().name.contains("Microphone") || !st.tracks.is_empty());
        assert_eq!(st.wavelink.protocol, wavelink::PROTOCOL_LABEL);
    }

    #[test]
    fn scroll_then_select_name() {
        let mut st = mock_state();
        st.selected_track_index = scroll_track_index(st.tracks.len(), st.selected_track_index, 2);
        assert_eq!(st.selected_track_index, 2);
        assert_eq!(st.selected_track().unwrap().name, "Music");
    }
}
