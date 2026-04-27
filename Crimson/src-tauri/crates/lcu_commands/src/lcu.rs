use serde::{Deserialize, Serialize};
use reqwest::{Client, Method};
use std::str::FromStr;
use sysinfo::System;
use std::fs;
use std::sync::Mutex;

static LCU_CACHE: Mutex<Option<LcuInfo>> = Mutex::new(None);
/// Count consecutive lcu_request failures to know when League has truly closed
static LCU_FAIL_COUNT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LcuInfo {
    pub port: u16,
    pub password: String,
    pub protocol: String,
}

/// Try parsing a port and password from a raw command-line string (wmic/powershell output)
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

fn try_cache_and_return(port: u16, password: String, protocol: &str) -> Option<LcuInfo> {
    if port > 0 && !password.is_empty() {
        let info = LcuInfo { port, password, protocol: protocol.to_string() };
        if let Ok(mut cache) = LCU_CACHE.lock() {
            *cache = Some(info.clone());
        }
        Some(info)
    } else {
        None
    }
}

#[tauri::command]
pub fn get_lcu_info() -> Result<LcuInfo, String> {
    if std::env::var("CRIMSON_MOCK_LCU").unwrap_or_default() == "true" {
        return Ok(LcuInfo { port: 3000, password: "mock_password".to_string(), protocol: "http".to_string() });
    }

    // --- Return cached value if available ---
    if let Ok(cache) = LCU_CACHE.lock() {
        if let Some(info) = cache.as_ref() {
            return Ok(info.clone());
        }
    }

    // --- Method 1: sysinfo (works if Crimson launched before League) ---
    let mut sys = System::new_all();
    sys.refresh_all();

    for (_pid, process) in sys.processes() {
        let name = process.name().to_string();
        // Match main process only (not LeagueClientUxRender sub-processes)
        // Accept both with and without .exe in case sysinfo version differs
        let is_main = name == "LeagueClientUx.exe" || name == "LeagueClientUx";
        if is_main {
            // Try cmd args first
            let cmdline: String = process.cmd().iter().map(|a| a.to_string() + " ").collect();
            let (port, password) = parse_cmdline(&cmdline);
            if let Some(info) = try_cache_and_return(port, password, "https") {
                return Ok(info);
            }

            // Try lockfile via exe path (works even with missing cmd args)
            if let Some(exe_path) = process.exe() {
                if let Some(parent) = exe_path.parent() {
                    if let Ok(content) = fs::read_to_string(parent.join("lockfile")) {
                        if let Ok(info) = parse_lockfile(&content) {
                            if let Ok(mut cache) = LCU_CACHE.lock() { *cache = Some(info.clone()); }
                            return Ok(info);
                        }
                    }
                }
            }
        }
    }

    // --- Method 2: PowerShell (most reliable on Windows 10/11) ---
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command",
              "(Get-Process -Name LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1).CommandLine"]);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    if let Ok(output) = cmd.output()
    {
        let cmdline = String::from_utf8_lossy(&output.stdout);
        let (port, password) = parse_cmdline(&cmdline);
        if let Some(info) = try_cache_and_return(port, password, "https") {
            return Ok(info);
        }
    }

    // --- Method 3: Default lockfile paths (all common drives) ---
    let default_paths = [
        "C:\\Riot Games\\League of Legends\\lockfile",
        "D:\\Riot Games\\League of Legends\\lockfile",
        "E:\\Riot Games\\League of Legends\\lockfile",
        "F:\\Riot Games\\League of Legends\\lockfile",
    ];
    for path in &default_paths {
        if let Ok(content) = fs::read_to_string(path) {
            if let Ok(info) = parse_lockfile(&content) {
                if let Ok(mut cache) = LCU_CACHE.lock() { *cache = Some(info.clone()); }
                return Ok(info);
            }
        }
    }

    Err("LCU not found".to_string())
}

