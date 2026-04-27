extern crate winres;
use std::env;
use std::path::PathBuf;

fn main() {
    if env::var("CARGO_CFG_TARGET_OS").unwrap() == "windows" {
        let mut res = winres::WindowsResource::new();
        
        // Find the project root icon path
        let manifest_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
        
        // Path: src-tauri/crates/crimson_server -> src-tauri/icons/icon.ico
        let icon_path = manifest_dir.join("..").join("..").join("icons").join("icon.ico");

        if icon_path.exists() {
            res.set_icon(icon_path.to_str().unwrap());
        } else {
            println!("cargo:warning=Icon not found at {:?}", icon_path);
        }

        res.set("FileDescription", "Crimson Server");
        res.set("ProductName", "Crimson Server");
        res.set("OriginalFilename", "crimson-server.exe");
        res.compile().unwrap();
    }
}
