use tokio::sync::broadcast;

#[derive(Clone)]
pub struct WsSender(pub broadcast::Sender<String>);
