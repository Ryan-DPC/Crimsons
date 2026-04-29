use rusqlite::{params, Connection, Result};
use std::path::PathBuf;
use serde_json::Value;
use chrono::Utc;
use std::sync::Mutex;

pub struct StreamDockDB {
    conn: Mutex<Connection>,
}

impl StreamDockDB {
    pub fn init() -> Result<Self> {
        let mut path = crate::storage::get_data_dir();
        std::fs::create_dir_all(&path).ok();
        path.push("streamdock.db");
        
        let conn = Connection::open(path)?;
        
        conn.execute(
            "CREATE TABLE IF NOT EXISTS buttons (
                context TEXT PRIMARY KEY,
                action TEXT,
                settings TEXT,
                image TEXT,
                updated_at TEXT
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS cache (
                key TEXT PRIMARY KEY,
                value TEXT,
                updated_at TEXT
            )",
            [],
        )?;
        
        Ok(Self { conn: Mutex::new(conn) })
    }

    pub fn save_button(&self, context: &str, action: Option<&str>, settings: &Value, image: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let settings_str = settings.to_string();
        let now = Utc::now().to_rfc3339();
        
        conn.execute(
            "INSERT INTO buttons (context, action, settings, image, updated_at) 
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(context) DO UPDATE SET
                action = COALESCE(?2, action),
                settings = ?3,
                image = COALESCE(?4, image),
                updated_at = ?5",
            params![context, action, settings_str, image, now],
        )?;
        Ok(())
    }

    pub fn get_button_settings(&self, context: &str) -> Result<Option<Value>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT settings FROM buttons WHERE context = ?1")?;
        let mut rows = stmt.query(params![context])?;
        
        if let Some(row) = rows.next()? {
            let s: String = row.get::<_, String>(0)?;
            Ok(serde_json::from_str(&s).ok())
        } else {
            Ok(None)
        }
    }

    pub fn get_all_buttons(&self) -> Result<Vec<(String, String, Value, Option<String>)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT context, action, settings, image FROM buttons")?;
        let rows = stmt.query_map([], |row: &rusqlite::Row| {
            let context: String = row.get::<_, String>(0)?;
            let action: String = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let settings_str: String = row.get::<_, String>(2)?;
            let image: Option<String> = row.get::<_, Option<String>>(3)?;
            let settings = serde_json::from_str(&settings_str).unwrap_or(Value::Null);
            Ok((context, action, settings, image))
        })?;
        
        let mut results = Vec::new();
        for row in rows {
            if let Ok(r) = row { results.push(r); }
        }
        Ok(results)
    }

    pub fn set_cache(&self, key: &str, value: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "INSERT INTO cache (key, value, updated_at) VALUES (?1, ?2, ?3)
             ON CONFLICT(key) DO UPDATE SET value = ?2, updated_at = ?3",
            params![key, value, now],
        )?;
        Ok(())
    }

    pub fn get_cache(&self, key: &str) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT value FROM cache WHERE key = ?1")?;
        let mut rows = stmt.query(params![key])?;
        if let Some(row) = rows.next()? {
            Ok(Some(row.get(0)?))
        } else {
            Ok(None)
        }
    }
}
