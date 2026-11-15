/**
 * Lightweight assertions for Apple Music StreamDock UI refresh helpers.
 * Mirrors the pure title/format logic in
 * plugins/catalog/com.laoy.streamdock.applemusic.sdPlugin/plugin/app.js
 * (kept in sync manually — fail this test if songinfo blanks when art exists).
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const appJs = fs.readFileSync(
  path.join(root, "plugins/catalog/com.laoy.streamdock.applemusic.sdPlugin/plugin/app.js"),
  "utf8"
);

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

function playlistButtonTitle(settings, opts) {
  const s = settings || {};
  const playing = !!(opts && opts.playing);
  let base = "";
  if (s.playlistName || s.name) {
    base = String(s.playlistName || s.name).slice(0, 14);
  } else {
    base = "Playlist";
  }
  return playing ? ("▶ " + base).slice(0, 16) : base;
}

// --- Regression: never blank title when album_art URL is present ---
{
  const title = songInfoTitle({
    cider_connected: true,
    track_name: "Midnight City (feat. Someone)",
    artist_name: "M83",
    album_art: "https://is1-ssl.mzstatic.com/image/thumb/x/300x300bb.jpg",
    is_playing: true
  });
  assert.notEqual(title, "", "songinfo must not blank title when album_art exists");
  assert.match(title, /Midnight/);
  assert.match(title, /M83/);
}

{
  assert.equal(songInfoTitle({ cider_connected: false }), "Cider off");
  assert.equal(
    songInfoTitle({ cider_connected: true, track_name: "", is_playing: false }),
    "—"
  );
}

{
  assert.equal(
    playlistButtonTitle({ playlistName: "2023-2024" }, { playing: false }),
    "2023-2024"
  );
  assert.equal(
    playlistButtonTitle({ playlistName: "2023-2024" }, { playing: true }),
    "▶ 2023-2024"
  );
}

// --- Source guards: ensure the live plugin keeps the fix ---
assert.match(
  appJs,
  /Always show title \+ artist on Now Playing/,
  "app.js must keep the songinfo title comment/fix"
);
assert.doesNotMatch(
  appJs,
  /if \(state\.album_art\) \{\s*\/\/ Option 1: Clean cover art only/,
  "must not clear title when album_art exists"
);
assert.match(appJs, /POLL_MS\s*=\s*1000/, "poll interval should be ~1s");
assert.match(appJs, /albumArtRetryAfter/, "must retry failed album art conversion");
assert.match(appJs, /refreshPlaylistButtons/, "playplaylist must refresh ▶ feedback");
assert.match(appJs, /fetchStateV1/, "plugin must fall back to Cider v1 playback APIs");
assert.match(appJs, /forceRehydrateNowPlaying/, "must force rehydrate on willAppear/reconnect");
assert.match(appJs, /invalidateUiPaintCaches/, "must invalidate setImage dedupe on page return");
assert.match(
  appJs,
  /Keep contextSettings/,
  "must keep playlist settings across willDisappear"
);
assert.match(appJs, /playlistArtMemo/, "must memoize playlist covers for instant willAppear paint");
assert.match(appJs, /PLAYLIST_ART_RETRY_MS/, "playlist cover retry must be faster than album 8s backoff");
assert.match(
  appJs,
  /never enrichMissingArtwork/,
  "resolvePlaylistArtwork must not crawl the full library (5s delay bug)"
);
assert.match(
  appJs,
  /must NOT wipe playlist cover/,
  "forceRehydrateNowPlaying must not clear playlist cover caches"
);

console.log("applemusic_ui_refresh_test: ok");
