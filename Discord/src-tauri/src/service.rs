use crate::{lcu, storage, db};
use std::time::Duration;
use tokio::time::interval;
use tauri::{AppHandle, Manager};
use serde_json::{self, json};
use crate::ws::WsSender;

pub fn start_auto_accept_service(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut interval = interval(Duration::from_millis(1000));
        loop {
            interval.tick().await;
            
            let data = storage::load_data(&handle);
            if data.auto_accept {
                let _ = check_and_accept(&handle).await;
            }
            
            // Broadcast current phase and champelect state
            let _ = broadcast_state(&handle).await;
        }
    });
}

async fn check_and_accept(handle: &AppHandle) -> Result<(), String> {
    // 1. Auto-Accept Logic
    let ready_check = lcu::lcu_request("GET".into(), "/lol-matchmaking/v1/ready-check".into(), None).await;
    if let Ok(json) = ready_check {
        if json.contains("\"InProgress\"") {
            let _ = lcu::lcu_request("POST".into(), "/lol-matchmaking/v1/ready-check/accept".into(), None).await;
        }
    }

    // 2. Harvesting Logic (Simplified for MVP)
    // We check if we are in EndOfGame to grab the last match
    let session = lcu::lcu_request("GET".into(), "/lol-gameflow/v1/session".into(), None).await;
    if let Ok(json) = session {
        if json.contains("\"EndOfGame\"") {
            // Fetch last match ID from the client's history
            let summoner = lcu::lcu_request("GET".into(), "/lol-summoner/v1/current-summoner".into(), None).await;
            if let Ok(s_json) = summoner {
                let s: serde_json::Value = serde_json::from_str(&s_json).unwrap_or_default();
                if let Some(puuid) = s["puuid"].as_str() {
                    let history = lcu::lcu_request("GET".into(), format!("/lol-match-history/v1/products/league-of-legends/{}/matches?begIndex=0&endIndex=1", puuid), None).await;
                    if let Ok(h_json) = history {
                        let h: serde_json::Value = serde_json::from_str(&h_json).unwrap_or_default();
                        if let Some(g) = h["games"]["games"][0].as_object() {
                            let match_id = g["gameId"].as_u64().unwrap_or(0);
                            let mut data = storage::load_data(handle);
                            if !data.match_ids.contains(&match_id) {
                                // Extract stats for the player
                                if let Some(p) = g["participants"][0].as_object() {
                                    let stats = &p["stats"];
                                    let db_match = db::DbMatch {
                                        game_id: match_id,
                                        timestamp: g["gameCreation"].as_u64().unwrap_or(0),
                                        champion_id: p["championId"].as_u64().unwrap_or(0) as u32,
                                        kills: stats["kills"].as_u64().unwrap_or(0) as u32,
                                        deaths: stats["deaths"].as_u64().unwrap_or(0) as u32,
                                        assists: stats["assists"].as_u64().unwrap_or(0) as u32,
                                        win: stats["win"].as_bool().unwrap_or(false),
                                        queue_id: g["gameQueueId"].as_u64().unwrap_or(0) as u32,
                                        game_duration: g["gameDuration"].as_u64().unwrap_or(0),
                                    };
                                    let _ = db::insert_match(handle, &db_match);
                                }
                                
                                data.match_ids.push(match_id);
                                storage::save_data(handle, &data);
                            }
                        }
                    }
                }
            }
        }
    }
    
    Ok(())
}

async fn broadcast_state(handle: &AppHandle) -> Result<(), String> {
    let ws = handle.state::<WsSender>();
    
    // 1. Get Gameflow Phase
    if let Ok(phase_json) = lcu::lcu_request("GET".into(), "/lol-gameflow/v1/gameflow-phase".into(), None).await {
        let phase: String = serde_json::from_str(&phase_json).unwrap_or_else(|_| "None".to_string());
        let _ = ws.0.send(json!({"type": "GAME_PHASE", "phase": phase}).to_string());
    }

    // 2. Get Champ Select State (if in ChampSelect)
    if let Ok(session_json) = lcu::lcu_request("GET".into(), "/lol-champ-select/v1/session".into(), None).await {
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
                if let Ok(champ_json) = lcu::lcu_request("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", my_champ_id), None).await {
                    if let Ok(champ_data) = serde_json::from_str::<serde_json::Value>(&champ_json) {
                        my_champ_name = champ_data["name"].as_str().unwrap_or("").to_string();
                    }
                }
            }

            let _ = ws.0.send(json!({
                "type": "CHAMP_SELECT", 
                "championId": my_champ_id,
                "championName": my_champ_name
            }).to_string());
        }
    }

    // 3. Get Rank (occasionally or if data is empty)
    if let Ok(summoner_json) = lcu::lcu_request("GET".into(), "/lol-summoner/v1/current-summoner".into(), None).await {
         if let Ok(summoner) = serde_json::from_str::<serde_json::Value>(&summoner_json) {
             if let Some(summoner_id) = summoner["summonerId"].as_u64() {
                 if let Ok(rank_json) = lcu::lcu_request("GET".into(), format!("/lol-ranked/v1/ranked-stats/{}", summoner_id), None).await {
                     if let Ok(rank_data) = serde_json::from_str::<serde_json::Value>(&rank_json) {
                         let queue = &rank_data["queueMap"]["RANKED_SOLO_5x5"];
                         let tier = queue["tier"].as_str().unwrap_or("UNRANKED");
                         let division = queue["division"].as_str().unwrap_or("");
                         let lp = queue["leaguePoints"].as_u64().unwrap_or(0);
                         let _ = ws.0.send(json!({
                             "type": "RANK_UPDATE", 
                             "tier": tier, 
                             "division": division, 
                             "lp": lp
                         }).to_string());
                     }
                 }
             }
         }
    }

    Ok(())
}
