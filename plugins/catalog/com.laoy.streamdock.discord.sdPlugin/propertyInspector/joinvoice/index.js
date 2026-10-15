(function () {
    let websocket = null;
    let uuid = null;
    let context = null;
    let settings = {};

    const input = document.getElementById('channelId');

    function saveSettings() {
        if (!websocket || websocket.readyState !== WebSocket.OPEN || !context) return;
        websocket.send(JSON.stringify({
            event: 'setSettings',
            context: context,
            payload: settings
        }));
    }

    function applySettings(next) {
        settings = next || {};
        input.value = settings.channelId || '';
    }

    input.addEventListener('change', function () {
        settings.channelId = (input.value || '').trim();
        saveSettings();
    });
    input.addEventListener('blur', function () {
        settings.channelId = (input.value || '').trim();
        saveSettings();
    });

    window.connectElgatoStreamDeckSocket = function (port, inUuid, registerEvent, info) {
        uuid = inUuid;
        try {
            const parsed = typeof info === 'string' ? JSON.parse(info) : info;
            context = parsed.context || inUuid;
        } catch (e) {
            context = inUuid;
        }

        websocket = new WebSocket('ws://127.0.0.1:' + port);
        websocket.onopen = function () {
            websocket.send(JSON.stringify({ event: registerEvent, uuid: uuid }));
            websocket.send(JSON.stringify({ event: 'getSettings', context: context }));
        };
        websocket.onmessage = function (evt) {
            try {
                const data = JSON.parse(evt.data);
                if (data.event === 'didReceiveSettings') {
                    applySettings(data.payload && data.payload.settings);
                }
            } catch (e) {
                console.error('[Discord PI]', e);
            }
        };
    };
})();
