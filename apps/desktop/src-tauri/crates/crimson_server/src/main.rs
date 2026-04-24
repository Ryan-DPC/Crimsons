use tokio::sync::broadcast;
use std::sync::Arc;
use crimson_server::events::WsSender;
use crimson_server::{ws, lcu_ws, service, spotify, discord, lcu};
use serde_json::json;

use clap::Parser;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Args {
    #[arg(long)]
    parent_pid: Option<u32>,

    #[arg(long)]
    data_path: Option<String>,
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
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

    let current_pid = std::process::id();
    
    // 1. Mutex Check (Global namespace to catch cross-session/elevated instances)
    let instance = single_instance::SingleInstance::new("Global\\crimson_server_v1_lock").unwrap();
    let mut is_primary = instance.is_single();

    // 2. Port Probe Fallback (If port 40510 is busy, another instance is definitely primary)
    if is_primary {
        use std::net::TcpStream;
        if TcpStream::connect("127.0.0.1:40510").is_ok() {
            println!("[PID {}] Port 40510 is busy. Mutex might have failed. Forcing proxy/exit mode...", current_pid);
            is_primary = false;
        }
    }

    if !is_primary {
        if is_streamdock_plugin {
            println!("[PID {}] Primary instance detected via Lock/Port. Entering Handover mode...", current_pid);
            if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) { 
                crimson_server::proxy::start_proxy_bridge(p, uuid, reg_evt).await;
            }
            return Ok(());
        } else {
            println!("[PID {}] Another instance is already running (Detected via Lock/Port). Exiting.", current_pid);
            return Ok(());
        }
    }

    println!("[PID {}] Starting Crimson Phantom Server (PRIMARY)...", current_pid);
    
    // Log primary status to file for diagnostics
    let log_path = crimson_server::storage::get_data_dir().join("streamdock.log");
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&log_path) {
        use std::io::Write;
        let _ = writeln!(f, "\n--- CRIMSON SERVER STARTUP (PID {}) ---", current_pid);
        let _ = writeln!(f, "[System] Initializing primary services...");
    }

    // Setup broadcast channel for internal communications
    let (tx, _) = broadcast::channel(100);
    let sender = WsSender(tx);

    // Start Auto-Accept and State Broadcasting Service
    service::start_auto_accept_service(sender.clone());

    // Start LCU WebSocket Listener (Sidecar -> LCU)
    let lcu_sender = sender.clone();
    tokio::spawn(async move {
        lcu_ws::start_lcu_ws(lcu_sender).await;
    });

    // Start Spotify Service
    let spotify_service = Arc::new(spotify::SpotifyService::new(sender.clone()));
    let spotify_poll = spotify_service.clone();
    tokio::spawn(async move {
        spotify_poll.start_background_polling().await;
    });

    // Start Mirabox Auth Server (Port 26433) for hijacking third-party Spotify plugins
    let spotify_auth = spotify_service.clone();
    tokio::spawn(async move {
        crimson_server::streamdock::start_mirabox_auth_server(spotify_auth, None, None).await;
    });

    // Start Discord Service
    let discord_service = Arc::new(discord::DiscordService::new(sender.clone()));
    let discord_poll = discord_service.clone();
    tokio::spawn(async move {
        discord_poll.start_background_polling().await;
    });

    // Start Heartbeat Service (Broadcasts 5s server/lcu/discord status)
    let hb_sender = sender.clone();
    let hb_discord = discord_service.clone();
    tokio::spawn(async move {
        loop {
            let hb = json!({
                "type": "HEARTBEAT_STATUS",
                "server": true,
                "lol": lcu::is_lcu_connected(),
                "discord": hb_discord.is_connected().await
            }).to_string();
            let _ = hb_sender.0.send(hb);
            tokio::time::sleep(tokio::time::Duration::from_secs(5)).await;
        }
    });


    // If we were ALSO started with StreamDock flags, start the bridge too
    if is_streamdock_plugin {
        if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) {
            let spotify_clone = spotify_service.clone();
            let discord_clone = discord_service.clone();
            tokio::spawn(async move {
                crimson_server::streamdock::start_streamdock_client(p, uuid, reg_evt, spotify_clone, discord_clone).await;
            });
        }
    }


    // Start External WebSocket Server (Sidecar -> UI/StreamDeck)
    println!("WebSocket server listening on 127.0.0.1:40510");
    ws::start_ws_server(sender, spotify_service, discord_service).await;


    Ok(())
}
