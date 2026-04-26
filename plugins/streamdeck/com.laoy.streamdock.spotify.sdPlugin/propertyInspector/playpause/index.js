/// <reference path="../utils/common.js" />
/// <reference path="../utils/action.js" />

const $local = false, $back = true, $dom = {
    main: $('.sdpi-wrapper'),
};

const deviceSelect = document.getElementById('deviceSelect');
const titleFormat = document.getElementById('titleFormat');
const showTitle = document.getElementById('showTitle');
const timeDisplay = document.getElementById('timeDisplay');
const logoutBtn = document.getElementById('logoutBtn');

let _currentSettings = {};

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
    deviceSelect.addEventListener('change', () => {
        if ($settings) $settings.device_id = deviceSelect.value;
        else _currentSettings.device_id = deviceSelect.value;
    });
}

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
                    if (data.payload.devices) populateDevices(data.payload.devices);
                }
            } catch (err) { console.error('Crimson parse error', err); }
        };
        setTimeout(() => {
            if (deviceSelect && (deviceSelect.innerHTML === '' || deviceSelect.querySelector('option[value=""]'))) {
                crimsonDirectFetch();
            }
        }, 3000);
    } catch (e) { console.error('Crimson Direct Fetch failed', e); }
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
        _currentSettings = data || {};
        $websocket.getGlobalSettings();
        if (titleFormat) titleFormat.value = _currentSettings.titleFormat || '';
        if (showTitle) showTitle.checked = _currentSettings.showTitle || false;
        if (timeDisplay) timeDisplay.value = _currentSettings.timeDisplay || '';
    }
};

if (timeDisplay) timeDisplay.addEventListener('change', () => { if ($settings) $settings.timeDisplay = timeDisplay.value; });
if (showTitle) showTitle.addEventListener('change', () => { if ($settings) $settings.showTitle = showTitle.checked; });
if (titleFormat) titleFormat.addEventListener('change', () => { if ($settings) $settings.titleFormat = titleFormat.value; });

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        $websocket.setGlobalSettings({});
        $propEvent.didReceiveGlobalSettings({ settings: {} });
    });
}

document.addEventListener('DOMContentLoaded', crimsonDirectFetch);
setTimeout(crimsonDirectFetch, 300);