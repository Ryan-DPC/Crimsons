let streamDeckSocket = null;
let globalPluginUUID = "";
let lastAlbumArt = null;
/** URL currently being converted — avoids parallel toBase64 storms. */
let albumArtInFlight = null;
/** Failed art URLs → next retry timestamp (ms). */
let albumArtRetryAfter = {};
let contextSettings = {};
/** Last title/image sent per context — skip identical StreamDock spam. */
let lastTitleByContext = {};
let lastImageByContext = {};
/** context -> playlist ref last launched from Play Playlist (▶ feedback). */
let activePlaylistByContext = {};
const POLL_MS = 1000;
const ART_RETRY_MS = 8000;

/** Dev-only pipeline logger (no-op in prod unless debug.flag / CRIMSON_PLUGIN_DEBUG). */
const amLog = (typeof CrimsonDebug !== "undefined" && CrimsonDebug.create)
    ? CrimsonDebug.create("applemusic")
    : { enabled: false, info: function () {}, warn: function () {}, error: function () {}, timing: function () { return 0; } };
amLog.info("plugin boot", { debug: !!amLog.enabled });

let actionContexts = {
    "com.laoy.streamdock.applemusic.playpause": [],
    "com.laoy.streamdock.applemusic.previous": [],
    "com.laoy.streamdock.applemusic.next": [],
    "com.laoy.streamdock.applemusic.volumeup": [],
    "com.laoy.streamdock.applemusic.volumedown": [],
    "com.laoy.streamdock.applemusic.shuffle": [],
    "com.laoy.streamdock.applemusic.repeat": [],
    "com.laoy.streamdock.applemusic.songinfo": [],
    "com.laoy.streamdock.applemusic.love": [],
    "com.laoy.streamdock.applemusic.addtolibrary": [],
    "com.laoy.streamdock.applemusic.seekforward": [],
    "com.laoy.streamdock.applemusic.seekbackward": [],
    "com.laoy.streamdock.applemusic.clearqueue": [],
    "com.laoy.streamdock.applemusic.playplaylist": [],
    "com.laoy.streamdock.applemusic.playlistbrowse": [],
    "com.laoy.streamdock.applemusic.playlistview": [],
    "com.laoy.streamdock.applemusic.volumecontrol": [],
    "com.laoy.streamdock.applemusic.previousornext": [],
    "com.laoy.streamdock.applemusic.seekcontrol": []
};

/** Shared playlist browser: molette scroll + bouton visu/play. */
const playlistBrowser = {
    list: [],
    index: 0,
    loading: false,
    moveBusy: false,
    pendingDelta: 0,
    lastCoverUrl: "",
    lastCoverCtx: {},

    current() {
        if (!this.list.length) return null;
        const i = ((this.index % this.list.length) + this.list.length) % this.list.length;
        return this.list[i];
    },

    async ensureLoaded(force) {
        if (this.loading) return;
        if (!force && this.list.length) return;
        this.loading = true;
        const t0 = Date.now();
        amLog.info("browser.ensureLoaded start", { force: !!force, cached: this.list.length });
        try {
            const list = await ciderAPI.listLibraryPlaylistsFast();
            this.list = list || [];
            if (this.index >= this.list.length) this.index = 0;
            amLog.timing("browser.listFast", t0);
            amLog.info("browser.list ready", { count: this.list.length });
            // Cover for current only — never block scroll on full-library enrich
            const cur = this.current();
            if (cur && !cur.image) {
                const t1 = Date.now();
                cur.image = await ciderAPI.artworkFromFirstTrack(cur.id);
                amLog.timing("browser.cover.current", t1);
            }
        } catch (e) {
            amLog.error("browser.ensureLoaded failed", String(e && e.message ? e.message : e));
        } finally {
            this.loading = false;
        }
    },

    move(delta) {
        // Coalesce dial ticks so rapid scrolling never stacks awaits (freeze source)
        this.pendingDelta += delta;
        if (this.moveBusy) return;
        this._drainMove();
    },

    async _drainMove() {
        if (this.moveBusy) return;
        this.moveBusy = true;
        try {
            while (this.pendingDelta !== 0) {
                const step = this.pendingDelta > 0 ? 1 : -1;
                this.pendingDelta -= step;
                const t0 = Date.now();
                await this.ensureLoaded(false);
                if (!this.list.length) {
                    this.paint({ empty: true });
                    amLog.warn("browser.move empty list");
                    break;
                }
                this.index = (this.index + step) % this.list.length;
                if (this.index < 0) this.index += this.list.length;
                const cur = this.current();
                amLog.info("browser.move", { index: this.index, id: cur && cur.id, name: cur && cur.name });
                // Paint name/position immediately; cover async so dial never freezes
                this.paint({ skipCoverFetch: true });
                if (cur && !cur.image) {
                    ciderAPI.artworkFromFirstTrack(cur.id).then((art) => {
                        if (!art) return;
                        if (this.current() && this.current().id === cur.id) {
                            cur.image = art;
                            this.applyCover(art);
                        }
                    }).catch(() => {});
                } else if (cur && cur.image) {
                    this.applyCover(cur.image);
                }
                amLog.timing("browser.move.tick", t0);
            }
        } finally {
            this.moveBusy = false;
            if (this.pendingDelta !== 0) this._drainMove();
        }
    },

    async playCurrent() {
        const t0 = Date.now();
        await this.ensureLoaded(false);
        const cur = this.current();
        if (!cur || !cur.id) {
            amLog.warn("browser.playCurrent: nothing selected");
            return;
        }
        amLog.info("browser.playCurrent SHUFFLE", { id: cur.id, name: cur.name });
        await ciderAPI.playPlaylist({
            playlist: cur.id,
            playlistId: cur.id,
            playlistName: cur.name,
            shuffle: true
        });
        amLog.timing("browser.playCurrent", t0);
        setTitleForAction("com.laoy.streamdock.applemusic.playlistbrowse", "▶ " + String(cur.name || "").slice(0, 10));
        setTimeout(() => this.paint({}), 800);
    },

    paint(opts) {
        const cur = this.current();
        const label = !this.list.length
            ? "Aucune"
            : ((this.index + 1) + "/" + this.list.length);
        const name = cur ? String(cur.name || "").slice(0, 14) : "Playlist";

        setTitleForAction("com.laoy.streamdock.applemusic.playlistbrowse", label);

        const viewContexts = actionContexts["com.laoy.streamdock.applemusic.playlistview"] || [];
        viewContexts.forEach((ctx) => {
            sendToContext(ctx, "setTitle", { title: name, target: 0 });
        });

        if (cur && cur.image) {
            this.applyCover(cur.image);
        } else if (!(opts && opts.skipCoverFetch)) {
            viewContexts.forEach((ctx) => {
                sendToContext(ctx, "setImage", { image: "static/icon/play_playlist.png", target: 0 });
            });
        }
    },

    async applyCover(url) {
        if (!url) return;
        const viewContexts = actionContexts["com.laoy.streamdock.applemusic.playlistview"] || [];
        if (!viewContexts.length) return;
        const t0 = Date.now();
        try {
            const b64 = url.startsWith("data:") ? url : await crimsonAPI.toBase64(url);
            if (!b64) {
                amLog.warn("browser.cover toBase64 failed", url.slice(0, 80));
                return;
            }
            viewContexts.forEach((ctx) => {
                if (this.lastCoverCtx[ctx] === url) return;
                this.lastCoverCtx[ctx] = url;
                sendToContext(ctx, "setImage", { image: b64, target: 0 });
            });
            this.lastCoverUrl = url;
            amLog.timing("browser.cover.apply", t0);
        } catch (e) {
            amLog.error("browser.cover failed", String(e && e.message ? e.message : e));
        }
    }
};

