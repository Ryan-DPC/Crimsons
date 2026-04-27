use serde::Deserialize;
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tauri::AppHandle;
use crate::{storage, lcu};

#[derive(Debug, Deserialize)]
#[serde(tag = "type")]
pub enum StreamDeckCommand {
    #[serde(rename = "TOGGLE_AUTO_ACCEPT")]
    ToggleAutoAccept,

    #[serde(rename = "TOGGLE_AUTO_BAN")]
    ToggleAutoBan { 
        #[serde(rename = "championId")]
        champion_id: Option<u64> 
    },

    #[serde(rename = "TOGGLE_AUTO_PICK")]
    ToggleAutoPick { 
        #[serde(rename = "championId")]
        champion_id: Option<u64> 
    },

    #[serde(rename = "DODGE_GAME")]
    DodgeGame,

    #[serde(rename = "INJECT_BUILD")]
    InjectBuild {
        #[serde(rename = "championId")]
        champion_id: u32,
        #[serde(rename = "championName")]
        champion_name: Option<String>,
        role: Option<String>
    },

    #[serde(rename = "GET_BUILDS")]
    GetBuilds {
        #[serde(rename = "championId")]
        champion_id: u32,
        #[serde(rename = "championName")]
        champion_name: Option<String>,
    },

    #[serde(rename = "TOGGLE_GLOBAL_AUTOMATION")]
    ToggleGlobalAutomation
}

impl StreamDeckCommand {
    pub async fn execute(
        self, 
        _handle: &AppHandle, 
        tx: &broadcast::Sender<String>
    ) -> Result<Option<Value>, String> {
        self.execute_standalone(tx).await
    }

    pub async fn execute_standalone(
        self, 
        tx: &broadcast::Sender<String>
    ) -> Result<Option<Value>, String> {
        match self {
            StreamDeckCommand::ToggleAutoAccept => {
                let mut data = storage::load_data_from_path(storage::get_data_path_from_env());
                data.auto_accept = !data.auto_accept;
                storage::save_data_to_path(storage::get_data_path_from_env(), &data);
                let _ = tx.send(json!({"type": "AUTO_ACCEPT_STATE", "enabled": data.auto_accept}).to_string());
                Ok(None)
            }
            StreamDeckCommand::ToggleAutoBan { champion_id } => {
                let mut data = storage::load_data_from_path(storage::get_data_path_from_env());
                let id = champion_id.unwrap_or(0);
                if data.auto_ban == Some(id) { 
                    data.auto_ban = None; 
                } else { 
                    data.auto_ban = Some(id); 
                    data.auto_pick = None; 
                }
                storage::save_data_to_path(storage::get_data_path_from_env(), &data);
                let _ = tx.send(json!({"type": "AUTO_BAN_STATE", "championId": data.auto_ban}).to_string());
                Ok(None)
            }
            StreamDeckCommand::ToggleAutoPick { champion_id } => {
                let mut data = storage::load_data_from_path(storage::get_data_path_from_env());
                let id = champion_id.unwrap_or(0);
                if data.auto_pick == Some(id) { 
                    data.auto_pick = None; 
                } else { 
                    data.auto_pick = Some(id); 
                    data.auto_ban = None; 
                }
                storage::save_data_to_path(storage::get_data_path_from_env(), &data);
                let _ = tx.send(json!({"type": "AUTO_PICK_STATE", "championId": data.auto_pick}).to_string());
                Ok(None)
            }
            StreamDeckCommand::DodgeGame => {
                let _ = lcu::lcu_request("POST".into(), "/lol-login/v1/session/invoke?destination=lcdsServiceProxy&method=call&args=[\"\", \"teambuilder-draft\", \"quitV2\", \"\"]".into(), None).await;
                Ok(None)
            }
            StreamDeckCommand::InjectBuild { champion_id, champion_name, role } => {
                if champion_id == 0 { return Ok(None); }
                let mut c_name = champion_name.unwrap_or_default();
                
                if c_name.is_empty() {
                    if let Ok(c_json) = lcu::lcu_request("GET".into(), format!("/lol-game-data/assets/v1/champions/{}.json", champion_id), None).await {
                        if let Ok(c_data) = serde_json::from_str::<Value>(&c_json) {
                            c_name = c_data["name"].as_str().unwrap_or("").to_string();
                        }
                    }
                }

                if !c_name.is_empty() {
                    let _r = role.unwrap_or_else(|| "mid".to_string());
                    // For sidecar, we might need a DB pool to fetch builds if we want to bypass Gemini.
                    // But here we use analyzer::fetch_dynamic_runes which we refactored.
                    // We need a pool though. Currently StreamDeckCommand doesn't have one.
                    // Let's assume for now it uses the Gemini path.
                    
                    let data = storage::load_data_from_path(storage::get_data_path_from_env());
                    let _key = data.gemini_api_key.unwrap_or_default();
                    
                    // TODO: Pass proper pool if we want caching in the sidecar.
                    // For now, standalone will use a temporary pool or just Gemini.
                    // Actually, let's keep it simple.
                }
                Ok(None)
            }
            StreamDeckCommand::GetBuilds { champion_id: _, champion_name: _ } => {
                Ok(None) // Simplified for standalone for now
            }
            StreamDeckCommand::ToggleGlobalAutomation => {
                let mut data = storage::load_data_from_path(storage::get_data_path_from_env());
                if data.auto_ban.is_some() || data.auto_pick.is_some() {
                    data.remembered_auto_ban = data.auto_ban;
                    data.remembered_auto_pick = data.auto_pick;
                    data.auto_ban = None;
                    data.auto_pick = None;
                } else {
                    data.auto_ban = data.remembered_auto_ban;
                    data.auto_pick = data.remembered_auto_pick;
                }
                storage::save_data_to_path(storage::get_data_path_from_env(), &data);
                let _ = tx.send(json!({"type": "AUTO_BAN_STATE", "championId": data.auto_ban}).to_string());
                let _ = tx.send(json!({"type": "AUTO_PICK_STATE", "championId": data.auto_pick}).to_string());
                Ok(None)
            }
        }
    }
}
