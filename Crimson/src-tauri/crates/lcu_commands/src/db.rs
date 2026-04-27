use rusqlite::params;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, State};
use serde::{Serialize, Deserialize};
use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

pub type DbPool = Pool<SqliteConnectionManager>;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct DbMatch {
    pub game_id: u64,
    pub timestamp: u64,
    pub champion_id: u32,
    pub kills: u32,
    pub deaths: u32,
    pub assists: u32,
    pub win: bool,
    pub queue_id: u32,
    pub game_duration: u64,
}

pub fn get_db_path(_app: &AppHandle) -> PathBuf {
    if let Ok(appdata) = std::env::var("APPDATA") {
        let path = PathBuf::from(appdata).join("com.laoy.crimson");
        if !path.exists() {
            let _ = std::fs::create_dir_all(&path);
        }
        path.join("crimson.db")
    } else {
        PathBuf::from("./crimson.db")
    }
}

pub fn create_pool(app: &AppHandle) -> DbPool {
    let path = get_db_path(app);
    let manager = SqliteConnectionManager::file(path);
    Pool::builder()
        .max_size(10)
        .build(manager)
        .expect("Failed to create pool.")
}

pub fn init_db(pool: &DbPool) -> Result<(), r2d2::Error> {
    let conn = pool.get()?;
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS matches (
            game_id INTEGER PRIMARY KEY,
            timestamp INTEGER,
            champion_id INTEGER,
            kills INTEGER,
            deaths INTEGER,
            assists INTEGER,
            win INTEGER,
            queue_id INTEGER,
            game_duration INTEGER
        )",
        [],
    ).expect("Failed to create matches table");

    conn.execute(
        "CREATE TABLE IF NOT EXISTS rune_cache (
            champion TEXT,
            role TEXT,
            build_index INTEGER,
            data TEXT,
            patch TEXT,
            timestamp INTEGER,
            PRIMARY KEY (champion, role, build_index)
        )",
        [],
    ).expect("Failed to create rune_cache table");
    
    Ok(())
}

pub fn insert_match(pool: &DbPool, m: &DbMatch) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT OR IGNORE INTO matches (game_id, timestamp, champion_id, kills, deaths, assists, win, queue_id, game_duration)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            m.game_id as i64,
            m.timestamp as i64,
            m.champion_id,
            m.kills,
            m.deaths,
            m.assists,
            if m.win { 1 } else { 0 },
            m.queue_id,
            m.game_duration as i64
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

#[tauri::command]
pub fn get_all_matches(pool: State<DbPool>) -> Result<Vec<DbMatch>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT game_id, timestamp, champion_id, kills, deaths, assists, win, queue_id, game_duration FROM matches ORDER BY timestamp DESC")
        .map_err(|e| e.to_string())?;
        
    let match_iter = stmt.query_map([], |row| {
        Ok(DbMatch {
            game_id: row.get::<_, i64>(0)? as u64,
            timestamp: row.get::<_, i64>(1)? as u64,
            champion_id: row.get(2)?,
            kills: row.get(3)?,
            deaths: row.get(4)?,
            assists: row.get(5)?,
            win: row.get::<_, i32>(6)? != 0,
            queue_id: row.get(7)?,
            game_duration: row.get::<_, i64>(8)? as u64,
        })
    }).map_err(|e| e.to_string())?;
    
    let mut results = Vec::new();
    for m in match_iter {
        results.push(m.map_err(|e| e.to_string())?);
    }
    
    Ok(results)
}

pub fn get_cached_runes(pool: &DbPool, champion: &str, role: &str, patch: &str) -> Result<HashMap<i32, String>, String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    let mut stmt = conn.prepare("SELECT build_index, data FROM rune_cache WHERE champion = ?1 AND role = ?2 AND patch = ?3")
        .map_err(|e| e.to_string())?;
    let rows = stmt.query_map(params![champion.to_lowercase(), role, patch], |row| {
        Ok((row.get::<_, i32>(0)?, row.get::<_, String>(1)?))
    }).map_err(|e| e.to_string())?;
    
    let mut map = HashMap::new();
    for r in rows {
        let (idx, data) = r.map_err(|e| e.to_string())?;
        map.insert(idx, data);
    }
    Ok(map)
}

pub fn save_rune_cache(pool: &DbPool, champion: &str, role: &str, patch: &str, build_index: i32, data: &str) -> Result<(), String> {
    let conn = pool.get().map_err(|e| e.to_string())?;
    
    conn.execute(
        "INSERT OR REPLACE INTO rune_cache (champion, role, build_index, data, patch, timestamp)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            champion.to_lowercase(),
            role,
            build_index,
            data,
            patch,
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64
        ],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}
