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

let _deviceChangeBound = false;



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

    if (!_deviceChangeBound) {

        deviceSelect.addEventListener('change', () => {

            if ($settings) $settings.device_id = deviceSelect.value;

            else _currentSettings.device_id = deviceSelect.value;

        });

        _deviceChangeBound = true;

    }

}



function requestPiData() {

    if ($websocket && $websocket.readyState === WebSocket.OPEN) {

        $websocket.sendToPlugin({ type: 'refresh' });

    }

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

        $websocket.getGlobalSettings();

        if (titleFormat) titleFormat.value = _currentSettings.titleFormat || '';

        if (showTitle) showTitle.checked = _currentSettings.showTitle || false;

        if (timeDisplay) timeDisplay.value = _currentSettings.timeDisplay || '';

        requestPiData();

    },

    sendToPropertyInspector(data) {

        if (data && data.devices) populateDevices(data.devices);

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


