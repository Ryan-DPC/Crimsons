use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::events::WsSender;
use serde_json::json;
#[cfg(windows)]
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

// Discord IPC transport. Windows exposes a named pipe; Linux/macOS expose a
// Unix domain socket. Both implement AsyncRead + AsyncWrite, so all of the
// framing/handshake code below is shared and only `connect_to_ipc` differs.
#[cfg(windows)]
type IpcStream = tokio::net::windows::named_pipe::NamedPipeClient;
#[cfg(not(windows))]
type IpcStream = tokio::net::UnixStream;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct DiscordState {
    pub is_muted: bool,
    pub is_deaf: bool,
    pub is_camera_on: bool,
    pub connected: bool,
    /// True when Discord reports an active selected voice channel / voice connection.
    pub in_voice: bool,
    pub current_channel_id: Option<String>,
    pub username: Option<String>,
}

pub struct DiscordService {
    state: Arc<RwLock<DiscordState>>,
    sender: WsSender,
    cmd_sender: tokio::sync::mpsc::Sender<(String, serde_json::Value)>,
    cmd_receiver: Arc<tokio::sync::Mutex<tokio::sync::mpsc::Receiver<(String, serde_json::Value)>>>,
    pub is_enabled: Arc<std::sync::atomic::AtomicBool>,
}

impl DiscordService {
    pub fn new(sender: WsSender) -> Self {
        let (tx, rx) = tokio::sync::mpsc::channel(100);
        Self {
            state: Arc::new(RwLock::new(DiscordState::default())),
            sender,
            cmd_sender: tx,
            cmd_receiver: Arc::new(tokio::sync::Mutex::new(rx)),
            is_enabled: Arc::new(std::sync::atomic::AtomicBool::new(false)),
        }
    }

    pub fn subscribe_events(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.sender.0.subscribe()
    }

    pub async fn is_connected(&self) -> bool {
        self.state.read().await.connected
    }

    async fn broadcast_state(state: &Arc<RwLock<DiscordState>>, sender: &WsSender) {
        let snapshot = state.read().await.clone();
        let _ = sender.0.send(json!({
            "type": "DISCORD_STATE",
            "data": snapshot
        }).to_string());
    }

