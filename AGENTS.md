# AGENTS.md

## Cursor Cloud specific instructions

CRIMSONS is a **Windows-native Tauri 2 desktop app** (React UI + Rust sidecar). See `README.md` for the full architecture. On the Linux cloud VM, only the **frontend** (`crimson/`) is runnable/testable; the Rust workspace is Windows-only.

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

### What does NOT run on Linux (Windows-only)

- `crimson-server` (`server/`) depends on the `windows` crate and Discord named pipes; `crimson/src-tauri` depends on it plus the Tauri GTK/webkit stack. CI builds/tests the Rust workspace only on `windows-latest`.
- Full end-to-end features (local WebSocket sidecar on port `40510`, League Client/LCU, Spotify, Discord, StreamDock plugins) require Windows + the real clients/hardware.
- `cargo build`/`cargo test` will not work here: the sidecar needs Windows, and even the cross-platform `lcu_commands` crate pulls in `tauri` (needs system GTK/webkit) and a transitive dep now requiring Rust edition 2024 (>1.83). Run Rust checks on Windows CI instead.
- `tools/integration_tester` and `tools/mock-lcu` are Node helpers that talk to the sidecar WS (`40510`); they only do something useful when the Windows sidecar is running.
