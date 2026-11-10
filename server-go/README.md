# crimsons-server (Go)

Go rewrite of the Crimsons local sidecar (`server/` Rust crate). Same binary name, same port, same WebSocket contract so the Tauri UI and StreamDock plugins do not need to change.

| | |
|---|---|
| Binary | `crimsons-server` |
| Listen | `127.0.0.1:40510` (+ best-effort `[::1]`) |
| Auth file | `%APPDATA%/com.laoy.crimsons/auth.token` |
| Token HTTP | `GET /local/ws-token` |
| Dev guard | `CRIMSON_DEV=1` required for non-release builds |

## Status

**Skeleton (this PR)** — boots, enforces origin + WS token, heartbeats, `PLUGIN_PREFS` / `AUTH_SESSION*` / auto-accept / plugin toggles, data.json round-trip.

Still on the Rust sidecar until ported:

- Spotify OAuth + playback
- Discord IPC
- League LCU / champ-select automation
- StreamDock bridge
- Hotkeys / Hue / Twitch stubs

Keep `server/` until feature parity; then switch `scripts/build_release.ps1` + CI to `server-go` and drop the Rust crate.

## Build / run

```bash
cd server-go
make test
make build
CRIMSON_DEV=1 ./bin/crimsons-server
```

Release embed (Supabase URL/key baked in, like Rust `build.rs`):

```bash
make build-release   # requires ../crimson/.env
```

Windows packaging will copy `bin/crimsons-server.exe` to `crimson/src-tauri/bin/crimsons-server-x86_64-pc-windows-msvc.exe` once CI flips over.

## Env

| Variable | Meaning |
|---|---|
| `CRIMSON_DEV=1` | Allow non-release binary to start |
| `CRIMSON_STRICT_AUTH=0` | Accept WS without token (debug only) |
| `CRIMSON_SUPABASE_URL` / `CRIMSON_SUPABASE_ANON_KEY` | Override embed / `.env` |
| `APPDATA` | Data root (Linux/dev: falls back to `./com.laoy.crimsons`) |