const CIDER_BASE = "http://127.0.0.1:10767";

/** Dynamic Cider App Token resolver — prefer live disk sources over stale injected values. */
function getCiderToken() {
    try {
        var fs = require("fs");
        var path = require("path");
        var appdata = process.env.APPDATA || "";
        // 1. Crimsons cider cache (set via Now Playing PI / APPLE_MUSIC_CREDENTIALS)
        var cachePath = path.join(appdata, "com.laoy.crimsons", "cider_cache.json");
        if (fs.existsSync(cachePath)) {
            var raw = JSON.parse(fs.readFileSync(cachePath, "utf8"));
            if (raw && raw.appToken && String(raw.appToken).trim()) {
                window.__CIDER_APP_TOKEN__ = String(raw.appToken).trim();
                return window.__CIDER_APP_TOKEN__;
            }
        }
        // 2. Cider spa-config.yml apiTokens
        var cfgPath = path.join(appdata, "sh.cider.dotnet", "spa-config.yml");
        if (fs.existsSync(cfgPath)) {
            var content = fs.readFileSync(cfgPath, "utf8");
            var m = content.match(/token:\s*([^\r\n]+)/);
            if (m && m[1]) {
                var tok = m[1].trim().replace(/^['"]|['"]$/g, "");
                if (tok) {
                    window.__CIDER_APP_TOKEN__ = tok;
                    return tok;
                }
            }
        }
    } catch (eNode) {}
    try {
        if (typeof localStorage !== "undefined" && localStorage.getItem("cider_token")) {
            return localStorage.getItem("cider_token");
        }
    } catch (eStorage) {}
    try {
        if (typeof window !== "undefined" && window.__CIDER_APP_TOKEN__) {
            return String(window.__CIDER_APP_TOKEN__).trim();
        }
    } catch (eWin) {}
    return "";
}

/** Direct Cider HTTP API Client */
const ciderAPI = {
    cachedState: null,
    lastVolume: 0.5,
    playlistCache: [], // last library list with artwork

    async request(path, method = "POST", body = null) {
        const token = getCiderToken();
        const headers = {};
        if (token) headers["apptoken"] = token;
        const opts = { method, headers };
        if (body !== null && body !== undefined) {
            headers["Content-Type"] = "application/json";
            opts.body = JSON.stringify(body);
        }
        const t0 = Date.now();
        try {
            const resp = await fetch(`${CIDER_BASE}${path}`, opts);
            const ms = Date.now() - t0;
            if (!resp) {
                amLog.error("cider.request null", { path: path, ms: ms });
            } else if (!resp.ok) {
                amLog.warn("cider.request HTTP", { path: path, status: resp.status, ms: ms });
            } else if (ms >= 200) {
                amLog.warn("cider.request SLOW", { path: path, status: resp.status, ms: ms });
            }
            return resp;
        } catch (err) {
            amLog.error("cider.request network", { path: path, err: String(err), ms: Date.now() - t0 });
            return null;
        }
    },

    extractContainerId(now) {
        if (!now || typeof now !== "object") return "";
        const candidates = [
            now.container && (now.container.id || now.containerId),
            now._container && now._container.id,
            now.playlistId,
            now.playlist_id,
            now.playParams && now.playParams.catalogId,
            now.playParams && now.playParams.parentId
        ];
        for (const c of candidates) {
            if (typeof c === "string" && c.trim()) return c.trim();
        }
        return "";
    },

    mapPlaybackState(d, now, time, vol) {
        if (vol > 0) this.lastVolume = vol;
        const artworkRaw = (now.artwork && now.artwork.url)
            ? now.artwork.url
            : (typeof now.artwork === "string" ? now.artwork : "");
        const artwork = artworkRaw
            ? String(artworkRaw).replace("{w}", "300").replace("{h}", "300")
            : "";
        return {
            is_playing: d.state === "playing" || d.state === "play" || d.isPlaying === true,
            track_name: now.name || "",
            artist_name: now.artistName || "",
            album_name: now.albumName || "",
            album_art: artwork,
            album_art_data: "",
            progress_ms: Math.round((time.currentTime || 0) * 1000),
            duration_ms: now.durationInMillis || Math.round((time.duration || 0) * 1000),
            volume_percent: Math.round(Math.min(Math.max(vol, 0), 1) * 100),
            shuffle_state: !!d.shuffleMode,
            repeat_state: d.repeatMode || "none",
            cider_connected: true,
            in_favorites: !!now.inFavorites,
            in_library: !!now.inLibrary,
            track_id: (now.id || (now.playParams && now.playParams.id) || "") + "",
            container_id: this.extractContainerId(now)
        };
    },

    async fetchStateV1() {
        try {
            const playingResp = await this.request("/api/v1/playback/is-playing", "GET");
            let isPlaying = false;
            if (playingResp && playingResp.ok) {
                const raw = await playingResp.json();
                isPlaying = raw === true || raw === false
                    ? raw
                    : !!(raw.is_playing ?? raw.data ?? raw.value);
            }
            const nowResp = await this.request("/api/v1/playback/now-playing", "GET");
            if (!nowResp || !nowResp.ok) return null;
            const nowRaw = await nowResp.json();
            const attrs = nowRaw.attributes || nowRaw.info || (nowRaw.data && nowRaw.data.attributes) || nowRaw;
            const volResp = await this.request("/api/v1/playback/volume", "GET");
            let vol = 0.5;
            if (volResp && volResp.ok) {
                const v = await volResp.json();
                vol = typeof v.volume === "number" ? v.volume : (typeof v === "number" ? v : 0.5);
            }
            const artwork = (attrs.artwork && attrs.artwork.url)
                ? attrs.artwork.url.replace("{w}", "300").replace("{h}", "300")
                : "";
            this.cachedState = {
                is_playing: isPlaying,
                track_name: attrs.name || "",
                artist_name: attrs.artistName || "",
                album_name: attrs.albumName || "",
                album_art: artwork,
                album_art_data: "",
                progress_ms: 0,
                duration_ms: attrs.durationInMillis || 0,
                volume_percent: Math.round(Math.min(Math.max(vol, 0), 1) * 100),
                shuffle_state: false,
                repeat_state: "none",
                cider_connected: true,
                in_favorites: !!attrs.inFavorites,
                in_library: !!attrs.inLibrary,
                track_id: (nowRaw.id || "") + "",
                container_id: this.extractContainerId(attrs) || this.extractContainerId(nowRaw)
            };
            return this.cachedState;
        } catch (e) {
            return null;
        }
    },

    async fetchState() {
        try {
            const resp = await this.request("/api/v2/playback", "GET");
            if (resp && resp.ok) {
                const json = await resp.json();
                const d = json.data || json || {};
                const now = d.nowPlaying || d.now_playing || {};
                const time = d.time || {};
                const vol = typeof d.volume === "number" ? d.volume : 0.5;
                this.cachedState = this.mapPlaybackState(d, now, time, vol);
                return this.cachedState;
            }
        } catch (e) {
            console.warn("[AppleMusic:Cider] fetchState v2 error", e);
        }
        const v1 = await this.fetchStateV1();
        if (v1) return v1;
        return null;
    },

    async executeCommand(endpoint, payload = {}) {
        console.log(`[AppleMusic:Cider] Executing: ${endpoint}`, payload);
        switch (endpoint) {
            case "playpause":
                await this.request("/api/v1/playback/playpause");
                break;
            case "previous":
                await this.request("/api/v1/playback/previous");
                break;
            case "next":
                await this.request("/api/v1/playback/next");
                break;
            case "volumeup": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.min(1.0, cur + 0.05);
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "volumedown": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.max(0.0, cur - 0.05);
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "volumecontrol": {
                const ticks = payload.ticks || 0;
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                const next = Math.min(1.0, Math.max(0.0, cur + (ticks * 0.03)));
                await this.request("/api/v2/audio/volume", "PATCH", { volume: next });
                break;
            }
            case "mute": {
                const cur = this.cachedState ? (this.cachedState.volume_percent / 100) : 0.5;
                if (cur > 0.01) {
                    this.lastVolume = cur;
                    await this.request("/api/v2/audio/volume", "PATCH", { volume: 0 });
                } else {
                    await this.request("/api/v2/audio/volume", "PATCH", { volume: this.lastVolume || 0.4 });
                }
                break;
            }
            case "skip": {
                const ticks = payload.ticks || 0;
                if (ticks > 0) {
                    await this.request("/api/v1/playback/next");
                } else if (ticks < 0) {
                    await this.request("/api/v1/playback/previous");
                }
                break;
            }
            case "seekrelative": {
                const ticks = payload.ticks || 0;
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const durSecs = this.cachedState ? (this.cachedState.duration_ms / 1000) : 0;
                const nextSecs = Math.min(durSecs || 9999, Math.max(0, curSecs + (ticks * 5)));
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "seekforward": {
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const durSecs = this.cachedState ? (this.cachedState.duration_ms / 1000) : 0;
                const nextSecs = Math.min(durSecs || 9999, Math.max(0, curSecs + 15));
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "seekbackward": {
                const curSecs = this.cachedState ? (this.cachedState.progress_ms / 1000) : 0;
                const nextSecs = Math.max(0, curSecs - 15);
                await this.request("/api/v1/playback/seek", "POST", { position: nextSecs });
                break;
            }
            case "shuffle":
                await this.request("/api/v1/playback/toggle-shuffle");
                break;
            case "repeat":
                await this.request("/api/v1/playback/toggle-repeat");
                break;
            case "clearqueue":
                await this.request("/api/v1/playback/queue/clear-queue");
                break;
            case "addtolibrary":
                await this.request("/api/v1/playback/add-to-library");
                break;
            case "togglelove":
                await this.request("/api/v1/playback/set-rating", "POST", { rating: 1 });
                break;
            case "playplaylist": {
                await this.playPlaylist(payload || {});
                break;
            }
        }

        // Fast update after command execution
        setTimeout(async () => {
            const st = await this.fetchState();
            if (st) applyNowPlaying(st);
        }, 120);
    },

    extractPlaylistRaw(settings) {
        const s = settings || {};
        const nested = s.settings || {};
        const candidates = [
            s.playlist, s.playlistId, s.playlist_id, s.url, s.id, s.uri, s.name,
            nested.playlist, nested.playlistId, nested.playlist_id, nested.url, nested.id, nested.uri, nested.name
        ];
        for (const c of candidates) {
            if (typeof c === "string" && c.trim()) return c.trim();
        }
        return "";
    },

    extractPlaylistIdFromUrl(url) {
        const m = url.match(/\/playlist\/(?:[^/?#]+\/)?(pl\.[^/?#]+|p\.[^/?#]+)/i)
            || url.match(/\b(pl\.[A-Za-z0-9._-]+|p\.[A-Za-z0-9._-]+)\b/);
        return m ? m[1] : null;
    },

    normalizeArtworkUrl(raw) {
        if (!raw || typeof raw !== "string") return "";
        return raw
            .replace(/\{w\}x\{h\}bb/g, "144x144bb")
            .replace("{w}", "144")
            .replace("{h}", "144")
            .replace(/\/600x600bb\.(png|jpg)/g, "/144x144bb.jpg")
            .replace(/\/1200x1200bb\.(png|jpg)/g, "/144x144bb.jpg")
            .replace(/\/300x300bb\.(png|jpg)/g, "/144x144bb.jpg");
    },

    extractArtworkFromItem(item) {
        if (!item) return "";
        const art = item.artwork
            || (item.attributes && item.attributes.artwork)
            || null;
        const candidates = [
            art && art.url,
            art && art.uri,
            typeof art === "string" ? art : null,
            item.artworkUrl,
            item.image,
            item.attributes && item.attributes.artworkUrl,
            item.attributes && item.attributes.url
        ];
        for (const c of candidates) {
            if (typeof c === "string" && c.trim() && /^https?:\/\//i.test(c.trim())) {
                return this.normalizeArtworkUrl(c.trim());
            }
        }
        return "";
    },

    normalizePlaylistList(json) {
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
                || '';
            if (!id || seen[id]) return;
            seen[id] = true;
            const name = item.name
                || (item.attributes && item.attributes.name)
                || '';
            out.push({
                id: String(id),
                name: name || String(id),
                image: this.extractArtworkFromItem(item)
            });
        });
        out.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        return out;
    },

    /** Many user playlists return artwork:null — use the first track cover instead. */
    async artworkFromFirstTrack(playlistId) {
        if (!playlistId) return "";
        try {
            const resp = await this.request(
                `/api/v2/library/playlists/${encodeURIComponent(playlistId)}/songs?limit=1`,
                "GET"
            );
            if (!resp || !resp.ok) return "";
            const json = await resp.json();
            const items = (json && json.data && Array.isArray(json.data.items))
                ? json.data.items
                : (Array.isArray(json && json.data) ? json.data : []);
            if (!items.length) return "";
            return this.extractArtworkFromItem(items[0]);
        } catch (e) {
            return "";
        }
    },

    async enrichMissingArtwork(playlists) {
        const missing = (playlists || []).filter((p) => p && p.id && !p.image);
        // Parallel but capped to avoid hammering Cider
        const chunk = 6;
        for (let i = 0; i < missing.length; i += chunk) {
            const slice = missing.slice(i, i + chunk);
            await Promise.all(slice.map(async (p) => {
                const art = await this.artworkFromFirstTrack(p.id);
                if (art) p.image = art;
            }));
        }
        return playlists;
    },

    async listLibraryPlaylistsFast() {
        const all = [];
        const seen = {};
        let offset = 0;
        const limit = 100;
        for (let page = 0; page < 20; page++) {
            const resp = await this.request(
                `/api/v2/library/playlists?limit=${limit}&offset=${offset}`,
                "GET"
            );
            if (!resp || !resp.ok) {
                if (page === 0) {
                    throw new Error(resp ? (`Cider ${resp.status}`) : "Cider unreachable");
                }
                break;
            }
            const json = await resp.json();
            const batch = this.normalizePlaylistList(json);
            batch.forEach((p) => {
                if (!seen[p.id]) {
                    seen[p.id] = true;
                    all.push(p);
                }
            });
            const total = (json.meta && typeof json.meta.total === "number") ? json.meta.total : null;
            offset += limit;
            if (batch.length < limit) break;
            if (total !== null && offset >= total) break;
        }
        all.sort((a, b) => a.name.localeCompare(b.name, 'fr', { sensitivity: 'base' }));
        this.playlistCache = all;
        return all;
    },

    async listLibraryPlaylists() {
        const all = await this.listLibraryPlaylistsFast();
        await this.enrichMissingArtwork(all);
        this.playlistCache = all;
        return all;
    },

    async resolvePlaylistArtwork(raw) {
        const key = (raw || "").trim();
        if (!key) return "";
        const match = (list) => (list || []).find((p) =>
            p.id === key
            || (p.name && p.name.toLowerCase() === key.toLowerCase())
            || (p.name && p.name.toLowerCase().startsWith(key.toLowerCase()))
        );

        const fromCache = match(this.playlistCache);
        if (fromCache && fromCache.image) return fromCache.image;

        try {
            if (!this.playlistCache.length) {
                await this.listLibraryPlaylists();
            } else {
                // Re-enrich just this playlist if still missing art
                const hit = match(this.playlistCache);
                if (hit && !hit.image) {
                    hit.image = await this.artworkFromFirstTrack(hit.id);
                }
                if (hit && hit.image) return hit.image;
            }
            const again = match(this.playlistCache);
            if (again && again.image) return again.image;
            if (again && again.id) {
                const art = await this.artworkFromFirstTrack(again.id);
                if (art) {
                    again.image = art;
                    return art;
                }
            }
        } catch (e) {}

        // Direct id fallback (library playlist id like p.xxx)
        const id = this.extractPlaylistIdFromUrl(key) || key;
        if (id.startsWith("p.") || id.startsWith("pl.")) {
            const art = await this.artworkFromFirstTrack(id);
            if (art) return art;
        }
        return "";
    },

    async playPlaylist(settings) {
        const raw = this.extractPlaylistRaw(settings);
        if (!raw) {
            console.warn("[AppleMusic:Cider] Play Playlist: no playlist id/URL configured");
            return;
        }
        // Default shuffle ON — user always launches playlists random; explicit false still respected
        const shuffle = (settings.shuffle === false || (settings.settings && settings.settings.shuffle === false))
            ? false
            : true;
        const lower = raw.toLowerCase();
        const isUrl = lower.includes("music.apple.com") || lower.startsWith("http://") || lower.startsWith("https://");
        const isId = raw.startsWith("pl.") || raw.startsWith("p.") || /^\d+$/.test(raw);

        if (isUrl) {
            let resp = await this.request("/api/v2/playback/play-url", "POST", { url: raw });
            if (!resp || !resp.ok) {
                resp = await this.request("/api/v1/playback/play-url", "POST", { url: raw });
            }
            if ((!resp || !resp.ok)) {
                const id = this.extractPlaylistIdFromUrl(raw);
                if (id) {
                    await this.request("/api/v2/playback/play-collection", "POST", {
                        type: "playlists", id, shuffle
                    });
                }
            }
            return;
        }

        if (isId) {
            let resp = await this.request("/api/v2/playback/play-collection", "POST", {
                type: "playlists", id: raw, shuffle
            });
            if (!resp || !resp.ok) {
                const url = "https://music.apple.com/playlist/" + encodeURIComponent(raw);
                resp = await this.request("/api/v2/playback/play-url", "POST", { url });
                if (!resp || !resp.ok) {
                    await this.request("/api/v1/playback/play-url", "POST", { url });
                }
            }
            return;
        }

        // Name: try library list, then catalog search
        let resolvedId = null;
        try {
            const libResp = await this.request("/api/v2/library/playlists?limit=100", "GET");
            if (libResp && libResp.ok) {
                const json = await libResp.json();
                const items = (json && json.data) || [];
                const list = Array.isArray(items) ? items : (items.data || []);
                const needle = raw.toLowerCase();
                const exact = list.find(p => ((p.attributes && p.attributes.name) || p.name || "").toLowerCase() === needle);
                const partial = list.find(p => ((p.attributes && p.attributes.name) || p.name || "").toLowerCase().includes(needle));
                const hit = exact || partial;
                if (hit && hit.id) resolvedId = hit.id;
            }
        } catch (eLib) {}

        if (!resolvedId) {
            try {
                const path = "/api/v2/amapi/search?term=" + encodeURIComponent(raw) + "&types=playlists&limit=10";
                const searchResp = await this.request(path, "GET");
                if (searchResp && searchResp.ok) {
                    const json = await searchResp.json();
                    const list = (((json || {}).data || {}).results || {}).playlists
                        ? (((json.data || {}).results || {}).playlists.data || [])
                        : ((((json || {}).results || {}).playlists || {}).data || []);
                    const needle = raw.toLowerCase();
                    const exact = list.find(p => ((p.attributes && p.attributes.name) || "").toLowerCase() === needle);
                    const partial = list.find(p => ((p.attributes && p.attributes.name) || "").toLowerCase().includes(needle));
                    const hit = exact || partial;
                    if (hit && hit.id) resolvedId = hit.id;
                }
            } catch (eSearch) {}
        }

        if (!resolvedId) {
            console.warn("[AppleMusic:Cider] Play Playlist: no match for name", raw);
            return;
        }
        await this.request("/api/v2/playback/play-collection", "POST", {
            type: "playlists", id: resolvedId, shuffle
        });
    }
};

/** Prefer live /local/ws-token over injected global (stale after server restart). */
function crimsonAuthToken() {
    try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', 'http://127.0.0.1:40510/local/ws-token', false);
        xhr.send(null);
        if (xhr.status === 200 && xhr.responseText) {
            var httpTok = String(xhr.responseText).trim();
            if (httpTok) {
                try { window.__CRIMSON_AUTH_TOKEN__ = httpTok; } catch (eCache) {}
                return httpTok;
            }
        }
    } catch (e1) {}
    try {
        var fs = require('fs');
        var path = require('path');
        var tokenPath = path.join(process.env.APPDATA || '', 'com.laoy.crimsons', 'auth.token');
        var fileTok = (fs.readFileSync(tokenPath, 'utf8') || '').trim();
        if (fileTok) {
            try { window.__CRIMSON_AUTH_TOKEN__ = fileTok; } catch (eCache2) {}
            return fileTok;
        }
    } catch (e2) {
        try {
            var shell = new ActiveXObject('WScript.Shell');
            var fso = new ActiveXObject('Scripting.FileSystemObject');
            var p = shell.ExpandEnvironmentStrings('%APPDATA%\\com.laoy.crimsons\\auth.token');
            if (fso.FileExists(p)) {
                var f = fso.OpenTextFile(p, 1);
                var t = (f.ReadAll() || '').trim();
                f.Close();
                if (t) {
                    try { window.__CRIMSON_AUTH_TOKEN__ = t; } catch (eCache3) {}
                    return t;
                }
            }
        } catch (e3) {}
    }
    try {
        if (typeof window !== 'undefined' && window.__CRIMSON_AUTH_TOKEN__) {
            var injected = String(window.__CRIMSON_AUTH_TOKEN__).trim();
            if (injected) return injected;
        }
    } catch (e0) {}
    return '';
}

function crimsonWsUrl(port) {
    port = port || 40510;
    var token = crimsonAuthToken();
    var base = 'ws://127.0.0.1:' + port;
    return token ? (base + '/?token=' + encodeURIComponent(token)) : base;
}

function playlistButtonTitle(settings, opts) {
    const s = settings || {};
    const playing = !!(opts && opts.playing);
    let base = "";
    if (s.playlistName || s.name) {
        base = String(s.playlistName || s.name).slice(0, 14);
    } else {
        const raw = ciderAPI.extractPlaylistRaw(s);
        if (!raw) {
            base = "Playlist";
        } else if (raw.includes("music.apple.com")) {
            const id = ciderAPI.extractPlaylistIdFromUrl(raw);
            base = (id || "Playlist").slice(0, 14);
        } else {
            base = raw.slice(0, 14);
        }
    }
    // Play Playlist keeps the configured label; show a live ▶ marker when this
    // button's playlist is the active source (not Now Playing track text).
    return playing ? ("▶ " + base).slice(0, 16) : base;
}

function playlistRefMatches(settings, containerId, activeRef) {
    const s = settings || {};
    const raw = ciderAPI.extractPlaylistRaw(s);
    const idFromUrl = raw && raw.includes("music.apple.com")
        ? ciderAPI.extractPlaylistIdFromUrl(raw)
        : null;
    const candidates = [
        raw,
        s.playlistId,
        s.playlist_id,
        s.id,
        idFromUrl,
        activeRef
    ].filter(Boolean).map(String);
    if (containerId) {
        const cid = String(containerId);
        if (candidates.some(c => c === cid || c.includes(cid) || cid.includes(c))) {
            return true;
        }
    }
    if (activeRef) {
        return candidates.some(c => c === activeRef || c.includes(activeRef) || activeRef.includes(c));
    }
    return false;
}

const playlistCoverCache = {}; // context -> artwork url
/** Failed playlist cover URLs → next retry timestamp (ms). */
const playlistCoverRetryAfter = {};

/** After page change / restart StreamDock blanks keys but our dedupe caches
 *  still hold the last URL — force a full paint so setImage/setTitle re-fire. */
function invalidateUiPaintCaches(context) {
    lastAlbumArt = null;
    albumArtInFlight = null;
    if (context) {
        delete lastTitleByContext[context];
        delete lastImageByContext[context];
        delete playlistCoverCache[context];
        delete playlistCoverRetryAfter[context];
    } else {
        lastTitleByContext = {};
        lastImageByContext = {};
        Object.keys(playlistCoverCache).forEach((k) => { delete playlistCoverCache[k]; });
        Object.keys(playlistCoverRetryAfter).forEach((k) => { delete playlistCoverRetryAfter[k]; });
    }
}

function forceRehydrateNowPlaying() {
    invalidateUiPaintCaches(null);
    return ciderAPI.fetchState().then((st) => {
        if (st) {
            applyNowPlaying(st);
            return st;
        }
        applyNowPlaying({
            cider_connected: false,
            track_name: "",
            artist_name: "",
            album_art: "",
            album_art_data: "",
            is_playing: false
        });
        return null;
    }).catch((e) => {
        amLog.error("forceRehydrateNowPlaying", String(e && e.message ? e.message : e));
        return null;
    });
}

function sendToContext(context, event, payload) {
    const json = { event: event, context: context, payload: payload };
    // Always try both paths — AJAZZ often owns one socket while the other is idle.
    let sent = false;
    if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
        try { streamDeckSocket.send(JSON.stringify(json)); sent = true; } catch (e) {}
    }
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        try {
            crimsonAPI.send({ type: "FORWARD_TO_STREAMDOCK", payload: json });
            sent = true;
        } catch (e2) {}
    }
    return sent;
}

function setTitleForContext(context, title) {
    if (lastTitleByContext[context] === title) return;
    lastTitleByContext[context] = title;
    sendToContext(context, "setTitle", { title: title, target: 0 });
}

function setImageForContext(context, image) {
    if (lastImageByContext[context] === image) return;
    lastImageByContext[context] = image;
    sendToContext(context, "setImage", { image: image, target: 0 });
}

function applyPlaylistButtonTitle(context, settings, opts) {
    const title = playlistButtonTitle(settings, opts);
    setTitleForContext(context, title);
}

function refreshPlaylistButtons(state) {
    const contexts = actionContexts["com.laoy.streamdock.applemusic.playplaylist"] || [];
    contexts.forEach(context => {
        const settings = contextSettings[context] || {};
        const activeRef = activePlaylistByContext[context] || "";
        const playing = !!(state && state.is_playing && state.cider_connected && (
            playlistRefMatches(settings, state.container_id, activeRef) ||
            (!!activeRef && !state.container_id)
        ));
        // Drop active marker once playback stops so the label returns to the PI name.
        if (activeRef && state && state.cider_connected && !state.is_playing) {
            delete activePlaylistByContext[context];
        }
        applyPlaylistButtonTitle(context, settings, { playing });
    });
}

function songInfoTitle(state) {
    if (!state || !state.cider_connected) return "Cider off";
    if (state.track_name) {
        const cleanTrack = String(state.track_name)
            .replace(/\s*[\(\[](feat\.|ft\.|with).*?[\)\]]/i, "")
            .trim();
        const cleanArtist = String(state.artist_name || "").trim();
        return cleanArtist
            ? `${cleanTrack.slice(0, 12)}\n${cleanArtist.slice(0, 12)}`
            : cleanTrack.slice(0, 14);
    }
    return state.is_playing ? "Apple Music" : "—";
}

async function applySongInfoArt(state) {
    const dataUrl = state.album_art_data || "";
    const url = state.album_art || "";

    if (dataUrl && dataUrl.indexOf("data:") === 0) {
        if (lastAlbumArt !== dataUrl) {
            lastAlbumArt = dataUrl;
            setImageForAction("com.laoy.streamdock.applemusic.songinfo", dataUrl);
        }
        return;
    }

    if (!url) {
        if (lastAlbumArt !== "") {
            lastAlbumArt = "";
            setImageForAction("com.laoy.streamdock.applemusic.songinfo", "static/icon/songinfo.png");
        }
        return;
    }

    if (lastAlbumArt === url) return;

    const now = Date.now();
    if (albumArtRetryAfter[url] && albumArtRetryAfter[url] > now) return;
    if (albumArtInFlight === url) return;
    albumArtInFlight = url;

    try {
        const b64 = await crimsonAPI.toBase64(url);
        if (b64) {
            lastAlbumArt = url;
            delete albumArtRetryAfter[url];
            setImageForAction("com.laoy.streamdock.applemusic.songinfo", b64);
        } else {
            // Conversion failed (often CORS on mzstatic). Retry later; keep title visible.
            // Do NOT set lastAlbumArt — that would permanently skip retries.
            albumArtRetryAfter[url] = now + ART_RETRY_MS;
            // Last-resort: some StreamDock hosts accept the raw URL.
            setImageForAction("com.laoy.streamdock.applemusic.songinfo", url);
        }
    } finally {
        if (albumArtInFlight === url) albumArtInFlight = null;
    }
}

async function applyPlaylistCover(context, settings) {
    const s = settings || {};
    let url = (s.playlist_image || s.image || "").trim();
    if (!url) {
        const raw = ciderAPI.extractPlaylistRaw(s);
        if (raw) {
            url = await ciderAPI.resolvePlaylistArtwork(raw);
            if (url) {
                s.playlist_image = url;
                s.image = url;
                contextSettings[context] = Object.assign({}, contextSettings[context] || {}, s);
            }
        }
    }
    if (!url) return;
    if (playlistCoverCache[context] === url) return;
    const now = Date.now();
    const retryKey = context + "|" + url;
    if (playlistCoverRetryAfter[retryKey] && playlistCoverRetryAfter[retryKey] > now) return;
    try {
        const b64 = url.startsWith("data:") ? url : await crimsonAPI.toBase64(url);
        if (!b64) {
            console.warn("[AppleMusic] playlist cover toBase64 failed", url.slice(0, 80));
            // Retry later — do NOT mark cache so willAppear/poll can try again.
            playlistCoverRetryAfter[retryKey] = now + ART_RETRY_MS;
            return;
        }
        delete playlistCoverRetryAfter[retryKey];
        playlistCoverCache[context] = url;
        setImageForContext(context, b64);
        // Keep playlist PI name on the key (cover is background; do not blank title).
        applyPlaylistButtonTitle(context, contextSettings[context] || s);
    } catch (e) {
        console.warn("[AppleMusic] playlist cover failed", e);
        playlistCoverRetryAfter[retryKey] = now + ART_RETRY_MS;
    }
}

function applyPlaylistButton(context, settings) {
    applyPlaylistButtonTitle(context, settings);
    applyPlaylistCover(context, settings);
}

function sendToPropertyInspector(context, action, payload) {
    const json = {
        event: "sendToPropertyInspector",
        context: context,
        action: action,
        payload: payload
    };
    if (streamDeckSocket && streamDeckSocket.readyState === WebSocket.OPEN) {
        streamDeckSocket.send(JSON.stringify(json));
    } else if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        crimsonAPI.send({ type: "FORWARD_TO_STREAMDOCK", payload: json });
    }
}

async function pushPlaylistsToPi(context, action) {
    const token = getCiderToken();
    try {
        // Fast path: list first (no per-playlist song fetch), push immediately
        const playlists = await ciderAPI.listLibraryPlaylistsFast
            ? await ciderAPI.listLibraryPlaylistsFast()
            : await ciderAPI.listLibraryPlaylists();
        sendToPropertyInspector(context, action, {
            playlists: playlists,
            ciderToken: token || undefined
        });
        // Background: fill missing artwork, re-push once enriched
        ciderAPI.enrichMissingArtwork(playlists).then((enriched) => {
            ciderAPI.playlistCache = enriched;
            sendToPropertyInspector(context, action, {
                playlists: enriched,
                ciderToken: token || undefined
            });
        }).catch(() => {});
    } catch (e) {
        const msg = e && e.message ? String(e.message) : "";
        const authFail = /UNAUTHORIZED|403/i.test(msg);
        sendToPropertyInspector(context, action, {
            playlists: [],
            ciderToken: token || undefined,
            error: authFail
                ? "Jeton Cider manquant ou invalide — colle un apptoken avec scope Library ci-dessous."
                : ("Impossible de lister les playlists Cider. " + msg)
        });
    }
}

function handleHardwareEvent(jsonObj) {
    const event = jsonObj['event'];
    const action = jsonObj['action'];
    const context = jsonObj['context'];

    if (!event) return;

    if (event === "willAppear" || event === "didReceiveSettings") {
        if (jsonObj['payload']?.settings) {
            contextSettings[context] = jsonObj['payload'].settings;
        }
    }

    if (event === "willAppear") {
        if (actionContexts[action] && !actionContexts[action].includes(context)) {
            actionContexts[action].push(context);
        }
        // Page return / plugin reload: StreamDock wiped the key visuals but our
        // dedupe caches may still match — invalidate so setImage/setTitle fire again.
        invalidateUiPaintCaches(context);
        if (action === "com.laoy.streamdock.applemusic.playplaylist") {
            applyPlaylistButton(context, contextSettings[context] || jsonObj['payload']?.settings || {});
        }
        if (action === "com.laoy.streamdock.applemusic.playlistbrowse"
            || action === "com.laoy.streamdock.applemusic.playlistview") {
            playlistBrowser.ensureLoaded(true).then(() => playlistBrowser.paint());
        }
        // Immediately rehydrate Now Playing (title+artist+art) on every appear
        forceRehydrateNowPlaying();
    }

    if (event === "didReceiveSettings") {
        if (action === "com.laoy.streamdock.applemusic.playplaylist") {
            invalidateUiPaintCaches(context);
            applyPlaylistButton(context, contextSettings[context] || {});
        }
    }

    if (event === "propertyInspectorDidAppear" || event === "sendToPlugin") {
        if (action === "com.laoy.streamdock.applemusic.playplaylist") {
            const payload = jsonObj['payload'] || {};
            if (event === "propertyInspectorDidAppear" || payload.type === "refreshPlaylists" || payload.type === "refresh") {
                pushPlaylistsToPi(context, action);
            }
            if (payload.type === "refreshCover" || payload.type === "settingsUpdated") {
                const s = Object.assign({}, contextSettings[context] || {}, payload.settings || {});
                contextSettings[context] = s;
                delete playlistCoverCache[context];
                applyPlaylistButton(context, s);
            }
        }
    }

    if (event === "willDisappear") {
        if (actionContexts[action]) {
            actionContexts[action] = actionContexts[action].filter(c => c !== context);
        }
        // Keep contextSettings — AJAZZ often omits settings on the next willAppear
        // after a page switch; wiping them left Play Playlist with name only / no cover.
        delete playlistCoverCache[context];
        delete lastTitleByContext[context];
        delete lastImageByContext[context];
        // Global art dedupe must reset too: otherwise applySongInfoArt skips setImage
        // when the same track is still playing after coming back to the page.
        lastAlbumArt = null;
    }

    if (event === "keyDown" || (event === "dialPress" && jsonObj['payload']?.pressed)) {
        const settings = contextSettings[context]
            || (jsonObj['payload'] && jsonObj['payload'].settings)
            || {};
        handleKeyDown(action, settings, context);
    }

    if (event === "dialRotate") {
        const ticks = (jsonObj['payload'] && jsonObj['payload'].ticks) || 0;
        handleDialRotate(action, ticks);
    }
}

const crimsonAPI = {
    ws: null,
    queue: [],
    onOpen: null,
    connect() {
        this.ws = new WebSocket(crimsonWsUrl(40510));
        this.ws.onopen = () => {
            console.log("[AppleMusic] Connected to Crimson Backend on 40510.");
            if (this.onOpen) this.onOpen();
            while (this.queue.length > 0) {
                this.ws.send(JSON.stringify(this.queue.shift()));
            }
            // Sidecar (re)connect after Crimson/StreamDock restart — force live paint.
            forceRehydrateNowPlaying();
            // Also re-apply playlist covers from cached settings.
            const pp = actionContexts["com.laoy.streamdock.applemusic.playplaylist"] || [];
            pp.forEach((ctx) => {
                invalidateUiPaintCaches(ctx);
                applyPlaylistButton(ctx, contextSettings[ctx] || {});
            });
        };
        this.ws.onmessage = (evt) => {
            try {
                const data = JSON.parse(evt.data);
                if (data.event === "setState") {
                    updateActionState(data.action, data.payload.state);
                }
                if (data.type === "APPLE_MUSIC_STATE" && data.data) {
                    applyNowPlaying(data.data);
                }
                // Sidecar-pushed cover (data URL or http) — same path as Spotify.
                if (data.event === "setImageBroadcast" && data.payload && data.payload.image) {
                    applySongInfoArt({
                        album_art: data.payload.image.indexOf("data:") === 0 ? "" : data.payload.image,
                        album_art_data: data.payload.image.indexOf("data:") === 0 ? data.payload.image : ""
                    });
                }
                if (data.event && data.event !== "setImageBroadcast") {
                    handleHardwareEvent(data);
                }
            } catch (e) {
                console.error("[AppleMusic] Error parsing Crimson message", e);
            }
        };
        this.ws.onclose = () => {
            setTimeout(() => this.connect(), 4000);
            setTimeout(() => {
                if (!streamDeckSocket || streamDeckSocket.readyState === WebSocket.CLOSED) {
                    if (window.connectHw) window.connectHw();
                }
            }, 1000);
        };
        this.ws.onerror = () => {
            try { this.ws.close(); } catch (e) {}
        };
    },
    send(data) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(data));
        } else {
            this.queue.push(data);
        }
    },
    async toBase64(url) {
        // Prefer Node https — Apple Music CDN often blocks canvas/CORS in the webview.
        try {
            const buf = await this.fetchBuffer(url);
            if (buf && buf.length) {
                const b64 = buf.toString("base64");
                const mime = /\.png(\?|$)/i.test(url) ? "image/png" : "image/jpeg";
                // Resize via Image if possible; otherwise send raw data URL
                const dataUrl = "data:" + mime + ";base64," + b64;
                return await this.resizeDataUrl(dataUrl, 144) || dataUrl;
            }
        } catch (eNode) {}

        try {
            const resp = await fetch(url, { mode: "cors", cache: "force-cache" });
            if (resp && resp.ok) {
                const blob = await resp.blob();
                const dataUrl = await new Promise((resolve) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result);
                    reader.onerror = () => resolve(null);
                    reader.readAsDataURL(blob);
                });
                if (dataUrl) return await this.resizeDataUrl(dataUrl, 144) || dataUrl;
            }
        } catch (eFetch) {}

        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "Anonymous";
            img.onload = () => {
                try {
                    const canvas = document.createElement("canvas");
                    canvas.width = 144;
                    canvas.height = 144;
                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(img, 0, 0, 144, 144);
                    resolve(canvas.toDataURL("image/jpeg", 0.85));
                } catch (e) {
                    resolve(null);
                }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
    },

    fetchBuffer(url) {
        return new Promise((resolve, reject) => {
            try {
                const lib = url.startsWith("https") ? require("https") : require("http");
                const req = lib.get(url, { timeout: 8000 }, (res) => {
                    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
                        this.fetchBuffer(res.headers.location).then(resolve, reject);
                        return;
                    }
                    if (res.statusCode !== 200) {
                        reject(new Error("HTTP " + res.statusCode));
                        res.resume();
                        return;
                    }
                    const chunks = [];
                    res.on("data", (c) => chunks.push(c));
                    res.on("end", () => resolve(Buffer.concat(chunks)));
                });
                req.on("error", reject);
                req.on("timeout", () => { try { req.destroy(); } catch (e) {} reject(new Error("timeout")); });
            } catch (e) {
                reject(e);
            }
        });
    },

    resizeDataUrl(dataUrl, size) {
        return new Promise((resolve) => {
            try {
                const img = new Image();
                img.onload = () => {
                    try {
                        const canvas = document.createElement("canvas");
                        canvas.width = size;
                        canvas.height = size;
                        const ctx = canvas.getContext("2d");
                        ctx.drawImage(img, 0, 0, size, size);
                        resolve(canvas.toDataURL("image/jpeg", 0.85));
                    } catch (e) {
                        resolve(dataUrl);
                    }
                };
                img.onerror = () => resolve(dataUrl);
                img.src = dataUrl;
            } catch (e) {
                resolve(dataUrl);
            }
        });
    }
};
crimsonAPI.connect();

