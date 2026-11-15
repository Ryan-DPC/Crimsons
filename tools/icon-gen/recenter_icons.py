#!/usr/bin/env python3
"""Center red glyph content on a freshly painted rounded-rect plate (no ghosts)."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[2] / (
    "plugins/catalog/com.laoy.streamdock.applemusic.sdPlugin/static/icon"
)

BG = (18, 18, 20, 255)
RADIUS = 32

# Optical nudges after geometric centering (px). Positive = right/down.
OPTICAL = {
    "play.png": (-3, 0),
    "love.png": (0, -2),
    "love_on.png": (0, -2),
    "add_library.png": (0, 1),
    "songinfo.png": (0, 1),
    "forward.png": (0, 1),
    "rewind.png": (0, 1),
}


def is_glyph(pixel: tuple[int, int, int, int]) -> bool:
    r, g, b, a = pixel
    if a < 80:
        return False
    # Red-dominant (includes antialias fringe toward FG)
    return r > 80 and r > g + 15 and r > b + 15


def make_plate(size: int) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=RADIUS, fill=BG
    )
    return im


def measure(im: Image.Image) -> tuple[float, float]:
    px = im.load()
    xs: list[int] = []
    ys: list[int] = []
    w, h = im.size
    for y in range(h):
        for x in range(w):
            if is_glyph(px[x, y]):
                xs.append(x)
                ys.append(y)
    if not xs:
        raise RuntimeError("no glyph pixels")
    return (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2


def recenter(path: Path) -> None:
    src = Image.open(path).convert("RGBA")
    w, h = src.size
    cx, cy = measure(src)
    ox, oy = OPTICAL.get(path.name, (0, 0))
    dx = round(w / 2 - cx + ox)
    dy = round(h / 2 - cy + oy)

    px = src.load()
    glyph = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    gp = glyph.load()
    for y in range(h):
        for x in range(w):
            if is_glyph(px[x, y]):
                gp[x, y] = px[x, y]

    plate = make_plate(w)
    if dx or dy:
        shifted = Image.new("RGBA", (w, h), (0, 0, 0, 0))
        shifted.paste(glyph, (dx, dy), glyph)
        glyph = shifted
    plate.alpha_composite(glyph)
    plate.save(path)
    print(f"{'fix' if dx or dy else 'ok  '} {path.name}  dx={dx:+d} dy={dy:+d}")


def main() -> None:
    for path in sorted(OUT.glob("*.png")):
        if path.name.startswith("applemusic"):
            continue
        recenter(path)


if __name__ == "__main__":
    main()
