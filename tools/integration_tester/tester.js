const { spawn } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const SERVER_CMD = 'cargo';
const SERVER_ARGS = ['run', '-p', 'crimson-server'];
const SERVER_CWD = path.resolve(__dirname, '../../apps/desktop/src-tauri/crates/crimson_server');
const WS_URL = 'ws://127.0.0.1:40510';

let serverProcess = null;
let ws = null;
let testStep = 0;

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [TESTER] ${msg}`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function startServer() {
    log('Starting Crimson Server...');
    serverProcess = spawn(SERVER_CMD, SERVER_ARGS, {
        cwd: SERVER_CWD,
        env: { ...process.env, RUST_LOG: 'info' }
    });

    serverProcess.stdout.on('data', (data) => {
        process.stdout.write(`[SERVER] ${data}`);
    });

    serverProcess.stderr.on('data', (data) => {
        process.stderr.write(`[SERVER-ERR] ${data}`);
    });

    serverProcess.on('close', (code) => {
        log(`Server process exited with code ${code}`);
        process.exit(code);
    });
}

function connectWS() {
    return new Promise((resolve, reject) => {
        log(`Connecting to ${WS_URL}...`);
        const socket = new WebSocket(WS_URL);

        socket.on('open', () => {
            log('WebSocket connected!');
            ws = socket;
            resolve();
        });

        socket.on('error', (err) => {
            log(`WebSocket error: ${err.message}`);
            setTimeout(() => {
                connectWS().then(resolve).catch(reject);
            }, 1000);
        });

        socket.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                handleMessage(msg);
            } catch (e) {
                log(`Failed to parse message: ${data}`);
            }
        });
    });
}

let lastState = null;
let availablePlaylists = [];

function handleMessage(msg) {
    if (msg.type === 'SPOTIFY_STATE') {
        lastState = msg.data;
    } else if (msg.event === 'setImage') {
        log(`Cover Art Update received for context ${msg.context}`);
    } else if (msg.event === 'sendToPropertyInspector' && msg.payload && msg.payload.playlists) {
        availablePlaylists = msg.payload.playlists;
        log(`Captured ${availablePlaylists.length} playlists from server.`);
    }
}

async function runSuite() {
    log('--- STARTING TEST SUITE ---');

    // Step 1: Register as a "plugin"
    log('Step 1: Registering StreamDock Plugin...');
    ws.send(JSON.stringify({
        type: 'REGISTER_STREAMDOCK',
        port: 5000,
        uuid: 'test-plugin-uuid',
        register_event: 'registerPlugin'
    }));
    await sleep(2000);

    // Step 2: Test Play/Pause
    log('Step 2: Testing Play/Pause...');
    const initialPlaying = lastState ? lastState.is_playing : false;
    log(`Initial state: ${initialPlaying ? 'Playing' : 'Paused'}`);
    
    ws.send(JSON.stringify({
        type: 'SPOTIFY_COMMAND',
        endpoint: 'playpause'
    }));
    await sleep(3000);
    
    const newPlaying = lastState ? lastState.is_playing : false;
    log(`State after toggle: ${newPlaying ? 'Playing' : 'Paused'}`);
    if (newPlaying === initialPlaying && lastState && lastState.has_token) {
        log('WARNING: Play/Pause state did not toggle (or Spotify was already in that state and command was ignored)');
    } else {
        log('Play/Pause toggle successful (or state changed)');
    }

    // Step 3: Test Next/Prev
    log('Step 3: Testing Next Track...');
    const oldTrack = lastState ? lastState.track_id : null;
    ws.send(JSON.stringify({
        type: 'SPOTIFY_COMMAND',
        endpoint: 'next'
    }));
    await sleep(4000);
    const nextTrack = lastState ? lastState.track_id : null;
    if (oldTrack !== nextTrack) {
        log(`Next track successful: ${lastState.track_name}`);
    } else {
        log('Next track failed to change ID (maybe same track or error)');
    }

    // Step 4: Test Playlist Selection
    log('Step 4: Testing Playlist Selection...');
    ws.send(JSON.stringify({
        event: 'registerPropertyInspector',
        context: 'test-ctx'
    }));
    await sleep(3000);

    let testPlaylist = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM3M'; // Today's Top Hits
    if (availablePlaylists.length > 0) {
        testPlaylist = availablePlaylists[0].uri;
        log(`Using captured playlist: ${availablePlaylists[0].name} (${testPlaylist})`);
    } else {
        log(`No playlists captured, using fallback: ${testPlaylist}`);
    }

    ws.send(JSON.stringify({
        type: 'SPOTIFY_COMMAND',
        endpoint: 'play',
        payload: {
            settings: {
                playlist: testPlaylist
            }
        }
    }));
    await sleep(8000); // Wait longer for Spotify to start playing
    log(`Current track after playlist: ${lastState ? lastState.track_name : 'Unknown'}`);

    // Step 5: Test Cover Art delivery on willAppear
    log('Step 5: Testing Cover Art delivery on willAppear...');
    ws.send(JSON.stringify({
        event: 'willAppear',
        context: 'playlist-ctx',
        action: 'com.laoy.streamdock.spotify.playplaylist',
        payload: {
            settings: {
                playlist: testPlaylist
            }
        }
    }));
    await sleep(4000);
    // handleMessage will log "Cover Art Update received for context playlist-ctx"
    
    log('--- TEST SUITE COMPLETE ---');
    process.exit(0);
}

// Main execution
(async () => {
    // Kill existing instances first to avoid lock issues
    log('Cleaning up existing instances...');
    try {
        if (process.platform === 'win32') {
            spawn('taskkill', ['/F', '/IM', 'crimson-server.exe']);
        }
    } catch (e) {}

    await sleep(1000);
    startServer();
    await sleep(5000); // Wait for server to boot
    await connectWS();
    await runSuite();
})();
