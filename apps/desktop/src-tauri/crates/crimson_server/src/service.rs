use crate::{lcu, storage};
use std::time::Duration;
use tokio::time::interval;
use serde_json::json;
use crate::events::WsSender;

pub fn start_auto_accept_service(sender: WsSender) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_millis(1000));
        loop {
            interval.tick().await;

            let data = storage::load_data_from_path(storage::get_data_path_from_env());
            if data.auto_accept {
                let _ = check_and_accept(&sender);
            }
            
            // Always broadcast state (v1.0.8 parity: ensure UI & StreamDock stay synchronized)
            let _ = broadcast_state(&sender);

            // Always broadcast status heartbeat
            let _ = sender.0.send(json!({
                "type": "HEARTBEAT_STATUS",
                "server": true,
                "lol": lcu::is_lcu_connected()
            }).to_string());
        }
    });
}

fn check_and_accept(sender: &WsSender) -> Result<(), String> {
    // 1. Auto-Accept Logic
    let ready_check = lcu::lcu_request("GET".into(), "/lol-matchmaking/v1/ready-check".into(), None);
    if let Ok(json) = ready_check {
        if json.contains("\"InProgress\"") {
            let _ = lcu::lcu_request("POST".into(), "/lol-matchmaking/v1/ready-check/accept".into(), None);
            
            // Send WebSocket notification for the UI to display
            let _ = sender.0.send(json!({
                "type": "NATIVE_NOTIFICATION",
                "title": "CRIMSON",
                "body": "Match accepté automatiquement !"
            }).to_string());
        }
    }

    Ok(())
}

fn broadcast_state(sender: &WsSender) -> Result<(), String> {
    // 1. Get Gameflow Phase
    if let Ok(phase_json) = lcu::lcu_request("GET".into(), "/lol-gameflow/v1/gameflow-phase".into(), None) {
        let phase: String = serde_json::from_str(&phase_json).unwrap_or_else(|_| "None".to_string());
        let _ = sender.0.send(json!({"type": "GAME_PHASE", "phase": phase}).to_string());
    }

    // 2. Get Champ Select State (if in ChampSelect)
    if let Ok(session_json) = lcu::lcu_request("GET".into(), "/lol-champ-select/v1/session".into(), None) {
        if let Ok(session) = serde_json::from_str::<serde_json::Value>(&session_json) {
            let my_cell_id = session["localPlayerCellId"].as_i64().unwrap_or(-1);
            let mut my_champ_id = 0;
            let mut my_champ_name = String::new();
            
            if let Some(actions) = session["actions"].as_array() {
                for group in actions {
                    if let Some(group_arr) = group.as_array() {
                        for action in group_arr {
                            if action["actorCellId"].as_i64() == Some(my_cell_id) {
                                my_champ_id = action["championId"].as_u64().unwrap_or(0) as u32;
                            }
                        }
                    }
                }
            }

            // Resolve name if we have a champion
            if my_champ_id > 0 {
                if let Ok(champ_json) = lcu::lcu_request("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", my_champ_id), None) {
                    if let Ok(champ_data) = serde_json::from_str::<serde_json::Value>(&champ_json) {
                        my_champ_name = champ_data["name"].as_str().unwrap_or("").to_string();
                    }
                }
            }

            let _ = sender.0.send(json!({
                "type": "CHAMP_SELECT", 
                "championId": my_champ_id,
                "championName": my_champ_name
            }).to_string());
        }
    }

    // 3. Get Rank (occasionally)
    if let Ok(rank_json) = lcu::lcu_request("GET".into(), "/lol-ranked/v1/current-ranked-stats".into(), None) {
         if let Ok(rank_data) = serde_json::from_str::<serde_json::Value>(&rank_json) {
             let queues = rank_data["queues"].as_array();
             
             // Solo Queue
             let queue = queues.and_then(|qs| qs.iter().find(|q| q["queueType"].as_str() == Some("RANKED_SOLO_5x5"))).unwrap_or(&serde_json::Value::Null);
             let mut tier = queue["tier"].as_str().unwrap_or("UNRANKED");
             if tier == "NONE" || tier == "NA" { tier = "UNRANKED"; }
             let division = queue["division"].as_str().unwrap_or("");
             let lp = queue["leaguePoints"].as_u64().unwrap_or(0);
             
             // TFT Queue
             let tft_queue = queues.and_then(|qs| qs.iter().find(|q| q["queueType"].as_str() == Some("RANKED_TFT"))).unwrap_or(&serde_json::Value::Null);
             let mut tft_tier = tft_queue["tier"].as_str().unwrap_or("UNRANKED");
             if tft_tier == "NONE" || tft_tier == "NA" { tft_tier = "UNRANKED"; }
             let tft_division = tft_queue["division"].as_str().unwrap_or("");
             let tft_lp = tft_queue["leaguePoints"].as_u64().unwrap_or(0);

             let rank_payload = json!({
                 "type": "RANK_UPDATE", 
                 "tier": tier, 
                 "division": division, 
                 "lp": lp,
                 "tft_tier": tft_tier,
                 "tft_division": tft_division,
                 "tft_lp": tft_lp
             });

             // Cache rank for cold boot
             let mut app_data = storage::load_data_from_path(storage::get_data_path_from_env());
             app_data.other.insert("last_rank".to_string(), rank_payload.clone());
             storage::save_data_to_path(storage::get_data_path_from_env(), &app_data);

             let _ = sender.0.send(rank_payload.to_string());
         }
    }

    Ok(())
}

