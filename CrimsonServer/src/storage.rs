use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AppData {
    pub auto_accept: bool,
    pub spotify_client_id: String,
    pub spotify_client_secret: String,
    #[serde(flatten)]
    pub other: HashMap<String, serde_json::Value>,
}

impl Default for AppData {
    fn default() -> Self {
        Self {
            auto_accept: true,
            spotify_client_id: "c009a382d41a4a899b212d2ebaf37388".to_string(),
            spotify_client_secret: "7bdf4d082d1b4b36955af25d80480cba".to_string(),
            other: HashMap::new(),
        }
    }
}

pub fn get_data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    let path = PathBuf::from(appdata).join("Crimson");
    if !path.exists() {
        let _ = fs::create_dir_all(&path);
    }
    path
}

pub fn get_data_path_from_env() -> PathBuf {
    get_data_dir().join("data.json")
}

pub fn load_data_from_path(path: PathBuf) -> AppData {
    if let Ok(content) = fs::read_to_string(path) {
        serde_json::from_str(&content).unwrap_or_default()
    } else {
        AppData::default()
    }
}

pub fn save_data_to_path(path: PathBuf, data: &AppData) {
    if let Ok(content) = serde_json::to_string_pretty(data) {
        let _ = fs::write(path, content);
    }
}

pub fn rotate_log(log_name: &str, max_size_mb: u64) {
    let log_path = get_data_dir().join(log_name);
    let mut should_rotate = false;
    
    if let Ok(metadata) = fs::metadata(&log_path) {
        // Rotate if too big
        if metadata.len() > max_size_mb * 1024 * 1024 {
            should_rotate = true;
        }
        
        // Rotate if older than 24h
        if let Ok(modified) = metadata.modified() {
            if let Ok(elapsed) = modified.elapsed() {
                if elapsed.as_secs() > 86400 {
                    should_rotate = true;
                }
            }
        }
    }
    
    if should_rotate {
        let old_path = get_data_dir().join(format!("{}.old", log_name));
        let _ = fs::remove_file(&old_path); // Clear previous old
        let _ = fs::rename(&log_path, &old_path);
    }
}

pub fn log_to_file(log_name: &str, message: &str) {
    rotate_log(log_name, 5); // Max 5MB / 24h
    let log_path = get_data_dir().join(log_name);
    if let Ok(mut file) = fs::OpenOptions::new().create(true).append(true).open(log_path) {
        use std::io::Write;
        let _ = writeln!(file, "[{}] {}", chrono::Local::now().format("%Y-%m-%d %H:%M:%S"), message);
    }
}