/// Returns diagnostic information about what each detection method found.
/// Used by the debug tab to diagnose connection failures.
#[tauri::command]
pub fn debug_lcu() -> String {
    let mut lines: Vec<String> = Vec::new();

    // sysinfo scan
    let mut sys = System::new_all();
    sys.refresh_all();
    let mut found_sysinfo = false;
    for (_pid, process) in sys.processes() {
        let name = process.name().to_string();
        if name.contains("LeagueClientUx") {
            found_sysinfo = true;
            let cmdline: String = process.cmd().iter().map(|a| a.to_string() + " ").collect();
            let exe = process.exe().map(|p| p.display().to_string()).unwrap_or_default();
            lines.push(format!("[sysinfo] Process found: {name}"));
            lines.push(format!("[sysinfo] CMD args ({} chars): {}", cmdline.len(), if cmdline.is_empty() { "(empty - Windows blocked)" } else { &cmdline[..cmdline.len().min(120)] }));
            lines.push(format!("[sysinfo] EXE: {exe}"));
            // Try lockfile
            if let Some(exe_path) = process.exe() {
                if let Some(parent) = exe_path.parent() {
                    let lf = parent.join("lockfile");
                    match fs::read_to_string(&lf) {
                        Ok(c) => lines.push(format!("[sysinfo] Lockfile OK: {}", &c[..c.len().min(80)])),
                        Err(e) => lines.push(format!("[sysinfo] Lockfile FAIL: {e}")),
                    }
                }
            }
        }
    }
    if !found_sysinfo { lines.push("[sysinfo] No LeagueClientUx process found".into()); }

    // PowerShell
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command",
              "(Get-Process -Name LeagueClientUx -ErrorAction SilentlyContinue | Select-Object -First 1).CommandLine"]);
    
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }

    match cmd.output()
    {
        Ok(out) => {
            let s = String::from_utf8_lossy(&out.stdout).trim().to_string();
            lines.push(format!("[powershell] OUT ({} chars): {}", s.len(), if s.is_empty() { "(empty)" } else { &s[..s.len().min(120)] }));
        }
        Err(e) => lines.push(format!("[powershell] FAIL: {e}")),
    }

    // Default lockfile paths
    for path in &["C:\\Riot Games\\League of Legends\\lockfile", "D:\\Riot Games\\League of Legends\\lockfile", "E:\\Riot Games\\League of Legends\\lockfile"] {
        match fs::read_to_string(path) {
            Ok(c) => lines.push(format!("[lockfile] {} OK: {}", path, &c[..c.len().min(80)])),
            Err(e) => lines.push(format!("[lockfile] {} ERR: {e}", path)),
        }
    }

    lines.join("\n")
}



fn parse_lockfile(content: &str) -> Result<LcuInfo, String> {
    let parts: Vec<&str> = content.split(':').collect();
    if parts.len() >= 5 {
        Ok(LcuInfo {
            port: parts[2].trim().parse().unwrap_or(0),
            password: parts[3].trim().to_string(),
            protocol: parts[4].trim().to_string(),
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
        .timeout(std::time::Duration::from_secs(4))
        .build()
        .map_err(|e| e.to_string())?;

    let url = format!("{}://127.0.0.1:{}{}", info.protocol, info.port, endpoint);
    let req_method = Method::from_str(&method.to_uppercase()).map_err(|e| e.to_string())?;
    
    let mut request = client.request(req_method.clone(), &url)
        .basic_auth("riot", Some(info.password));
        
    if let Some(b) = body {
        request = request.header("Content-Type", "application/json").body(b);
    }

    let response = match request.send().await {
        Ok(r) => r,
        Err(e) => {
            println!("lcu_request ERROR on {}: {}", endpoint, e);
            let count = LCU_FAIL_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed) + 1;
            if count >= 10 {
                if let Ok(mut cache) = LCU_CACHE.lock() {
                    *cache = None;
                }
                LCU_FAIL_COUNT.store(0, std::sync::atomic::Ordering::Relaxed);
            }

            return Err(e.to_string());
        }
    };
    
    LCU_FAIL_COUNT.store(0, std::sync::atomic::Ordering::Relaxed);
    let response_text = response.text().await.map_err(|e| {
        println!("lcu_request parsing ERROR on {}: {}", endpoint, e);
        e.to_string()
    })?;

    Ok(response_text)
}

#[tauri::command]
pub async fn fetch_ddragon_url(url: String) -> Result<String, String> {
    reqwest::get(&url)
        .await
        .map_err(|e| e.to_string())?
        .text()
        .await
        .map_err(|e| e.to_string())
}
