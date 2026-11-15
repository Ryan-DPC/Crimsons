#!/usr/bin/env python3
"""Downscale 2× PNGs → 144×144 (LANCZOS) and mass-center red glyphs on a clean plate.

BBox centering is wrong for filled-heavy glyphs (note heads, hearts, play triangles).
We center by alpha×red mass so the optical weight sits on the canvas midpoint.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

SIZE = 144
BG = (18, 18, 20, 255)
RADIUS = 32

# Residual nudges after mass-centering (px). Positive = right / down.
OPTICAL: dict[str, tuple[int, int]] = {}


def glyph_mask(im: Image.Image) -> np.ndarray:
    arr = np.array(im.convert("RGBA"))
    r, g, b, a = arr[:, :, 0], arr[:, :, 1], arr[:, :, 2], arr[:, :, 3]
    return (a >= 60) & (r > 70) & (r > g + 12) & (r > b + 12), arr


def mass_center(mask: np.ndarray, arr: np.ndarray) -> tuple[float, float]:
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError("no glyph pixels")
    weights = arr[:, :, 3][mask].astype(np.float64) * arr[:, :, 0][mask].astype(
        np.float64
    )
    return float(np.average(xs, weights=weights)), float(np.average(ys, weights=weights))


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def make_plate(size: int) -> Image.Image:
    im = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    ImageDraw.Draw(im).rounded_rectangle(
        (0, 0, size - 1, size - 1), radius=RADIUS, fill=BG
    )
    return im


def extract_glyph(src: Image.Image, mask: np.ndarray) -> Image.Image:
    arr = np.array(src.convert("RGBA"))
    out = np.zeros_like(arr)
    out[mask] = arr[mask]
    return Image.fromarray(out, "RGBA")


def process(src_path: Path, dst_path: Path) -> None:
    src = Image.open(src_path).convert("RGBA")
    if src.size != (SIZE, SIZE):
        src = src.resize((SIZE, SIZE), Image.Resampling.LANCZOS)

    mask, arr = glyph_mask(src)
    cx, cy = mass_center(mask, arr)
    x0, y0, x1, y1 = bbox(mask)
    ox, oy = OPTICAL.get(src_path.name, (0, 0))
    dx = round(SIZE / 2 - cx + ox)
    dy = round(SIZE / 2 - cy + oy)

    glyph = extract_glyph(src, mask)
    if dx or dy:
        shifted = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
        shifted.paste(glyph, (dx, dy), glyph)
        glyph = shifted

    plate = make_plate(SIZE)
    plate.alpha_composite(glyph)
    plate.save(dst_path)

    nmask, narr = glyph_mask(plate)
    ncx, ncy = mass_center(nmask, narr)
    print(
        f"{'fix' if dx or dy else 'ok  '} {src_path.name:22s} "
        f"dx={dx:+d} dy={dy:+d}  "
        f"pad LTRB={x0:2d}/{y0:2d}/{SIZE-1-x1:2d}/{SIZE-1-y1:2d}  "
        f"mass→({ncx:.1f},{ncy:.1f})"
    )


def main() -> None:
    if len(sys.argv) < 3:
        print("usage: downscale_and_center.py <src_dir_2x> <dst_dir>")
        sys.exit(1)
    src_dir = Path(sys.argv[1])
    dst_dir = Path(sys.argv[2])
    dst_dir.mkdir(parents=True, exist_ok=True)
    for path in sorted(src_dir.glob("*.png")):
        process(path, dst_dir / path.name)


if __name__ == "__main__":
    main()
