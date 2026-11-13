use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppData {
    #[serde(default = "default_true")]
    pub auto_accept: bool,
    /// Typed pick/ban fields — must match Tauri `lcu_commands` / frontend camelCase keys.
    #[serde(default)]
    pub auto_ban: Option<u64>,
    #[serde(default)]
    pub auto_pick: Option<u64>,
    #[serde(default)]
    pub remembered_auto_ban: Option<u64>,
    #[serde(default)]
    pub remembered_auto_pick: Option<u64>,
    // Renseignes par l'utilisateur depuis les parametres de l'app : chaque
    // installation utilise sa propre application Spotify. Aucune valeur par
    // defaut, un secret OAuth n'a pas a etre distribue dans le binaire.
    #[serde(default)]
    pub spotify_client_id: String,
    #[serde(default)]
    pub spotify_client_secret: String,
    
    // Premium and Custom Settings
    /// Conserve pour compatibilite et affichage uniquement. Ne jamais s'en
    /// servir pour autoriser quoi que ce soit : ce fichier est ecrit par le
    /// client et modifiable a la main. Voir crate::entitlement.
    #[serde(default)]
    pub is_premium: bool,
    #[serde(default)]
    pub premium_token: Option<String>,
    #[serde(default)]
    pub custom_server_path: Option<String>,
    #[serde(default)]
    pub discord_client_id: Option<String>,

    /// Twitch Helix Client-Id (user-owned app). Env `TWITCH_CLIENT_ID` overrides.
    #[serde(default)]
    pub twitch_client_id: Option<String>,
    /// Twitch user access token. Env `TWITCH_ACCESS_TOKEN` / `TWITCH_OAUTH_TOKEN` overrides.
    #[serde(default)]
    pub twitch_access_token: Option<String>,

    #[serde(flatten)]
    pub other: HashMap<String, serde_json::Value>,
}

fn default_true() -> bool { true }

impl Default for AppData {
    fn default() -> Self {
        Self {
            auto_accept: default_true(),
            auto_ban: None,
            auto_pick: None,
            remembered_auto_ban: None,
            remembered_auto_pick: None,
            spotify_client_id: String::new(),
            spotify_client_secret: String::new(),
            is_premium: false,
            premium_token: None,
            custom_server_path: None,
            discord_client_id: None,
            twitch_client_id: None,
            twitch_access_token: None,
            other: HashMap::new(),
        }
    }
}

impl AppData {
    fn legacy_champ_id(value: &serde_json::Value) -> Option<u64> {
        if value.is_null() {
            return None;
        }
        value
            .as_u64()
            .or_else(|| value.as_i64().and_then(|i| if i >= 0 { Some(i as u64) } else { None }))
            .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
            .filter(|&id| id > 0)
    }

    /// Prefer typed fields; fall back to legacy `other.autoBan` if present.
    pub fn effective_auto_ban(&self) -> Option<u64> {
        self.auto_ban
            .filter(|&id| id > 0)
            .or_else(|| self.other.get("autoBan").and_then(Self::legacy_champ_id))
    }

    pub fn effective_auto_pick(&self) -> Option<u64> {
        self.auto_pick
            .filter(|&id| id > 0)
            .or_else(|| self.other.get("autoPick").and_then(Self::legacy_champ_id))
    }
}

lazy_static::lazy_static! {
    static ref CACHED_APP_DATA: std::sync::RwLock<Option<(AppData, std::time::SystemTime)>> = std::sync::RwLock::new(None);
}

pub fn invalidate_cache() {
    if let Ok(mut cache) = CACHED_APP_DATA.write() {
        *cache = None;
    }
}

/// Copy missing files from a legacy AppData folder into the canonical one.
/// Same policy as the Tauri host: never overwrite files that already exist.
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

pub fn get_data_dir() -> PathBuf {
    let appdata = std::env::var("APPDATA").unwrap_or_default();
    // Canonical data dir: must match tauri.conf.json `identifier` (com.laoy.crimsons).
    // The sidecar can start before (or without) the Tauri host, so it must migrate
    // legacy folders itself — otherwise it creates an empty com.laoy.crimsons and
    // orphans data.json / auth.token under com.laoy.crimson or com.laoy.crimons.
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
    path
}

pub fn get_data_path_from_env() -> PathBuf {
    get_data_dir().join("data.json")
}

pub fn load_data_from_path(path: PathBuf) -> AppData {
    let disk_mtime = fs::metadata(&path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    if let Ok(cache) = CACHED_APP_DATA.read() {
        if let Some((data, cached_mtime)) = cache.as_ref() {
            if disk_mtime <= *cached_mtime {
                return data.clone();
            }
        }
    }

    let mut loaded_data: Option<AppData> = None;
    for _ in 0..5 {
        if let Ok(content) = fs::read_to_string(&path) {
            if content.trim().is_empty() {
                std::thread::sleep(std::time::Duration::from_millis(20));
                continue;
            }
            if let Ok(data) = serde_json::from_str(&content) {
                loaded_data = Some(data);
                break;
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }

    let loaded_data = match loaded_data {
        Some(data) => data,
        None => {
            if path.exists() {
                // Do NOT cache Default over a real file — a later save would wipe
                // firstLaunchFinished / plugins / Spotify credentials.
                tracing::warn!(
                    "[storage] Failed to parse {:?} after retries; refusing Default cache",
                    path
                );
                return AppData::default();
            }
            AppData::default()
        }
    };

    let final_mtime = fs::metadata(&path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    if let Ok(mut cache) = CACHED_APP_DATA.write() {
        *cache = Some((loaded_data.clone(), final_mtime));
    }
    loaded_data
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

    let final_mtime = fs::metadata(&path)
        .and_then(|m| m.modified())
        .unwrap_or(std::time::SystemTime::UNIX_EPOCH);

    if let Ok(mut cache) = CACHED_APP_DATA.write() {
        *cache = Some((data.clone(), final_mtime));
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

#[cfg(test)]
mod storage_automation_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn effective_auto_ban_prefers_typed_field() {
        let mut data = AppData::default();
        data.auto_ban = Some(157);
        data.other.insert("autoBan".into(), json!(103));
        assert_eq!(data.effective_auto_ban(), Some(157));
    }

    #[test]
    fn effective_auto_ban_falls_back_to_other() {
        let mut data = AppData::default();
        data.other.insert("autoBan".into(), json!(103));
        assert_eq!(data.effective_auto_ban(), Some(103));
    }

    #[test]
    fn roundtrip_camel_case_pick_ban() {
        let mut data = AppData::default();
        data.auto_pick = Some(64);
        data.auto_ban = Some(238);
        let json = serde_json::to_string(&data).unwrap();
        assert!(json.contains("\"autoPick\":64"));
        assert!(json.contains("\"autoBan\":238"));
        let loaded: AppData = serde_json::from_str(&json).unwrap();
        assert_eq!(loaded.effective_auto_pick(), Some(64));
        assert_eq!(loaded.effective_auto_ban(), Some(238));
    }
}