function connectElgatoStreamDeckSocket(inPort, inPluginUUID, inRegisterEvent, inInfo) {
    globalPluginUUID = inPluginUUID;

    const register = () => {
        crimsonAPI.send({
            type: 'REGISTER_STREAMDOCK',
            port: inPort,
            uuid: inPluginUUID,
            register_event: inRegisterEvent
        });
    };

    crimsonAPI.onOpen = register;
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        register();
    }

    const connectHw = () => {
        if (streamDeckSocket &&
            (streamDeckSocket.readyState === WebSocket.OPEN ||
             streamDeckSocket.readyState === WebSocket.CONNECTING)) {
            return;
        }

        streamDeckSocket = new WebSocket("ws://127.0.0.1:" + inPort);

        streamDeckSocket.onopen = function () {
            streamDeckSocket.send(JSON.stringify({ "event": inRegisterEvent, "uuid": inPluginUUID }));
            // Immediate state sync after StreamDock socket reconnect / plugin reload
            forceRehydrateNowPlaying();
            const pp = actionContexts["com.laoy.streamdock.applemusic.playplaylist"] || [];
            pp.forEach((ctx) => {
                invalidateUiPaintCaches(ctx);
                applyPlaylistButton(ctx, contextSettings[ctx] || {});
            });
        };

        streamDeckSocket.onclose = function () {
            streamDeckSocket = null;
            setTimeout(() => connectHw(), 3000);
        };

        streamDeckSocket.onerror = function () {
            try { streamDeckSocket.close(); } catch (e) {}
        };

        streamDeckSocket.onmessage = function (evt) {
            try {
                handleHardwareEvent(JSON.parse(evt.data));
            } catch (e) {
                console.error("[AppleMusic] Hardware message error", e);
            }
        };
    };

    window.connectHw = connectHw;
    connectHw();
}

