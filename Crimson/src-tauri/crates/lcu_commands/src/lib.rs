pub mod lcu;
pub mod analyzer;
pub mod db;
pub mod automation;
pub mod sd_commands;
pub mod storage;
pub mod events;
pub mod updater_cmd;

pub struct SidecarChild(pub std::sync::Arc<tokio::sync::Mutex<Option<std::process::Child>>>);
