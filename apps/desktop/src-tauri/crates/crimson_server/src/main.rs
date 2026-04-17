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
    let mut info = None;

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
                if i + 1 < env_args.len() { info = Some(env_args[i + 1].clone()); i += 1; }
            }
            _ => {}
        }
        i += 1;
    }

    if is_streamdock_plugin {
        println!("Starting in StreamDock Plugin Mode...");
        // In plugin mode, we don't care about single instance checking, 
        // because StreamDock launches us as a background sidecar.
        let (tx, _) = broadcast::channel(100);
        let sender = WsSender(tx);
        let spotify_service = Arc::new(spotify::SpotifyService::new(sender.clone()));
        // Note: we don't need polling since the main server instance probably does it,
        // but let's start it just in case this is running standalone.
        spotify_service.start_background_polling().await;

        if let (Some(p), Some(uuid), Some(reg_evt)) = (port, plugin_uuid, register_event) { // Use matched string to avoid variable collision
            crimson_server::streamdock::start_streamdock_client(p, uuid, reg_evt, spotify_service).await;
        }
        return Ok(());
    }

    let instance = single_instance::SingleInstance::new("com.laoy.crimson.server").unwrap();
    if !instance.is_single() {
        eprintln!("Another instance of Crimson Server is already running. Exiting.");
        return Ok(());
    }

    let _args = Args::parse();
    println!("Starting Crimson Phantom Server...");

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

    // Start External WebSocket Server (Sidecar -> UI/StreamDeck)
    println!("WebSocket server listening on 127.0.0.1:40509");
    ws::start_ws_server(sender, spotify_service).await;

    Ok(())
}
