use std::fs::{self, OpenOptions};
use std::io::Write;
use serde::{Deserialize, Serialize};
use reqwest::{Client, Method};
use std::str::FromStr;
use chrono::Local;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LcuInfo {
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

#[tauri::command]
pub fn get_lcu_info() -> Result<LcuInfo, String> {
    let default_path = "C:\\Riot Games\\League of Legends\\lockfile";
    
    match fs::read_to_string(default_path) {
        Ok(content) => parse_lockfile(&content),
        Err(_) => Err("LeagueClient not running or lockfile missing".to_string())
    }
}

fn parse_lockfile(content: &str) -> Result<LcuInfo, String> {
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() >= 5 {
        Ok(LcuInfo {
            port: parts[2].parse().unwrap_or(0),
            password: parts[3].to_string(),
            protocol: parts[4].to_string(),
        })
    } else {
        Err("Invalid lockfile format".to_string())
    }
}

#[tauri::command]
pub async fn lcu_request(method: String, endpoint: String, body: Option<String>) -> Result<String, String> {
    let info = get_lcu_info()?;
    
    let client = Client::builder()
        .danger_accept_invalid_certs(true)
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}://127.0.0.1:{}{}", info.protocol, info.port, endpoint);
    let req_method = Method::from_str(&method.to_uppercase()).map_err(|e| e.to_string())?;
    
    let mut request = client.request(req_method.clone(), &url)
        .basic_auth("riot", Some(info.password));
        
    let body_clone = body.clone();
    if let Some(b) = body {
        request = request.header("Content-Type", "application/json").body(b);
    }

    let response = request.send().await.map_err(|e| e.to_string())?;
    let response_text = response.text().await.map_err(|e| e.to_string())?;
    
    // DEBUG LOGGING
    if let Ok(mut file) = OpenOptions::new().create(true).append(true).open("lcu_debug.log") {
        let timestamp = Local::now().format("%Y-%m-%d %H:%M:%S");
        let _ = writeln!(file, "\n[{}] {} {}", timestamp, req_method, endpoint);
        if let Some(b) = body_clone {
            let _ = writeln!(file, "BODY: {}", b);
        }
        let _ = writeln!(file, "RESPONSE: {}", response_text);
    }
    
    Ok(response_text)
}
