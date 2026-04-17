use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use serde_json::json;

pub async fn start_proxy_bridge(sd_port: u16, sd_uuid: String, sd_reg_evt: String) {
    let backend_url = "ws://127.0.0.1:40509";
    println!("Proxy Mode: Connecting to Main Server at {}", backend_url);

    // Connect to Main Backend
    let (mut backend_ws, _) = match connect_async(backend_url).await {
        Ok(s) => s,
        Err(e) => {
            eprintln!("Proxy Mode: Failed to connect to Main Server: {}. Is the main Crimson app running?", e);
            return;
        }
    };

    println!("Proxy Mode: Connected to Main Server. Performing handover...");

    // Send the registration info to the primary server
    let reg_msg = json!({
        "type": "REGISTER_STREAMDOCK",
        "port": sd_port,
        "uuid": sd_uuid,
        "register_event": sd_reg_evt
    }).to_string();

    let _ = backend_ws.send(Message::Text(reg_msg.into())).await;

    // Wait for acknowledgment then exit
    while let Some(msg_res) = backend_ws.next().await {
        if let Ok(Message::Text(text)) = msg_res {
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                if value["type"] == "COMMAND_ACK" && value["action"] == "REGISTER_STREAMDOCK" {
                    println!("Handover successful! Primary server is now managing the StreamDock connection.");
                    println!("Exiting secondary process.");
                    break;
                }
            }
        }
    }
}
