# AGENTS.md

## Cursor Cloud specific instructions

CRIMSONS is a **Windows-native Tauri 2 desktop app** (React UI + Rust sidecar). See `README.md` for the full architecture. On the Linux cloud VM, the **frontend** (`crimson/`) always runs, and the **Rust sidecar** (`server/`) now builds/tests/runs on Linux too (see below). The full Tauri desktop app and the peripheral/client integrations remain Windows-oriented.

### What runs on Linux (the frontend — `crimson/`)

Standard scripts live in `crimson/package.json`. From `crimson/`:

- `npm run dev` — Vite dev server at `http://localhost:5173/` (this is the dev surface; do NOT use `npm run build`, which requires the Tauri toolchain).
- `npx tsc -b` — typecheck. This is the **blocking** check in CI (`.github/workflows/ci.yml`).
- `npm run lint` — ESLint. There is a large pre-existing lint debt (mostly `@typescript-eslint/no-explicit-any`); CI runs it with `continue-on-error: true`, so a non-zero lint exit is expected and non-blocking. Do not try to fix the whole backlog.

### Required env file (non-obvious gotcha)

The frontend imports `@supabase/supabase-js`'s `createClient` at module load, and it **throws on an empty URL**, which renders as a black screen (the README calls this out). To boot the UI you MUST have `crimson/.env` (git-ignored) with:

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Placeholder values (e.g. `https://mock.supabase.co` / any string) are enough to render the login screen and exercise the UI. A **real** Supabase project is required to actually sign up / log in; without it, submitting the login form fails with `Failed to fetch`, which is expected on the VM. If you see a black screen, the missing/empty `crimson/.env` is almost always the cause.

The app is a Tauri app, so `@tauri-apps/api/*` calls (window controls, `invoke`, `getVersion`) are no-ops/errors in a plain browser but degrade gracefully — the login screen renders and form interaction works without any mocks.

### Building the Rust sidecar (`server/`) on Linux

The `crimson-server` sidecar builds, unit-tests, and runs on Linux (Discord IPC is transport-abstracted: named pipe on Windows, Unix socket elsewhere; the Win32-only `windows` crate is target-gated). It is NOT in the update script (system deps / toolchain changes are out of scope there). Prerequisites, one-time:

- Rust >= 1.85 (a transitive dep requires edition 2024). The VM's pinned default may be older — `rustup default stable` fixes it.
- System libs: `sudo apt-get install -y pkg-config libssl-dev libx11-dev libxi-dev libxtst-dev` (OpenSSL for `native-tls`; X11 for `rdev` hotkeys).

Then, from the repo root:

- `cargo build -p crimson-server` — compiles on Linux.
- `cargo test -p crimson-server --lib` — the same suite CI runs on Windows (origin/auth + automation + storage tests).
- Run it with `CRIMSON_DEV=1 ./target/debug/crimson-server` (the dev guard refuses to start otherwise). It listens on `127.0.0.1:40510`. Note `get_data_dir()` keys off `APPDATA` (empty on Linux), so logs/data land under `./com.laoy.crimsons/` relative to the CWD.

### Still Windows-only

- The full **Tauri desktop app** (`crimson/src-tauri`, and `lcu_commands` which pulls in `tauri`) needs the GTK/webkit stack (`libwebkit2gtk-4.1-dev`, `libgtk-3-dev`, `libsoup-3.0-dev`, `librsvg2-dev`, `libayatana-appindicator3-dev`) and has not been ported/verified on Linux.
- **Runtime** integrations still require Windows + real clients/hardware: League Client/LCU (Riot blocks Linux via Vanguard), StreamDock (Windows/macOS host app), and the PowerShell-based Discord aux-audio/screenshare helpers (`server/src/discord.rs`) which no-op-fail on Linux. Core Discord IPC (mute/deafen/voice status) works on Linux if Discord is running.
- `tools/integration_tester` and `tools/mock-lcu` are Node helpers that talk to the sidecar WS (`40510`).
