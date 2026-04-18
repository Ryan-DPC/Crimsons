use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::sync::RwLock;
use crate::events::WsSender;
use serde_json::json;
use tokio::net::windows::named_pipe::ClientOptions;
use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct DiscordState {
    pub is_muted: bool,
    pub is_deaf: bool,
    pub is_camera_on: bool,
    pub connected: bool,
    pub current_channel_id: Option<String>,
}

pub struct DiscordService {
    state: Arc<RwLock<DiscordState>>,
    sender: WsSender,
    client_id: String,
}

impl DiscordService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(DiscordState::default())),
            sender,
            client_id: "1330663435166412852".to_string(), // Placeholder - User should update
        }
    }

    pub fn subscribe_events(&self) -> tokio::sync::broadcast::Receiver<String> {
        self.sender.0.subscribe()
    }

    pub async fn is_connected(&self) -> bool {
        self.state.read().await.connected
    }

    pub async fn start_background_polling(&self) {
        let state_clone = self.state.clone();
        let sender_clone = self.sender.clone();
        let client_id = self.client_id.clone();

        tokio::spawn(async move {
            loop {
                if let Ok(mut pipe) = Self::connect_to_ipc().await {
                    println!("Connected to Discord IPC!");
                    
                    // Handshake
                    if Self::send_handshake(&mut pipe, &client_id).await.is_ok() {
                        {
                            let mut s = state_clone.write().await;
                            s.connected = true;
                        }
                        
                        // Subscribe to events (VOICE_SETTINGS_UPDATE)
                        let _ = Self::send_command(&mut pipe, "SUBSCRIBE", json!({ "evt": "VOICE_SETTINGS_UPDATE" })).await;

                        let mut buffer = [0u8; 4096];
                        loop {
                            tokio::select! {
                                result = pipe.read(&mut buffer) => {
                                    match result {
                                        Ok(n) if n > 0 => {
                                            // Handle multi-frame or partial reads if necessary, 
                                            // but for now assume small JSON payloads.
                                            let payload = &buffer[8..n]; // Skip 8-byte header
                                            if let Ok(v) = serde_json::from_slice::<serde_json::Value>(payload) {
                                                if let Some(evt) = v["evt"].as_str() {
                                                    if evt == "VOICE_SETTINGS_UPDATE" {
                                                        let data = &v["data"];
                                                        let mut s = state_clone.write().await;
                                                        s.is_muted = data["mute"].as_bool().unwrap_or(s.is_muted);
                                                        s.is_deaf = data["deaf"].as_bool().unwrap_or(s.is_deaf);
                                                        s.is_camera_on = data["video_enabled"].as_bool().unwrap_or(s.is_camera_on);
                                                        
                                                        let state_json = json!({
                                                            "type": "DISCORD_STATE",
                                                            "data": *s
                                                        }).to_string();
                                                        let _ = sender_clone.0.send(state_json);
                                                    }
                                                }
                                            }
                                        }
                                        _ => break,
                                    }
                                }
                                _ = tokio::time::sleep(tokio::time::Duration::from_secs(30)) => {
                                    // Periodic health check if needed
                                }
                            }
                        }
                    }
                }

                {
                    let mut s = state_clone.write().await;
                    s.connected = false;
                }
                println!("Discord IPC disconnected, retrying in 5s...");
                tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
            }
        });
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut pipe = Self::connect_to_ipc().await?;
        Self::send_handshake(&mut pipe, &self.client_id).await?;

        match endpoint {
            "toggleMute" => {
                let current_mute = self.state.read().await.is_muted;
                Self::send_command(&mut pipe, "SET_VOICE_SETTINGS", json!({ "mute": !current_mute })).await?;
            }
            "toggleDeafen" => {
                let current_deaf = self.state.read().await.is_deaf;
                Self::send_command(&mut pipe, "SET_VOICE_SETTINGS", json!({ "deaf": !current_deaf })).await?;
            }
            "toggleCamera" => {
                let current_camera = self.state.read().await.is_camera_on;
                Self::send_command(&mut pipe, "SET_VOICE_SETTINGS", json!({ "video_enabled": !current_camera })).await?;
            }
            "joinVoiceChannel" => {
                if let Some(channel_id) = params.as_ref().and_then(|p| p["payload"]["settings"]["channelId"].as_str().or(p["channelId"].as_str())) {
                    let current_chan = self.state.read().await.current_channel_id.clone();
                    let target = if current_chan.as_deref() == Some(channel_id) { None } else { Some(channel_id) };
                    Self::send_command(&mut pipe, "SELECT_VOICE_CHANNEL", json!({ "channel_id": target, "force": true })).await?;
                }
            }
            "playSoundboardSound" => {
                if let Some(p) = params {
                    let sound_id = p["payload"]["settings"]["soundId"].as_str().or(p["soundId"].as_str());
                    let guild_id = p["payload"]["settings"]["guildId"].as_str().or(p["guildId"].as_str());
                    
                    if let (Some(sid), Some(gid)) = (sound_id, guild_id) {
                        // We need the current voice channel for soundboard
                        // For now, we assume getting it via RPC if state doesn't have it
                        Self::send_command(&mut pipe, "PLAY_SOUNDBOARD_SOUND", json!({
                            "sound_id": sid,
                            "guild_id": gid
                        })).await?;
                    }
                }
            }
            "toggleScreenshare" => {
                // Bridge to PowerShell focus logic
                tokio::spawn(async move {
                    let _ = Self::simulate_screenshare_keybind().await;
                });
            }
            _ => return Err("Unknown Discord command".into()),
        }

        Ok(())
    }

    async fn connect_to_ipc() -> Result<tokio::net::windows::named_pipe::NamedPipeClient, Box<dyn std::error::Error + Send + Sync>> {
        for i in 0..10 {
            let path = format!(r"\\.\pipe\discord-ipc-{}", i);
            if let Ok(client) = ClientOptions::new().open(&path) {
                return Ok(client);
            }
        }
        Err("Could not find Discord IPC pipe".into())
    }

    async fn send_handshake(pipe: &mut tokio::net::windows::named_pipe::NamedPipeClient, client_id: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let payload = json!({ "v": 1, "client_id": client_id }).to_string();
        Self::send_raw_packet(pipe, 0, &payload).await
    }

    async fn send_command(pipe: &mut tokio::net::windows::named_pipe::NamedPipeClient, cmd: &str, args: serde_json::Value) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let nonce = uuid::Uuid::new_v4().to_string();
        let payload = json!({
            "cmd": cmd,
            "args": args,
            "nonce": nonce
        }).to_string();
        Self::send_raw_packet(pipe, 1, &payload).await
    }

    async fn send_raw_packet(pipe: &mut tokio::net::windows::named_pipe::NamedPipeClient, opcode: u32, payload: &str) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        let mut header = Vec::with_capacity(8);
        header.extend_from_slice(&opcode.to_le_bytes());
        header.extend_from_slice(&(payload.len() as u32).to_le_bytes());
        pipe.write_all(&header).await?;
        pipe.write_all(payload.as_bytes()).await?;
        Ok(())
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
# CTRL+SHIFT+F9
[Win32]::keybd_event(0x11, 0, 0, 0) # CTRL
[Win32]::keybd_event(0x10, 0, 0, 0) # SHIFT
[Win32]::keybd_event(0x78, 0, 0, 0) # F9
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
}
