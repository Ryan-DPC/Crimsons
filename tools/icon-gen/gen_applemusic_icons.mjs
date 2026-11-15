/**
 * Apple Music StreamDock icons — coherent Lucide/media-player geometry.
 * Renders SVG at 2× via @resvg/resvg-js; Python downscales 288→144 (LANCZOS).
 *
 * Design rules (viewBox 0–100):
 *  - ~20% padding → glyph in ~20–80
 *  - stroke ≈ 6.5 (≈ Lucide 2 @ 24 scaled + StreamDock weight)
 *  - round caps/joins; filled media glyphs optically nudged
 */
import { Resvg } from "@resvg/resvg-js";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  __dirname,
  "../../plugins/catalog/com.laoy.streamdock.applemusic.sdPlugin/static/icon"
);
const TMP = path.join(__dirname, ".tmp-2x");

const SIZE = 144;
const RENDER = SIZE * 2; // 288
const FG = "#E11D2E";
const BG = "#121214";
const SW = 6.5;

function svg(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${RENDER}" height="${RENDER}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" ry="22" fill="${BG}"/>
  ${body}
</svg>`;
}

const stroke = `fill="none" stroke="${FG}" stroke-width="${SW}" stroke-linecap="round" stroke-linejoin="round"`;

/**
 * Lucide Repeat — exact 24×24 paths, scaled into viewBox with ~18% padding.
 * Guarantees authentic media-player corner arcs (no hand-tuned sweep bugs).
 */
function repeatIcon(active = false) {
  const mid = active
    ? `<circle cx="50" cy="50" r="5" fill="${FG}"/>`
    : "";
  // 24 → 64 content (pad 18): scale=64/24, origin=(100-64)/2=18
  return svg(`
  <g transform="translate(18,18) scale(${64 / 24})"
     fill="none" stroke="${FG}" stroke-width="2.45"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="m17 2 4 4-4 4"/>
    <path d="M3 11v-1a4 4 0 0 1 4-4h14"/>
    <path d="m7 22-4-4 4-4"/>
    <path d="M21 13v1a4 4 0 0 1-4 4H3"/>
  </g>
  ${mid}
  `);
}

/** Lucide Shuffle — exact upstream 24×24 paths. */
function shuffleIcon(active = false) {
  const sw = active ? 2.55 : 2.45;
  return svg(`
  <g transform="translate(18,18) scale(${64 / 24})"
     fill="none" stroke="${FG}" stroke-width="${sw}"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="m18 14 4 4-4 4"/>
    <path d="m18 2 4 4-4 4"/>
    <path d="M2 18h1.973a4 4 0 0 0 3.3-1.7l5.454-8.6a4 4 0 0 1 3.3-1.7H22"/>
    <path d="M2 6h1.972a4 4 0 0 1 3.6 2.2"/>
    <path d="M22 18h-6.041a4 4 0 0 1-3.3-1.8l-.359-.45"/>
  </g>
  `);
}

/** Seek ±15 — partial ring + arrowhead + numeral. */
function seek15(forward) {
  const ring = forward
    ? `M58 28 A22 22 0 1 1 40 29`
    : `M42 28 A22 22 0 1 0 60 29`;
  const head = forward
    ? `M38 18 L50 30 L36 34 Z`
    : `M62 18 L50 30 L64 34 Z`;
  return svg(`
  <g transform="translate(0,2)">
    <path d="${ring}" fill="none" stroke="${FG}" stroke-width="${SW}" stroke-linecap="butt"/>
    <path d="${head}" fill="${FG}"/>
    <text x="50" y="58" text-anchor="middle"
          font-family="Segoe UI, Arial, Helvetica, sans-serif"
          font-size="20" font-weight="700" fill="${FG}">15</text>
  </g>
  `);
}

function volume(waves, muted = false) {
  const w1 =
    waves >= 1
      ? `<path d="M58 40 A10 10 0 0 1 58 60" fill="none" stroke="${FG}" stroke-width="${SW}" stroke-linecap="round"/>`
      : "";
  const w2 =
    waves >= 2
      ? `<path d="M68 32 A20 20 0 0 1 68 68" fill="none" stroke="${FG}" stroke-width="${SW}" stroke-linecap="round"/>`
      : "";
  const mute = muted
    ? `<g fill="none" stroke="${FG}" stroke-width="${SW}" stroke-linecap="round">
         <path d="M60 38 L78 58 M78 38 L60 58"/>
       </g>`
    : `${w1}${w2}`;
  // Optical: speaker cone is left-heavy; nudge so glyph mass sits on center
  const tx = muted ? -2 : waves <= 1 ? 2 : -3;
  return svg(`
  <g transform="translate(${tx},0)">
    <path d="M28 40 H38 L54 28 V72 L38 60 H28 Z" fill="${FG}"
          stroke="${FG}" stroke-width="1" stroke-linejoin="round"/>
    ${mute}
  </g>
  `);
}

/**
 * Single note + plus — compact unit (plus sits beside the stem tip, not flying off).
 * Mass-centering places optical weight on canvas mid.
 */
function notePlus() {
  return svg(`
  <g>
    <circle cx="42" cy="64" r="12" fill="${FG}"/>
    <path d="M52 64 V28 L70 34" fill="none" stroke="${FG}"
          stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>
    <!-- plus tucked against the bar tip -->
    <g fill="none" stroke="${FG}" stroke-width="6" stroke-linecap="round">
      <path d="M68 22 H80 M74 16 V28"/>
    </g>
  </g>
  `);
}

/** Single note (Now Playing) — Lucide Music2 geometry. */
function noteOnly() {
  return svg(`
  <g>
    <circle cx="42" cy="66" r="12" fill="${FG}"/>
    <path d="M52 66 V26 L76 34" fill="none" stroke="${FG}"
          stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
  `);
}

const icons = {
  // Transport — filled, optically nudged
  play: svg(`
    <path d="M38 28 L38 72 L76 50 Z" fill="${FG}"
          stroke="${FG}" stroke-width="3" stroke-linejoin="round"/>
  `),

  pause: svg(`
    <rect x="34" y="28" width="12" height="44" rx="3" fill="${FG}"/>
    <rect x="54" y="28" width="12" height="44" rx="3" fill="${FG}"/>
  `),

  previous: svg(`
    <rect x="28" y="28" width="8" height="44" rx="2" fill="${FG}"/>
    <path d="M72 28 L40 50 L72 72 Z" fill="${FG}"
          stroke="${FG}" stroke-width="1.5" stroke-linejoin="round"/>
  `),

  next: svg(`
    <path d="M28 28 L60 50 L28 72 Z" fill="${FG}"
          stroke="${FG}" stroke-width="1.5" stroke-linejoin="round"/>
    <rect x="64" y="28" width="8" height="44" rx="2" fill="${FG}"/>
  `),

  forward: seek15(true),
  rewind: seek15(false),

  repeat: repeatIcon(false),
  repeat_on: repeatIcon(true),

  shuffle: shuffleIcon(false),
  shuffle_on: shuffleIcon(true),

  love: svg(`
  <g transform="translate(18,18) scale(${64 / 24})"
     fill="none" stroke="${FG}" stroke-width="2.45"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/>
  </g>
  `),

  love_on: svg(`
  <g transform="translate(18,18) scale(${64 / 24})">
    <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"
          fill="${FG}"/>
  </g>
  `),

  add_library: notePlus(),
  songinfo: noteOnly(),

  clear_queue: svg(`
  <g transform="translate(18,18) scale(${64 / 24})"
     fill="none" stroke="${FG}" stroke-width="2.45"
     stroke-linecap="round" stroke-linejoin="round">
    <path d="M16 5H3"/>
    <path d="M11 12H3"/>
    <path d="M16 19H3"/>
    <path d="m15.5 9.5 5 5"/>
    <path d="m20.5 9.5-5 5"/>
  </g>
  `),

  volume_up: volume(2),
  volume_down: volume(1),
  volume_control: volume(2),
  volume_mute: volume(0, true),

  prevornext: svg(`
    <rect x="18" y="34" width="7" height="32" rx="2" fill="${FG}"/>
    <path d="M48 34 L26 50 L48 66 Z" fill="${FG}"
          stroke="${FG}" stroke-width="1" stroke-linejoin="round"/>
    <path d="M52 34 L74 50 L52 66 Z" fill="${FG}"
          stroke="${FG}" stroke-width="1" stroke-linejoin="round"/>
    <rect x="75" y="34" width="7" height="32" rx="2" fill="${FG}"/>
  `),

  seek_control: svg(`
    <g fill="${FG}" stroke="${FG}" stroke-width="1" stroke-linejoin="round">
      <path d="M44 36 L26 50 L44 64 Z"/>
      <path d="M34 36 L16 50 L34 64 Z"/>
      <path d="M56 36 L74 50 L56 64 Z"/>
      <path d="M66 36 L84 50 L66 64 Z"/>
    </g>
  `),

  play_playlist: svg(`
    <g>
      <path d="M22 30 L22 54 L42 42 Z" fill="${FG}"
            stroke="${FG}" stroke-width="1.5" stroke-linejoin="round"/>
      <g ${stroke}>
        <path d="M48 34 H80"/>
        <path d="M48 50 H80"/>
        <path d="M48 66 H72"/>
      </g>
    </g>
  `),
};

function writePng2x(name, svgStr) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: "width", value: RENDER },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(TMP, `${name}.png`), png);
}

fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });
for (const [name, svgStr] of Object.entries(icons)) {
  writePng2x(name, svgStr);
  console.log("2x", `${name}.png`);
}

const downscale = path.join(__dirname, "downscale_and_center.py");
execFileSync("python", [downscale, TMP, OUT], { stdio: "inherit" });
console.log("done", Object.keys(icons).length, "icons →", OUT);
