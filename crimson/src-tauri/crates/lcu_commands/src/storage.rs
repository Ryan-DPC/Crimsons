use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PlayerNote {
    pub name: String,
    pub note: String,
    pub tag: String,
    pub last_seen: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default)]
    pub player_notes: HashMap<String, PlayerNote>,
    #[serde(default = "default_true")]
    pub auto_accept: bool,
    #[serde(default)]
    pub match_ids: Vec<u64>,
    
    #[serde(default)]
    pub auto_ban: Option<u64>,
    #[serde(default)]
    pub auto_pick: Option<u64>,
    #[serde(default)]
    pub gemini_api_key: Option<String>,
    #[serde(default)]
    pub last_lp_delta: Option<i32>,
    #[serde(default)]
    pub hist: Option<serde_json::Value>,

    #[serde(default)]
    pub remembered_auto_ban: Option<u64>,
    #[serde(default)]
    pub remembered_auto_pick: Option<u64>,

    #[serde(default = "default_true")]
    pub draft_warnings: bool,
    
    #[serde(default)]
    pub invisible_automation: bool,
    #[serde(default = "default_true")]
    pub dark_glass_mode: bool,
    #[serde(default)]
    pub reduced_animations: bool,

    // Windows integration
    #[serde(default)]
    pub close_to_tray: Option<bool>,
    #[serde(default)]
    pub launch_on_startup: bool,
    #[serde(default)]
    pub server_launch_on_startup: bool,
    #[serde(default)]
    pub window_x: Option<i32>,
    #[serde(default)]
    pub window_y: Option<i32>,
    #[serde(default)]
    pub window_width: Option<u32>,
    #[serde(default)]
    pub window_height: Option<u32>,
    
    // Premium and Custom Settings
    #[serde(default)]
    pub is_premium: bool,
    #[serde(default)]
    pub premium_token: Option<String>,
    #[serde(default)]
    pub custom_server_path: Option<String>,
    #[serde(default)]
    pub discord_client_id: Option<String>,

    /// Twitch Helix Client-Id (user-owned). Env overrides on the sidecar.
    #[serde(default)]
    pub twitch_client_id: Option<String>,
    /// Twitch user access token (masked in Settings once saved).
    #[serde(default)]
    pub twitch_access_token: Option<String>,

    // Spotify OAuth app credentials (user-owned). Typed so Tauri ↔ server
    // round-trips cannot drop them into a mismatched flatten bucket.
    #[serde(default)]
    pub spotify_client_id: String,
    #[serde(default)]
    pub spotify_client_secret: String,

    #[serde(flatten)]
    pub other: HashMap<String, serde_json::Value>,
}

fn default_true() -> bool { true }

impl Default for AppData {
    fn default() -> Self {
        Self {
            player_notes: HashMap::new(),
            auto_accept: true,
            match_ids: Vec::new(),
            auto_ban: None,
            auto_pick: None,
            gemini_api_key: None,
            last_lp_delta: None,
            hist: None,
            remembered_auto_ban: None,
            remembered_auto_pick: None,
            draft_warnings: true,
            invisible_automation: false,
            dark_glass_mode: true,
            reduced_animations: false,
            close_to_tray: None,
            launch_on_startup: false,
            server_launch_on_startup: false,
            window_x: None,
            window_y: None,
            window_width: None,
            window_height: None,
            is_premium: false,
            premium_token: None,
            custom_server_path: None,
            discord_client_id: None,
            twitch_client_id: None,
            twitch_access_token: None,
            spotify_client_id: String::new(),
            spotify_client_secret: String::new(),
            other: HashMap::new(),
        }
    }
}

fn migrate_legacy_appdata(from: &Path, to: &Path) {
    let Ok(entries) = fs::read_dir(from) else { return };
    let _ = fs::create_dir_all(to);
    for entry in entries.flatten() {
        let src = entry.path();
        let Some(name) = src.file_name() else { continue };
        let dest = to.join(name);
        if dest.exists() {
            continue;
        }
        if src.is_dir() {
            let _ = copy_dir_recursive(&src, &dest);
        } else {
            let _ = fs::copy(&src, &dest);
        }
    }
}

fn copy_dir_recursive(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else if !dest.exists() {
            fs::copy(&src, &dest)?;
        }
    }
    Ok(())
}

pub fn get_data_path_from_env() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        // Canonical data dir: must match tauri.conf.json `identifier` (com.laoy.crimsons).
        let path = PathBuf::from(&appdata).join("com.laoy.crimsons");
        for legacy_name in ["com.laoy.crimson", "com.laoy.crimons"] {
            let legacy = PathBuf::from(&appdata).join(legacy_name);
            if legacy.exists() && legacy != path {
                migrate_legacy_appdata(&legacy, &path);
            }
        }
        if !path.exists() {
            let _ = fs::create_dir_all(&path);
        }
        path.join("data.json")
    } else {
        PathBuf::from("./data.json")
    }
}

pub fn get_data_path(_app: &AppHandle) -> PathBuf {
    get_data_path_from_env()
}

