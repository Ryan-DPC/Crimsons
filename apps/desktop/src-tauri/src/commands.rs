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
