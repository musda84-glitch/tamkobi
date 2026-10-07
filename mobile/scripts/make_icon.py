#!/usr/bin/env python3
"""Generate TamKobi brand icons from the official 4-quadrant mark.

Palette (brand guide):
  Mavi  #2d7bff · Mor #7b3ff2 · Mor koyu #4f2fd0 · Vurgu #c6f432 · Gece #0b0b14
"""
from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
IMAGES = ROOT / "assets" / "images"
ASSETS = ROOT / "assets"

MAVI = (45, 123, 255)       # #2d7bff  top-left
MOR = (123, 63, 242)        # #7b3ff2  top-right
MOR_DARK = (79, 47, 208)    # #4f2fd0  bottom-left
VURGU = (198, 244, 50)      # #c6f432  bottom-right
GECE = (11, 11, 20)         # #0b0b14


def make_mark(
    size: int,
    *,
    bg: tuple[int, int, int] | None = GECE,
    gap_ratio: float = 0.04,
    margin_ratio: float = 0.12,
) -> Image.Image:
    """4-quadrant circle. PIL pieslice angles are clockwise from 3 o'clock."""
    out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(out)
    m = int(size * margin_ratio)
    bbox = [m, m, size - 1 - m, size - 1 - m]
    # Clockwise from east: 180–270 NW, 270–360 NE, 0–90 SE, 90–180 SW
    draw.pieslice(bbox, 180, 270, fill=(*MAVI, 255))
    draw.pieslice(bbox, 270, 360, fill=(*MOR, 255))
    draw.pieslice(bbox, 0, 90, fill=(*VURGU, 255))
    draw.pieslice(bbox, 90, 180, fill=(*MOR_DARK, 255))
    g = max(2, int(size * gap_ratio))
    cx = cy = size // 2
    draw.rectangle([m, cy - g // 2, size - m, cy + g // 2], fill=(0, 0, 0, 0))
    draw.rectangle([cx - g // 2, m, cx + g // 2, size - m], fill=(0, 0, 0, 0))
    if bg is None:
        return out
    base = Image.new("RGBA", (size, size), (*bg, 255))
    return Image.alpha_composite(base, out).convert("RGB")


def write_png(path: Path, im: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    im.save(path, "PNG", optimize=True)
    print("wrote", path, im.size, im.mode)


def main() -> None:
    icon = make_mark(1024, bg=GECE, margin_ratio=0.12)
    write_png(IMAGES / "icon.png", icon)
    write_png(ASSETS / "icon.png", icon)

    # Adaptive foreground: transparent, more padding for safe zone
    fg = make_mark(1024, bg=None, margin_ratio=0.18)
    write_png(IMAGES / "android-icon-foreground.png", fg)

    splash = make_mark(1024, bg=GECE, margin_ratio=0.22)
    write_png(IMAGES / "splash-icon.png", splash)

    fav = make_mark(192, bg=GECE, margin_ratio=0.12)
    write_png(IMAGES / "favicon.png", fav)

    # Small web / extension sizes
    for n in (16, 32, 48, 128, 180, 512):
        write_png(IMAGES / f"icon-{n}.png", make_mark(n, bg=GECE, margin_ratio=0.10 if n >= 48 else 0.08))


if __name__ == "__main__":
    main()