function handleKeyDown(action, settings, context) {
    amLog.info("hw.keyDown", { action: action });
    let endpoint = null;
    let payload = {};
    switch (action) {
        case "com.laoy.streamdock.applemusic.playpause":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.previous":
            endpoint = "previous";
            break;
        case "com.laoy.streamdock.applemusic.next":
            endpoint = "next";
            break;
        case "com.laoy.streamdock.applemusic.volumeup":
            endpoint = "volumeup";
            break;
        case "com.laoy.streamdock.applemusic.volumedown":
            endpoint = "volumedown";
            break;
        case "com.laoy.streamdock.applemusic.shuffle":
            endpoint = "shuffle";
            break;
        case "com.laoy.streamdock.applemusic.repeat":
            endpoint = "repeat";
            break;
        case "com.laoy.streamdock.applemusic.songinfo":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.love":
            endpoint = "togglelove";
            break;
        case "com.laoy.streamdock.applemusic.addtolibrary":
            endpoint = "addtolibrary";
            break;
        case "com.laoy.streamdock.applemusic.seekforward":
            endpoint = "seekforward";
            break;
        case "com.laoy.streamdock.applemusic.seekbackward":
            endpoint = "seekbackward";
            break;
        case "com.laoy.streamdock.applemusic.clearqueue":
            endpoint = "clearqueue";
            break;
        case "com.laoy.streamdock.applemusic.playplaylist":
            endpoint = "playplaylist";
            payload = settings || {};
            // Mark this key as the active playlist source for ▶ feedback.
            {
                const raw = ciderAPI.extractPlaylistRaw(settings || {});
                const id = raw && raw.includes("music.apple.com")
                    ? (ciderAPI.extractPlaylistIdFromUrl(raw) || raw)
                    : raw;
                Object.keys(activePlaylistByContext).forEach(k => { delete activePlaylistByContext[k]; });
                if (context) {
                    activePlaylistByContext[context] = id || raw || "playlist";
                }
                refreshPlaylistButtons({
                    is_playing: true,
                    cider_connected: true,
                    container_id: id || ""
                });
            }
            break;
        case "com.laoy.streamdock.applemusic.playlistview":
            // Visual button press → play currently browsed playlist
            playlistBrowser.playCurrent();
            return;
        case "com.laoy.streamdock.applemusic.playlistbrowse":
            // Knob press → play currently browsed playlist
            playlistBrowser.playCurrent();
            return;
        case "com.laoy.streamdock.applemusic.volumecontrol":
            endpoint = "mute";
            break;
        case "com.laoy.streamdock.applemusic.previousornext":
            endpoint = "playpause";
            break;
        case "com.laoy.streamdock.applemusic.seekcontrol":
            endpoint = "playpause";
            break;
        default:
            console.warn("[AppleMusic] Unsupported action:", action);
            return;
    }

    // 1. Direct local execution against Cider API (always works, ultra-fast)
    ciderAPI.executeCommand(endpoint, payload);

    // 2. Also forward to Crimsons sidecar if connected
    if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
        crimsonAPI.send({
            type: "APPLE_MUSIC_COMMAND",
            endpoint: endpoint,
            payload: payload
        });
    }
}

