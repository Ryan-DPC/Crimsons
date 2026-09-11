#![windows_subsystem = "windows"]

use tokio::sync::broadcast;
use std::sync::Arc;
use crimson_server::events::WsSender;
use crimson_server::{ws, lcu_ws, service, spotify, discord, lcu, hue, twitch, updater, auth};
use serde_json::json;
use tracing_subscriber::EnvFilter;
use tracing_appender::rolling;


#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. Setup Tracing
    let log_dir = crimson_server::storage::get_data_dir();
    let file_appender = rolling::daily(log_dir, "crimson-server.log");
    let (non_blocking, _guard) = tracing_appender::non_blocking(file_appender);

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive(tracing::Level::INFO.into()))
        .with_writer(non_blocking)
        .init();

    std::panic::set_hook(Box::new(|info| {
        // Chemin resolu a l'execution : le chemin en dur pointait vers le
        // dossier d'un poste precis, donc n'ecrivait rien ailleurs et exposait
        // un nom d'utilisateur dans le binaire distribue.
        let msg = format!("CRITICAL PANIC: {:?}", info);
        let path = crimson_server::storage::get_data_dir().join("panic.log");
        let _ = std::fs::write(path, &msg);
    }));

    // Un binaire de developpement ne doit jamais tourner en dehors du
    // developpement. Sans ce garde-fou il suffisait qu'il tourne au moment
    // d'une extinction : Windows le restaurait a la session suivante, il
    // prenait le port 40510 avant l'installation reelle, et le mutex
    // Global\crimson_server_v2_lock empechait ensuite le vrai serveur de
    // demarrer. Le tout sans la moindre erreur visible.
    if cfg!(debug_assertions) && std::env::var("CRIMSON_DEV").as_deref() != Ok("1") {
        // tracing may not flush before exit; leave a breadcrumb next to logs.
        let msg = "Build de developpement lance hors contexte de developpement : arret. \
             Definissez CRIMSON_DEV=1 pour l'executer volontairement.";
        let path = crimson_server::storage::get_data_dir().join("panic.log");
        let _ = std::fs::write(
            path,
            format!("SIDECAR REFUSED TO START: {}\n", msg),
        );
        tracing::warn!("{}", msg);
        return Ok(());
    }

    tracing::info!("--- SERVER'S STARTUP ---");

    let mut is_streamdock_plugin = false;
    let mut port = None;
    let mut plugin_uuid = None;
    let mut register_event = None;

    let env_args: Vec<String> = std::env::args().collect();
    let mut i = 0;
    while i < env_args.len() {
        match env_args[i].as_str() {
            "-port" => {
                is_streamdock_plugin = true;
                if i + 1 < env_args.len() { port = env_args[i + 1].parse::<u16>().ok(); i += 1; }
            }
            "-pluginUUID" => {
                if i + 1 < env_args.len() { plugin_uuid = Some(env_args[i + 1].clone()); i += 1; }
            }
            "-registerEvent" => {
                if i + 1 < env_args.len() { register_event = Some(env_args[i + 1].clone()); i += 1; }
            }
            "-info" => {
                if i + 1 < env_args.len() { i += 1; }
            }
            _ => {}
        }
        i += 1;
    }


    let listen_port = 40510;
    let lock_name = "Global\\crimson_server_v2_lock";
    let current_pid = std::process::id();

    // 2. Mutex Check
    let instance_result = single_instance::SingleInstance::new(lock_name);
    let is_primary = match instance_result {
        Ok(ref inst) => inst.is_single(),
        Err(e) => {
            tracing::error!("Failed to create SingleInstance mutex: {:?}", e);
            true // Fallback to primary if mutex creation fails
        }
    };

    tracing::info!("Mutex initialized, is_primary: {}", is_primary);



    tracing::info!("Port checked, is_primary: {}", is_primary);

    if !is_primary {
        if is_streamdock_plugin {
            tracing::info!("[PID {}] Primary instance detected. Entering Handover mode...", current_pid);
            if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) { 
                crimson_server::proxy::start_proxy_bridge(p, uuid, reg_evt).await;
            }
            return Ok(());
        } else {
            tracing::info!("[PID {}] Another instance is already running. Exiting.", current_pid);
            return Ok(());
        }
    }

    tracing::info!("[PID {}] Starting Server's (PRIMARY) on port {}...", current_pid, listen_port);

    // 4. Generate Auth Token
    let _auth_token = auth::generate_and_save_token();

    tracing::info!("Auth token generated");

    // 5. Setup broadcast channel for internal communications
    let (tx, _) = broadcast::channel(100);
    let sender = WsSender(tx);
    // L'UI doit apprendre les renouvellements de session faits par le sidecar
    // (autostart / JWT expire pendant que la fenetre est cachee). Sans cela
    // supabase-js rejoue l'ancien refresh et GoTrue deconnecte l'utilisateur.
    crimson_server::entitlement::set_ws_sender(sender.0.clone());

    tracing::info!("Initializing DB");

    // 6. Initialize DB (v1.2.1)
    let db_result = crimson_server::db::StreamDockDB::init();
    let db = match db_result {
        Ok(db) => Arc::new(db),
        Err(e) => {
            tracing::error!("Failed to init StreamDock DB: {:?}", e);
            return Err(e.into());
        }
    };
    
    tracing::info!("DB initialized");

    // 7. Initialize Services (Monolithic)
    
    // Load config to check which plugins are enabled
    let app_data = crimson_server::storage::load_data_from_path(crimson_server::storage::get_data_path_from_env());
    let mut plugins_map = std::collections::HashMap::new();
    if let Some(plugins) = app_data.other.get("plugins") {
        if let Some(obj) = plugins.as_object() {
            for (k, v) in obj {
                if let Some(b) = v.as_bool() {
                    plugins_map.insert(k.clone(), b);
                }
            }
        }
    }
    
    let is_lol_enabled_val = *plugins_map.get("leagueOfLegends").unwrap_or(&true);

    let is_lol_enabled = Arc::new(std::sync::atomic::AtomicBool::new(is_lol_enabled_val));
    let is_auto_accept_enabled = Arc::new(std::sync::atomic::AtomicBool::new(app_data.auto_accept));

    crimson_server::process_scanner::start_process_scanner().await;
    
    // ALWAYS start League of Legends loops (they will internally pause if !is_lol_enabled)
    service::start_auto_accept_service(sender.clone(), is_lol_enabled.clone(), is_auto_accept_enabled.clone());
    let lcu_sender = sender.clone();
    let lcu_enabled_clone = is_lol_enabled.clone();
    tokio::spawn(async move { lcu_ws::start_lcu_ws(lcu_sender, lcu_enabled_clone).await; });

    // Les services premium demarrent desactives. C'est entitlement::start_guard
    // qui les allumera une fois les droits confirmes aupres de Supabase :
    // data.json ne peut plus servir a les activer.
    let s = Arc::new(spotify::SpotifyService::new(sender.clone()));
    let d = Arc::new(discord::DiscordService::new(sender.clone()));
    let h = Arc::new(hue::HueService::new(sender.clone()));
    let t = Arc::new(twitch::TwitchService::new(sender.clone()));

    crimson_server::entitlement::start_guard(vec![
        ("spotify", s.is_enabled.clone()),
        ("discord", d.is_enabled.clone()),
        // Hue / Twitch stay out of the entitlement guard until their APIs exist.
    ]);

    let hotkey_manager = crimson_server::hotkeys::HotkeyManager::new(sender.clone(), s.clone(), d.clone());
    let hm_poll = Arc::new(hotkey_manager);
    tokio::spawn(async move { hm_poll.start_listening().await; });

    // ALWAYS start background polling for all services (hot-reload handles pause)
    tracing::info!("Starting Spotify Service");
    let s_poll = s.clone();
    tokio::spawn(async move { s_poll.start_background_polling().await; });
    
    tracing::info!("Starting Discord Service");
    let d_poll = d.clone();
    tokio::spawn(async move { d_poll.start_background_polling().await; });
    
    // Hue / Twitch stubs register for WS dispatch but stay unavailable.
    tracing::info!("Twitch Service stub loaded (coming soon)");
    let t_poll = t.clone();
    tokio::spawn(async move { t_poll.start_background_polling().await; });
    
    tracing::info!("Hue Service stub loaded (coming soon)");
    
    updater::start_background_updater().await;

    let hb_sender = sender.clone();
    let d_hb = d.clone();
    let is_lol_enabled_hb = is_lol_enabled.clone();
    tokio::spawn(async move {
        loop {
            let hb = json!({
                "type": "HEARTBEAT_STATUS",
                "server": true,
                "lol": is_lol_enabled_hb.load(std::sync::atomic::Ordering::Relaxed) && lcu::is_lcu_connected(),
                "discord": d_hb.is_enabled.load(std::sync::atomic::Ordering::Relaxed) && d_hb.is_connected().await,
            }).to_string();
            let _ = hb_sender.0.send(hb);
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    });

    let spotify_service = Some(s.clone());
    let discord_service = Some(d.clone());
    let hue_service = Some(h.clone());
    let twitch_service = Some(t.clone());

    // If we were ALSO started with StreamDock flags, start the bridge too
    if is_streamdock_plugin {
        if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) {
            let db_clone = db.clone();
            tokio::spawn(async move {
                crimson_server::streamdock::start_streamdock_client(p, uuid, reg_evt, s, d, h, t, db_clone).await;
            });
        }
    }

    // 8. Start External WebSocket Server
    tracing::info!("WebSocket server listening on 127.0.0.1:{}", listen_port);
    ws::start_ws_server_modular(listen_port, sender, spotify_service, discord_service, hue_service, twitch_service, db, is_lol_enabled.clone(), is_auto_accept_enabled.clone()).await;

    Ok(())
}
