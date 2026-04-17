use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use serde_json::json;
use std::sync::Arc;
use crate::storage;
use crate::events::WsSender;
use crate::sd_commands::StreamDeckCommand;
use crate::spotify::SpotifyService;

pub async fn start_ws_server(sender: WsSender, spotify_service: Arc<SpotifyService>) {
    let addr = "127.0.0.1:40509".parse::<SocketAddr>().expect("Invalid address");
    if let Ok(listener) = TcpListener::bind(&addr).await {
        while let Ok((stream, _)) = listener.accept().await {
            let sender_clone = WsSender(sender.0.clone());
            let spotify_clone = spotify_service.clone();
            tokio::spawn(async move {
                // Peek for HTTP GET
                let mut buffer = [0; 1024];
                if stream.peek(&mut buffer).await.is_ok() {
                    let request = String::from_utf8_lossy(&buffer);
                    if request.starts_with("GET /callback") {
                        // Extract code from query
                        if let Some(code_start) = request.find("code=") {
                            let code = request[code_start + 5..].split_whitespace().next().unwrap_or("");
                            let code = code.split('&').next().unwrap_or(code);
                            
                            // Broadcast the code to the UI
                            let _ = sender_clone.0.send(json!({
                                "type": "SPOTIFY_CALLBACK_CODE",
                                "code": code
                            }).to_string());
                            
                            // Send a "Success" HTML response
                            use tokio::io::AsyncWriteExt;
                            let response = "HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n<html><body style='background:#111;color:white;font-family:sans-serif;display:flex;justify-content:center;align-items:center;height:100vh;'><div><h1>Spotify Connected!</h1><p>You can close this window now.</p></div></body></html>";
                            let mut stream = stream;
                            let _ = stream.write_all(response.as_bytes()).await;
                            return;
                        }
                    }
                }
                handle_connection(stream, sender_clone, spotify_clone).await;
            });
        }
    }
}

async fn handle_connection(stream: TcpStream, sender: WsSender, spotify: Arc<SpotifyService>) {
    if let Ok(mut ws_stream) = accept_async(stream).await {
        println!("Client connected to WebSocket server");
        
        let data = storage::load_data_from_path(storage::get_data_path_from_env());
        let initial_state = json!({
            "type": "AUTO_ACCEPT_STATE",
            "enabled": data.auto_accept
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(initial_state.to_string().into())).await;

        if let Some(last_rank) = data.other.get("last_rank") {
            let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(last_rank.to_string().into())).await;
        }

        let mut rx = sender.0.subscribe();

        loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(msg)) => {
                            if let Ok(text) = msg.into_text() {
                                if text.trim().is_empty() { continue; }
                                // Parse Command and Dispatch
                                if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                                    if value["type"] == "UPDATE_RESOURCE_MODE" {
                                        if let Some(low) = value["low_resource"].as_bool() {
                                            crate::state::set_low_resource_mode(low);
                                            println!("Resource optimization: {}", if low { "ENABLED" } else { "DISABLED" });
                                        }
                                        continue;
                                    }

                                    if value["type"] == "SPOTIFY_AUTH" {
                                        if let (Some(access), Some(refresh)) = (value["access_token"].as_str(), value["refresh_token"].as_str()) {
                                            let expires_in = value["expires_in"].as_u64().unwrap_or(3600);
                                            spotify.update_tokens(access.to_string(), refresh.to_string(), expires_in).await;
                                            println!("Spotify tokens updated from client");
                                        }
                                        continue;
                                    }

                                    if value["type"] == "SPOTIFY_COMMAND" {
                                        if let Some(endpoint) = value["endpoint"].as_str() {
                                            let _ = spotify.handle_command(endpoint, Some(value.clone())).await;
                                        }
                                        continue;
                                    }

                                    // Broadcast direct action requests from StreamDock so the Tauri UI can handle them
                                    if value["type"] == "TOGGLE_AUTO_ACCEPT" || value["type"] == "TOGGLE_AUTO_BAN" || value["type"] == "TOGGLE_AUTO_PICK" || value["type"] == "INJECT_BUILD" || value["type"] == "DODGE_GAME" || value["type"] == "RUNE_BUILDS_READY" {
                                        let _ = sender.0.send(text.clone());
                                        // Also directly acknowledge it
                                        let response_json = json!({
                                            "type": "COMMAND_ACK",
                                            "action": value["type"],
                                            "status": "ok"
                                        });
                                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                        continue;
                                    }

                                    if let Ok(command) = serde_json::from_str::<StreamDeckCommand>(&text) {
                                        // Simple command acknowledgement
                                        let response_json = json!({
                                            "type": "COMMAND_ACK",
                                            "action": command.action,
                                            "status": "ok"
                                        });
                                        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(response_json.to_string().into())).await;
                                    }
                                } else {
                                    println!("Failed to parse command from Client: {}", text);
                                }
                            }
                        }
                        _ => break,
                    }
                }
                Ok(broadcast_msg) = rx.recv() => {
                    if let Err(_) = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(broadcast_msg.into())).await {
                        break;
                    }
                }
            }
        }
    }
}
