use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use serde_json::json;
use std::time::Duration;
use tokio::time::{sleep, timeout};

pub async fn start_proxy_bridge(sd_port: u16, sd_uuid: String, sd_reg_evt: String) {
    let backend_url = "ws://127.0.0.1:40509";
    let current_pid = std::process::id();
    println!("[PID {}] Handover: Connecting to Primary Server at {}...", current_pid, backend_url);

    // Initial connection with retries (primary might still be starting)
    let mut backend_ws = None;
    for attempt in 1..=5 {
        match connect_async(backend_url).await {
            Ok((s, _)) => {
                backend_ws = Some(s);
                break;
            }
            Err(e) => {
                if attempt == 5 {
                    eprintln!("[PID {}] Handover: Failed after 5 attempts: {}. Primary server unreachable.", current_pid, e);
                    return;
                }
                println!("[PID {}] Handover: Connection attempt {} failed, retrying in 1s...", current_pid, attempt);
                sleep(Duration::from_secs(1)).await;
            }
        }
    }

    let mut backend_ws = backend_ws.unwrap();
    println!("[PID {}] Handover: Connected. Sending registration context...", current_pid);

    // Perform handover with a strict 10s timeout to prevent zombie processes
    let handover_future = async {
        // Send the registration info to the primary server
        let reg_msg = json!({
            "type": "REGISTER_STREAMDOCK",
            "port": sd_port,
            "uuid": sd_uuid,
            "register_event": sd_reg_evt
        }).to_string();

        if let Err(e) = backend_ws.send(Message::Text(reg_msg.into())).await {
            eprintln!("[PID {}] Handover: Failed to send registration: {}", current_pid, e);
            return;
        }

        // Wait for acknowledgment then exit
        while let Some(msg_res) = backend_ws.next().await {
            if let Ok(Message::Text(text)) = msg_res {
                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                    if value["type"] == "COMMAND_ACK" && value["action"] == "REGISTER_STREAMDOCK" {
                        println!("[PID {}] Handover SUCCESSFUL. Primary server is now managing the hardware connection.", current_pid);
                        return;
                    }
                }
            }
        }
    };

    if let Err(_) = timeout(Duration::from_secs(10), handover_future).await {
        eprintln!("[PID {}] Handover: TIMED OUT after 10s. Forcing exit to prevent zombie process.", current_pid);
    }
}
