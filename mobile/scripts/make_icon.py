#!/usr/bin/env python3
"""Generate TamKobi Expo icon / splash PNGs without Pillow."""
from __future__ import annotations

import struct
import zlib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "assets"


def lerp(a: int, b: int, t: float) -> int:
    return int(a + (b - a) * t)


def png_rgb(width: int, height: int, rgb: bytes) -> bytes:
    raw = bytearray()
    row = width * 3
    for y in range(height):
        raw.append(0)
        raw.extend(rgb[y * row : (y + 1) * row])

    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


T_GLYPH = [
    "1111111",
    "0011100",
    "0011100",
    "0011100",
    "0011100",
    "0011100",
    "0011100",
]
K_GLYPH = [
    "1100011",
    "1100110",
    "1101100",
    "1111000",
    "1101100",
    "1100110",
    "1100011",
]


def blit(px: bytearray, w: int, glyph: list[str], ox: int, oy: int, scale: int, color: tuple[int, int, int]) -> None:
    for gy, row in enumerate(glyph):
        for gx, ch in enumerate(row):
            if ch != "1":
                continue
            for dy in range(scale):
                for dx in range(scale):
                    x = ox + gx * scale + dx
                    y = oy + gy * scale + dy
                    i = (y * w + x) * 3
                    px[i : i + 3] = bytes(color)


def icon(size: int = 1024) -> bytes:
    px = bytearray(size * size * 3)
    c0, c1 = (5, 150, 105), (79, 70, 229)  # emerald → indigo
    for y in range(size):
        for x in range(size):
            t = (x + (size - 1 - y)) / (2 * (size - 1))
            i = (y * size + x) * 3
            px[i] = lerp(c0[0], c1[0], t)
            px[i + 1] = lerp(c0[1], c1[1], t)
            px[i + 2] = lerp(c0[2], c1[2], t)
            # highlight
            shine = max(0.0, 1.0 - ((x - size * 0.35) ** 2 + (y - size * 0.28) ** 2) / (size * size * 0.18))
            if shine:
                px[i] = min(255, int(px[i] + 40 * shine))
                px[i + 1] = min(255, int(px[i + 1] + 40 * shine))
                px[i + 2] = min(255, int(px[i + 2] + 40 * shine))
    scale = size // 16
    letter_w = 7 * scale
    gap = scale
    total = letter_w * 2 + gap
    ox = (size - total) // 2
    oy = (size - 7 * scale) // 2
    blit(px, size, T_GLYPH, ox, oy, scale, (255, 255, 255))
    blit(px, size, K_GLYPH, ox + letter_w + gap, oy, scale, (255, 255, 255))
    return png_rgb(size, size, bytes(px))


def splash(size: int = 1024) -> bytes:
    bg = (15, 23, 42)
    px = bytearray(bytes(bg) * (size * size))
    inner = icon(size)
    # icon() already is a PNG; paint a smaller mark instead
    mark = 640
    mark_png_pixels = icon_pixels(mark)
    ox = (size - mark) // 2
    oy = (size - mark) // 2
    for y in range(mark):
        for x in range(mark):
            si = (y * mark + x) * 3
            di = ((oy + y) * size + (ox + x)) * 3
            px[di : di + 3] = mark_png_pixels[si : si + 3]
    return png_rgb(size, size, bytes(px))


def icon_pixels(size: int) -> bytes:
    px = bytearray(size * size * 3)
    c0, c1 = (5, 150, 105), (79, 70, 229)
    for y in range(size):
        for x in range(size):
            t = (x + (size - 1 - y)) / (2 * (size - 1))
            i = (y * size + x) * 3
            px[i] = lerp(c0[0], c1[0], t)
            px[i + 1] = lerp(c0[1], c1[1], t)
            px[i + 2] = lerp(c0[2], c1[2], t)
    scale = size // 16
    letter_w = 7 * scale
    gap = scale
    total = letter_w * 2 + gap
    ox = (size - total) // 2
    oy = (size - 7 * scale) // 2
    blit(px, size, T_GLYPH, ox, oy, scale, (255, 255, 255))
    blit(px, size, K_GLYPH, ox + letter_w + gap, oy, scale, (255, 255, 255))
    return bytes(px)


def main() -> None:
    ROOT.mkdir(parents=True, exist_ok=True)
    icon_bytes = png_rgb(1024, 1024, icon_pixels(1024))
    (ROOT / "icon.png").write_bytes(icon_bytes)
    (ROOT / "adaptive-icon.png").write_bytes(icon_bytes)
    (ROOT / "splash.png").write_bytes(splash(1024))
    (ROOT / "favicon.png").write_bytes(png_rgb(192, 192, icon_pixels(192)))
    print("wrote", ROOT)


if __name__ == "__main__":
    main()
