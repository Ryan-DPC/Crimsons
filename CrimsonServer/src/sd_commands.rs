use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct StreamDeckCommand {
    pub action: String,
    pub payload: serde_json::Value,
}
