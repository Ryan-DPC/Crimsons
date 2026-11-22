use serde_json::Value;
use crate::{lcu, storage};

/// Parse a champion id from JSON that may be u64, i64, or numeric string.
pub fn parse_champ_id(value: &Value) -> Option<u64> {
    if value.is_null() {
        return None;
    }
    value
        .as_u64()
        .or_else(|| value.as_i64().and_then(|i| if i >= 0 { Some(i as u64) } else { None }))
        .or_else(|| value.as_str().and_then(|s| s.parse().ok()))
        .filter(|&id| id > 0)
}

/// LCU ready-check is active when state is InProgress and the local player has not answered.
pub fn should_auto_accept(state: &str, player_response: &str, auto_accept_enabled: bool) -> bool {
    if !auto_accept_enabled {
        return false;
    }
    let is_in_progress = state.eq_ignore_ascii_case("InProgress");
    let not_answered = player_response.is_empty()
        || player_response.eq_ignore_ascii_case("None")
        || (!player_response.eq_ignore_ascii_case("Accepted") && !player_response.eq_ignore_ascii_case("Declined"));
    is_in_progress && not_answered
}

pub fn handle_champ_select_standalone(data: &Value) {
    let local_player_cell_id = data["localPlayerCellId"].as_i64().unwrap_or(-1);
    if local_player_cell_id == -1 {
        return;
    }

    let actions = match data["actions"].as_array() {
        Some(a) => a,
        None => return,
    };

    let app_data = storage::load_data_from_path(storage::get_data_path_from_env());
    let auto_ban = app_data.effective_auto_ban();
    let auto_pick = app_data.effective_auto_pick();

    if auto_ban.is_none() && auto_pick.is_none() {
        return;
    }

    for group in actions {
        if let Some(group_arr) = group.as_array() {
            for action in group_arr {
                let actor_cell_id = action["actorCellId"].as_i64().unwrap_or(-1);
                if actor_cell_id != local_player_cell_id {
                    continue;
                }

                let is_active = action["isInProgress"].as_bool().unwrap_or(false);
                if !is_active {
                    continue;
                }

                let action_type = action["type"].as_str().unwrap_or("");
                let action_id = action["id"].as_i64().unwrap_or(-1);
                let completed = action["completed"].as_bool().unwrap_or(false);

                if completed || action_id < 0 {
                    continue;
                }

                if action_type == "ban" {
                    if let Some(target_id) = auto_ban {
                        tracing::info!("Automation: Auto-Ban champion {} (action {})", target_id, action_id);
                        if let Err(e) = execute_action(action_id, target_id as u32) {
                            tracing::warn!("Automation: Auto-Ban failed: {}", e);
                        }
                    }
                } else if action_type == "pick" {
                    if let Some(target_id) = auto_pick {
                        tracing::info!("Automation: Auto-Pick champion {} (action {})", target_id, action_id);
                        if let Err(e) = execute_action(action_id, target_id as u32) {
                            tracing::warn!("Automation: Auto-Pick failed: {}", e);
                        }
                    }
                }
            }
        }
    }
}

pub fn handle_ready_check(data: &Value) {
    let state = data["state"].as_str().unwrap_or("");
    let player_status = data["playerResponse"].as_str().unwrap_or("");

    let app_data = storage::load_data_from_path(storage::get_data_path_from_env());
    if !should_auto_accept(state, player_status, app_data.auto_accept) {
        return;
    }

    tracing::info!("Automation: Ready-check InProgress — auto-accepting");
    match lcu::lcu_request(
        "POST".into(),
        "/lol-matchmaking/v1/ready-check/accept".into(),
        Some("{}".into()),
    ) {
        Ok(_) => tracing::info!("Automation: Auto-accept OK"),
        Err(e) => tracing::warn!("Automation: Auto-accept failed: {}", e),
    }
}

fn execute_action(action_id: i64, champion_id: u32) -> Result<(), String> {
    let body = serde_json::json!({
        "championId": champion_id,
        "completed": true
    });

    lcu::lcu_request(
        "PATCH".into(),
        format!("/lol-champ-select/v1/session/actions/{}", action_id),
        Some(body.to_string()),
    )
    .map(|_| ())
    .map_err(|e| format!("Action execution failed: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn ready_check_accepts_in_progress_only() {
        assert!(should_auto_accept("InProgress", "None", true));
        assert!(should_auto_accept("inprogress", "", true));
        assert!(should_auto_accept("InProgress", "none", true));
        assert!(!should_auto_accept("InProgress", "Declined", true));
        assert!(!should_auto_accept("Proposed", "None", true));
        assert!(!should_auto_accept("InProgress", "Accepted", true));
        assert!(!should_auto_accept("InProgress", "None", false));
        assert!(!should_auto_accept("EveryoneReady", "None", true));
    }

    #[test]
    fn parse_champ_id_variants() {
        assert_eq!(parse_champ_id(&json!(157)), Some(157));
        assert_eq!(parse_champ_id(&json!(157i64)), Some(157));
        assert_eq!(parse_champ_id(&json!("103")), Some(103));
        assert_eq!(parse_champ_id(&json!(null)), None);
        assert_eq!(parse_champ_id(&json!(0)), None);
        assert_eq!(parse_champ_id(&json!("")), None);
    }

    #[test]
    fn champ_select_finds_active_local_action() {
        let session = json!({
            "localPlayerCellId": 2,
            "actions": [[
                {
                    "actorCellId": 2,
                    "id": 5,
                    "type": "ban",
                    "isInProgress": true,
                    "completed": false,
                    "championId": 0
                },
                {
                    "actorCellId": 1,
                    "id": 6,
                    "type": "ban",
                    "isInProgress": true,
                    "completed": false,
                    "championId": 0
                }
            ]]
        });

        let local = session["localPlayerCellId"].as_i64().unwrap();
        let mut found = None;
        for group in session["actions"].as_array().unwrap() {
            for action in group.as_array().unwrap() {
                if action["actorCellId"].as_i64() == Some(local)
                    && action["isInProgress"].as_bool() == Some(true)
                    && action["completed"].as_bool() != Some(true)
                    && action["type"].as_str() == Some("ban")
                {
                    found = action["id"].as_i64();
                }
            }
        }
        assert_eq!(found, Some(5));
    }
}
