use std::sync::atomic::{AtomicBool, Ordering};

pub static LOW_RESOURCE_MODE: AtomicBool = AtomicBool::new(false);

pub fn set_low_resource_mode(enabled: bool) {
    LOW_RESOURCE_MODE.store(enabled, Ordering::Relaxed);
}

pub fn is_low_resource_mode() -> bool {
    LOW_RESOURCE_MODE.load(Ordering::Relaxed)
}