    pub async fn start_background_polling(&self) {
        let state_clone = self.state.clone();
        let sender_clone = self.sender.clone();
        let cmd_rx = self.cmd_receiver.clone();
        let is_enabled_clone = self.is_enabled.clone();

        tokio::spawn(async move {
            let mut rx = cmd_rx.lock().await;
            loop {
                if !is_enabled_clone.load(std::sync::atomic::Ordering::Relaxed) {
                    {
                        let mut s = state_clone.write().await;
                        if s.connected || s.in_voice {
                            *s = DiscordState::default();
                            drop(s);
                            Self::broadcast_state(&state_clone, &sender_clone).await;
                        }
                    }
                    tokio::time::sleep(tokio::time::Duration::from_secs(1)).await;
                    continue;
                }

                let app_data = crate::storage::load_data_from_path(crate::storage::get_data_path_from_env());
                let client_id = app_data
                    .discord_client_id
                    .filter(|s| !s.trim().is_empty())
                    .unwrap_or_else(|| "1330663435166412852".to_string());

                match Self::connect_to_ipc().await {
                    Ok(mut pipe) => {
                        tracing::info!("[DISCORD] IPC pipe opened, handshaking…");
                        if let Err(e) = Self::send_handshake(&mut pipe, &client_id).await {
                            tracing::warn!("[DISCORD] Handshake write failed: {}", e);
                        } else if let Err(e) = Self::wait_for_ready(&mut pipe, &state_clone, &sender_clone).await {
                            tracing::warn!("[DISCORD] Handshake/READY failed: {}", e);
                        } else {
                            tracing::info!("[DISCORD] READY — connected to Discord client");
                            // rpc.local events/commands work without OAuth on IPC.
                            let _ = Self::subscribe_event(&mut pipe, "VOICE_SETTINGS_UPDATE_2", json!({})).await;
                            let _ = Self::subscribe_event(&mut pipe, "VIDEO_STATE_UPDATE", json!({})).await;
                            // Best-effort: these need `rpc` / voice scopes; ignore failures.
                            let _ = Self::subscribe_event(&mut pipe, "VOICE_CHANNEL_SELECT", json!({})).await;
                            let _ = Self::subscribe_event(&mut pipe, "VOICE_CONNECTION_STATUS", json!({})).await;
                            let _ = Self::send_command(&mut pipe, "GET_VOICE_SETTINGS", json!({})).await;
                            let _ = Self::send_command(&mut pipe, "GET_SELECTED_VOICE_CHANNEL", json!({})).await;

                            let mut buffer = Vec::with_capacity(8192);
                            loop {
                                if !is_enabled_clone.load(std::sync::atomic::Ordering::Relaxed) {
                                    break;
                                }
                                tokio::select! {
                                    result = Self::read_frame(&mut pipe, &mut buffer) => {
                                        match result {
                                            Ok(v) => {
                                                Self::handle_ipc_payload(
                                                    v,
                                                    &state_clone,
                                                    &sender_clone,
                                                ).await;
                                            }
                                            Err(e) => {
                                                tracing::warn!("[DISCORD] IPC read ended: {}", e);
                                                break;
                                            }
                                        }
                                    }
                                    cmd_opt = rx.recv() => {
                                        if let Some((endpoint, params)) = cmd_opt {
                                            if let Err(e) = Self::dispatch_command(
                                                &mut pipe,
                                                &endpoint,
                                                &params,
                                                &state_clone,
                                                &sender_clone,
                                            ).await {
                                                tracing::warn!("[DISCORD] command {} failed: {}", endpoint, e);
                                            }
                                        } else {
                                            break;
                                        }
                                    }
                                }
                            }
                        }
                    }
                    Err(e) => {
                        tracing::debug!("[DISCORD] IPC not available: {}", e);
                    }
                }

                {
                    let mut s = state_clone.write().await;
                    if s.connected || s.in_voice {
                        *s = DiscordState::default();
                        drop(s);
                        Self::broadcast_state(&state_clone, &sender_clone).await;
                    }
                }
                tracing::info!("[DISCORD] disconnected, retrying in 3s…");
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
        });
    }

    async fn wait_for_ready(
        pipe: &mut IpcStream,
        state: &Arc<RwLock<DiscordState>>,
        sender: &WsSender,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut buffer = Vec::new();
        let deadline = tokio::time::Instant::now() + tokio::time::Duration::from_secs(5);
        loop {
            let remaining = deadline.saturating_duration_since(tokio::time::Instant::now());
            if remaining.is_zero() {
                return Err("Timed out waiting for Discord READY".into());
            }
            let frame = tokio::time::timeout(remaining, Self::read_frame(pipe, &mut buffer)).await
                .map_err(|_| "Timed out waiting for Discord READY")??;
            if frame["evt"].as_str() == Some("READY") {
                let username = frame["data"]["user"]["username"]
                    .as_str()
                    .or_else(|| frame["data"]["user"]["global_name"].as_str())
                    .map(|s| s.to_string());
                {
                    let mut s = state.write().await;
                    s.connected = true;
                    s.username = username;
                }
                Self::broadcast_state(state, sender).await;
                return Ok(());
            }
            if frame["evt"].as_str() == Some("ERROR") {
                let msg = frame["data"]["message"].as_str().unwrap_or("unknown error");
                return Err(format!("Discord ERROR during handshake: {}", msg).into());
            }
        }
    }

    async fn handle_ipc_payload(
        v: serde_json::Value,
        state: &Arc<RwLock<DiscordState>>,
        sender: &WsSender,
    ) {
        let evt = v["evt"].as_str().unwrap_or("");
        let cmd = v["cmd"].as_str().unwrap_or("");
        let data = &v["data"];

        if evt == "ERROR" {
            tracing::warn!(
                "[DISCORD] RPC error: {} ({})",
                data["message"].as_str().unwrap_or("?"),
                data["code"]
            );
            return;
        }

        let mut changed = false;

        match evt {
            "VOICE_SETTINGS_UPDATE_2" => {
                let mut s = state.write().await;
                if let Some(m) = data["self_mute"].as_bool() {
                    s.is_muted = m;
                    changed = true;
                }
                if let Some(d) = data["self_deaf"].as_bool() {
                    s.is_deaf = d;
                    changed = true;
                }
            }
            "VOICE_SETTINGS_UPDATE" => {
                let mut s = state.write().await;
                if let Some(m) = data["mute"].as_bool() {
                    s.is_muted = m;
                    changed = true;
                }
                if let Some(d) = data["deaf"].as_bool() {
                    s.is_deaf = d;
                    changed = true;
                }
            }
            "VIDEO_STATE_UPDATE" => {
                let mut s = state.write().await;
                if let Some(on) = data["active"].as_bool().or_else(|| data["video_enabled"].as_bool()) {
                    s.is_camera_on = on;
                    changed = true;
                }
            }
            "VOICE_CHANNEL_SELECT" => {
                let mut s = state.write().await;
                let channel_id = data["channel_id"].as_str().filter(|c| !c.is_empty()).map(|c| c.to_string());
                s.in_voice = channel_id.is_some();
                s.current_channel_id = channel_id;
                changed = true;
            }
            "VOICE_CONNECTION_STATUS" => {
                let mut s = state.write().await;
                let voice_state = data["state"].as_str().unwrap_or("");
                // DISCONNECTED / AWAITING_ENDPOINT / CONNECTING / CONNECTED / …
                let in_voice = voice_state != "DISCONNECTED" && !voice_state.is_empty();
                if s.in_voice != in_voice {
                    s.in_voice = in_voice;
                    changed = true;
                }
            }
            _ => {}
        }

        // Command responses (GET_*)
        if cmd == "GET_VOICE_SETTINGS" && evt.is_empty() {
            let mut s = state.write().await;
            if let Some(m) = data["mute"].as_bool() {
                s.is_muted = m;
                changed = true;
            }
            if let Some(d) = data["deaf"].as_bool() {
                s.is_deaf = d;
                changed = true;
            }
        }
        if cmd == "GET_SELECTED_VOICE_CHANNEL" && evt.is_empty() {
            let mut s = state.write().await;
            // data is null when not in a channel, or a channel object with id
            let channel_id = if data.is_null() {
                None
            } else {
                data["id"].as_str().filter(|c| !c.is_empty()).map(|c| c.to_string())
            };
            let in_voice = channel_id.is_some();
            if s.current_channel_id != channel_id || s.in_voice != in_voice {
                s.current_channel_id = channel_id;
                s.in_voice = in_voice;
                changed = true;
            }
        }
        if cmd == "SET_VOICE_SETTINGS_2" && evt.is_empty() {
            // Response is null; state comes from VOICE_SETTINGS_UPDATE_2.
        }

        if changed {
            Self::broadcast_state(state, sender).await;
        }
    }

    async fn dispatch_command(
        pipe: &mut IpcStream,
        endpoint: &str,
        params: &serde_json::Value,
        state: &Arc<RwLock<DiscordState>>,
        sender: &WsSender,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match endpoint {
            "toggleMute" => {
                let next = !state.read().await.is_muted;
                Self::send_command(pipe, "SET_VOICE_SETTINGS_2", json!({ "self_mute": next })).await?;
                {
                    let mut s = state.write().await;
                    s.is_muted = next;
                }
                Self::broadcast_state(state, sender).await;
            }
            "toggleDeafen" => {
                let next = !state.read().await.is_deaf;
                Self::send_command(pipe, "SET_VOICE_SETTINGS_2", json!({ "self_deaf": next })).await?;
                {
                    let mut s = state.write().await;
                    s.is_deaf = next;
                }
                Self::broadcast_state(state, sender).await;
            }
            "toggleCamera" => {
                let next = !state.read().await.is_camera_on;
                // Best-effort: may require voice.write scope on some Discord builds.
                let _ = Self::send_command(pipe, "SET_VOICE_SETTINGS", json!({ "video_enabled": next })).await;
                let _ = Self::send_command(pipe, "TOGGLE_VIDEO", json!({})).await;
                {
                    let mut s = state.write().await;
                    s.is_camera_on = next;
                }
                Self::broadcast_state(state, sender).await;
            }
            "joinVoiceChannel" => {
                let channel_id = params.get("payload").and_then(|p| p.get("settings")).and_then(|s| s.get("channelId")).and_then(|c| c.as_str())
                    .or_else(|| params.get("payload").and_then(|p| p.get("channelId")).and_then(|c| c.as_str()))
                    .or_else(|| params.get("settings").and_then(|s| s.get("channelId")).and_then(|c| c.as_str()))
                    .or_else(|| params.get("channelId").and_then(|c| c.as_str()));
                if let Some(channel_id) = channel_id.filter(|c| !c.is_empty()) {
                    let current_chan = state.read().await.current_channel_id.clone();
                    let target = if current_chan.as_deref() == Some(channel_id) { None } else { Some(channel_id) };
                    // Needs `rpc` scope — best effort.
                    Self::send_command(pipe, "SELECT_VOICE_CHANNEL", json!({ "channel_id": target, "force": true })).await?;
                    {
                        let mut s = state.write().await;
                        s.current_channel_id = target.map(|c| c.to_string());
                        s.in_voice = target.is_some();
                    }
                    Self::broadcast_state(state, sender).await;
                } else {
                    tracing::warn!("[DISCORD] joinVoiceChannel ignored: missing channelId");
                }
            }
            "playSoundboardSound" => {
                let sound_id = params.get("payload").and_then(|p| p.get("settings")).and_then(|s| s.get("soundId")).and_then(|c| c.as_str()).or_else(|| params.get("soundId").and_then(|c| c.as_str()));
                let guild_id = params.get("payload").and_then(|p| p.get("settings")).and_then(|s| s.get("guildId")).and_then(|c| c.as_str()).or_else(|| params.get("guildId").and_then(|c| c.as_str()));
                if let (Some(s_id), Some(g_id)) = (sound_id, guild_id) {
                    let _ = Self::send_command(pipe, "PLAY_SOUNDBOARD_SOUND", json!({ "sound_id": s_id, "guild_id": g_id })).await;
                }
            }
            _ => {
                tracing::debug!("[DISCORD] unknown endpoint {}", endpoint);
            }
        }
        Ok(())
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        if !self.is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
            tracing::info!("[DISCORD] Discord command ignored: service disabled");
            return Ok(());
        }

        if endpoint == "toggleScreenshare" {
            tokio::spawn(async move {
                let _ = Self::simulate_screenshare_keybind().await;
            });
            return Ok(());
        }

        let _ = self.cmd_sender.send((endpoint.to_string(), params.unwrap_or(json!({})))).await;
        Ok(())
    }

