(function () {
    let websocket = null;
    let uuid = null;
    let context = null;
    let settings = {};

    const playlistInput = document.getElementById('playlist');
    const nameInput = document.getElementById('playlistName');
    const shuffleInput = document.getElementById('shuffle');

    function saveSettings() {
        if (!websocket || websocket.readyState !== WebSocket.OPEN || !context) return;
        websocket.send(JSON.stringify({
            event: 'setSettings',
            context: context,
            payload: settings
        }));
    }

    function readFormIntoSettings() {
        const raw = (playlistInput.value || '').trim();
        settings.playlist = raw;
        settings.playlistId = raw;
        settings.url = raw;
        const name = (nameInput.value || '').trim();
        if (name) {
            settings.playlistName = name;
            settings.name = name;
        } else {
            delete settings.playlistName;
            delete settings.name;
        }
        settings.shuffle = !!shuffleInput.checked;
    }

    function applySettings(next) {
        settings = next || {};
        const value =
            settings.playlist ||
            settings.playlistId ||
            settings.playlist_id ||
            settings.url ||
            settings.id ||
            settings.uri ||
            '';
        playlistInput.value = value;
        nameInput.value = settings.playlistName || settings.name || '';
        shuffleInput.checked = !!settings.shuffle;
    }

    function onChange() {
        readFormIntoSettings();
        saveSettings();
    }

    playlistInput.addEventListener('change', onChange);
    playlistInput.addEventListener('blur', onChange);
    nameInput.addEventListener('change', onChange);
    nameInput.addEventListener('blur', onChange);
    shuffleInput.addEventListener('change', onChange);

    window.connectElgatoStreamDeckSocket = function (port, inUuid, registerEvent, info) {
        uuid = inUuid;
        try {
            const parsed = typeof info === 'string' ? JSON.parse(info) : info;
            context = parsed.context || inUuid;
            if (parsed.payload && parsed.payload.settings) {
                applySettings(parsed.payload.settings);
            }
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
                console.error('[AppleMusic PlayPlaylist PI]', e);
            }
        };
    };
})();