function formatTime(ms) {
    if (!ms || ms < 0) return "0:00";
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return mins + ":" + secs.toString().padStart(2, '0');
}

function handleDialRotate(action, ticks) {
    amLog.info("hw.dialRotate", { action: action, ticks: ticks });
    if (action === "com.laoy.streamdock.applemusic.playlistbrowse") {
        // One detent = one playlist
        const step = ticks > 0 ? 1 : (ticks < 0 ? -1 : 0);
        if (step) playlistBrowser.move(step);
        return;
    }
    if (action === "com.laoy.streamdock.applemusic.volumecontrol") {
        ciderAPI.executeCommand("volumecontrol", { ticks: ticks });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "volumecontrol",
                payload: { ticks: ticks }
            });
        }
    } else if (action === "com.laoy.streamdock.applemusic.previousornext") {
        ciderAPI.executeCommand("skip", { ticks: ticks > 0 ? 1 : -1 });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "skip",
                payload: { ticks: ticks > 0 ? 1 : -1 }
            });
        }
    } else if (action === "com.laoy.streamdock.applemusic.seekcontrol") {
        ciderAPI.executeCommand("seekrelative", { ticks: ticks });
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({
                type: "APPLE_MUSIC_COMMAND",
                endpoint: "seekrelative",
                payload: { ticks: ticks }
            });
        }
    }
}

