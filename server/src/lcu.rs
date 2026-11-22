use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use std::sync::Arc;
use std::sync::atomic::{AtomicU32, Ordering};
use base64::Engine;

lazy_static::lazy_static! {
    static ref LCU_AGENT: ureq::Agent = {
        let tls_connector = Arc::new(native_tls::TlsConnector::builder()
            .danger_accept_invalid_certs(true)
            .build()
            .unwrap());
        ureq::builder()
            .tls_connector(tls_connector)
            .timeout(std::time::Duration::from_secs(2))
            .build()
    };
}

static LCU_CACHE: Mutex<Option<LcuInfo>> = Mutex::new(None);
static LCU_FAIL_COUNT: AtomicU32 = AtomicU32::new(0);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LcuInfo {
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

pub fn get_lcu_info() -> Result<LcuInfo, String> {
    // Return cached value if available
    if let Ok(cache) = LCU_CACHE.lock() {
        if let Some(info) = cache.as_ref() {
            return Ok(info.clone());
        }
    }

    // Method 1: Native Process Scanning (Performance & Reliability)
    let processes_info: Vec<(String, Vec<String>, Option<std::path::PathBuf>)> = {
        if let Ok(sys) = crate::process_scanner::GLOBAL_SYSTEM.lock() {
            sys.processes().iter().map(|(_pid, process)| {
                (
                    process.name().to_string(), 
                    process.cmd().to_vec(),
                    process.exe().and_then(|p| p.parent().map(|p| p.to_path_buf()))
                )
            }).collect()
        } else {
            Vec::new()
        }
    };

    for (name, cmd, parent) in processes_info {
        if name == "LeagueClientUx.exe" || name == "LeagueClientUx" {
            let cmdline = cmd.join(" ");
            let (port, password) = parse_cmdline(&cmdline);
            if port > 0 && !password.is_empty() {
                let info = LcuInfo { port, password, protocol: "https".into() };
                if let Ok(mut cache) = LCU_CACHE.lock() { *cache = Some(info.clone()); }
                return Ok(info);
            }

            // Fallback: Check lockfile in the process directory if cmdline parsing failed
            if let Some(parent_path) = parent {
                let lockfile_path = parent_path.join("lockfile");
                if let Ok(content) = fs::read_to_string(&lockfile_path) {
                    if let Some(info) = parse_lockfile(&content) {
                        if let Ok(mut cache) = LCU_CACHE.lock() { *cache = Some(info.clone()); }
                        return Ok(info);
                    }
                }
            }
        }
    }

    // Method 2: Global Fallback (Default paths on all common drives)
    let default_paths = [
        "C:\\Riot Games\\League of Legends\\lockfile",
        "D:\\Riot Games\\League of Legends\\lockfile",
        "E:\\Riot Games\\League of Legends\\lockfile",
        "F:\\Riot Games\\League of Legends\\lockfile",
    ];
    for path in &default_paths {
        if let Ok(content) = fs::read_to_string(path) {
            if let Some(info) = parse_lockfile(&content) {
                if let Ok(mut cache) = LCU_CACHE.lock() { *cache = Some(info.clone()); }
                return Ok(info);
            }
        }
    }

    Err("LCU not found".to_string())
}

fn parse_lockfile(content: &str) -> Option<LcuInfo> {
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() >= 5 {
        Some(LcuInfo {
            port: parts[2].trim().parse().unwrap_or(0),
            password: parts[3].trim().to_string(),
            protocol: parts[4].trim().to_string(),
        })
    } else {
        None
    }
}

pub fn is_lcu_connected() -> bool {
    get_lcu_info().is_ok()
}

fn parse_cmdline(cmdline: &str) -> (u16, String) {
    let mut port = 0u16;
    let mut password = String::new();
    for token in cmdline.split_whitespace() {
        if token.starts_with("--app-port=") {
            port = token.trim_start_matches("--app-port=").parse().unwrap_or(0);
        } else if token.starts_with("--remoting-auth-token=") {
            password = token.trim_start_matches("--remoting-auth-token=").to_string();
        }
    }
    (port, password)
}

pub fn lcu_request(method: String, endpoint: String, body: Option<String>) -> Result<String, String> {
    let info = get_lcu_info()?;
    let url = format!("{}://127.0.0.1:{}{}", info.protocol, info.port, endpoint);

    let mut request = LCU_AGENT.request(&method.to_uppercase(), &url)
        .set("Authorization", &format!("Basic {}", base64::engine::general_purpose::STANDARD.encode(format!("riot:{}", info.password))))
        .timeout(std::time::Duration::from_secs(4));

    if let Some(b) = body {
        request = request.set("Content-Type", "application/json");
        match request.send_string(&b) {
            Ok(r) => handle_response(r),
            Err(e) => handle_error(e)
        }
    } else {
        match request.call() {
            Ok(r) => handle_response(r),
            Err(e) => handle_error(e)
        }
    }
}

pub async fn lcu_request_async(method: String, endpoint: String, body: Option<String>) -> Result<String, String> {
    tokio::task::spawn_blocking(move || lcu_request(method, endpoint, body))
        .await
        .unwrap_or_else(|e| Err(e.to_string()))
}

fn handle_response(response: ureq::Response) -> Result<String, String> {
    LCU_FAIL_COUNT.store(0, Ordering::Relaxed);
    response.into_string().map_err(|e| e.to_string())
}

fn handle_error(err: ureq::Error) -> Result<String, String> {
    match &err {
        ureq::Error::Status(code, _) => {
            // An HTTP status code (such as 404 when not in queue / not in champ select)
            // proves the LCU HTTP server is alive and responding! Do NOT increment fail count.
            LCU_FAIL_COUNT.store(0, Ordering::Relaxed);
            tracing::debug!("LCU responded with HTTP status {}: alive", code);
        }
        ureq::Error::Transport(_) => {
            // Only genuine connection failures (process closed, socket closed, timeout)
            // count towards disconnecting LCU.
            let count = LCU_FAIL_COUNT.fetch_add(1, Ordering::Relaxed) + 1;
            if count >= 5 {
                if let Ok(mut cache) = LCU_CACHE.lock() { *cache = None; }
                LCU_FAIL_COUNT.store(0, Ordering::Relaxed);
            }
        }
    }
    Err(err.to_string())
}
