use futures_util::{StreamExt, SinkExt};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::protocol::Message;
use serde_json::json;
use std::time::Duration;
use tokio::time::sleep;

pub async fn start_proxy_bridge(sd_port: u16, sd_uuid: String, sd_reg_evt: String) {
    let backend_url = "ws://127.0.0.1:40510";
    let hardware_url = format!("ws://127.0.0.1:{}", sd_port);
    let current_pid = std::process::id();
    
    println!("[PID {}] Bridge: Establishing connection between Hardware ({}) and Primary Backend ({})", current_pid, hardware_url, backend_url);

    loop {
        // 1. Connect to Hardware
        let hardware_res = connect_async(&hardware_url).await;
        if let Err(e) = hardware_res {
            eprintln!("[PID {}] Bridge: Failed to connect to Hardware: {}. Retrying in 2s...", current_pid, e);
            sleep(Duration::from_secs(2)).await;
            continue;
        }
        let (mut hw_write, mut hw_read) = hardware_res.unwrap().0.split();

        // 2. Connect to Backend
        let backend_res = connect_async(backend_url).await;
        if let Err(e) = backend_res {
            eprintln!("[PID {}] Bridge: Failed to connect to Primary Backend: {}. Retrying in 2s...", current_pid, e);
            sleep(Duration::from_secs(2)).await;
            continue;
        }
        let (mut be_write, mut be_read) = backend_res.unwrap().0.split();

        println!("[PID {}] Bridge: PLUGGED IN. Performing initial registration...", current_pid);

        // 3. Perform Initial Hardware Registration
        let reg_msg = json!({
            "event": sd_reg_evt,
            "uuid": sd_uuid
        }).to_string();
        if let Err(e) = hw_write.send(Message::Text(reg_msg.into())).await {
            eprintln!("[PID {}] Bridge: Failed initial HW register: {}", current_pid, e);
            continue;
        }

        // 4. Notify Primary Backend of this Bridge
        let notify_msg = json!({
            "type": "REGISTER_STREAMDOCK_BRIDGE",
            "uuid": sd_uuid,
            "port": sd_port
        }).to_string();
        if let Err(e) = be_write.send(Message::Text(notify_msg.into())).await {
            eprintln!("[PID {}] Bridge: Failed to notify Backend: {}", current_pid, e);
            continue;
        }

        // 5. Start the Bi-directional Pipe
        println!("[PID {}] Bridge: ACTIVE. Forwarding messages...", current_pid);
        
        let bridge_loop = async {
            loop {
                tokio::select! {
                    // Hardware -> Primary Backend (Events)
                    msg_opt = hw_read.next() => {
                        match msg_opt {
                            Some(Ok(msg)) => {
                                if msg.is_text() || msg.is_binary() {
                                    crate::storage::log_to_file("proxy.log", &format!("[PROXY -> BE] {}", msg));
                                    if let Err(e) = be_write.send(msg).await {
                                        eprintln!("[PID {}] Bridge: Error forwarding HW -> BE: {}", current_pid, e);
                                        break;
                                    }
                                }
                            }
                            _ => break,
                        }
                    }
                    // Primary Backend -> Hardware (Commands)
                    msg_opt = be_read.next() => {
                        match msg_opt {
                            Some(Ok(msg)) => {
                                if msg.is_text() || msg.is_binary() {
                                    crate::storage::log_to_file("proxy.log", &format!("[BE -> PROXY] {}", msg));
                                    if let Err(e) = hw_write.send(msg).await {
                                        eprintln!("[PID {}] Bridge: Error forwarding BE -> HW: {}", current_pid, e);
                                        break;
                                    }
                                }
                            }
                            _ => break,
                        }
                    }
                }
            }
        };

        bridge_loop.await;
        println!("[PID {}] Bridge: Connection lost. Restarting loop in 2s...", current_pid);
        sleep(Duration::from_secs(2)).await;
    }
}
