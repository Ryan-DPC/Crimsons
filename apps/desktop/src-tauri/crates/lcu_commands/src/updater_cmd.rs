use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use sysinfo::{System, ProcessRefreshKind, RefreshKind};

#[tauri::command]
pub async fn download_and_install_update(app: AppHandle, _url: String) -> Result<(), String> {
    let update = app.updater().map_err(|e| e.to_string())?
        .check().await.map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    let mut downloaded = 0;

    // Download the update
    let app_c = app.clone();
    let bytes = update.download(
        move |chunk_len, total_len| {
            downloaded += chunk_len;
            let _ = app_c.emit("update-progress", serde_json::json!({
                "downloaded": downloaded,
                "total": total_len.unwrap_or(0)
            }));
        },
        || {
            // on_download_finished
        }
    ).await.map_err(|e| e.to_string())?;

    // --- CRITICAL CLEANUP ---
    // Kill ALL instances of the sidecar by name using sysinfo.
    // This is more robust than just killing the one in state because
    // there might be orphaned or detached processes locking the binary.
    {
        let mut sys = System::new_with_specifics(
            RefreshKind::new().with_processes(ProcessRefreshKind::new())
        );
        sys.refresh_processes();
        
        // Match both 'crimson-server' and 'crimson-server.exe'
        for process in sys.processes().values() {
            let name = process.name().to_lowercase();
            if name.contains("crimson-server") {
                let _ = process.kill();
            }
        }
        
        // Also take the one in state just in case it's a direct child we have a handle for
        let sidecar_state = app.state::<crate::SidecarChild>();
        let mut lock = sidecar_state.0.lock().await;
        if let Some(mut child) = lock.take() {
            let _ = child.kill();
        }
    }

    // Give the OS 500ms to release file locks
    tokio::time::sleep(std::time::Duration::from_millis(500)).await;

    update.install(bytes).map_err(|e| e.to_string())?;

    Ok(())
}
