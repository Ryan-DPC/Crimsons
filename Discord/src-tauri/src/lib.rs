#[cfg_attr(mobile, tauri::mobile_entry_point)]
mod lcu;
mod storage;
mod service;
mod ws;
mod analyzer;
mod ugg;
mod db;

use tauri::Manager;

pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
        lcu::get_lcu_info,
        lcu::lcu_request,
        storage::get_app_data,
        storage::set_app_data,
        storage::set_auto_accept,
        storage::set_player_note,
        analyzer::fetch_dynamic_runes,
        ugg::fetch_ugg_data,
        db::get_all_matches
    ])
    .setup(|app| {
      db::init_db(app.handle()).expect("failed to initialize database");
      let (tx, _) = tokio::sync::broadcast::channel(100);
      app.manage(crate::ws::WsSender(tx));

      let handle = app.handle().clone();
      
      // Force auto_accept to true on startup
      let mut data = storage::load_data(&handle);
      data.auto_accept = true;
      storage::save_data(&handle, &data);

      service::start_auto_accept_service(handle.clone());

      tauri::async_runtime::spawn(async move {
          crate::ws::start_ws_server(handle).await;
      });
      
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