function applyNowPlaying(state) {
    updateActionState(
        "com.laoy.streamdock.applemusic.playpause",
        state.is_playing ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.shuffle",
        state.shuffle_state ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.repeat",
        (state.repeat_state && state.repeat_state !== "none") ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.love",
        state.in_favorites ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.addtolibrary",
        state.in_library ? 1 : 0
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.volumecontrol",
        state.volume_percent === 0 ? 1 : 0
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.volumecontrol",
        state.cider_connected ? (state.volume_percent + "%") : "—"
    );
    updateActionState(
        "com.laoy.streamdock.applemusic.previousornext",
        state.is_playing ? 1 : 0
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.previousornext",
        state.is_playing ? "Lecture" : "Pause"
    );
    setTitleForAction(
        "com.laoy.streamdock.applemusic.seekcontrol",
        state.duration_ms ? (formatTime(state.progress_ms) + "\n" + formatTime(state.duration_ms)) : ""
    );

    // Always show title + artist on Now Playing — never blank when art URL exists
    // (blank+failed CORS left the red "i" stuck with no text).
    setTitleForAction("com.laoy.streamdock.applemusic.songinfo", songInfoTitle(state));
    applySongInfoArt(state);

    refreshPlaylistButtons(state);
    // Retry playlist covers when previous toBase64 failed (page return / CORS).
    const ppContexts = actionContexts["com.laoy.streamdock.applemusic.playplaylist"] || [];
    ppContexts.forEach((ctx) => {
        if (!playlistCoverCache[ctx]) {
            applyPlaylistCover(ctx, contextSettings[ctx] || {});
        }
    });
}

