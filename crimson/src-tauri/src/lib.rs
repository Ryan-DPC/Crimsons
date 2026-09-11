use tauri::Manager;
use lcu_commands::{lcu, storage, db, SidecarChild};

mod commands;

/// Copy missing files from a legacy AppData folder into the canonical one.
/// Skips destinations that already exist so current data.json / auth.token win.
fn migrate_legacy_appdata(from: &std::path::Path, to: &std::path::Path) {
    let Ok(entries) = std::fs::read_dir(from) else { return };
    let _ = std::fs::create_dir_all(to);
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
            let _ = std::fs::copy(&src, &dest);
        }
    }
}

fn copy_dir_recursive(from: &std::path::Path, to: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(to)?;
    for entry in std::fs::read_dir(from)? {
        let entry = entry?;
        let src = entry.path();
        let dest = to.join(entry.file_name());
        if src.is_dir() {
            copy_dir_recursive(&src, &dest)?;
        } else if !dest.exists() {
            std::fs::copy(&src, &dest)?;
        }
    }
    Ok(())
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window("main_window") {
                let _ = window.unminimize();
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
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
        lcu_commands::analyzer::analyze_draft,
        db::get_all_matches,
        lcu::fetch_ddragon_url,
        lcu_commands::updater_cmd::download_and_install_update,
        commands::crimson_quit_app,
        commands::crimson_toggle_server_autostart,
        commands::crimson_get_server_autostart_info,
        commands::crimson_start_server,
        commands::crimson_stop_server,
        commands::crimson_restart_server,
        commands::exchange_spotify_token,
        commands::youtube_search,
        commands::download_music_video,
        commands::check_plugin_presence,
        commands::crimson_get_actual_server_path,
        commands::crimson_get_auth_token,
        commands::crimson_read_supabase_session,
        commands::crimson_write_supabase_session
    ])
    .setup(|app| {
      let handle = app.handle().clone();
      let path_resolver = handle.path();

      // Canonical AppData folder is com.laoy.crimsons (matches tauri.conf.json identifier).
      // One-time: merge missing files from legacy folders so they are not orphaned:
      //   - com.laoy.crimson (previous identifier, no trailing S)
      //   - com.laoy.crimons  (older typo identifier)
      if let Ok(app_data) = path_resolver.app_data_dir() {
          if let Ok(appdata) = std::env::var("APPDATA") {
              for legacy_name in ["com.laoy.crimson", "com.laoy.crimons"] {
                  let legacy_dir = std::path::PathBuf::from(&appdata).join(legacy_name);
                  if legacy_dir.exists() && legacy_dir != app_data {
                      migrate_legacy_appdata(&legacy_dir, &app_data);
                  }
              }
          }

          // 1. Initialize Log IMMEDIATELY in the correct AppData folder
          let _ = std::fs::create_dir_all(&app_data);
          let log_path = app_data.join("launch_debug.log");
          if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
              use std::io::Write;
              let _ = writeln!(file, "\n--- Crimsons Startup [{:?}] ---", std::time::SystemTime::now());
              let _ = writeln!(file, "  Resource Dir: {:?}", path_resolver.resource_dir());
              let _ = writeln!(file, "  AppData Dir:  {:?}", app_data);
          }
      }

      let data = storage::load_data(&handle);

      // Heal stale HKCU Run entries (dead debug paths, GUI --autostart, etc.).
      // Prefer crimsons-server.exe; never Vite / localhost.
      let run_stale = commands::read_server_registry_run_for_heal()
          .map(|v| !commands::run_value_points_to_existing_exe_for_heal(&v))
          .unwrap_or(false);
      if data.server_launch_on_startup || run_stale {
          match commands::ensure_server_autostart_registered(&handle) {
              Ok(()) => {}
              Err(e) => {
                  if let Ok(app_data) = path_resolver.app_data_dir() {
                      let log_path = app_data.join("launch_debug.log");
                      if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(log_path) {
                          use std::io::Write;
                          let _ = writeln!(file, "[{:?}] autostart heal failed: {}", std::time::SystemTime::now(), e);
                      }
                  }
              }
          }
      }
      
      let args: Vec<String> = std::env::args().collect();
      let is_autostart = args.contains(&"--autostart".to_string());
      
      // Restore window geometry (label must match tauri.conf.json)
      if let Some(window) = app.get_webview_window("main_window") {
          if let (Some(x), Some(y)) = (data.window_x, data.window_y) {
              let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x, y }));
          }
          if let (Some(width), Some(height)) = (data.window_width, data.window_height) {
              let _ = window.set_size(tauri::Size::Physical(tauri::PhysicalSize { width, height }));
          }
          
          if is_autostart {
              let _ = window.hide();
          }
      }

      let quit_i = tauri::menu::MenuItem::with_id(app, "quit", "Quitter Crimsons", true, None::<&str>)?;
      let show_i = tauri::menu::MenuItem::with_id(app, "show", "Panneau de Controle", true, None::<&str>)?;
      let menu = tauri::menu::Menu::with_items(app, &[&show_i, &quit_i])?;

      let mut tray_builder = tauri::tray::TrayIconBuilder::new()
        .menu(&menu)
        .tooltip("Crimsons")
        .show_menu_on_left_click(true);

      if let Some(icon) = app.default_window_icon() {
          tray_builder = tray_builder.icon(icon.clone());
      }

      let _tray = tray_builder
        .on_menu_event(|app, event| match event.id().as_ref() {
            "quit" => {
                let app_c = app.clone();
                tauri::async_runtime::spawn(async move {
                    crate::commands::crimson_quit_app(app_c).await;
                });
            }
            "show" => {
                if let Some(window) = app.get_webview_window("main_window") {
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
                if let Some(window) = app.get_webview_window("main_window") {
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

      // Launch Sidecar Logic (v1.6.5 Persistence Priority)
      let sidecar_child = std::sync::Arc::new(tokio::sync::Mutex::new(None));
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

        let url = match crimson_server::auth::read_token() {
            Some(t) if !t.is_empty() => format!("ws://127.0.0.1:40510/?token={}", t),
            _ => "ws://127.0.0.1:40510".to_string(),
        };
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

