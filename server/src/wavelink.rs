//! Elgato Wave Link bridge (unofficial local JSON-RPC over WebSocket).
//!
//! Wave Link has **no public official API**. Community reverse-engineering of the
//! Stream Deck Wave Link plugin documents a localhost JSON-RPC 2.0 WebSocket:
//!
//! - Host: `ws://127.0.0.1:<port>`
//! - Port discovery: `%LOCALAPPDATA%\Packages\Elgato.WaveLink_*\LocalState\ws-info.json`
//!   with fallback TCP probe on ports `1884–1893`
//! - Origin header: `streamdeck://`
//! - Auth: none
//!
//! Key RPC methods (Wave Link 3.x): `getApplicationInfo`, `getChannels`, `getMixes`,
//! `setChannel` (level / mute / per-mix), `setSubscription`.
//!
//! Sources (community, unofficial):
//! - https://github.com/Raphiiko/wavelink-ts/blob/main/PROTOCOL.md
//! - https://pypi.org/project/wavelink-adapter/
//! - https://github.com/DarrellVS/node-wave-link-sdk
//!
//! This module discovers readiness and holds a typed stub state. Live JSON-RPC
//! I/O is intentionally deferred — Windows WASAPI sessions (see `volume`) cover
//! the same app mapping until the bridge client lands.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Documented fallback port range used by Wave Link 3.x when `ws-info.json` is missing.
pub const FALLBACK_PORT_RANGE: std::ops::RangeInclusive<u16> = 1884..=1893;

/// Origin header the Stream Deck plugin sends (required by Wave Link).
pub const WS_ORIGIN: &str = "streamdeck://";

/// Protocol label embedded in state for Hub / docs.
pub const PROTOCOL_LABEL: &str = "jsonrpc-ws-v3-unofficial";

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct WaveLinkChannel {
    pub id: String,
    pub name: String,
    /// Overall channel level 0.0–1.0 when known.
    pub level: f32,
    pub muted: bool,
    #[serde(default)]
    pub apps: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default, PartialEq)]
pub struct WaveLinkState {
    /// True when a local Wave Link instance looks reachable (port discovered).
    pub available: bool,
    /// True only after a successful `getApplicationInfo` handshake (not yet implemented).
    pub connected: bool,
    pub port: Option<u16>,
    pub protocol: String,
    #[serde(default)]
    pub channels: Vec<WaveLinkChannel>,
    /// Human-readable bridge status for Hub / README.
    pub status: String,
    pub error: Option<String>,
}

impl WaveLinkState {
    pub fn stub_unavailable(reason: &str) -> Self {
        Self {
            available: false,
            connected: false,
            port: None,
            protocol: PROTOCOL_LABEL.into(),
            channels: Vec::new(),
            status: reason.into(),
            error: None,
        }
    }

    pub fn stub_discovered(port: u16) -> Self {
        Self {
            available: true,
            connected: false,
            port: Some(port),
            protocol: PROTOCOL_LABEL.into(),
            channels: Vec::new(),
            status: format!(
                "port {} discovered — JSON-RPC client not wired yet (see plugins/catalog README)",
                port
            ),
            error: None,
        }
    }
}

/// Typical Wave Link software channel names used for mock / mapping UX.
pub fn typical_channel_names() -> &'static [&'static str] {
    &[
        "Microphone",
        "System",
        "Music",
        "Browser",
        "Game",
        "Voice Chat",
        "SFX",
    ]
}

/// Windows Store / MSIX path fragment for Wave Link `ws-info.json`.
pub fn ws_info_candidates() -> Vec<PathBuf> {
    let mut out = Vec::new();
    let local = std::env::var("LOCALAPPDATA").unwrap_or_default();
    if local.is_empty() {
        return out;
    }
    let packages = PathBuf::from(&local).join("Packages");
    if let Ok(entries) = std::fs::read_dir(&packages) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with("Elgato.WaveLink_") {
                out.push(
                    entry
                        .path()
                        .join("LocalState")
                        .join("ws-info.json"),
                );
            }
        }
    }
    // Documented canonical package id (may vary by install channel).
    out.push(
        PathBuf::from(local)
            .join("Packages")
            .join("Elgato.WaveLink_g54w8ztgkx496")
            .join("LocalState")
            .join("ws-info.json"),
    );
    out
}

/// Parse `{"port": 1884}` (and minor shape variants) from Wave Link `ws-info.json`.
pub fn parse_ws_info_port(raw: &str) -> Option<u16> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    v.get("port")
        .or_else(|| v.get("Port"))
        .and_then(|p| p.as_u64().or_else(|| p.as_str().and_then(|s| s.parse().ok())))
        .and_then(|n| u16::try_from(n).ok())
}

/// Best-effort local discovery. Never opens the Wave Link WebSocket itself.
pub fn discover_state() -> WaveLinkState {
    #[cfg(not(windows))]
    {
        return WaveLinkState::stub_unavailable(
            "Wave Link bridge is Windows-only (Linux stub — use mock Windows sessions)",
        );
    }
    #[cfg(windows)]
    {
        for path in ws_info_candidates() {
            if let Ok(raw) = std::fs::read_to_string(&path) {
                if let Some(port) = parse_ws_info_port(&raw) {
                    return WaveLinkState::stub_discovered(port);
                }
            }
        }
        // Lightweight TCP probe of the documented fallback range (connect only).
        for port in FALLBACK_PORT_RANGE {
            if std::net::TcpStream::connect_timeout(
                &std::net::SocketAddr::from(([127, 0, 0, 1], port)),
                std::time::Duration::from_millis(40),
            )
            .is_ok()
            {
                return WaveLinkState::stub_discovered(port);
            }
        }
        WaveLinkState::stub_unavailable(
            "Wave Link not detected (no ws-info.json / ports 1884–1893 closed)",
        )
    }
}

/// Future hook: build a JSON-RPC request body (documented for integrators / tests).
pub fn jsonrpc_request(id: u64, method: &str, params: Option<serde_json::Value>) -> serde_json::Value {
    serde_json::json!({
        "id": id,
        "jsonrpc": "2.0",
        "method": method,
        "params": params.unwrap_or(serde_json::Value::Null),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ws_info_port_number() {
        assert_eq!(parse_ws_info_port(r#"{"port":1884}"#), Some(1884));
        assert_eq!(parse_ws_info_port(r#"{"Port":"1890"}"#), Some(1890));
        assert_eq!(parse_ws_info_port(r#"{"nope":1}"#), None);
    }

    #[test]
    fn jsonrpc_shape() {
        let req = jsonrpc_request(1, "getChannels", None);
        assert_eq!(req["jsonrpc"], "2.0");
        assert_eq!(req["method"], "getChannels");
        assert_eq!(req["id"], 1);
    }

    #[test]
    fn discover_on_linux_is_stub() {
        let st = discover_state();
        assert!(!st.connected);
        assert_eq!(st.protocol, PROTOCOL_LABEL);
        #[cfg(not(windows))]
        assert!(!st.available);
    }

    #[test]
    fn typical_names_cover_mix() {
        assert!(typical_channel_names().contains(&"Music"));
        assert!(typical_channel_names().contains(&"Voice Chat"));
    }
}
