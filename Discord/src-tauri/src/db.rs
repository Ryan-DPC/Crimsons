use rusqlite::{params, Connection, Result};
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use serde::{Serialize, Deserialize};

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

pub fn get_db_path(app: &AppHandle) -> PathBuf {
    let path = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("./"));
    if !path.exists() {
        let _ = std::fs::create_dir_all(&path);
    }
    path.join("crimson.db")
}

pub fn init_db(app: &AppHandle) -> Result<()> {
    let path = get_db_path(app);
    let conn = Connection::open(path)?;
    
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
    )?;
    
    Ok(())
}

pub fn insert_match(app: &AppHandle, m: &DbMatch) -> Result<()> {
    let path = get_db_path(app);
    let conn = Connection::open(path)?;
    
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
    )?;
    
    Ok(())
}

#[tauri::command]
pub fn get_all_matches(app: AppHandle) -> Result<Vec<DbMatch>, String> {
    let path = get_db_path(&app);
    let conn = Connection::open(path).map_err(|e| e.to_string())?;
    
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
