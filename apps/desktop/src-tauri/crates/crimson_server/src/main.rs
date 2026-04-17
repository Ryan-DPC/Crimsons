use tokio::sync::broadcast;
use std::sync::Arc;
use crimson_server::events::WsSender;
use crimson_server::{ws, lcu_ws, service, spotify};
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

    let instance = single_instance::SingleInstance::new("com.laoy.crimson.server").unwrap();
    let is_primary = instance.is_single();

    if !is_primary {
        if is_streamdock_plugin {
            println!("Another instance running. Starting in StreamDock PROXY Mode...");
            if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) { 
                crimson_server::proxy::start_proxy_bridge(p, uuid, reg_evt).await;
            }
            return Ok(());
        } else {
            eprintln!("Another instance of Crimson Server is already running. Exiting.");
            return Ok(());
        }
    }

    println!("Starting Crimson Phantom Server (Primary)...");

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
    spotify_service.start_background_polling().await;

    // If we were ALSO started with StreamDock flags, start the bridge too
    if is_streamdock_plugin {
        if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) {
            let spotify_clone = spotify_service.clone();
            tokio::spawn(async move {
                crimson_server::streamdock::start_streamdock_client(p, uuid, reg_evt, spotify_clone).await;
            });
        }
    }

    // Start External WebSocket Server (Sidecar -> UI/StreamDeck)
    println!("WebSocket server listening on 127.0.0.1:40509");
    ws::start_ws_server(sender, spotify_service).await;

    Ok(())
}
