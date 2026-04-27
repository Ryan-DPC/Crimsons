import { execSync } from 'child_process';
execSync('npx tauri init --ci --app-name lol-assistant --window-title "LoL Assistant" --frontend-dist ../dist --dev-url http://localhost:5173 --before-dev-command "npm run dev" --before-build-command "npm run build"', { stdio: 'inherit' });
