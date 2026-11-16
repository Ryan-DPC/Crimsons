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
/** Playlist covers retry sooner — 8s backoff made willAppear feel “broken”. */
const PLAYLIST_ART_RETRY_MS = 1500;
/** playlistId / name → { url, b64 } so willAppear can paint instantly. */
const playlistArtMemo = {};
/** StreamDock keys clip centered setTitle — slide a fixed window instead. */
const MARQUEE_CHARS = 10;
const MARQUEE_GAP = "   ";
/** ~10 Hz / 1-char steps — smoother than 280–500ms jumps; SD handles this fine. */
const MARQUEE_TICK_MS = 100;
/** Brief hold at loop start/end so the full window is readable. */
const MARQUEE_PAUSE_MS = 1200;

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
    /** In-flight ensureLoaded promise — concurrent willAppear must await, not no-op. */
    loadPromise: null,
    moveBusy: false,
    pendingDelta: 0,
    lastCoverUrl: "",
    lastCoverCtx: {},

    current() {
        if (!this.list.length) return null;
        const i = ((this.index % this.list.length) + this.list.length) % this.list.length;
        return this.list[i];
    },

    clearCoverDedupe() {
        this.lastCoverUrl = "";
        this.lastCoverCtx = {};
    },

    async ensureLoaded(force) {
        // Browse + Preview both fire willAppear — join the in-flight load so the
        // second caller no longer paints with an empty list / no cover.
        if (this.loadPromise) {
            await this.loadPromise;
            if (!force && this.list.length) return;
        }
        if (!force && this.list.length) return;
        if (this.loadPromise) {
            await this.loadPromise;
            return;
        }

        const t0 = Date.now();
        this.loading = true;
        amLog.info("browser.ensureLoaded start", { force: !!force, cached: this.list.length });
        const work = (async () => {
            try {
                const list = await ciderAPI.listLibraryPlaylistsFast();
                this.list = list || [];
                if (this.index >= this.list.length) this.index = 0;
                amLog.timing("browser.listFast", t0);
                const cur = this.current();
                amLog.info("browser.list ready", {
                    count: this.list.length,
                    index: this.index,
                    id: cur && cur.id,
                    name: cur && cur.name,
                    hasImage: !!(cur && cur.image)
                });
                // Cover for current only — never block scroll on full-library enrich
                if (cur && !cur.image) {
                    const t1 = Date.now();
                    cur.image = await ciderAPI.artworkFromFirstTrack(cur.id);
                    amLog.timing("browser.cover.current", t1);
                    amLog.info("browser.cover.current result", {
                        id: cur.id,
                        name: cur.name,
                        art: cur.image ? String(cur.image).slice(0, 80) : ""
                    });
                }
            } catch (e) {
                amLog.error("browser.ensureLoaded failed", String(e && e.message ? e.message : e));
            } finally {
                this.loading = false;
            }
        })();
        this.loadPromise = work;
        try {
            await work;
        } finally {
            if (this.loadPromise === work) this.loadPromise = null;
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
                        if (!art) {
                            amLog.warn("browser.move no artwork", { id: cur.id, name: cur.name });
                            return;
                        }
                        if (this.current() && this.current().id === cur.id) {
                            cur.image = art;
                            this.applyCover(art, { force: true });
                        }
                    }).catch(() => {});
                } else if (cur && cur.image) {
                    this.applyCover(cur.image, { force: true });
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
        const force = !!(opts && opts.force);
        const label = !this.list.length
            ? "Aucune"
            : ((this.index + 1) + "/" + this.list.length);
        const name = cur ? String(cur.name || "") : "Playlist";

        setTitleForAction("com.laoy.streamdock.applemusic.playlistbrowse", label);

        const viewContexts = actionContexts["com.laoy.streamdock.applemusic.playlistview"] || [];
        if (force) {
            viewContexts.forEach((ctx) => { delete lastTitleByContext[ctx]; });
        }
        if (!cur || !name) {
            playlistViewMarquee.stop();
            viewContexts.forEach((ctx) => {
                sendToContext(ctx, "setTitle", { title: "Playlist", target: 0 });
            });
        } else {
            playlistViewMarquee.set([name], (title) => {
                const ctxs = actionContexts["com.laoy.streamdock.applemusic.playlistview"] || [];
                ctxs.forEach((ctx) => setTitleForContext(ctx, title));
            });
            if (force) playlistViewMarquee.forceRepaint();
        }

        amLog.info("browser.paint", {
            name: name,
            label: label,
            hasImage: !!(cur && cur.image),
            views: viewContexts.length,
            force: force,
            skipCoverFetch: !!(opts && opts.skipCoverFetch)
        });

        if (cur && cur.image) {
            this.applyCover(cur.image, { force: force });
        } else if (!(opts && opts.skipCoverFetch)) {
            // Still try first-track art (list often has artwork:null for user playlists).
            if (cur && cur.id) {
                ciderAPI.artworkFromFirstTrack(cur.id).then((art) => {
                    if (!art) {
                        amLog.warn("browser.paint no artwork", { id: cur.id, name: cur.name });
                        return;
                    }
                    if (this.current() && this.current().id === cur.id) {
                        cur.image = art;
                        this.applyCover(art, { force: true });
                    }
                }).catch(() => {});
            }
            viewContexts.forEach((ctx) => {
                sendToContext(ctx, "setImage", { image: "static/icon/play_playlist.png", target: 0 });
            });
        }
    },

    async applyCover(url, opts) {
        if (!url) return;
        const force = !!(opts && opts.force);
        const viewContexts = actionContexts["com.laoy.streamdock.applemusic.playlistview"] || [];
        if (!viewContexts.length) {
            amLog.warn("browser.cover no playlistview contexts");
            return;
        }
        const t0 = Date.now();
        const cur = this.current();
        try {
            let b64 = url.startsWith("data:") ? url : await crimsonAPI.toBase64(url);
            if (!b64) {
                amLog.warn("browser.cover toBase64 failed — raw URL fallback", url.slice(0, 80));
                // Same last-resort as Now Playing / Play Playlist.
                b64 = url;
            }
            // Warm Play Playlist memo so square keys can paint instantly later.
            if (cur && cur.id) rememberPlaylistArt(cur.id, url, b64.startsWith("data:") ? b64 : "");
            if (cur && cur.name) rememberPlaylistArt(cur.name, url, b64.startsWith("data:") ? b64 : "");
            let painted = 0;
            viewContexts.forEach((ctx) => {
                if (!force && this.lastCoverCtx[ctx] === url) return;
                this.lastCoverCtx[ctx] = url;
                sendToContext(ctx, "setImage", { image: b64, target: 0 });
                painted++;
            });
            this.lastCoverUrl = url;
            amLog.info("browser.cover.setImage", {
                painted: painted,
                views: viewContexts.length,
                force: force,
                b64: b64.startsWith("data:"),
                url: String(url).slice(0, 80)
            });
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
            // User explicitly disconnected — do not fall through to spa-config.
            if (raw && raw.cleared === true) {
                try { window.__CIDER_APP_TOKEN__ = ""; } catch (eClr) {}
                return "";
            }
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

/**
 * Sliding-window marquee for StreamDock setTitle (host center-clips long text).
 * Pauses briefly at the start of each loop; no-ops when text fits the key.
 */
function createTitleMarquee(width) {
    const chars = width || MARQUEE_CHARS;
    let lines = [];
    let offset = 0;
    let pauseUntil = 0;
    let timer = null;
    let paint = null;

    function sliceLine(text, off) {
        if (!text || text.length <= chars) return text || "";
        const loop = text + MARQUEE_GAP;
        const i = ((off % loop.length) + loop.length) % loop.length;
        return (loop + loop).slice(i, i + chars);
    }

    function render() {
        if (!paint) return;
        const title = lines.map((t) => sliceLine(t, offset)).join("\n");
        paint(title);
    }

    function tick() {
        const needs = lines.some((t) => t && t.length > chars);
        if (!needs) {
            offset = 0;
            render();
            return;
        }
        const now = Date.now();
        if (now < pauseUntil) {
            render();
            return;
        }
        let maxLoop = 0;
        for (let i = 0; i < lines.length; i++) {
            const t = lines[i] || "";
            if (t.length > chars) maxLoop = Math.max(maxLoop, t.length + MARQUEE_GAP.length);
        }
        offset += 1;
        if (offset >= maxLoop) {
            offset = 0;
            pauseUntil = now + MARQUEE_PAUSE_MS;
        }
        render();
    }

    function ensureTimer(needsScroll) {
        if (needsScroll && !timer) {
            timer = setInterval(tick, MARQUEE_TICK_MS);
        } else if (!needsScroll && timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    return {
        set: function (nextLines, paintFn) {
            paint = paintFn;
            const next = (nextLines || []).map((s) => String(s || ""));
            const same = next.length === lines.length && next.every((s, i) => s === lines[i]);
            if (same) {
                ensureTimer(next.some((t) => t.length > chars));
                return;
            }
            lines = next;
            offset = 0;
            pauseUntil = Date.now() + MARQUEE_PAUSE_MS;
            render();
            ensureTimer(lines.some((t) => t.length > chars));
        },
        stop: function () {
            if (timer) {
                clearInterval(timer);
                timer = null;
            }
            lines = [];
            offset = 0;
            paint = null;
        },
        forceRepaint: function () {
            // Wipe StreamDock dedupe then show current window (page return).
            render();
        }
    };
}

const songInfoMarquee = createTitleMarquee(MARQUEE_CHARS);
const playlistViewMarquee = createTitleMarquee(12);

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
            // Keep original extension — mzstatic serves both .png and .jpg variants.
            .replace(/\/600x600bb\.(png|jpg)/gi, "/144x144bb.$1")
            .replace(/\/1200x1200bb\.(png|jpg)/gi, "/144x144bb.$1")
            .replace(/\/300x300bb\.(png|jpg)/gi, "/144x144bb.$1");
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
            if (!resp || !resp.ok) {
                amLog.warn("artworkFromFirstTrack HTTP", {
                    id: playlistId,
                    status: resp ? resp.status : null
                });
                return "";
            }
            const json = await resp.json();
            const items = (json && json.data && Array.isArray(json.data.items))
                ? json.data.items
                : (Array.isArray(json && json.data) ? json.data : []);
            if (!items.length) {
                amLog.warn("artworkFromFirstTrack empty songs", { id: playlistId });
                return "";
            }
            const art = this.extractArtworkFromItem(items[0]);
            if (!art) {
                amLog.warn("artworkFromFirstTrack no extractable art", {
                    id: playlistId,
                    track: items[0] && (items[0].name || (items[0].attributes && items[0].attributes.name))
                });
            }
            return art;
        } catch (e) {
            amLog.error("artworkFromFirstTrack exception", String(e && e.message ? e.message : e));
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
        // Instant: memory from a prior paint / browser scroll
        const memo = playlistArtMemo[key] || playlistArtMemo[key.toLowerCase()];
        if (memo && memo.url) return memo.url;

        const match = (list) => (list || []).find((p) =>
            p.id === key
            || (p.name && p.name.toLowerCase() === key.toLowerCase())
            || (p.name && p.name.toLowerCase().startsWith(key.toLowerCase()))
        );

        const fromCache = match(this.playlistCache);
        if (fromCache && fromCache.image) return fromCache.image;

        try {
            // Fast list ONLY — never enrichMissingArtwork (that serial first-track
            // crawl for the whole library is what made covers land ~5s late).
            if (!this.playlistCache.length) {
                await this.listLibraryPlaylistsFast();
            }
            const hit = match(this.playlistCache);
            if (hit && hit.image) return hit.image;
            if (hit && hit.id) {
                const art = await this.artworkFromFirstTrack(hit.id);
                if (art) {
                    hit.image = art;
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
/** Failed playlist cover URLs → next retry timestamp (ms). Keys: "context|url". */
const playlistCoverRetryAfter = {};

function clearPlaylistCoverRetryForContext(context) {
    if (!context) {
        Object.keys(playlistCoverRetryAfter).forEach((k) => { delete playlistCoverRetryAfter[k]; });
        return;
    }
    Object.keys(playlistCoverRetryAfter).forEach((k) => {
        if (k === context || k.startsWith(context + "|")) delete playlistCoverRetryAfter[k];
    });
}

function invalidateNowPlayingCaches() {
    lastAlbumArt = null;
    albumArtInFlight = null;
}

/** Wipe setImage/setTitle dedupe for a Play Playlist key so paint re-fires.
 *  Does NOT clear playlistArtMemo — that is the fast willAppear path. */
function invalidatePlaylistPaintCaches(context) {
    if (context) {
        delete lastTitleByContext[context];
        delete lastImageByContext[context];
        delete playlistCoverCache[context];
        clearPlaylistCoverRetryForContext(context);
    } else {
        lastTitleByContext = {};
        lastImageByContext = {};
        Object.keys(playlistCoverCache).forEach((k) => { delete playlistCoverCache[k]; });
        clearPlaylistCoverRetryForContext(null);
    }
}

/** After page change / restart StreamDock blanks keys but our dedupe caches
 *  still hold the last URL — force a full paint so setImage/setTitle re-fire. */
function invalidateUiPaintCaches(context) {
    invalidateNowPlayingCaches();
    invalidatePlaylistPaintCaches(context);
}

/** Rehydrate Now Playing only — must NOT wipe playlist cover memo/dedupe
 *  (that raced with applyPlaylistCover and delayed/skipped square-key paints). */
function forceRehydrateNowPlaying() {
    invalidateNowPlayingCaches();
    const songContexts = actionContexts["com.laoy.streamdock.applemusic.songinfo"] || [];
    songContexts.forEach((ctx) => {
        delete lastTitleByContext[ctx];
        delete lastImageByContext[ctx];
    });
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

function playlistCoverMemoKey(settings) {
    const s = settings || {};
    const raw = ciderAPI.extractPlaylistRaw(s);
    if (raw) return raw;
    if (s.playlistName) return String(s.playlistName);
    if (s.name) return String(s.name);
    return "";
}

function rememberPlaylistArt(key, url, b64) {
    if (!key) return;
    const prev = playlistArtMemo[key] || {};
    const entry = {
        url: (url || prev.url || "").trim(),
        b64: b64 || prev.b64 || ""
    };
    playlistArtMemo[key] = entry;
    const lower = String(key).toLowerCase();
    if (lower !== key) playlistArtMemo[lower] = entry;
}

function persistPlaylistImageToSettings(context, settings, url) {
    if (!context || !url) return;
    const prev = contextSettings[context] || {};
    if (prev.playlist_image === url && prev.image === url) {
        contextSettings[context] = Object.assign({}, prev, settings || {});
        return;
    }
    const next = Object.assign({}, prev, settings || {}, {
        playlist_image: url,
        image: url
    });
    contextSettings[context] = next;
    // Persist URL so the next StreamDock restart skips Cider resolve.
    sendToContext(context, "setSettings", next);
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

function songInfoLines(state) {
    if (!state || !state.track_name) return { track: "", artist: "" };
    const track = String(state.track_name)
        .replace(/\s*[\(\[](feat\.|ft\.|with).*?[\)\]]/i, "")
        .trim();
    const artist = String(state.artist_name || "").trim();
    return { track: track, artist: artist };
}

function songInfoTitle(state) {
    if (!state || !state.cider_connected) return "Cider off";
    if (state.track_name) {
        const lines = songInfoLines(state);
        // Full text — live keys use marquee; this is the logical title (tests / fallback).
        return lines.artist ? (lines.track + "\n" + lines.artist) : lines.track;
    }
    return state.is_playing ? "Apple Music" : "—";
}

function applySongInfoTitle(state) {
    if (!state || !state.cider_connected) {
        songInfoMarquee.stop();
        setTitleForAction("com.laoy.streamdock.applemusic.songinfo", "Cider off");
        return;
    }
    if (!state.track_name) {
        songInfoMarquee.stop();
        setTitleForAction(
            "com.laoy.streamdock.applemusic.songinfo",
            state.is_playing ? "Apple Music" : "—"
        );
        return;
    }
    const lines = songInfoLines(state);
    const parts = lines.artist ? [lines.track, lines.artist] : [lines.track];
    songInfoMarquee.set(parts, (title) => {
        setTitleForAction("com.laoy.streamdock.applemusic.songinfo", title);
    });
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

async function applyPlaylistCover(context, settings, opts) {
    const s = Object.assign({}, contextSettings[context] || {}, settings || {});
    const force = !!(opts && opts.force);
    const memoKey = playlistCoverMemoKey(s);
    let url = (s.playlist_image || s.image || "").trim();
    const memo = memoKey
        ? (playlistArtMemo[memoKey] || playlistArtMemo[String(memoKey).toLowerCase()])
        : null;
    amLog.info("applyPlaylistCover start", {
        context: String(context || "").slice(0, 12),
        memoKey: String(memoKey || "").slice(0, 40),
        hasUrl: !!url,
        hasMemoB64: !!(memo && memo.b64),
        force: force
    });

    // Fast path: paint cached base64 immediately (willAppear / page return <1s).
    if (memo && memo.b64) {
        const paintedUrl = memo.url || memo.b64;
        if (force || playlistCoverCache[context] !== paintedUrl || lastImageByContext[context] !== memo.b64) {
            playlistCoverCache[context] = paintedUrl;
            setImageForContext(context, memo.b64);
            applyPlaylistButtonTitle(context, s);
        }
        if (url && memo.url && memo.url === url && !force) return;
        if (!url && memo.url) url = memo.url;
    }

    if (!url) {
        const raw = ciderAPI.extractPlaylistRaw(s);
        if (raw) {
            url = await ciderAPI.resolvePlaylistArtwork(raw);
            amLog.info("applyPlaylistCover resolve", {
                raw: String(raw).slice(0, 40),
                art: url ? String(url).slice(0, 80) : ""
            });
            if (url) {
                persistPlaylistImageToSettings(context, s, url);
            }
        }
    }
    if (!url) {
        amLog.warn("applyPlaylistCover empty artwork", {
            memoKey: String(memoKey || "").slice(0, 40),
            name: s.playlistName || s.name || ""
        });
        return;
    }

    // Re-check memo for this URL after resolve (browser may have warmed it).
    const memo2 = memoKey
        ? (playlistArtMemo[memoKey] || playlistArtMemo[String(memoKey).toLowerCase()])
        : null;
    if (memo2 && memo2.b64 && memo2.url === url) {
        playlistCoverCache[context] = url;
        setImageForContext(context, memo2.b64);
        applyPlaylistButtonTitle(context, contextSettings[context] || s);
        if (!force) return;
    }

    if (!force && playlistCoverCache[context] === url && lastImageByContext[context]) return;

    const now = Date.now();
    const retryKey = context + "|" + url;
    if (!force && playlistCoverRetryAfter[retryKey] && playlistCoverRetryAfter[retryKey] > now) return;
    try {
        let b64 = url.startsWith("data:") ? url : await crimsonAPI.toBase64(url);
        if (!b64) {
            console.warn("[AppleMusic] playlist cover toBase64 failed", url.slice(0, 80));
            // Last-resort like Now Playing: some hosts accept the raw mzstatic URL.
            setImageForContext(context, url);
            playlistCoverCache[context] = url;
            rememberPlaylistArt(memoKey, url, "");
            persistPlaylistImageToSettings(context, s, url);
            applyPlaylistButtonTitle(context, contextSettings[context] || s);
            playlistCoverRetryAfter[retryKey] = now + PLAYLIST_ART_RETRY_MS;
            return;
        }
        delete playlistCoverRetryAfter[retryKey];
        playlistCoverCache[context] = url;
        rememberPlaylistArt(memoKey, url, b64);
        persistPlaylistImageToSettings(context, s, url);
        setImageForContext(context, b64);
        // Keep playlist PI name on the key (cover is background; do not blank title).
        applyPlaylistButtonTitle(context, contextSettings[context] || s);
    } catch (e) {
        console.warn("[AppleMusic] playlist cover failed", e);
        playlistCoverRetryAfter[retryKey] = now + PLAYLIST_ART_RETRY_MS;
    }
}

function applyPlaylistButton(context, settings, opts) {
    applyPlaylistButtonTitle(context, settings);
    applyPlaylistCover(context, settings, opts);
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
        if (action === "com.laoy.streamdock.applemusic.playplaylist") {
            // Dedupe only for this key — keep playlistArtMemo for instant cover paint.
            invalidatePlaylistPaintCaches(context);
            applyPlaylistButton(
                context,
                contextSettings[context] || jsonObj['payload']?.settings || {},
                { force: true }
            );
            // Live ▶ marker without touching Now Playing / playlist memo.
            ciderAPI.fetchState().then((st) => {
                if (st) refreshPlaylistButtons(st);
            }).catch(() => {});
        } else if (action === "com.laoy.streamdock.applemusic.playlistbrowse"
            || action === "com.laoy.streamdock.applemusic.playlistview") {
            // StreamDock blanks the key on page return; wipe cover dedupe so setImage re-fires.
            playlistBrowser.clearCoverDedupe();
            delete lastTitleByContext[context];
            delete lastImageByContext[context];
            playlistBrowser.ensureLoaded(true).then(() => playlistBrowser.paint({ force: true }));
            forceRehydrateNowPlaying();
        } else {
            // Page return / plugin reload: wipe songinfo dedupe then rehydrate.
            invalidateNowPlayingCaches();
            delete lastTitleByContext[context];
            delete lastImageByContext[context];
            forceRehydrateNowPlaying();
        }
    }

    if (event === "didReceiveSettings") {
        if (action === "com.laoy.streamdock.applemusic.playplaylist") {
            invalidatePlaylistPaintCaches(context);
            applyPlaylistButton(context, contextSettings[context] || {}, { force: true });
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
                invalidatePlaylistPaintCaches(context);
                applyPlaylistButton(context, s, { force: true });
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
        delete playlistBrowser.lastCoverCtx[context];
        // Global art dedupe must reset too: otherwise applySongInfoArt skips setImage
        // when the same track is still playing after coming back to the page.
        lastAlbumArt = null;
        // Stop marquee timers when no live keys remain (avoid setTitle spam off-page).
        if (action === "com.laoy.streamdock.applemusic.songinfo"
            && !(actionContexts[action] || []).length) {
            songInfoMarquee.stop();
        }
        if (action === "com.laoy.streamdock.applemusic.playlistview"
            && !(actionContexts[action] || []).length) {
            playlistViewMarquee.stop();
        }
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
            // Also re-apply playlist covers from cached settings / memo (instant b64).
            const pp = actionContexts["com.laoy.streamdock.applemusic.playplaylist"] || [];
            pp.forEach((ctx) => {
                invalidatePlaylistPaintCaches(ctx);
                applyPlaylistButton(ctx, contextSettings[ctx] || {}, { force: true });
            });
            // Playlist Preview key (browser) — same page-return blanking problem.
            const hasBrowser =
                (actionContexts["com.laoy.streamdock.applemusic.playlistview"] || []).length
                || (actionContexts["com.laoy.streamdock.applemusic.playlistbrowse"] || []).length;
            if (hasBrowser) {
                playlistBrowser.clearCoverDedupe();
                playlistBrowser.ensureLoaded(true).then(() => playlistBrowser.paint({ force: true }));
            }
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
                invalidatePlaylistPaintCaches(ctx);
                applyPlaylistButton(ctx, contextSettings[ctx] || {}, { force: true });
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
    // Long titles use a sliding-window marquee (StreamDock center-clips setTitle).
    applySongInfoTitle(state);
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
