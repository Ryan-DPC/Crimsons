use std::net::SocketAddr;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::accept_async;
use futures_util::{StreamExt, SinkExt};
use tokio::sync::broadcast;
use tauri::{AppHandle, Manager};
use serde_json::json;
use crate::storage;
use crate::lcu;

pub struct WsSender(pub broadcast::Sender<String>);

pub async fn start_ws_server(handle: AppHandle) {
    let addr = "127.0.0.1:40509".parse::<SocketAddr>().expect("Invalid address");
    if let Ok(listener) = TcpListener::bind(&addr).await {
        while let Ok((stream, _)) = listener.accept().await {
            let handle_clone = handle.clone();
            tokio::spawn(handle_connection(stream, handle_clone));
        }
    }
}

async fn handle_connection(stream: TcpStream, handle: AppHandle) {
    if let Ok(mut ws_stream) = accept_async(stream).await {
        
        let data = storage::load_data(&handle);
        let initial_state = json!({
            "type": "AUTO_ACCEPT_STATE",
            "enabled": data.auto_accept
        });
        let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(initial_state.to_string().into())).await;

        let state = handle.state::<WsSender>();
        let mut rx = state.0.subscribe();

        loop {
            tokio::select! {
                msg = ws_stream.next() => {
                    match msg {
                        Some(Ok(msg)) => {
                            if let Ok(text) = msg.to_text() {
                                if let Ok(j) = serde_json::from_str::<serde_json::Value>(text) {
                                    if j["type"] == "TOGGLE_AUTO_ACCEPT" {
                                        let mut data = storage::load_data(&handle);
                                        data.auto_accept = !data.auto_accept;
                                        storage::save_data(&handle, &data);
                                        let _ = state.0.send(json!({"type": "AUTO_ACCEPT_STATE", "enabled": data.auto_accept}).to_string());
                                    } else if j["type"] == "TOGGLE_AUTO_BAN" {
                                        let mut data = storage::load_data(&handle);
                                        let id = j["championId"].as_u64().unwrap_or(0);
                                        if data.auto_ban == Some(id) { data.auto_ban = None; }
                                        else { data.auto_ban = Some(id); data.auto_pick = None; }
                                        storage::save_data(&handle, &data);
                                        let _ = state.0.send(json!({"type": "AUTO_BAN_STATE", "championId": data.auto_ban}).to_string());
                                    } else if j["type"] == "TOGGLE_AUTO_PICK" {
                                        let mut data = storage::load_data(&handle);
                                        let id = j["championId"].as_u64().unwrap_or(0);
                                        if data.auto_pick == Some(id) { data.auto_pick = None; }
                                        else { data.auto_pick = Some(id); data.auto_ban = None; }
                                        storage::save_data(&handle, &data);
                                        let _ = state.0.send(json!({"type": "AUTO_PICK_STATE", "championId": data.auto_pick}).to_string());
                                    } else if j["type"] == "DODGE_GAME" {
                                        let _ = lcu::lcu_request("POST".into(), "/lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=[\"\", \"teambuilder-draft\", \"quitV2\", \"\"]".into(), None).await;
                                    } else if j["type"] == "INJECT_BUILD" {
                                        let champ_id = j["championId"].as_u64().unwrap_or(0) as u32;
                                        if champ_id > 0 {
                                            let mut champion_name = j["championName"].as_str().unwrap_or("").to_string();
                                            
                                            // Fallback: Resolve name from LCU if name is missing
                                            if champion_name.is_empty() {
                                                if let Ok(champ_json) = lcu::lcu_request("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", champ_id), None).await {
                                                    if let Ok(champ_data) = serde_json::from_str::<serde_json::Value>(&champ_json) {
                                                        champion_name = champ_data["name"].as_str().unwrap_or("").to_string();
                                                    }
                                                }
                                            }

                                            if !champion_name.is_empty() {
                                                let role = j["role"].as_str().unwrap_or("mid").into();
                                                if let Ok(builds) = crate::analyzer::fetch_dynamic_runes(handle.clone(), champion_name, role).await {
                                                    if let Some(best) = builds.first() {
                                                        let rune_page = json!({
                                                            "name": format!("CRIMSON: {}", best.name),
                                                            "primaryStyleId": best.primary_style_id,
                                                            "subStyleId": best.sub_style_id,
                                                            "selectedPerkIds": [
                                                                best.perk_ids[0], best.perk_ids[1], best.perk_ids[2], best.perk_ids[3],
                                                                best.perk_ids[4], best.perk_ids[5],
                                                                best.shards[0], best.shards[1], best.shards[2]
                                                            ],
                                                            "current": true
                                                        });
                                                        
                                                        // Delete all CRIMSON pages first
                                                        if let Ok(pages_json) = lcu::lcu_request("GET".into(), "/lol-perks/v1/pages".into(), None).await {
                                                            if let Ok(pages) = serde_json::from_str::<Value>(&pages_json) {
                                                                if let Some(pages_arr) = pages.as_array() {
                                                                    for p in pages_arr {
                                                                        if p["name"].as_str().unwrap_or("").starts_with("CRIMSON:") {
                                                                            let id = p["id"].as_u64().unwrap_or(0);
                                                                            let _ = lcu::lcu_request("DELETE".into(), format!("/lol-perks/v1/pages/{}", id), None).await;
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                        
                                                        let _ = lcu::lcu_request("POST".into(), "/lol-perks/v1/pages".into(), Some(rune_page.to_string())).await;
                                                    }
                                                }
                                            }
                                        }
                                    } else if j["type"] == "GET_BUILDS" {
                                        let champ_id = j["championId"].as_u64().unwrap_or(0) as u32;
                                        let mut champion_name = j["championName"].as_str().unwrap_or("").to_string();
                                        if champion_name.is_empty() && champ_id > 0 {
                                            if let Ok(champ_json) = lcu::lcu_request("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", champ_id), None).await {
                                                if let Ok(champ_data) = serde_json::from_str::<serde_json::Value>(&champ_json) {
                                                    champion_name = champ_data["name"].as_str().unwrap_or("").to_string();
                                                }
                                            }
                                        }
                                        if !champion_name.is_empty() {
                                            if let Ok(builds) = crate::analyzer::fetch_dynamic_runes(handle.clone(), champion_name, "mid".to_string()).await {
                                                let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(json!({"type": "BUILDS_LIST", "builds": builds}).to_string().into())).await;
                                            }
                                        }
                                    } else if j["type"] == "TOGGLE_GLOBAL_AUTOMATION" {
                                        let mut data = storage::load_data(&handle);
                                        if data.auto_ban.is_some() || data.auto_pick.is_some() {
                                            // Toggle OFF: Save and clear
                                            data.remembered_auto_ban = data.auto_ban;
                                            data.remembered_auto_pick = data.auto_pick;
                                            data.auto_ban = None;
                                            data.auto_pick = None;
                                        } else {
                                            // Toggle ON: Restore
                                            data.auto_ban = data.remembered_auto_ban;
                                            data.auto_pick = data.remembered_auto_pick;
                                        }
                                        storage::save_data(&handle, &data);
                                        let _ = state.0.send(json!({"type": "AUTO_BAN_STATE", "championId": data.auto_ban}).to_string());
                                        let _ = state.0.send(json!({"type": "AUTO_PICK_STATE", "championId": data.auto_pick}).to_string());
                                        let _ = state.0.send(json!({
                                            "type": "GLOBAL_AUTOMATION_STATE", 
                                            "enabled": data.auto_ban.is_some() || data.auto_pick.is_some()
                                        }).to_string());
                                    }
                                }
                            }
                        }
                        _ => break,
                    }
                }
                Ok(broadcast_msg) = rx.recv() => {
                    let _ = ws_stream.send(tokio_tungstenite::tungstenite::Message::Text(broadcast_msg.into())).await;
                }
            }
        }
    }
}
