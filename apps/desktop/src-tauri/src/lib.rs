use tauri::Manager;
use lcu_commands::{lcu, storage, db, SidecarChild};

mod commands;

pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_updater::Builder::new().build())
    .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--autostart"])))
    .plugin(tauri_plugin_notification::init())
    .plugin(tauri_plugin_shell::init())
    .invoke_handler(tauri::generate_handler![
        lcu::get_lcu_info,
        lcu::lcu_request,
        lcu::debug_lcu,
        storage::get_app_data,
        storage::set_app_data,
        storage::set_auto_accept,
        storage::set_player_note,
        lcu_commands::analyzer::fetch_single_build,
        lcu_commands::analyzer::fetch_dynamic_runes,
        db::get_all_matches,
        lcu::fetch_ddragon_url,
        lcu_commands::updater_cmd::download_and_install_update,
        commands::crimson_quit_app,
        commands::crimson_toggle_autostart,
        commands::exchange_spotify_token
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      let path_resolver = handle.path();

      // Autostart Logic
      let autostart_manager = app.state::<tauri_plugin_autostart::AutoLaunchManager>();
      let data = storage::load_data(&handle);
      if data.launch_on_startup {
          let _ = autostart_manager.enable();
      }

      // Check if started via autostart to start minimized
      let args: Vec<String> = std::env::args().collect();
      if args.iter().any(|a| a == "--autostart") {
          if let Some(window) = app.get_webview_window("main") {
              let _ = window.hide();
          }
      }
      
      // 1. Initialize Log IMMEDIATELY in the correct AppData folder
      if let Ok(app_data) = path_resolver.app_data_dir() {
          let _ = std::fs::create_dir_all(&app_data);
          let log_path = app_data.join("launch_debug.log");
          if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
              use std::io::Write;
              let _ = writeln!(file, "\n--- Crimson Startup [{:?}] ---", std::time::SystemTime::now());
              let _ = writeln!(file, "  Resource Dir: {:?}", path_resolver.resource_dir());
              let _ = writeln!(file, "  AppData Dir:  {:?}", app_data);
          }
      }

      let data = storage::load_data(&handle);
      // Restore window geometry
      if let Some(window) = app.get_webview_window("main") {
          if let (Some(x), Some(y)) = (data.window_x, data.window_y) {
              let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
          }
          if let (Some(width), Some(height)) = (data.window_width, data.window_height) {
              let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
          }
      }

      let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quitter Crimson", true, None::<&str>)?;
      let show_i = tauri::menu::MenuItem::with_id(app, "show", "Panneau de Controle", true, None::<&str>)?;
      let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

      let mut tray_builder = tauri::tray::TrayIconBuilder::new()
        .menu(&menu)
        .show_menu_on_left_click(true);

      if let Some(icon) = app.default_window_icon() {
          tray_builder = tray_builder.icon(icon.clone());
      }

      let _tray = tray_builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                crate::commands::crimson_quit_app(app.clone());
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = notify_server_resource_mode(false);
                }
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                let app = tray.app_handle();
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                    let _ = notify_server_resource_mode(false);
                }
            }
        })
        .build(app)?;

      let pool = db::create_pool(app.handle());
      if let Err(e) = db::init_db(&pool) {
          eprintln!("Failed to initialize database: {}", e);
      }
      app.manage(pool);

      let (tx, _) = tokio::sync::broadcast::channel(100);
      app.manage(lcu_commands::events::WsSender(tx));

      let handle_c = handle.clone();
      
      // Force auto_accept to true on startup
      let mut data = storage::load_data(&handle_c);
      data.auto_accept = true;
      storage::save_data(&handle_c, &data);

      // Launch Sidecar Logic (v1.6.5 Persistence Priority)
      let sidecar_child = std::sync::Arc::new(tokio::sync::Mutex::new(None));
      let sidecar_handle = handle_c.clone();
      tauri::async_runtime::spawn(async move {
          use std::os::windows::process::CommandExt;
          let path_resolver = sidecar_handle.path();
          let mut log_lines = Vec::new();

          // 1. CLEANUP: Clear any hung processes (Native & Silent)
          {
              use sysinfo::{System, ProcessRefreshKind, RefreshKind};
              let mut sys = System::new_with_specifics(
                  RefreshKind::new().with_processes(ProcessRefreshKind::new())
              );
              sys.refresh_processes();
              for process in sys.processes_by_exact_name("crimson-server.exe") {
                  let _ = process.kill();
              }
          }
          log_lines.push("Cleanup: native sysinfo finish.".to_string());

          // 2. Port Check
          if std::net::TcpStream::connect("127.0.0.1:40509").is_ok() {
              log_lines.push("Port 40509 busy. Skipping spawn.".to_string());
          } else {
              let mut spawn_success = false;

              // 3. Strategy A: Manual Detached (Persistence Priority)
              let sidecar_base = "crimson-server.exe";
              let sidecar_arch = "crimson-server-x86_64-pc-windows-msvc.exe";
              let find_direct_path = || -> Option<std::path::PathBuf> {
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
              };

              if let Some(p) = find_direct_path() {
                  const DETACHED_PROCESS: u32 = 0x00000008;
                  const CREATE_BREAKAWAY_FROM_JOB: u32 = 0x01000000;
                  const CREATE_NO_WINDOW: u32 = 0x08000000;

                  let mut cmd = std::process::Command::new(&p);
                  cmd.creation_flags(DETACHED_PROCESS | CREATE_BREAKAWAY_FROM_JOB | CREATE_NO_WINDOW);
                  
                  // Ensure current directory is same as binary for local resource access
                  if let Some(parent) = p.parent() {
                      cmd.current_dir(parent);
                  }
                  match cmd.spawn() {
                      Ok(_) => {
                          log_lines.push(format!("SUCCESS: Manual Detached spawned from {:?}", p));
                          spawn_success = true;
                      },
                      Err(e) => log_lines.push(format!("ERROR: Manual Detached spawn failed: {}", e)),
                  }
              }

              // 4. Strategy B: Native Fallback
              if !spawn_success {
                  use tauri_plugin_shell::ShellExt;
                  for variant in &["bin/crimson-server", "crimson-server"] {
                      if let Ok(sidecar) = sidecar_handle.shell().sidecar(*variant) {
                          if let Ok(_) = sidecar.spawn() {
                              log_lines.push(format!("SUCCESS: Native Sidecar [{}] spawned.", variant));
                              spawn_success = true;
                              break;
                          }
                      }
                  }
              }

              if !spawn_success {
                  log_lines.push("CRITICAL: All spawn strategies failed.".to_string());
              }
          }

          // Flush logs to AppData
          if let Ok(app_data) = path_resolver.app_data_dir() {
              let log_path = app_data.join("launch_debug.log");
              if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                  use std::io::Write;
                  for line in log_lines {
                      let _ = writeln!(file, "[{:?}] {}", std::time::SystemTime::now(), line);
                  }
              }
          }
      });
      
      app.manage(SidecarChild(sidecar_child));

      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .on_window_event(|window, event| {
        match event {
            tauri::WindowEvent::Focused(focused) => {
                let _ = notify_server_resource_mode(!focused);
            }
            tauri::WindowEvent::Resized(size) => {
                let handle = window.app_handle();
                let mut data = storage::load_data(handle);
                data.window_width = Some(size.width);
                data.window_height = Some(size.height);
                storage::save_data(handle, &data);
            }
            tauri::WindowEvent::Moved(pos) => {
                let handle = window.app_handle();
                let mut data = storage::load_data(handle);
                data.window_x = Some(pos.x);
                data.window_y = Some(pos.y);
                storage::save_data(handle, &data);
            }
            _ => {}
        }
    })
    .build(tauri::generate_context!())
    .expect("error while building tauri application")
    .run(|_app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            // Decoupled: Server stays running in background.
            // No kill() call here.
        }
    });
}

fn notify_server_resource_mode(low: bool) -> Result<(), String> {
    tauri::async_runtime::spawn(async move {
        use tokio_tungstenite::{connect_async, tungstenite::protocol::Message};
        use futures_util::SinkExt;
        use serde_json::json;

        let url = "ws://127.0.0.1:40509";
        if let Ok((mut ws_stream, _)) = connect_async(url).await {
            let msg = json!({
                "type": "UPDATE_RESOURCE_MODE",
                "low_resource": low
            }).to_string();
            let _ = ws_stream.send(Message::Text(msg.into())).await;
        }
    });
    Ok(())
}

