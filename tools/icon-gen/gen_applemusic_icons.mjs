/**
 * Generate clean 144×144 Apple Music StreamDock icons (red on dark).
 * SVG → PNG via @resvg/resvg-js. Static assets only — runtime setImage covers unchanged.
 */
import { Resvg } from "@resvg/resvg-js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(
  __dirname,
  "../../plugins/catalog/com.laoy.streamdock.applemusic.sdPlugin/static/icon"
);

const SIZE = 144;
const FG = "#FA3C41";
const BG = "#121214";

function svg(body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 100 100">
  <rect width="100" height="100" rx="22" ry="22" fill="${BG}"/>
  ${body}
</svg>`;
}

/** Dual-arrow repeat (Apple / media standard) — clean geometry */
function repeatIcon(active = false) {
  const sw = active ? 8 : 7.5;
  const mid = active
    ? `<circle cx="50" cy="50" r="4.5" fill="${FG}"/>`
    : "";
  // Dual rounded arrows (standard media repeat) — smooth cubic corners
  return svg(`
  <g fill="none" stroke="${FG}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <path d="M 28 38 H 58 C 68 38 74 44 74 52 V 54"/>
    <path d="M 72 62 H 42 C 32 62 26 56 26 48 V 46"/>
  </g>
  <path d="M 66 30 L 78 38 L 66 46" fill="${FG}"/>
  <path d="M 34 70 L 22 62 L 34 54" fill="${FG}"/>
  ${mid}
  `);
}

/** Shuffle with deliberate gap at crossing */
function shuffleIcon(active = false) {
  const sw = active ? 8 : 7;
  return svg(`
  <g fill="none" stroke="${FG}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">
    <!-- upper path: BL→TR via top bend -->
    <path d="M 22 36 H 34 C 42 36 46 42 50 48"/>
    <path d="M 50 52 C 54 58 58 64 66 64 H 78"/>
    <!-- lower path: TL→BR with gap through center -->
    <path d="M 22 64 H 34 C 40 64 44 58 47 54"/>
    <path d="M 53 46 C 56 42 60 36 66 36 H 78"/>
  </g>
  <path d="M 72 28 L 82 36 L 72 44" fill="${FG}"/>
  <path d="M 72 56 L 82 64 L 72 72" fill="${FG}"/>
  `);
}

function seek15(forward) {
  // Nearly-full circle + overlapping arrowhead; nudge down for optical center
  if (forward) {
    return svg(`
    <g transform="translate(0,3)">
      <path d="M 58 29 A 22 22 0 1 1 40 30"
            fill="none" stroke="${FG}" stroke-width="7.5" stroke-linecap="butt"/>
      <path d="M 36 18 L 48 30 L 34 34 Z" fill="${FG}"/>
      <text x="50" y="56" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700"
            fill="${FG}">15</text>
    </g>
    `);
  }
  return svg(`
    <g transform="translate(0,3)">
      <path d="M 42 29 A 22 22 0 1 0 60 30"
            fill="none" stroke="${FG}" stroke-width="7.5" stroke-linecap="butt"/>
      <path d="M 64 18 L 52 30 L 66 34 Z" fill="${FG}"/>
      <text x="50" y="56" text-anchor="middle"
            font-family="Segoe UI, Arial, sans-serif" font-size="22" font-weight="700"
            fill="${FG}">15</text>
    </g>
  `);
}

function volume(waves, muted = false) {
  const wavePaths =
    waves >= 1
      ? `<path d="M 58 40 A 10 10 0 0 1 58 60" fill="none" stroke="${FG}" stroke-width="6.5" stroke-linecap="round"/>`
      : "";
  const wave2 =
    waves >= 2
      ? `<path d="M 66 32 A 20 20 0 0 1 66 68" fill="none" stroke="${FG}" stroke-width="6.5" stroke-linecap="round"/>`
      : "";
  const mute = muted
    ? `<g fill="none" stroke="${FG}" stroke-width="7" stroke-linecap="round">
         <path d="M 60 38 L 76 58 M 76 38 L 60 58"/>
       </g>`
    : `${wavePaths}${wave2}`;

  // Optical: mute is right-heavy; down left-heavy; up/control need left shift
  const tx = muted ? -4 : waves === 1 ? 1 : -4;
  return svg(`
  <g transform="translate(${tx},0)">
    <rect x="26" y="40" width="11" height="20" rx="2" fill="${FG}"/>
    <polygon points="37,40 52,28 52,72 37,60" fill="${FG}"/>
    ${mute}
  </g>
  `);
}

function notesPlus() {
  // Beamed notes + plus — calibrated so combined bbox centers near 50,50
  return svg(`
  <g transform="translate(-10,6)">
    <ellipse cx="36" cy="64" rx="9" ry="7" fill="${FG}"/>
    <ellipse cx="56" cy="60" rx="9" ry="7" fill="${FG}"/>
    <rect x="43" y="30" width="5" height="34" fill="${FG}"/>
    <rect x="63" y="26" width="5" height="34" fill="${FG}"/>
    <path d="M 48 30 H 68 V 37.5 H 48 Z" fill="${FG}"/>
    <g fill="none" stroke="${FG}" stroke-width="6.5" stroke-linecap="round">
      <path d="M 76 28 H 90 M 83 21 V 35"/>
    </g>
  </g>
  `);
}

function notesOnly() {
  return svg(`
  <g transform="translate(-4,2)">
    <ellipse cx="40" cy="64" rx="10" ry="8" fill="${FG}"/>
    <ellipse cx="62" cy="58" rx="10" ry="8" fill="${FG}"/>
    <rect x="48" y="28" width="5.5" height="36" fill="${FG}"/>
    <rect x="70" y="22" width="5.5" height="36" fill="${FG}"/>
    <path d="M 53.5 28 H 75.5 V 36 H 53.5 Z" fill="${FG}"/>
  </g>
  `);
}

const icons = {
  play: svg(`
    <!-- geometric center nudged left so triangle looks centered -->
    <polygon points="32,28 32,72 70,50" fill="${FG}"/>
  `),

  pause: svg(`
    <rect x="34" y="28" width="12" height="44" rx="2.5" fill="${FG}"/>
    <rect x="54" y="28" width="12" height="44" rx="2.5" fill="${FG}"/>
  `),

  previous: svg(`
    <rect x="30" y="28" width="8" height="44" rx="1.5" fill="${FG}"/>
    <polygon points="70,28 38,50 70,72" fill="${FG}"/>
  `),

  next: svg(`
    <polygon points="30,28 62,50 30,72" fill="${FG}"/>
    <rect x="62" y="28" width="8" height="44" rx="1.5" fill="${FG}"/>
  `),

  forward: seek15(true),
  rewind: seek15(false),

  repeat: repeatIcon(false),
  repeat_on: repeatIcon(true),

  shuffle: shuffleIcon(false),
  shuffle_on: shuffleIcon(true),

  love: svg(`
    <g transform="translate(0,2)">
      <path d="M 50 74
               C 28 58 22 46 22 36
               C 22 27 29 22 37 22
               C 43 22 47 25 50 30
               C 53 25 57 22 63 22
               C 71 22 78 27 78 36
               C 78 46 72 58 50 74 Z"
            fill="none" stroke="${FG}" stroke-width="7" stroke-linejoin="round"/>
    </g>
  `),

  love_on: svg(`
    <g transform="translate(0,3)">
      <path d="M 50 76
               C 26 58 20 45 20 35
               C 20 25 28 19 37 19
               C 43 19 47 23 50 28
               C 53 23 57 19 63 19
               C 72 19 80 25 80 35
               C 80 45 74 58 50 76 Z"
            fill="${FG}"/>
    </g>
  `),

  add_library: notesPlus(),
  songinfo: notesOnly(),

  clear_queue: svg(`
    <g transform="translate(-2,0)" fill="none" stroke="${FG}" stroke-width="7" stroke-linecap="round">
      <path d="M 24 36 H 56"/>
      <path d="M 24 50 H 50"/>
      <path d="M 24 64 H 44"/>
      <path d="M 62 40 L 80 58 M 80 40 L 62 58"/>
    </g>
  `),

  volume_up: volume(2),
  volume_down: volume(1),
  volume_control: volume(2),
  volume_mute: volume(0, true),

  prevornext: svg(`
    <rect x="16" y="34" width="6" height="32" rx="1" fill="${FG}"/>
    <polygon points="46,34 24,50 46,66" fill="${FG}"/>
    <polygon points="54,34 76,50 54,66" fill="${FG}"/>
    <rect x="78" y="34" width="6" height="32" rx="1" fill="${FG}"/>
  `),

  seek_control: svg(`
    <polygon points="44,36 26,50 44,64" fill="${FG}"/>
    <polygon points="32,36 14,50 32,64" fill="${FG}"/>
    <polygon points="56,36 74,50 56,64" fill="${FG}"/>
    <polygon points="68,36 86,50 68,64" fill="${FG}"/>
  `),

  play_playlist: svg(`
    <g transform="translate(-2,1)">
      <g fill="none" stroke="${FG}" stroke-width="7" stroke-linecap="round">
        <path d="M 42 34 H 80"/>
        <path d="M 42 50 H 80"/>
        <path d="M 42 66 H 72"/>
      </g>
      <polygon points="20,28 20,56 42,42" fill="${FG}"/>
    </g>
  `),
};

function writePng(name, svgStr) {
  const resvg = new Resvg(svgStr, {
    fitTo: { mode: "width", value: SIZE },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  fs.writeFileSync(path.join(OUT, `${name}.png`), png);
  console.log("wrote", `${name}.png`);
}

fs.mkdirSync(OUT, { recursive: true });
for (const [name, svgStr] of Object.entries(icons)) {
  writePng(name, svgStr);
}
console.log("done", Object.keys(icons).length, "icons");
