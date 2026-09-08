"""Unit tests for upload image optimization (no live DB required)."""
import io
import os
import sys
import zlib
import struct

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import image_opt
from PIL import Image, ImageDraw


def _tiny_png() -> bytes:
    def chunk(typ, data):
        c = typ + data
        return struct.pack(">I", len(data)) + c + struct.pack(">I", zlib.crc32(c) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)
    raw = b"\x00\xff\x00\x00"
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", ihdr)
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def _photo_jpeg(w=1800, h=1200, quality=98) -> bytes:
    img = Image.new("RGB", (w, h))
    draw = ImageDraw.Draw(img)
    for i in range(0, w, 12):
        draw.rectangle([i, 0, i + 8, h], fill=(i % 255, (i * 3) % 255, 90))
    for y in range(0, h, 40):
        draw.ellipse([y % w, y, (y % w) + 220, y + 180], outline=(255, y % 255, 40), width=3)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    return buf.getvalue()


def _photo_png(w=1200, h=800) -> bytes:
    # Photo-like raster saved as PNG (typical bulky product upload).
    im = Image.open(io.BytesIO(_photo_jpeg(w, h, quality=98))).convert("RGB")
    buf = io.BytesIO()
    im.save(buf, format="PNG", compress_level=1)
    return buf.getvalue()


def _animated_gif() -> bytes:
    frames = [Image.new("RGB", (240, 240), (i * 30, 40, 200 - i * 20)) for i in range(8)]
    buf = io.BytesIO()
    frames[0].save(buf, format="GIF", save_all=True, append_images=frames[1:], duration=80, loop=0)
    return buf.getvalue()


def test_tiny_png_unchanged():
    png = _tiny_png()
    r = image_opt.optimize_upload(png, "image/png", "logo.png")
    assert r.data == png
    assert r.content_type == "image/png"
    assert r.optimized is False
    assert r.reason in {"already_small", "no_savings"}
    assert r.stored_size == len(png)


def test_large_jpeg_gets_smaller_and_decodes():
    raw = _photo_jpeg()
    assert len(raw) > 20_000
    r = image_opt.optimize_upload(raw, "image/jpeg", "photo.jpg")
    assert r.optimized is True
    assert r.reason == "compressed"
    assert r.stored_size < r.original_size
    assert r.stored_size <= int(len(raw) * 0.95)
    im = Image.open(io.BytesIO(r.data))
    im.load()
    assert im.size[0] > 0 and im.size[1] > 0
    assert r.content_type in {"image/jpeg", "image/webp"}


def test_large_png_photo_gets_smaller():
    raw = _photo_png()
    assert len(raw) > 50_000
    r = image_opt.optimize_upload(raw, "image/png", "shot.png")
    assert r.optimized is True
    assert r.stored_size < len(raw)
    im = Image.open(io.BytesIO(r.data))
    im.load()
    assert im.size[0] > 0 and im.size[1] > 0


def test_pdf_passthrough():
    pdf = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n" + (b"x" * 5000)
    r = image_opt.optimize_upload(pdf, "application/pdf", "invoice.pdf")
    assert r.data == pdf
    assert r.optimized is False
    assert r.reason == "not_image"
    assert r.content_type == "application/pdf"


def test_plain_bytes_passthrough():
    blob = b"hello-not-an-image" + (b"\x00" * 5000)
    r = image_opt.optimize_upload(blob, "application/octet-stream", "file.bin")
    assert r.data == blob
    assert r.reason == "not_image"


def test_disabled_leaves_bytes(monkeypatch):
    raw = _photo_jpeg()
    monkeypatch.setenv("IMAGE_OPTIMIZE", "0")
    r = image_opt.optimize_upload(raw, "image/jpeg", "photo.jpg")
    assert r.data == raw
    assert r.optimized is False
    assert r.reason == "disabled"
    assert r.stored_size == len(raw)


def test_animated_gif_not_converted():
    gif = _animated_gif()
    r = image_opt.optimize_upload(gif, "image/gif", "spin.gif")
    assert r.data == gif
    assert r.optimized is False
    assert r.reason in {"animated", "already_small"}


def test_oversized_edge_is_downscaled(monkeypatch):
    monkeypatch.setenv("IMAGE_MAX_EDGE", "640")
    raw = _photo_jpeg(w=1600, h=1200, quality=95)
    r = image_opt.optimize_upload(raw, "image/jpeg", "big.jpg")
    assert r.optimized is True
    assert r.width <= 640 and r.height <= 640
    im = Image.open(io.BytesIO(r.data))
    assert max(im.size) <= 640


def test_as_meta_omits_payload():
    raw = _photo_jpeg()
    r = image_opt.optimize_upload(raw, "image/jpeg", "photo.jpg")
    meta = r.as_meta()
    assert "data" not in meta
    assert meta["original_size"] == len(raw)
    assert meta["stored_size"] == r.stored_size
    assert "saved_bytes" in meta
