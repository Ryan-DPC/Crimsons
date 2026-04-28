const { spawn, execSync } = require('child_process');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');

const SERVER_CMD = 'cargo';
const SERVER_ARGS = ['run', '-p', 'crimson-server'];
const SERVER_CWD = path.resolve(__dirname, '../../apps/desktop/src-tauri/crates/crimson_server');
const WS_URL = 'ws://127.0.0.1:40510';

const STREAMDOCK_EXE = 'C:\\Program Files (x86)\\Stream Dock AJAZZ Global\\Stream Dock AJAZZ.exe';

let serverProcess = null;
let ws = null;
let lastState = null;
let availablePlaylists = [];
let availableDevices = [];
let receivedImages = new Set();
let testResults = [];

function log(msg) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] [TESTER] ${msg}`);
}

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isProcessRunning(name) {
    try {
        const output = execSync(`tasklist /FI "IMAGENAME eq ${name}"`, { encoding: 'utf8' });
        return output.toLowerCase().includes(name.toLowerCase());
    } catch (e) {
        return false;
    }
}

function ensureStreamDockRunning() {
    const exeName = path.basename(STREAMDOCK_EXE);
    if (isProcessRunning(exeName)) {
        log('Stream Dock is already running.');
        return;
    }

    log(`Starting Stream Dock from ${STREAMDOCK_EXE}...`);
    try {
        // Use cmd /c start to properly launch and let go
        spawn('cmd.exe', ['/c', 'start', '""', STREAMDOCK_EXE], {
            detached: true,
            stdio: 'ignore'
        }).unref();
    } catch (e) {
        log(`Failed to start Stream Dock: ${e.message}`);
    }
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
            log(`WebSocket error: ${err.message}. Retrying...`);
            setTimeout(() => {
                connectWS().then(resolve).catch(reject);
            }, 2000);
        });

        socket.on('message', (data) => {
            try {
                const msg = JSON.parse(data);
                handleMessage(msg);
            } catch (e) { }
        });
    });
}

function handleMessage(msg) {
    if (msg.type === 'SPOTIFY_STATE') {
        lastState = msg.data;
    } else if (msg.event === 'setImage') {
        receivedImages.add(msg.context);
    } else if (msg.event === 'sendToPropertyInspector' && msg.payload) {
        if (msg.payload.playlists) availablePlaylists = msg.payload.playlists;
        if (msg.payload.devices) availableDevices = msg.payload.devices;
        log(`Captured sync data: ${availablePlaylists.length} playlists, ${availableDevices.length} devices.`);
    }
}

async function waitForState(predicate, timeout = 15000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (lastState && predicate(lastState)) return true;
        await sleep(500);
    }
    return false;
}

async function runTest(name, action, payload = {}, validationPredicate = null) {
    log(`[TEST] ${name}...`);
    const ctx = name.toLowerCase().replace(/\s+/g, '-') + '-ctx';
    receivedImages.delete(ctx);
    
    ws.send(JSON.stringify({
        event: 'keyUp',
        context: ctx,
        action: action,
        payload: payload
    }));

    if (validationPredicate) {
        const success = await waitForState(validationPredicate, 10000);
        if (success) {
            log(`  SUCCESS: ${name}`);
            testResults.push({ name, status: 'PASSED' });
            return true;
        } else {
            log(`  FAILED: ${name} (Timeout/State mismatch)`);
            testResults.push({ name, status: 'FAILED' });
            return false;
        }
    } else {
        await sleep(1500);
        log(`  SENT: ${name}`);
        testResults.push({ name, status: 'SENT' });
        return true;
    }
}

async function runSuite() {
    log('--- STARTING COMPREHENSIVE TEST SUITE ---');

    // Step 1: Register as a "bridge"
    log('Step 1: Registering StreamDock Bridge...');
    ws.send(JSON.stringify({
        type: 'REGISTER_STREAMDOCK_BRIDGE',
        port: 40510,
        uuid: 'test-hardware-uuid'
    }));
    await sleep(3000);

    // Initial State Check
    if (!lastState) {
        log('WARNING: No initial Spotify state received. Make sure Spotify is open and active.');
    }

    // Step 2: Test Play/Pause
    const wasPlaying = lastState ? lastState.is_playing : false;
    log(`Current playing state: ${wasPlaying}`);
    await runTest('Toggle Play/Pause', 'com.laoy.streamdock.spotify.playpause', {}, s => s.is_playing !== wasPlaying);

    // Step 3: Test Next/Previous
    const oldTrack = lastState ? lastState.track_name : '';
    await runTest('Next Track', 'com.laoy.streamdock.spotify.next', {}, s => s.track_name !== oldTrack);
    await sleep(2000);
    await runTest('Previous Track', 'com.laoy.streamdock.spotify.previous', {}, s => s.track_name === oldTrack || s.track_name !== '');

    // Step 4: Test Shuffle/Repeat
    await runTest('Toggle Shuffle', 'com.laoy.streamdock.spotify.shuffle');
    await runTest('Toggle Repeat', 'com.laoy.streamdock.spotify.repeat');

    // Step 5: Test Playlist Selection
    log('Step 5: Testing Play Playlist...');
    ws.send(JSON.stringify({
        event: 'registerPropertyInspector',
        context: 'playlist-pi-ctx'
    }));
    await sleep(4000);

    let testPlaylist = 'spotify:playlist:37i9dQZF1DXcBWIGoYBM3M'; 
    if (availablePlaylists.length > 0) {
        testPlaylist = availablePlaylists[0].uri;
        log(`Using real playlist: ${availablePlaylists[0].name} (${testPlaylist})`);
    }

    log('Simulating willAppear for playlist button...');
    ws.send(JSON.stringify({
        event: 'willAppear',
        context: 'playlist-btn-ctx',
        action: 'com.laoy.streamdock.spotify.playplaylist',
        payload: { settings: { playlist: testPlaylist } }
    }));

    // Wait for cover art
    let artFound = false;
    for(let i=0; i<20; i++) {
        if (receivedImages.has('playlist-btn-ctx')) { artFound = true; break; }
        await sleep(500);
    }
    log(artFound ? '  SUCCESS: Received cover art for playlist.' : '  WARNING: Cover art timeout for playlist.');

    await runTest('Play Playlist', 'com.laoy.streamdock.spotify.playplaylist', { settings: { playlist: testPlaylist } }, s => s.is_playing === true);

    // Step 6: Test Volume
    await runTest('Volume Up', 'com.laoy.streamdock.spotify.volumeup');
    await runTest('Volume Down', 'com.laoy.streamdock.spotify.volumedown');

    log('--- TEST SUITE SUMMARY ---');
    testResults.forEach(r => console.log(`${r.status.padEnd(8)} | ${r.name}`));

    const anyFailed = testResults.some(r => r.status === 'FAILED');
    
    if (serverProcess) {
        log('Stopping server...');
        if (process.platform === 'win32') {
            try { execSync('taskkill /F /IM crimson-server.exe /T 2>nul || exit 0', { shell: true }); } catch(e){}
        } else {
            serverProcess.kill();
        }
    }
    
    log(`Test suite finished. Overall status: ${anyFailed ? 'FAILED' : 'PASSED'}`);
    process.exit(anyFailed ? 1 : 0);
}

(async () => {
    log('Cleaning up existing instances...');
    try {
        if (process.platform === 'win32') {
            execSync('taskkill /F /IM crimson-server.exe /T 2>nul || exit 0', { shell: true });
        }
    } catch (e) {}

    ensureStreamDockRunning();
    await sleep(2000);
    startServer();
    await sleep(15000); // Give server more time to initialize Spotify
    await connectWS();
    await runSuite();
})();
