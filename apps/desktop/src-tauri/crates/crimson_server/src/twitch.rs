use serde::{Deserialize, Serialize};
use crate::events::WsSender;
use std::sync::Arc;
use tokio::sync::RwLock;

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
pub struct TwitchState {
    pub connected: bool,
    pub username: Option<String>,
    pub viewers: u32,
}

pub struct TwitchService {
    state: Arc<RwLock<TwitchState>>,
    sender: WsSender,
}

impl TwitchService {
    pub fn new(sender: WsSender) -> Self {
        Self {
            state: Arc::new(RwLock::new(TwitchState::default())),
            sender,
        }
    }

    pub async fn handle_command(&self, endpoint: &str, params: Option<serde_json::Value>) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
        match endpoint {
            "chat" => {
                if let Some(p) = params {
                    let message = p["payload"]["settings"]["message"].as_str().or(p["message"].as_str());
                    if let Some(msg) = message {
                        println!("Twitch: Sending chat message: {}", msg);
                    }
                }
            }
            "ad" => {
                println!("Twitch: Running ad...");
            }
            _ => return Err("Unknown Twitch command".into()),
        }
        Ok(())
    }

    pub async fn start_background_polling(&self) {
        println!("Twitch: Starting background polling for viewer count...");
        // TODO: Implement actual Twitch API polling
    }
}
