use tauri::Manager;
use lcu_commands::storage;

#[tauri::command]
pub fn crimson_quit_app(app: tauri::AppHandle) {
  // Kill sidecar before exiting
  let sidecar_state = app.state::<lcu_commands::SidecarChild>();
  let child_mutex = sidecar_state.0.clone();
  tauri::async_runtime::spawn(async move {
      let mut lock = child_mutex.lock().await;
      if let Some(mut child) = lock.take() {
          let _ = child.kill();
      }
  });
  app.exit(0);
}

#[tauri::command]
pub fn crimson_toggle_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
  let autostart_manager = app.state::<tauri_plugin_autostart::AutoLaunchManager>();
  if enable {
    let _ = autostart_manager.enable();
  } else {
    let _ = autostart_manager.disable();
  }
  // Also update AppData
  let mut data = storage::load_data(&app);
  data.launch_on_startup = enable;
  storage::save_data(&app, &data);
  Ok(())
}

#[tauri::command]
pub fn crimson_toggle_server_autostart(app: tauri::AppHandle, enable: bool) -> Result<(), String> {
  // Update AppData
  let mut data = storage::load_data(&app);
  data.server_launch_on_startup = enable;
  storage::save_data(&app, &data);

  if let Some(p) = find_server_path(&app) {
      let reg_path = r"Software\Microsoft\Windows\CurrentVersion\Run";
      let exe_path = p.to_string_lossy().to_string();
      
      if enable {
          // Add registry key (User Registry for non-admin persistence)
          let _ = std::process::Command::new("reg")
              .args(["add", &format!(r"HKCU\{}", reg_path), "/v", "CrimsonServer", "/t", "REG_SZ", "/d", &exe_path, "/f"])
              .creation_flags(0x08000000) // CREATE_NO_WINDOW
              .spawn();
      } else {
          // Remove registry key
          let _ = std::process::Command::new("reg")
              .args(["delete", &format!(r"HKCU\{}", reg_path), "/v", "CrimsonServer", "/f"])
              .creation_flags(0x08000000) // CREATE_NO_WINDOW
              .spawn();
      }
      Ok(())
  } else {
      Err("Could not find server executable for autostart".to_string())
  }
}

#[tauri::command]
pub async fn crimson_restart_server(app: tauri::AppHandle) -> Result<(), String> {
    // 1. Kill current instance
    {
        let sidecar_state = app.state::<lcu_commands::SidecarChild>();
        let mut lock = sidecar_state.0.lock().await;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
        
        // Also kill by name just in case it was manual detached
        use sysinfo::{System, ProcessRefreshKind, RefreshKind};
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::new())
        );
        sys.refresh_processes();
        for process in sys.processes_by_exact_name("crimson-server.exe") {
            let _ = process.kill();
        }
    }

    // 2. Spawn fresh
    crimson_spawn_server(app.clone()).await;
    Ok(())
}

pub async fn crimson_spawn_server(handle: tauri::AppHandle) {
    use std::os::windows::process::CommandExt;
    let path_resolver = handle.path();
    let mut log_lines = Vec::new();

    // 1. Port Check
    if std::net::TcpStream::connect("127.0.0.1:40509").is_ok() {
        log_lines.push("Port 40509 busy. Skipping spawn.".to_string());
    } else {
        let mut spawn_success = false;

        // 2. Strategy A: Manual Detached (Persistence Priority)
        if let Some(p) = find_server_path(&handle) {
            const DETACHED_PROCESS: u32 = 0x00000008;
            const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
            const CREATE_NO_WINDOW: u32 = 0x08000000;

            let mut cmd = std::process::Command::new(&p);
            cmd.creation_flags(DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW);
            if let Some(parent) = p.parent() { cmd.current_dir(parent); }
            
            match cmd.spawn() {
                Ok(child) => {
                    log_lines.push(format!("SUCCESS: Manual Detached spawned from {:?}", p));
                    spawn_success = true;
                    let sidecar_state = handle.state::<lcu_commands::SidecarChild>();
                    let mut lock = sidecar_state.0.lock().await;
                    *lock = Some(child);
                },
                Err(e) => log_lines.push(format!("ERROR: Manual Detached spawn failed: {}", e)),
            }
        }

        // 3. Strategy B: Native Fallback
        if !spawn_success {
            use tauri_plugin_shell::ShellExt;
            for variant in &["bin/crimson-server", "crimson-server"] {
                if let Ok(sidecar) = handle.shell().sidecar(*variant) {
                    if let Ok(child) = sidecar.spawn() {
                        log_lines.push(format!("SUCCESS: Native Sidecar [{}] spawned.", variant));
                        // Note: sidecar.spawn() returns a different child type, 
                        // but we don't necessarily need to store it if it's managed by tauri
                        spawn_success = true;
                        break;
                    }
                }
            }
        }
    }

    // Flush logs
    if let Ok(app_data) = path_resolver.app_data_dir() {
        let log_path = app_data.join("launch_debug.log");
        if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
            use std::io::Write;
            for line in log_lines {
                let _ = writeln!(file, "[{:?}] {}", std::time::SystemTime::now(), line);
            }
        }
    }
}

fn find_server_path(app: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    let path_resolver = app.path();
    let sidecar_base = "crimson-server.exe";
    let sidecar_arch = "crimson-server-x86_64-pc-windows-msvc.exe";
    let roots = vec![
        path_resolver.resource_dir().ok(),
        path_resolver.executable_dir().ok(),
    ];
    for root in roots.into_iter().flatten() {
        for name in &[sidecar_base, sidecar_arch] {
            let p = root.join(name);
            if p.is_file() { return Some(p); }
            let p_bin = root.join("bin").join(name);
            if p_bin.is_file() { return Some(p_bin); }
        }
    }
    None
}
#[tauri::command]
pub async fn exchange_spotify_token(_app: tauri::AppHandle, code: String, client_id: String, client_secret: String) -> Result<(), String> {
    let client = reqwest::Client::new();
    let auth = base64::Engine::encode(&base64::prelude::BASE64_STANDARD, format!("{}:{}", client_id, client_secret));
    
    let params = [
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", "http://127.0.0.1:40509/callback"),
    ];

    let resp = client.post("https://accounts.spotify.com/api/token")
        .header("Authorization", format!("Basic {}", auth))
        .form(&params)
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if resp.status().is_success() {
        let json: serde_json::Value = resp.json().await.map_err(|e| e.to_string())?;
        let access_token = json["access_token"].as_str().ok_or("No access token")?;
        let refresh_token = json["refresh_token"].as_str().ok_or("No refresh token")?;
        let expires_in = json["expires_in"].as_u64().unwrap_or(3600);

        // Send to sidecar via WS
        use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
        use futures_util::SinkExt;
        use serde_json::json;

        let url = "ws://127.0.0.1:40509";
        if let Ok((mut ws_stream, _)) = connect_async(url).await {
            let msg = json!({
                "type": "SPOTIFY_AUTH",
                "access_token": access_token,
                "refresh_token": refresh_token,
                "expires_in": expires_in
            }).to_string();
            let _ = ws_stream.send(Message::Text(msg.into())).await;
        }
        Ok(())
    } else {
        Err(format!("Spotify error: {}", resp.status()))
    }
}
