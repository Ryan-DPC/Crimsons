use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
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
    pub player_notes: HashMap<String, PlayerNote>,
    pub auto_accept: bool,
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
        }
    }
}

pub fn get_data_path_from_env() -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = PathBuf::from(appdata).join("com.laoy.crimson");
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
    if let Ok(content) = fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppData::default()
    }
}

pub fn load_data(app: &AppHandle) -> AppData {
    load_data_from_path(get_data_path(app))
}

pub fn save_data_to_path(path: PathBuf, data: &AppData) {
    if let Ok(content) = serde_json::to_string_pretty(data) {
        let _ = fs::write(path, content);
    }
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
    save_data(&app, &data);
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
