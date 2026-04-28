/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

// $local: no translation needed, $back: we handle display ourselves
const $local = false, $back = true, $dom = {
    main: $('.sdpi-wrapper'),
};

// Safe element getters
const deviceSelect = document.getElementById('deviceSelect');
const uriSelect = document.getElementById('uri');
const refreshBtn = document.getElementById('Actualiser') || document.getElementById('refresh');
const logoutBtn = document.getElementById('DéconnexionBtn') || document.getElementById('logoutBtn');

// =============================================
// CRIMSON DIRECT SYNC — fetches data from the
// Crimson backend without needing $settings
// =============================================
let _playlistsData = [];
let _playlistChangeBound = false;
let _deviceChangeBound = false;

function populatePlaylists(playlists) {
    if (!uriSelect || !Array.isArray(playlists) || playlists.length === 0) return;
    _playlistsData = playlists;
    uriSelect.innerHTML = '';
    const selectedUri = _currentSettings?.uri || _currentSettings?.playlist || '';
    playlists.forEach(item => {
        const option = document.createElement('option');
        option.value = item.uri || item.id || '';
        option.text = item.name || item.uri || 'Unknown';
        if (selectedUri && option.value === selectedUri) option.selected = true;
        uriSelect.appendChild(option);
    });
    if (!uriSelect.value && uriSelect.options.length > 0) {
        uriSelect.selectedIndex = 0;
    }
    if (!_playlistChangeBound) {
        uriSelect.addEventListener('change', () => {
            if ($settings) {
                $settings.uri = uriSelect.value;
                $settings.playlist = uriSelect.value;

                // Find and store the image URL
                const selected = _playlistsData.find(p => p.uri === uriSelect.value);
                if (selected && selected.image) {
                    $settings.playlist_image = selected.image;
                }

                $websocket.setSettings($settings);
            } else {
                _currentSettings.uri = uriSelect.value;
                _currentSettings.playlist = uriSelect.value;
            }
        });
        _playlistChangeBound = true;
    }
}

function populateDevices(devices) {
    if (!deviceSelect || !Array.isArray(devices) || devices.length === 0) return;
    deviceSelect.innerHTML = '';
    const selectedDeviceId = _currentSettings?.device_id || '';
    devices.forEach(device => {
        const option = document.createElement('option');
        option.value = device.id || '';
        option.text = `${device.name || 'Unknown'} (${device.type || '?'})${device.is_active ? ' ✓' : ''}`;
        if (selectedDeviceId && device.id === selectedDeviceId) option.selected = true;
        deviceSelect.appendChild(option);
    });
    if (!deviceSelect.value) {
        const active = devices.find(d => d.is_active);
        if (active?.id) deviceSelect.value = active.id;
    }
    if (!_deviceChangeBound) {
        deviceSelect.addEventListener('change', () => {
            if ($settings) {
                $settings.device_id = deviceSelect.value;
                $websocket.setSettings($settings);
            } else {
                _currentSettings.device_id = deviceSelect.value;
            }
        });
        _deviceChangeBound = true;
    }
}

// Immediately connect to Crimson and request data
function crimsonDirectFetch() {
    try {
        const ws = new WebSocket('ws://127.0.0.1:40510');
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
        ws.onerror = () => console.warn('Crimson WS error — will retry via polling');
        // Keep trying every 3s until we have data
        setTimeout(() => {
            if (uriSelect && (uriSelect.innerHTML === '' || uriSelect.querySelector('option[value=""]'))) {
                crimsonDirectFetch();
            }
        }, 3000);
    } catch (e) { console.error('Crimson Direct Fetch failed', e); }
}

// =============================================
// STANDARD PROPERTY INSPECTOR EVENTS
// =============================================
const $propEvent = {
    didReceiveGlobalSettings({ settings }) {
        if (!settings || !('access_token' in settings)) {
            window.$websocket = $websocket;
            window.$lang = $lang || {};
            const screenWidth = window.screen.width;
            const screenHeight = window.screen.height;
            const top = (screenHeight - 800) / 2;
            const left = (screenWidth - 550) / 2;
            window.open('../utils/authorization.html', '_blank', `width=800,height=550,top=${top},left=${left}`);
        }
    },
    didReceiveSettings(data) {
        _currentSettings = data?.settings || data || {};
        $websocket.getGlobalSettings();
    },
    sendToPropertyInspector(data) {
        if (data && data.playlists) populatePlaylists(data.playlists);
        if (data && data.devices) populateDevices(data.devices);
    }
};

// Refresh button
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        if (deviceSelect) deviceSelect.innerHTML = '<option value="">Loading...</option>';
        if (uriSelect) uriSelect.innerHTML = '<option value="">Loading...</option>';
        crimsonDirectFetch();
    });
}

// Logout button
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        $websocket.setGlobalSettings({});
        $propEvent.didReceiveGlobalSettings({ settings: {} });
    });
}

// Kick off the direct fetch immediately when the page loads
document.addEventListener('DOMContentLoaded', () => {
    crimsonDirectFetch();
});

// Also fire after a short delay in case DOMContentLoaded already fired
setTimeout(crimsonDirectFetch, 300);
