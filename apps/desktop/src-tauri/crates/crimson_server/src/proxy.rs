use futures_util::StreamExt;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use std::sync::Arc;
use crate::spotify::SpotifyService;
use crate::streamdock;

pub async fn start_proxy_bridge(sd_port: u16, sd_uuid: String, sd_reg_evt: String) {
    let backend_url = "ws://127.0.0.1:40509";
    println!("Proxy Mode: Connecting to Main Server at {}", backend_url);

    let (tx, _rx_events) = tokio::sync::broadcast::channel(100);
    let sender = crate::events::WsSender(tx);
    let spotify = Arc::new(SpotifyService::new(sender));

    // Connect to Main Backend
    let (mut backend_ws, _) = match connect_async(backend_url).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Proxy Mode: Failed to connect to Main Server: {}. Is the main Crimson app running?", e);
            return;
        }
    };

    println!("Proxy Mode: Connected to Main Server. Acting as bridge.");

    // Spawn task to forward backend events to our local "mock" spotify service
    let spotify_mock = spotify.clone();
    tokio::spawn(async move {
        while let Some(msg_res) = backend_ws.next().await {
            if let Ok(Message::Text(text)) = msg_res {
                // Forward the raw JSON event to our local subscribers (like the streamdock_client)
                let _ = spotify_mock.broadcast_external_event(text.to_string());
            }
        }
    });

    // Start the standard streamdock client logic using our mock service
    streamdock::start_streamdock_client(sd_port, sd_uuid, sd_reg_evt, spotify).await;
}