function setTitleForAction(action, title) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => setTitleForContext(context, title));
}

function setImageForAction(action, image) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => setImageForContext(context, image));
}

function updateActionState(action, state) {
    const contexts = actionContexts[action] || [];
    contexts.forEach(context => sendToContext(context, "setState", { state: state }));
}

// Live sync: poll Cider fast so opening Cider / track changes hit the deck without a manual trigger.
// (StreamDock throttles background timers — also push via crimson WS which wakes the plugin.)
let _lastCiderConnected = null;
let _pollBusy = false;
async function pollCiderLive() {
    if (_pollBusy) return;
    _pollBusy = true;
    const t0 = Date.now();
    try {
        const st = await ciderAPI.fetchState();
        if (!st) {
            amLog.warn("poll: fetchState returned null");
            applyNowPlaying({
                cider_connected: false,
                track_name: "",
                artist_name: "",
                album_art: "",
                album_art_data: "",
                is_playing: false
            });
            return;
        }
        const connected = !!st.cider_connected;
        if (_lastCiderConnected !== connected) {
            amLog.info("poll: cider_connected changed", {
                from: _lastCiderConnected,
                to: connected,
                track: st.track_name || "",
                playing: !!st.is_playing
            });
        }
        if (_lastCiderConnected === false && connected) {
            lastAlbumArt = null;
        }
        // Log track changes (detect lag / missed updates)
        if (st.track_id && st.track_id !== pollCiderLive._lastTrackId) {
            amLog.info("poll: track changed", {
                id: st.track_id,
                name: st.track_name,
                artist: st.artist_name,
                playing: !!st.is_playing
            });
            pollCiderLive._lastTrackId = st.track_id;
        }
        _lastCiderConnected = connected;
        applyNowPlaying(st);
        const ms = Date.now() - t0;
        if (ms >= 250) amLog.warn("FREEZE/SLOW pollCiderLive", { ms: ms, connected: connected });
    } catch (e) {
        amLog.error("pollCiderLive exception", String(e && e.message ? e.message : e));
    } finally {
        _pollBusy = false;
    }
}
pollCiderLive._lastTrackId = "";
setInterval(pollCiderLive, POLL_MS);
// Keepalive ping so StreamDock is less likely to throttle the plugin timer
setInterval(() => {
    try {
        if (crimsonAPI.ws && crimsonAPI.ws.readyState === WebSocket.OPEN) {
            crimsonAPI.send({ type: "PING" });
        }
    } catch (e) {}
}, 5000);

window.connectElgatoStreamDeckSocket = connectElgatoStreamDeckSocket;