pub fn load_data_from_path(path: PathBuf) -> AppData {
    let mut last_err: Option<String> = None;
    for _ in 0..5 {
        match fs::read_to_string(&path) {
            Ok(content) => {
                if content.trim().is_empty() {
                    last_err = Some("empty file".into());
                } else {
                    match serde_json::from_str(&content) {
                        Ok(data) => return data,
                        Err(e) => last_err = Some(e.to_string()),
                    }
                }
            }
            Err(e) => last_err = Some(e.to_string()),
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    // Never invent a blank profile over a real (briefly locked) data.json —
    // callers that then save would wipe firstLaunchFinished / Spotify creds.
    if path.exists() {
        eprintln!(
            "[storage] Failed to load {:?} after retries ({:?}); refusing Default wipe",
            path, last_err
        );
        // Best-effort: return Default in-memory only. Callers must not treat this
        // as authoritative for set_app_data without a successful read.
    }
    AppData::default()
}

pub fn save_data_to_path(path: PathBuf, data: &AppData) {
    if let Ok(content) = serde_json::to_string_pretty(data) {
        for _ in 0..5 {
            if fs::write(&path, &content).is_ok() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

/// Load for mutation: if the file exists but cannot be parsed, return None so
/// we do not overwrite a good file with Default.
pub fn try_load_data_from_path(path: PathBuf) -> Option<AppData> {
    for _ in 0..5 {
        if let Ok(content) = fs::read_to_string(&path) {
            if content.trim().is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            if let Ok(data) = serde_json::from_str(&content) {
                return Some(data);
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    if path.exists() {
        None
    } else {
        Some(AppData::default())
    }
}

pub fn load_data(app: &AppHandle) -> AppData {
    load_data_from_path(get_data_path(app))
}

pub fn save_data(app: &AppHandle, data: &AppData) {
    save_data_to_path(get_data_path(app), data);
}

#[tauri::command]
pub fn get_app_data(app: AppHandle) -> AppData {
    load_data(&app)
}

#[tauri::command]
pub fn set_app_data(app: AppHandle, data: AppData) {
    // Refuse to persist a blank Default over an existing file when the payload
    // looks uninitialized (no firstLaunchFinished and empty plugins) AND disk
    // already has real state — still allow intentional first writes.
    let path = get_data_path(&app);
    if let Some(existing) = try_load_data_from_path(path.clone()) {
        let incoming_finished = data
            .other
            .get("firstLaunchFinished")
            .and_then(|v| v.as_bool());
        let existing_finished = existing
            .other
            .get("firstLaunchFinished")
            .and_then(|v| v.as_bool());
        // Protect onboarding flag from accidental wipe via partial/default payloads.
        let mut merged = data;
        if existing_finished == Some(true) && incoming_finished != Some(true) {
            merged
                .other
                .insert("firstLaunchFinished".into(), serde_json::Value::Bool(true));
        }
        // Preserve Spotify creds if the UI sent empty strings over known-good disk values.
        if merged.spotify_client_id.is_empty() && !existing.spotify_client_id.is_empty() {
            merged.spotify_client_id = existing.spotify_client_id;
        }
        if merged.spotify_client_secret.is_empty() && !existing.spotify_client_secret.is_empty() {
            merged.spotify_client_secret = existing.spotify_client_secret;
        }
        // Preserve Twitch token if the UI left the masked field blank.
        let incoming_twitch_token = merged
            .twitch_access_token
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        if incoming_twitch_token.is_none() {
            if let Some(existing_token) = existing
                .twitch_access_token
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                merged.twitch_access_token = Some(existing_token.to_string());
            }
        }
        let incoming_twitch_id = merged
            .twitch_client_id
            .as_ref()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty());
        if incoming_twitch_id.is_none() {
            if let Some(existing_id) = existing
                .twitch_client_id
                .as_ref()
                .map(|s| s.trim())
                .filter(|s| !s.is_empty())
            {
                merged.twitch_client_id = Some(existing_id.to_string());
            }
        }
        // Preserve plugins map if incoming omits it or sends an empty object over a real one.
        let incoming_plugins = merged.other.get("plugins").cloned();
        let existing_plugins = existing.other.get("plugins").cloned();
        match (incoming_plugins, existing_plugins) {
            (None, Some(p)) => {
                merged.other.insert("plugins".into(), p);
            }
            (Some(serde_json::Value::Object(obj)), Some(p)) if obj.is_empty() => {
                if p.as_object().map(|o| !o.is_empty()).unwrap_or(false) {
                    merged.other.insert("plugins".into(), p);
                }
            }
            _ => {}
        }
        save_data_to_path(path, &merged);
    } else if !path.exists() {
        save_data(&app, &data);
    }
    // If disk exists but is unreadable, skip write to avoid wipe.
}

#[tauri::command]
pub fn set_auto_accept(app: AppHandle, enabled: bool) {
    let mut data = load_data(&app);
    data.auto_accept = enabled;
    save_data(&app, &data);

    if let Some(ws_sender) = app.try_state::<crate::events::WsSender>() {
        let msg = serde_json::json!({
            "type": "AUTO_ACCEPT_STATE",
            "enabled": enabled
        });
        let _ = (*ws_sender).0.send(msg.to_string());
    }
}

#[tauri::command]
pub fn set_player_note(app: AppHandle, summoner_id: String, note: PlayerNote) {
    let mut data = load_data(&app);
    data.player_notes.insert(summoner_id, note);
    save_data(&app, &data);
}