    #[cfg(windows)]
    async fn connect_to_ipc() -> Result<IpcStream, Box<dyn std::error::Error + Send + Sync>> {
        for i in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{}", i);
            match ClientOptions::new().open(&path) {
                Ok(client) => return Ok(client),
                Err(_) => continue,
            }
        }
        Err("Could not find Discord IPC pipe (is Discord running?)".into())
    }

    #[cfg(not(windows))]
    async fn connect_to_ipc() -> Result<IpcStream, Box<dyn std::error::Error + Send + Sync>> {
        // On Linux/macOS Discord exposes the RPC as a Unix domain socket named
        // `discord-ipc-{0..9}`. It normally lives under $XDG_RUNTIME_DIR, but
        // sandboxed builds (Flatpak/Snap) and some setups place it elsewhere,
        // so probe the common base directories.
        let mut bases: Vec<String> = Vec::new();
        if let Ok(dir) = std::env::var("XDG_RUNTIME_DIR") {
            bases.push(dir.clone());
            bases.push(format!("{}/app/com.discordapp.Discord", dir));
            bases.push(format!("{}/snap.discord", dir));
        }
        for key in ["TMPDIR", "TMP", "TEMP"] {
            if let Ok(dir) = std::env::var(key) {
                bases.push(dir);
            }
        }
        bases.push("/tmp".to_string());

        for base in bases {
            for i in 0..10 {
                let path = format!("{}/discord-ipc-{}", base.trim_end_matches('/'), i);
                if let Ok(stream) = tokio::net::UnixStream::connect(&path).await {
                    return Ok(stream);
                }
            }
        }
        Err("Could not find Discord IPC socket (is Discord running?)".into())
    }

    async fn send_handshake(
        pipe: &mut IpcStream,
        client_id: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = json!({ "v": 1, "client_id": client_id }).to_string();
        Self::send_raw_packet(pipe, 0, &payload).await
    }

    async fn subscribe_event(
        pipe: &mut IpcStream,
        evt: &str,
        args: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let nonce = uuid::Uuid::new_v4().to_string();
        // Discord requires `evt` at the payload root for SUBSCRIBE (not inside args).
        let payload = json!({
            "cmd": "SUBSCRIBE",
            "args": args,
            "evt": evt,
            "nonce": nonce
        }).to_string();
        Self::send_raw_packet(pipe, 1, &payload).await
    }

    async fn send_command(
        pipe: &mut IpcStream,
        cmd: &str,
        args: serde_json::Value,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let payload = json!({
            "cmd": cmd,
            "args": args,
            "nonce": nonce
        }).to_string();
        Self::send_raw_packet(pipe, 1, &payload).await
    }

    async fn send_raw_packet(
        pipe: &mut IpcStream,
        opcode: u32,
        payload: &str,
    ) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut packet = Vec::with_capacity(8 + payload.len());
        packet.extend_from_slice(&opcode.to_le_bytes());
        packet.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        packet.extend_from_slice(payload.as_bytes());
        pipe.write_all(&packet).await?;
        Ok(())
    }

    /// Read one complete Discord IPC frame (8-byte header + JSON body).
    async fn read_frame(
        pipe: &mut IpcStream,
        scratch: &mut Vec<u8>,
    ) -> Result<serde_json::Value, Box<dyn std::error::Error + Send + Sync>> {
        let mut header = [0u8; 8];
        pipe.read_exact(&mut header).await?;
        let opcode = u32::from_le_bytes(header[0..4].try_into().unwrap());
        let length = u32::from_le_bytes(header[4..8].try_into().unwrap()) as usize;
        if length > 8 * 1024 * 1024 {
            return Err(format!("Discord frame too large: {} bytes", length).into());
        }
        scratch.resize(length, 0);
        pipe.read_exact(scratch).await?;

        // Opcode 3 = PING → reply PONG (4)
        if opcode == 3 {
            let mut pong = Vec::with_capacity(8 + length);
            pong.extend_from_slice(&4u32.to_le_bytes());
            pong.extend_from_slice(&(length as u32).to_le_bytes());
            pong.extend_from_slice(scratch);
            let _ = pipe.write_all(&pong).await;
            return Ok(json!({ "evt": "PING" }));
        }

        let value: serde_json::Value = serde_json::from_slice(scratch)?;
        Ok(value)
    }

    async fn simulate_screenshare_keybind() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        use std::process::Command;

        let ps_script = r#"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, int dwFlags, int dwExtraInfo);
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
}
"@
$prev = [Win32]::GetForegroundWindow()
$discord = [Win32]::FindWindow($null, "Discord")
if ($discord -eq [IntPtr]::Zero) {
    $procs = Get-Process | Where-Object { $_.MainWindowTitle -match "Discord" } | Select-Object -First 1
    if ($procs) { $discord = $procs.MainWindowHandle }
}
if ($discord -ne [IntPtr]::Zero) {
    [Win32]::SetForegroundWindow($discord) | Out-Null
    Start-Sleep -Milliseconds 200
}
[Win32]::keybd_event(0x11, 0, 0, 0)
[Win32]::keybd_event(0x10, 0, 0, 0)
[Win32]::keybd_event(0x78, 0, 0, 0)
Start-Sleep -Milliseconds 80
[Win32]::keybd_event(0x78, 0, 2, 0)
[Win32]::keybd_event(0x10, 0, 2, 0)
[Win32]::keybd_event(0x11, 0, 2, 0)
Start-Sleep -Milliseconds 150
if ($prev -ne [IntPtr]::Zero) { [Win32]::SetForegroundWindow($prev) | Out-Null }
"#;

        Command::new("powershell")
            .args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps_script])
            .output()?;

        Ok(())
    }

    pub async fn adjust_aux_volume(ticks: i64) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let delta = if ticks > 0 { 0.05f32 } else { -0.05f32 };
        Self::send_vol_command(format!("vol {}\n", delta)).await;
        Ok(())
    }

    pub async fn toggle_aux_mute() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        Self::send_vol_command("mute\n".to_string()).await;
        Ok(())
    }

    async fn send_vol_command(cmd: String) {
        // Hold the guard in a single named binding. Using `if let Some(..) =
        // &*PS_VOL_TX.lock().await` would keep the temporary MutexGuard alive
        // across the whole if/else (edition 2021), so re-locking the same
        // non-reentrant tokio::Mutex in the else branch deadlocked on first use.
        let mut guard = PS_VOL_TX.lock().await;
        if guard.is_none() {
            let (tx, mut rx) = tokio::sync::mpsc::channel::<String>(100);
            *guard = Some(tx.clone());

            let script = r#"
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
namespace AudioCtrl {
    [ComImport][Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] internal class MMDeviceEnumerator {}
    [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IMMDeviceEnumerator { int GetDefaultAudioEndpoint(int d, int r, out IMMDevice p); }
    [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IMMDevice { int Activate([MarshalAs(UnmanagedType.LPStruct)] Guid i, int c, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o); }
    [Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionManager2 { int GetSessionEnumerator(out IAudioSessionEnumerator e); }
    [Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionEnumerator { int GetCount(out int c); int GetSession(int i, out IAudioSessionControl s); }
    [Guid("F4B1A599-7266-4319-A8CA-E70ACB11E8CD"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionControl {}
    [Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface ISimpleAudioVolume { int SetMasterVolume(float f, Guid g); int GetMasterVolume(out float f); int SetMute(bool b, Guid g); int GetMute(out bool b); }
    [Guid("BFA971F1-4D5E-40BB-935E-967039BFBEE4"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)] internal interface IAudioSessionControl2 { int GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string s); int GetProcessId(out int p); }
    public static class DiscordVol {
        public static void Adjust(float delta, bool toggleMute) {
            IMMDeviceEnumerator e = (IMMDeviceEnumerator)new MMDeviceEnumerator();
            e.GetDefaultAudioEndpoint(0, 0, out IMMDevice dev);
            Guid g = typeof(IAudioSessionManager2).GUID;
            dev.Activate(g, 1, IntPtr.Zero, out object mo);
            IAudioSessionManager2 mgr = (IAudioSessionManager2)mo;
            mgr.GetSessionEnumerator(out IAudioSessionEnumerator se);
            se.GetCount(out int cnt);
            for (int i = 0; i < cnt; i++) {
                se.GetSession(i, out IAudioSessionControl sc);
                IAudioSessionControl2 sc2 = sc as IAudioSessionControl2;
                if (sc2 == null) continue;
                sc2.GetProcessId(out int pid);
                if (pid <= 0) continue;
                try {
                    var pr = System.Diagnostics.Process.GetProcessById(pid);
                    if (pr.ProcessName.ToLower().Contains("discord")) {
                        ISimpleAudioVolume vol = sc as ISimpleAudioVolume;
                        if (vol == null) continue;
                        if (toggleMute) { vol.GetMute(out bool mu); vol.SetMute(!mu, Guid.Empty); }
                        else { vol.GetMasterVolume(out float lv); lv += delta; if (lv > 1f) lv = 1f; if (lv < 0f) lv = 0f; vol.SetMasterVolume(lv, Guid.Empty); }
                    }
                } catch {}
            }
        }
    }
}
"@
while ($line = [Console]::ReadLine()) {
    if ($line -eq "quit") { break }
    if ($line.StartsWith("vol")) {
        $delta = [float]($line.Split(' ')[1].Replace(',','.'))
        [AudioCtrl.DiscordVol]::Adjust($delta, $false)
    } elseif ($line -eq "mute") {
        [AudioCtrl.DiscordVol]::Adjust(0.0, $true)
    }
}
"#;

            tokio::spawn(async move {
                use tokio::process::Command;
                use std::process::Stdio;
                use tokio::io::AsyncWriteExt;

                if let Ok(mut child) = Command::new("powershell")
                    .args(&["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
                    .stdin(Stdio::piped())
                    .stdout(Stdio::null())
                    .stderr(Stdio::null())
                    .spawn()
                {
                    if let Some(stdin) = child.stdin.take() {
                        let mut stdin: tokio::process::ChildStdin = stdin;
                        while let Some(msg) = rx.recv().await {
                            if stdin.write_all(msg.as_bytes()).await.is_err() {
                                break;
                            }
                            let _ = stdin.flush().await;
                        }
                    }
                    let _ = child.kill().await;
                }
            });

        }

        // Sender is guaranteed present now; clone it and release the lock
        // before awaiting the send so we never hold the mutex across .await.
        let tx = guard.as_ref().unwrap().clone();
        drop(guard);
        let _ = tx.send(cmd).await;
    }
}

lazy_static::lazy_static! {
    static ref PS_VOL_TX: tokio::sync::Mutex<Option<tokio::sync::mpsc::Sender<String>>> = tokio::sync::Mutex::new(None);
}
