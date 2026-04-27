use tauri::AppHandle;
use serde_json::Value;
use crate::{lcu, storage};

pub async fn handle_champ_select(_handle: &AppHandle, data: &Value) {
    handle_champ_select_standalone(data).await
}

pub async fn handle_champ_select_standalone(data: &Value) {
    let local_player_cell_id = data["localPlayerCellId"].as_i64().unwrap_or(-1);
    if local_player_cell_id == -1 { return; }

    let actions = match data["actions"].as_array() {
        Some(a) => a,
        None => return,
    };

    let app_data = storage::load_data_from_path(storage::get_data_path_from_env());
    
    for group in actions {
        if let Some(group_arr) = group.as_array() {
            for action in group_arr {
                let actor_cell_id = action["actorCellId"].as_i64().unwrap_or(-1);
                if actor_cell_id != local_player_cell_id { continue; }

                let is_active = action["isInProgress"].as_bool().unwrap_or(false);
                if !is_active { continue; }

                let action_type = action["type"].as_str().unwrap_or("");
                let action_id = action["id"].as_i64().unwrap_or(-1);
                let completed = action["completed"].as_bool().unwrap_or(false);

                if completed { continue; }

                if action_type == "ban" {
                    if let Some(target_id) = app_data.auto_ban {
                        println!("Automation: Executing Auto-Ban for champion {}", target_id);
                        let _ = execute_action(action_id, target_id as u32, true).await;
                    }
                } else if action_type == "pick" {
                    if let Some(target_id) = app_data.auto_pick {
                        println!("Automation: Executing Auto-Pick for champion {}", target_id);
                        let _ = execute_action(action_id, target_id as u32, false).await;
                    }
                }
            }
        }
    }
}

async fn execute_action(action_id: i64, champion_id: u32, should_complete: bool) -> Result<(), String> {
    let body = if should_complete {
        serde_json::json!({
            "championId": champion_id,
            "completed": true
        })
    } else {
        serde_json::json!({
            "championId": champion_id,
            "completed": true
        })
    };

    let res = lcu::lcu_request(
        "PATCH".into(), 
        format!("/lol-champ-select/v1/session/actions/{}", action_id), 
        Some(body.to_string())
    ).await;

    match res {
        Ok(_) => Ok(()),
        Err(e) => Err(format!("Action execution failed: {}", e))
    }
}
