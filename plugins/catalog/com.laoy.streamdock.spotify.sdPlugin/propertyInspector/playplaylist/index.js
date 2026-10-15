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
const logoutBtn = document.getElementById('DéconnexionBtn') || document.getElementById('DconnexionBtn') || document.getElementById('logoutBtn');

let _playlistsData = [];
let _playlistChangeBound = false;
let _deviceChangeBound = false;
let _currentSettings = {};
let _refreshTimer = null;

function setSelectPlaceholder(select, text) {
    if (!select) return;
    select.innerHTML = '';
    const option = document.createElement('option');
    option.value = '';
    option.text = text;
    select.appendChild(option);
}

function populatePlaylists(playlists) {
    if (!uriSelect) return;
    if (!Array.isArray(playlists) || playlists.length === 0) {
        setSelectPlaceholder(uriSelect, 'Aucune playlist');
        _playlistsData = [];
        return;
    }

    // Only rebuild if the list has changed or is empty
    if (uriSelect.options.length <= 1 || _playlistsData.length !== playlists.length) {
        uriSelect.innerHTML = '';
        playlists.forEach(item => {
            const option = document.createElement('option');
            option.value = item.uri || item.id || '';
            option.text = item.name || item.uri || 'Unknown';
            uriSelect.appendChild(option);
        });
        _playlistsData = playlists;
    }

    // Update selection based on settings
    syncSelectValue();

    if (!_playlistChangeBound) {
        uriSelect.addEventListener('change', () => {
            updatePlaylistSettings();
        });
        _playlistChangeBound = true;
    }
}

function syncSelectValue() {
    if (!uriSelect) return;
    const settings = $settings || _currentSettings || {};
    const selectedUri = settings.uri || settings.playlist || '';
    const selectedName = settings.playlistName || settings.name || '';

    if (selectedUri) {
        uriSelect.value = selectedUri;
    } else if (selectedName && _playlistsData.length > 0) {
        // Fallback to name matching if URI is missing (helps with initial "One" issue)
        const match = _playlistsData.find(p => p.name === selectedName);
        if (match) {
            uriSelect.value = match.uri || match.id;
            // Auto-update settings with the resolved URI
            updatePlaylistSettings();
        }
    }
}

function updatePlaylistSettings() {
    const val = uriSelect.value;
    if (!val) return;

    const selected = _playlistsData.find(p => (p.uri === val || p.id === val));
    const target = $settings || _currentSettings || {};

    target.uri = val;
    target.playlist = val;
    if (selected) {
        target.playlistName = selected.name;
        if (selected.image) {
            target.playlist_image = selected.image;
            target.image = selected.image;
        }
    }

    if ($settings && $websocket) {
        $websocket.saveData($settings);
    }
}

function populateDevices(devices) {
    if (!deviceSelect) return;
    if (!Array.isArray(devices) || devices.length === 0) {
        setSelectPlaceholder(deviceSelect, 'Aucun appareil');
        return;
    }

    deviceSelect.innerHTML = '';

    const settings = $settings || _currentSettings || {};
    const selectedDeviceId = settings.device_id || '';

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
            const target = $settings || _currentSettings || {};
            target.device_id = deviceSelect.value;
            if ($settings && $websocket) {
                $websocket.saveData($settings);
            }
        });
        _deviceChangeBound = true;
    }
}

function requestPiData() {
    if ($websocket && $websocket.readyState === WebSocket.OPEN) {
        $websocket.sendToPlugin({ type: 'refresh' });
    }
    if (_refreshTimer) clearTimeout(_refreshTimer);
    _refreshTimer = setTimeout(() => {
        const playlistStuck = uriSelect && uriSelect.options.length <= 1 && (!uriSelect.value || /loading|syncing/i.test(uriSelect.options[0]?.text || ''));
        const deviceStuck = deviceSelect && deviceSelect.options.length <= 1 && (!deviceSelect.value || /loading|syncing/i.test(deviceSelect.options[0]?.text || ''));
        if (playlistStuck) setSelectPlaceholder(uriSelect, 'Timeout — Actualiser');
        if (deviceStuck) setSelectPlaceholder(deviceSelect, 'Timeout — Actualiser');
    }, 8000);
}

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
        syncSelectValue();
        $websocket.getGlobalSettings();
        requestPiData();
    },

    sendToPropertyInspector(data) {
        if (_refreshTimer) {
            clearTimeout(_refreshTimer);
            _refreshTimer = null;
        }
        const payload = data?.payload && (data.payload.playlists || data.payload.devices || data.payload.error) ? data.payload : data;
        if (payload && payload.error === 'premium_required') {
            setSelectPlaceholder(uriSelect, 'Premium requis');
            setSelectPlaceholder(deviceSelect, 'Premium requis');
            return;
        }
        if (payload && payload.playlists) populatePlaylists(payload.playlists);
        if (payload && payload.devices) populateDevices(payload.devices);
        if (payload && payload.authorized === false && (!payload.playlists || payload.playlists.length === 0)) {
            if (uriSelect && uriSelect.options.length <= 1) setSelectPlaceholder(uriSelect, 'Non connecté');
            if (deviceSelect && deviceSelect.options.length <= 1) setSelectPlaceholder(deviceSelect, 'Non connecté');
        }
    }
};

// Refresh button — ask the plugin/server over the StreamDeck bridge (no raw 40510 WS)
if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
        setSelectPlaceholder(deviceSelect, 'Loading...');
        setSelectPlaceholder(uriSelect, 'Loading...');
        requestPiData();
    });
}

// Logout button
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        $websocket.setGlobalSettings({});
        $propEvent.didReceiveGlobalSettings({ settings: {} });
    });
}
