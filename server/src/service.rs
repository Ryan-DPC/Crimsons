use crate::{automation, lcu, storage};
use std::time::Duration;
use tokio::time::interval;
use serde_json::json;
use crate::events::WsSender;

lazy_static::lazy_static! {
    static ref LAST_RANK: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);
    static ref LAST_SUMMONER: std::sync::Mutex<Option<serde_json::Value>> = std::sync::Mutex::new(None);
}

pub fn start_auto_accept_service(
    sender: WsSender, 
    is_enabled: std::sync::Arc<std::sync::atomic::AtomicBool>,
    is_auto_accept_enabled: std::sync::Arc<std::sync::atomic::AtomicBool>
) {
    tokio::spawn(async move {
        let mut interval = interval(Duration::from_millis(500));
        let mut loop_count = 0u64;
        loop {
            interval.tick().await;

            if !is_enabled.load(std::sync::atomic::Ordering::Relaxed) {
                continue;
            }

            if !lcu::is_lcu_connected() {
                // Clear cache on disconnect so we query immediately on reconnect
                if let Ok(mut last) = LAST_RANK.lock() { *last = None; }
                if let Ok(mut last) = LAST_SUMMONER.lock() { *last = None; }
                continue;
            }

            // Disk is source of truth (UI may change autoAccept without touching the AtomicBool).
            let app_data = storage::load_data_from_path(storage::get_data_path_from_env());
            is_auto_accept_enabled.store(app_data.auto_accept, std::sync::atomic::Ordering::Relaxed);

            let sender_tick = sender.clone();
            let auto_accept = app_data.auto_accept;
            loop_count = loop_count.wrapping_add(1);
            let check_stats = if loop_count % 5 == 0 {
                let has_cached = {
                    let r = LAST_RANK.lock().map(|l| l.is_some()).unwrap_or(false);
                    let s = LAST_SUMMONER.lock().map(|l| l.is_some()).unwrap_or(false);
                    r && s
                };
                Some(!has_cached || (loop_count % 60 == 0))
            } else {
                None
            };

            // ureq is blocking; keep it off the current_thread runtime.
            let _ = tokio::task::spawn_blocking(move || {
                if auto_accept {
                    let _ = check_and_accept(&sender_tick);
                }
                let _ = poll_champ_select_automation();
                if let Some(check_stats) = check_stats {
                    let _ = broadcast_state_optimized(&sender_tick, check_stats);
                }
            }).await;
        }
    });
}

fn check_and_accept(sender: &WsSender) -> Result<(), String> {
    let ready_check = lcu::lcu_request("GET".into(), "/lol-matchmaking/v1/ready-check".into(), None)?;
    let data: serde_json::Value = serde_json::from_str(&ready_check).map_err(|e| e.to_string())?;

    let state = data["state"].as_str().unwrap_or("");
    let player_status = data["playerResponse"].as_str().unwrap_or("");
    if !automation::should_auto_accept(state, player_status, true) {
        return Ok(());
    }

    tracing::info!("Service: Ready-check InProgress — auto-accepting");
    lcu::lcu_request("POST".into(), "/lol-matchmaking/v1/ready-check/accept".into(), Some("{}".into()))?;

    let _ = sender.0.send(json!({
        "type": "NATIVE_NOTIFICATION",
        "title": "CRIMSONS",
        "body": "Match accepté automatiquement !"
    }).to_string());

    Ok(())
}

fn poll_champ_select_automation() -> Result<(), String> {
    let session_json = lcu::lcu_request("GET".into(), "/lol-champ-select/v1/session".into(), None)?;
    let session: serde_json::Value = serde_json::from_str(&session_json).map_err(|e| e.to_string())?;
    automation::handle_champ_select_standalone(&session);
    Ok(())
}

fn broadcast_state_optimized(sender: &WsSender, check_stats: bool) -> Result<(), String> {
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

    if !check_stats {
        return Ok(());
    }

    // 3. Get Rank (only if stats check requested)
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

              let mut last_rank_lock = LAST_RANK.lock().unwrap();
              let changed = match last_rank_lock.as_ref() {
                  Some(last) => last != &rank_payload,
                  None => true,
              };

              if changed {
                  *last_rank_lock = Some(rank_payload.clone());
                  // Cache rank for cold boot (only on changes)
                  let mut app_data = storage::load_data_from_path(storage::get_data_path_from_env());
                  app_data.other.insert("last_rank".to_string(), rank_payload.clone());
                  storage::save_data_to_path(storage::get_data_path_from_env(), &app_data);
              }

              let _ = sender.0.send(rank_payload.to_string());
         }
    }

    // 4. Get Summoner Info (only if stats check requested)
    if let Ok(summoner_json) = lcu::lcu_request("GET".into(), "/lol-summoner/v1/current-summoner".into(), None) {
        if let Ok(summoner) = serde_json::from_str::<serde_json::Value>(&summoner_json) {
            let game_name = summoner["gameName"].as_str()
                .or_else(|| summoner["displayName"].as_str())
                .unwrap_or("Unknown");
            let tag_line = summoner["tagLine"].as_str().unwrap_or("");
            let profile_icon_id = summoner["profileIconId"].as_u64().unwrap_or(0);
            
            let summoner_payload = json!({
                "type": "SUMMONER_INFO",
                "gameName": game_name,
                "tagLine": tag_line,
                "profileIconId": profile_icon_id
            });

            let mut last_summoner_lock = LAST_SUMMONER.lock().unwrap();
            let changed = match last_summoner_lock.as_ref() {
                Some(last) => last != &summoner_payload,
                None => true,
            };

            if changed {
                *last_summoner_lock = Some(summoner_payload.clone());
                // Cache summoner info for cold boot (only on changes)
                let mut app_data = storage::load_data_from_path(storage::get_data_path_from_env());
                app_data.other.insert("last_summoner".to_string(), summoner_payload.clone());
                storage::save_data_to_path(storage::get_data_path_from_env(), &app_data);
            }

            let _ = sender.0.send(summoner_payload.to_string());
        }
    }

    Ok(())
}
