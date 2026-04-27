/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// $local: no translation needed, $back: we handle display ourselves
const $local = false, $back = true, $dom = {
    main: $('.sdpi-wrapper'),
};

let deviceSelect, uriSelect;
let _currentSettings = {};
let _playlistsData = [];

function initUI() {
    deviceSelect = document.getElementById('deviceSelect');
    uriSelect = document.getElementById('uri');
    const refreshBtn = document.getElementById('Actualiser') || document.getElementById('refresh');
    const logoutBtn = document.getElementById('DéconnexionBtn') || document.getElementById('logoutBtn') || document.getElementById('DconnexionBtn');
    
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (deviceSelect) deviceSelect.innerHTML = '<option value="">Loading...</option>';
            if (uriSelect) uriSelect.innerHTML = '<option value="">Loading...</option>';
            crimsonDirectFetch();
        });
    }

    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            $websocket.setGlobalSettings({});
            $propEvent.didReceiveGlobalSettings({ settings: {} });
        });
    }

    if (uriSelect) {
        uriSelect.addEventListener('change', () => {
            _currentSettings.uri = uriSelect.value;
            _currentSettings.playlist = uriSelect.options[uriSelect.selectedIndex].text;
            
            // Find and store the image URL
            const selected = _playlistsData.find(p => p.uri === uriSelect.value);
            if (selected && selected.image) {
                _currentSettings.playlist_image = selected.image;
            }
            
            saveSettings();
        });
    }

    if (deviceSelect) {
        deviceSelect.addEventListener('change', () => {
            _currentSettings.device_id = deviceSelect.value;
            saveSettings();
        });
    }
}

function saveSettings() {
    // 1. Save to StreamDock Software
    if (window.$websocket) {
        $websocket.saveData(_currentSettings);
    }
    // 2. Save DIRECTLY to Crimson Server
    crimsonDirectSave(_currentSettings);
}

function crimsonDirectSave(settings) {
    if (window.crimsonSocket && window.crimsonSocket.readyState === WebSocket.OPEN) {
        window.crimsonSocket.send(JSON.stringify({
            type: "SAVE_SETTINGS",
            context: $uuid,
            settings: settings
        }));
    }
}

function populatePlaylists(playlists) {
    if (!uriSelect || !Array.isArray(playlists) || playlists.length === 0) return;
    _playlistsData = playlists;
    uriSelect.innerHTML = '';
    
    playlists.forEach(item => {
        const option = document.createElement('option');
        option.value = item.uri || item.id || '';
        option.text = item.name || item.uri || 'Unknown';
        if (_currentSettings.uri && item.uri === _currentSettings.uri) option.selected = true;
        uriSelect.appendChild(option);
    });
}

function populateDevices(devices) {
    if (!deviceSelect || !Array.isArray(devices) || devices.length === 0) return;
    deviceSelect.innerHTML = '';
    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id || '';
        option.text = `${device.name || 'Unknown'} (${device.type || '?'})${device.is_active ? ' ✓' : ''}`;
        if (_currentSettings.device_id && device.id === _currentSettings.device_id) option.selected = true;
        deviceSelect.appendChild(option);
    });
}

function crimsonDirectFetch() {
    try {
        if (window.crimsonSocket && window.crimsonSocket.readyState === WebSocket.OPEN) {
             window.crimsonSocket.send(JSON.stringify({ event: 'registerPropertyInspector', uuid: $uuid || 'pi' }));
             return;
        }

        const ws = new WebSocket('ws://127.0.0.1:40510');
        window.crimsonSocket = ws;
        ws.onopen = () => {
            ws.send(JSON.stringify({ event: 'registerPropertyInspector', uuid: $uuid || 'pi' }));
        };
        ws.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data.event === 'sendToPropertyInspector' && data.payload) {
                    if (data.payload.playlists) populatePlaylists(data.payload.playlists);
                    if (data.payload.devices) populateDevices(data.payload.devices);
                }
            } catch (err) { console.error('Crimson parse error', err); }
        };
    } catch (e) { console.error('Crimson Direct Fetch failed', e); }
}

const $propEvent = {
    didReceiveGlobalSettings({ settings }) {
        if (!settings || !('access_token' in settings)) {
            // Only open if we don't have tokens at all
            if (!window.crimsonAuthOpened) {
                window.crimsonAuthOpened = true;
                const top = (window.screen.height - 800) / 2;
                const left = (window.screen.width - 550) / 2;
                window.open('../utils/authorization.html', '_blank', `width=800,height=550,top=${top},left=${left}`);
            }
        }
    },
    didReceiveSettings(data) {
        // IMPORTANT: data here is the payload, so settings are in data.settings
        _currentSettings = data.settings || {};
        
        // Update UI if dropdowns already exist
        if (uriSelect && _currentSettings.uri) {
             Array.from(uriSelect.options).forEach(opt => {
                 if (opt.value === _currentSettings.uri) opt.selected = true;
             });
        }
        if (deviceSelect && _currentSettings.device_id) {
             Array.from(deviceSelect.options).forEach(opt => {
                 if (opt.value === _currentSettings.device_id) opt.selected = true;
             });
        }

        $websocket.getGlobalSettings();
        crimsonDirectFetch();
    },
    sendToPropertyInspector(data) {
        if (data && data.playlists) populatePlaylists(data.playlists);
        if (data && data.devices) populateDevices(data.devices);
    }
};

document.addEventListener('DOMContentLoaded', () => {
    initUI();
});
