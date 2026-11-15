(function () {
    const CIDER_BASE = 'http://127.0.0.1:10767';

    let websocket = null;
    let uuid = null;
    let context = null;
    let action = null;
    let settings = {};
    let playlists = [];
    let loading = false;
    let ciderTokenOverride = '';
    let coverInFlight = 0;

    const selectEl = document.getElementById('playlistSelect');
    const manualEl = document.getElementById('playlistManual');
    const shuffleEl = document.getElementById('shuffle');
    const statusEl = document.getElementById('status');
    const refreshBtn = document.getElementById('refresh');
    const tokenBox = document.getElementById('tokenBox');
    const tokenInput = document.getElementById('ciderToken');
    const saveTokenBtn = document.getElementById('saveToken');

    function setStatus(text, kind) {
        statusEl.textContent = text || '';
        statusEl.className = 'status' + (kind ? (' ' + kind) : '');
    }

    function showTokenBox(show) {
        if (show) tokenBox.classList.add('visible');
        else tokenBox.classList.remove('visible');
    }

    function crimsonAuthToken() {
        try {
            var xhr = new XMLHttpRequest();
            xhr.open('GET', 'http://127.0.0.1:40510/local/ws-token', false);
            xhr.send(null);
            if (xhr.status === 200 && xhr.responseText) return String(xhr.responseText).trim();
        } catch (e) {}
        try {
            if (window.__CRIMSON_AUTH_TOKEN__) return String(window.__CRIMSON_AUTH_TOKEN__).trim();
        } catch (e2) {}
        return '';
    }

    function persistTokenToCrimsons(token) {
        // Mirror Now Playing PI: clear the disconnect flag so getCiderToken works offline.
        try {
            const fs = require('fs');
            const path = require('path');
            const cachePath = path.join(process.env.APPDATA || '', 'com.laoy.crimsons', 'cider_cache.json');
            const parent = path.dirname(cachePath);
            if (!fs.existsSync(parent)) fs.mkdirSync(parent, { recursive: true });
            fs.writeFileSync(
                cachePath,
                JSON.stringify({ appToken: token || '', cleared: !token }, null, 2),
                'utf8'
            );
        } catch (eDisk) {}
        var wsToken = crimsonAuthToken();
        var url = wsToken
            ? 'ws://127.0.0.1:40510/?token=' + encodeURIComponent(wsToken)
            : 'ws://127.0.0.1:40510';
        try {
            var ws = new WebSocket(url);
            ws.onopen = function () {
                ws.send(JSON.stringify({ type: 'APPLE_MUSIC_CREDENTIALS', appToken: token }));
                setTimeout(function () { try { ws.close(); } catch (e) {} }, 400);
            };
        } catch (e) {}
    }

    function getCiderToken() {
        if (ciderTokenOverride) return ciderTokenOverride;
        try {
            const fs = require('fs');
            const path = require('path');
            const appdata = process.env.APPDATA || '';
            const cachePath = path.join(appdata, 'com.laoy.crimsons', 'cider_cache.json');
            if (fs.existsSync(cachePath)) {
                const raw = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
                // Align with Now Playing PI disconnect — do not fall through to spa-config.
                if (raw && raw.cleared === true) return '';
                if (raw && raw.appToken && String(raw.appToken).trim()) {
                    return String(raw.appToken).trim();
                }
            }
        } catch (eCache) {}
        try {
            const ls = localStorage.getItem('cider_token');
            if (ls && ls.trim()) return ls.trim();
        } catch (e1) {}
        try {
            const fs = require('fs');
            const path = require('path');
            const appdata = process.env.APPDATA || '';
            const cfgPath = path.join(appdata, 'sh.cider.dotnet', 'spa-config.yml');
            if (fs.existsSync(cfgPath)) {
                const content = fs.readFileSync(cfgPath, 'utf8');
                const m = content.match(/token:\s*([^\r\n]+)/);
                if (m && m[1]) {
                    const tok = m[1].trim().replace(/^['"]|['"]$/g, '');
                    if (tok) return tok;
                }
            }
        } catch (e2) {}
        try {
            if (window.__CIDER_APP_TOKEN__) return String(window.__CIDER_APP_TOKEN__).trim();
        } catch (e0) {}
        return '';
    }

    function normalizeArtworkUrl(raw) {
        if (!raw || typeof raw !== 'string') return '';
        return raw
            .replace(/\{w\}x\{h\}bb/g, '144x144bb')
            .replace('{w}', '144')
            .replace('{h}', '144')
            .replace(/\/1200x1200bb\.(png|jpg)/gi, '/144x144bb.jpg')
            .replace(/\/600x600bb\.(png|jpg)/gi, '/144x144bb.$1')
            .replace(/\/300x300bb\.(png|jpg)/gi, '/144x144bb.$1');
    }

    function extractArtwork(item) {
        if (!item) return '';
        const art = item.artwork || (item.attributes && item.attributes.artwork) || null;
        const candidates = [
            art && art.url,
            art && art.uri,
            typeof art === 'string' ? art : null,
            item.artworkUrl,
            item.image,
            item.attributes && item.attributes.artworkUrl
        ];
        for (let i = 0; i < candidates.length; i++) {
            const c = candidates[i];
            if (typeof c === 'string' && c.trim() && /^https?:\/\//i.test(c.trim())) {
                return normalizeArtworkUrl(c.trim());
            }
        }
        return '';
    }

    function normalizeItems(json) {
        const out = [];
        const seen = {};
        const data = json && json.data;
        const itemsA = data && Array.isArray(data.items) ? data.items : null;
        const itemsB = Array.isArray(data) ? data : (data && Array.isArray(data.data) ? data.data : null);
        const list = itemsA || itemsB || (Array.isArray(json) ? json : []);

        list.forEach((item) => {
            if (!item) return;
            const id = item.id
                || (item.attributes && item.attributes.playParams && item.attributes.playParams.id)
                || item.playlistId
                || '';
            if (!id || seen[id]) return;
            seen[id] = true;
            const name = item.name
                || (item.attributes && item.attributes.name)
                || '';
            out.push({
                id: String(id),
                name: name || String(id),
                image: extractArtwork(item)
            });
        });
        out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        return out;
    }

    async function ciderGet(path) {
        const headers = {};
        const token = getCiderToken();
        if (token) headers.apptoken = token;
        const resp = await fetch(CIDER_BASE + path, { method: 'GET', headers });
        if (!resp.ok) {
            const text = await resp.text().catch(() => '');
            throw new Error('Cider ' + resp.status + (text ? (': ' + text.slice(0, 120)) : ''));
        }
        return resp.json();
    }

    async function artworkFromFirstTrack(playlistId) {
        if (!playlistId) return '';
        try {
            const json = await ciderGet(
                '/api/v2/library/playlists/' + encodeURIComponent(playlistId) + '/songs?limit=1'
            );
            const items = (json && json.data && Array.isArray(json.data.items))
                ? json.data.items
                : (Array.isArray(json && json.data) ? json.data : []);
            if (!items.length) return '';
            return extractArtwork(items[0]);
        } catch (e) {
            return '';
        }
    }

    async function resolveCoverForPlaylist(p) {
        if (!p) return '';
        if (p.image) return p.image;
        const art = await artworkFromFirstTrack(p.id);
        if (art) p.image = art;
        return art || '';
    }

    async function fetchAllPlaylistsFromCider() {
        const all = [];
        const seen = {};
        let offset = 0;
        const limit = 100;
        for (let page = 0; page < 20; page++) {
            const json = await ciderGet('/api/v2/library/playlists?limit=' + limit + '&offset=' + offset);
            const batch = normalizeItems(json);
            batch.forEach((p) => {
                if (!seen[p.id]) {
                    seen[p.id] = true;
                    all.push(p);
                }
            });
            const total = (json.meta && typeof json.meta.total === 'number') ? json.meta.total : null;
            offset += limit;
            if (batch.length < limit) break;
            if (total !== null && offset >= total) break;
        }
        all.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        return all;
    }

    function selectedValue() {
        return (settings.playlist || settings.playlistId || settings.url || settings.id || '').trim();
    }

    function populateSelect(list) {
        playlists = Array.isArray(list) ? list : [];
        const current = selectedValue();
        selectEl.innerHTML = '';

        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = playlists.length ? 'Choisir une playlist…' : 'Aucune playlist';
        selectEl.appendChild(placeholder);

        playlists.forEach((p) => {
            const opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name || p.id;
            selectEl.appendChild(opt);
        });

        if (current) {
            const match = playlists.find((p) => p.id === current || p.name === current);
            if (match) {
                selectEl.value = match.id;
                manualEl.value = '';
            } else {
                selectEl.value = '';
                manualEl.value = current;
            }
        }
    }

    function sdSend(obj) {
        if (!websocket || websocket.readyState !== WebSocket.OPEN) return false;
        websocket.send(JSON.stringify(obj));
        return true;
    }

    function saveSettings() {
        if (!context) return;
        sdSend({
            event: 'setSettings',
            context: context,
            payload: settings
        });
    }

    function nodeFetchBuffer(url) {
        return new Promise(function (resolve, reject) {
            try {
                var lib = url.indexOf('https') === 0 ? require('https') : require('http');
                var req = lib.get(url, { timeout: 8000 }, function (res) {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        nodeFetchBuffer(res.headers.location).then(resolve, reject);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error('HTTP ' + res.statusCode));
                        res.resume();
                        return;
                    }
                    var chunks = [];
                    res.on('data', function (c) { chunks.push(c); });
                    res.on('end', function () { resolve(Buffer.concat(chunks)); });
                });
                req.on('error', reject);
                req.on('timeout', function () {
                    try { req.destroy(); } catch (e) {}
                    reject(new Error('timeout'));
                });
            } catch (e) {
                reject(e);
            }
        });
    }

    /** Convert image URL → data URL for StreamDock setImage (no plugin round-trip). */
    async function urlToDataUrl(url) {
        if (!url) return null;
        if (url.startsWith('data:')) return url;

        // 1) Node https (StreamDock PI often has Node — bypasses CDN CORS)
        try {
            var buf = await nodeFetchBuffer(url);
            if (buf && buf.length) {
                var mime = /\.png(\?|$)/i.test(url) ? 'image/png' : 'image/jpeg';
                var dataUrl = 'data:' + mime + ';base64,' + buf.toString('base64');
                return await resizeDataUrl(dataUrl, 144);
            }
        } catch (eNode) {}

        // 2) fetch blob
        try {
            const resp = await fetch(url, { cache: 'force-cache' });
            if (resp && resp.ok) {
                const blob = await resp.blob();
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (dataUrl) return await resizeDataUrl(dataUrl, 144);
            }
        } catch (e1) {}

        // 3) Image + canvas
        try {
            const dataUrl = await new Promise((resolve) => {
                const img = new Image();
                img.crossOrigin = 'Anonymous';
                img.onload = function () {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = 144;
                        canvas.height = 144;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, 144, 144);
                        resolve(canvas.toDataURL('image/jpeg', 0.85));
                    } catch (e) {
                        resolve(null);
                    }
                };
                img.onerror = function () { resolve(null); };
                img.src = url;
            });
            if (dataUrl) return dataUrl;
        } catch (e2) {}

        return null;
    }

    function resizeDataUrl(dataUrl, size) {
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = function () {
                    try {
                        const canvas = document.createElement('canvas');
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, size, size);
                        resolve(canvas.toDataURL('image/jpeg', 0.85));
                    } catch (e) {
                        resolve(dataUrl);
                    }
                };
                img.onerror = function () { resolve(dataUrl); };
                img.src = dataUrl;
            } catch (e) {
                resolve(dataUrl);
            }
        });
    }

    /** Paint cover on the key immediately from the Property Inspector socket. */
    function paintCoverOnKey(dataUrl) {
        if (!dataUrl || !context) return false;
        const okImg = sdSend({
            event: 'setImage',
            context: context,
            payload: { image: dataUrl, target: 0 }
        });
        // Keep playlist name on the key (cover is background — do not blank title).
        const label = String(settings.playlistName || settings.name || '').slice(0, 14);
        if (label) {
            sdSend({
                event: 'setTitle',
                context: context,
                payload: { title: label, target: 0 }
            });
        }
        return okImg;
    }

    async function applyCoverNow(selected) {
        const ticket = ++coverInFlight;
        setStatus('Récupération de la cover…');
        let url = selected && selected.image ? selected.image : '';
        if (!url && selected && selected.id) {
            url = await resolveCoverForPlaylist(selected);
        }
        if (ticket !== coverInFlight) return; // superseded
        if (!url) {
            setStatus('Pas de cover pour cette playlist (artwork vide).', 'err');
            return;
        }

        settings.playlist_image = url;
        settings.image = url;
        saveSettings();

        const dataUrl = await urlToDataUrl(url);
        if (ticket !== coverInFlight) return;
        if (!dataUrl) {
            // Still ask plugin — it has Node https which can download mzstatic
            sdSend({
                event: 'sendToPlugin',
                action: action,
                context: context || uuid,
                payload: { type: 'refreshCover', settings: settings }
            });
            setStatus('Cover demandée au plugin…', 'ok');
            return;
        }

        if (paintCoverOnKey(dataUrl)) {
            setStatus('Cover appliquée sur le bouton', 'ok');
        } else {
            setStatus('Socket StreamDock fermée — reclique le bouton.', 'err');
        }

        // Also notify plugin so willAppear/cache stay in sync
        sdSend({
            event: 'sendToPlugin',
            action: action,
            context: context || uuid,
            payload: { type: 'refreshCover', settings: settings }
        });
    }

    function commitFromUi() {
        const fromSelect = (selectEl.value || '').trim();
        const fromManual = (manualEl.value || '').trim();
        const raw = fromSelect || fromManual;
        const selected = playlists.find((p) => p.id === fromSelect);

        settings.playlist = raw;
        settings.playlistId = raw;
        settings.url = raw;
        settings.shuffle = !!shuffleEl.checked;

        if (selected && selected.name) {
            settings.playlistName = selected.name;
            settings.name = selected.name;
        } else {
            delete settings.playlistName;
            delete settings.name;
        }

        if (selected && selected.image) {
            settings.playlist_image = selected.image;
            settings.image = selected.image;
        } else {
            delete settings.playlist_image;
            delete settings.image;
        }

        saveSettings();

        if (selected) {
            applyCoverNow(selected);
        } else if (raw) {
            applyCoverNow({ id: raw, name: settings.playlistName || raw, image: '' });
        }
    }

    async function loadPlaylists(source) {
        if (loading) return;
        loading = true;
        setStatus('Chargement des playlists…');
        selectEl.innerHTML = '';
        const loadingOpt = document.createElement('option');
        loadingOpt.value = '';
        loadingOpt.textContent = 'Chargement…';
        selectEl.appendChild(loadingOpt);

        try {
            if (source !== 'plugin') {
                const list = await fetchAllPlaylistsFromCider();
                populateSelect(list);
                showTokenBox(false);
                if (list.length) {
                    setStatus(list.length + ' playlist(s)', 'ok');
                    // Auto-apply cover for already-selected playlist
                    const cur = selectedValue();
                    const match = list.find((p) => p.id === cur || p.name === cur);
                    if (match) applyCoverNow(match);
                } else {
                    setStatus('Aucune playlist dans la bibliothèque Cider.', 'err');
                }
            }
        } catch (e) {
            const msg = (e && e.message) ? String(e.message) : '';
            if (playlists.length) {
                populateSelect(playlists);
                setStatus(playlists.length + ' playlist(s)', 'ok');
            } else {
                populateSelect([]);
                showTokenBox(true);
                if (/UNAUTHORIZED|403/i.test(msg)) {
                    setStatus('Jeton Cider manquant ou invalide — colle un apptoken avec scope Library ci-dessous.', 'err');
                } else {
                    setStatus('Cider injoignable. Lance Cider, puis Actualiser. ' + (msg ? '(' + msg + ')' : ''), 'err');
                }
            }
            requestFromPlugin();
        } finally {
            loading = false;
            shuffleEl.checked = !!settings.shuffle;
        }
    }

    function requestFromPlugin() {
        sdSend({
            event: 'sendToPlugin',
            action: action,
            context: context || uuid,
            payload: { type: 'refreshPlaylists' }
        });
    }

    selectEl.addEventListener('change', function () {
        if (selectEl.value) manualEl.value = '';
        commitFromUi();
    });
    manualEl.addEventListener('change', function () {
        if (manualEl.value.trim()) selectEl.value = '';
        commitFromUi();
    });
    manualEl.addEventListener('blur', function () {
        if (manualEl.value.trim()) selectEl.value = '';
        commitFromUi();
    });
    shuffleEl.addEventListener('change', function () {
        settings.shuffle = !!shuffleEl.checked;
        saveSettings();
    });
    refreshBtn.addEventListener('click', function () {
        loadPlaylists('cider');
        requestFromPlugin();
    });

    saveTokenBtn.addEventListener('click', function () {
        const tok = (tokenInput.value || '').trim();
        if (!tok) {
            setStatus('Colle un jeton avant de valider.', 'err');
            return;
        }
        ciderTokenOverride = tok;
        try { localStorage.setItem('cider_token', tok); } catch (e) {}
        try { window.__CIDER_APP_TOKEN__ = tok; } catch (e2) {}
        persistTokenToCrimsons(tok);
        setStatus('Jeton enregistré — rechargement…', 'ok');
        loadPlaylists('cider');
        requestFromPlugin();
    });

    window.connectElgatoStreamDeckSocket = function (port, inUuid, registerEvent, _appInfo, actionInfo) {
        uuid = inUuid;
        try {
            const parsed = typeof actionInfo === 'string' ? JSON.parse(actionInfo) : (actionInfo || {});
            context = parsed.context || inUuid;
            action = parsed.action || 'com.laoy.streamdock.applemusic.playplaylist';
            if (parsed.payload && parsed.payload.settings) {
                settings = Object.assign({}, parsed.payload.settings);
            }
        } catch (e) {
            context = inUuid;
            action = 'com.laoy.streamdock.applemusic.playplaylist';
        }

        shuffleEl.checked = !!settings.shuffle;
        const current = selectedValue();
        if (current && (current.includes('://') || current.startsWith('pl.') || current.startsWith('p.'))) {
            manualEl.value = current;
        }
        try {
            const existing = localStorage.getItem('cider_token');
            if (existing) tokenInput.value = existing;
        } catch (eLs) {}

        websocket = new WebSocket('ws://127.0.0.1:' + port);
        websocket.onopen = function () {
            websocket.send(JSON.stringify({ event: registerEvent, uuid: uuid }));
            websocket.send(JSON.stringify({ event: 'getSettings', context: context }));
            requestFromPlugin();
            loadPlaylists('cider');
        };
        websocket.onmessage = function (evt) {
            try {
                const data = JSON.parse(evt.data);
                if (data.event === 'didReceiveSettings') {
                    settings = Object.assign({}, (data.payload && data.payload.settings) || {});
                    shuffleEl.checked = !!settings.shuffle;
                    populateSelect(playlists);
                }
                if (data.event === 'sendToPropertyInspector') {
                    const payload = data.payload || data;
                    if (payload.ciderToken) {
                        ciderTokenOverride = String(payload.ciderToken);
                        try { localStorage.setItem('cider_token', ciderTokenOverride); } catch (e) {}
                    }
                    if (payload.playlists) {
                        populateSelect(payload.playlists);
                        if (payload.playlists.length) {
                            showTokenBox(false);
                            setStatus(payload.playlists.length + ' playlist(s)', 'ok');
                            const cur = selectedValue();
                            const match = payload.playlists.find((p) => p.id === cur || p.name === cur);
                            if (match) applyCoverNow(match);
                        }
                    }
                    if (payload.error && !playlists.length) {
                        showTokenBox(true);
                        setStatus(String(payload.error), 'err');
                    }
                }
            } catch (e) {
                console.error('[AppleMusic PlayPlaylist PI]', e);
            }
        };
    };
})();
