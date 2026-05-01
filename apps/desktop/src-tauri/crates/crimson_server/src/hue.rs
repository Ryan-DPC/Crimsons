use serde::{Deserialize, Serialize};
use crate::events::WsSender;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct HueState {
    pub connected: bool,
    pub bridge_ip: Option<String>,
    pub username: Option<String>,
}

pub struct HueService {
    state: Arc<RwLock<HueState>>,
    sender: WsSender,
}

impl HueService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(HueState::default())),
            sender,
        }
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match endpoint {
            "toggle" => {
                println!("Hue: Toggling lights...");
                // TODO: Implement actual Hue API call using reqwest/ureq
            }
            "scene" => {
                if let Some(p) = params {
                    let scene_id = p["payload"]["settings"]["sceneId"].as_str().or(p["sceneId"].as_str());
                    if let Some(sid) = scene_id {
                        println!("Hue: Setting scene {}...", sid);
                    }
                }
            }
            _ => return Err("Unknown Hue command".into()),
        }
        Ok(())
    }
}
