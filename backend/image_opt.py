"""Panele yüklenen raster görselleri sunucuda otomatik küçültür.

Orijinal baytlar yalnızca aday en az IMAGE_MIN_SAVINGS oranında daha küçük
değilse korunur (küçük logolar, zaten sıkı WebP, animasyonlu GIF).
"""
from __future__ import annotations

import io
import logging
import os
from dataclasses import asdict, dataclass
from typing import Optional, Tuple

logger = logging.getLogger("TamKobiERP")

IMAGE_TYPES = {
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/bmp",
    "image/tiff",
    "image/heic",
    "image/heif",
}
EXT_FOR_TYPE = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/bmp": "bmp",
    "image/tiff": "tif",
    "image/heic": "heic",
    "image/heif": "heif",
}


def _i(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return int(default)


def enabled() -> bool:
    return os.environ.get("IMAGE_OPTIMIZE", "1").lower() not in {"0", "false", "no"}


def _settings():
    """Panel görselleri için agresif ama kaliteli varsayılanlar (MB tasarrufu)."""
    try:
        min_savings = float(os.environ.get("IMAGE_MIN_SAVINGS", "0.05"))
    except (TypeError, ValueError):
        min_savings = 0.05
    return {
        # 1920px çoğu panel/ürün kartı için yeterli; 4K yüklemeleri budar
        "max_edge": _i("IMAGE_MAX_EDGE", 1920),
        "jpeg_quality": _i("IMAGE_JPEG_QUALITY", 80),
        "webp_quality": _i("IMAGE_WEBP_QUALITY", 78),
        "min_savings": min_savings,
        "skip_under": _i("IMAGE_SKIP_UNDER_BYTES", 4096),
    }


MAX_EDGE = _i("IMAGE_MAX_EDGE", 1920)
JPEG_QUALITY = _i("IMAGE_JPEG_QUALITY", 80)
WEBP_QUALITY = _i("IMAGE_WEBP_QUALITY", 78)
MIN_SAVINGS = float(os.environ.get("IMAGE_MIN_SAVINGS", "0.05"))
SKIP_UNDER = _i("IMAGE_SKIP_UNDER_BYTES", 4096)


@dataclass
class OptimizeResult:
    data: bytes
    content_type: str
    ext: str
    original_size: int
    stored_size: int
    width: Optional[int] = None
    height: Optional[int] = None
    optimized: bool = False
    reason: str = "original"

    @property
    def saved_bytes(self) -> int:
        return max(0, self.original_size - self.stored_size)

    def as_meta(self) -> dict:
        d = asdict(self)
        d.pop("data", None)
        d["saved_bytes"] = self.saved_bytes
        d["saved_pct"] = round(100.0 * self.saved_bytes / self.original_size, 1) if self.original_size else 0
        return d


def _sniff_type(data: bytes, content_type: str) -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:2] == b"\xff\xd8":
        return "image/jpeg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    if data[:2] == b"BM":
        return "image/bmp"
    if data[:4] in (b"II*\x00", b"MM\x00*"):
        return "image/tiff"
    # HEIC/HEIF (ftyp....heic|heif|mif1)
    if len(data) >= 12 and data[4:8] == b"ftyp":
        brand = data[8:12].lower()
        if brand in (b"heic", b"heif", b"mif1", b"msf1", b"avif"):
            return "image/heic" if brand != b"avif" else "image/heic"
    return ct


def _save(im, fmt: str, **kwargs) -> bytes:
    buf = io.BytesIO()
    im.save(buf, format=fmt, **kwargs)
    return buf.getvalue()


def _has_alpha(im) -> bool:
    if im.mode in ("RGBA", "LA", "PA"):
        return True
    if im.mode == "P":
        return "transparency" in im.info
    return False


def _try_register_heif() -> None:
    try:
        from pillow_heif import register_heif_opener  # type: ignore

        register_heif_opener()
    except Exception:
        pass


IMAGE_NAME_EXTS = (
    ".jpg", ".jpeg", ".png", ".webp", ".gif",
    ".heic", ".heif", ".bmp", ".tif", ".tiff", ".avif",
)
VISION_MIME = {"image/jpeg", "image/png", "image/webp", "image/gif"}


def looks_like_image(data: bytes, content_type: str = "", filename: str = "") -> bool:
    """Content-type, uzantı veya dosya imzasına bakarak görüntü mü diye bak."""
    ctype = (content_type or "").split(";")[0].strip().lower()
    name = (filename or "").lower()
    if ctype.startswith("image/"):
        return True
    if name.endswith(IMAGE_NAME_EXTS):
        return True
    sniffed = _sniff_type(data or b"", ctype)
    return sniffed.startswith("image/")


def prepare_vision_image(data: bytes, content_type: str = "", filename: str = "") -> Tuple[bytes, str]:
    """Vision API'lerin kabul ettiği JPEG üret (HEIC/HEIF dahil). Asla raise etmez."""
    fallback_mime = "image/jpeg"
    if not data:
        return data, fallback_mime
    sniffed = _sniff_type(data, content_type)
    name = (filename or "").lower()
    if not sniffed.startswith("image/"):
        if name.endswith((".heic", ".heif", ".avif")):
            sniffed = "image/heic"
        elif name.endswith(".png"):
            sniffed = "image/png"
        elif name.endswith(".webp"):
            sniffed = "image/webp"
        elif name.endswith(".gif"):
            sniffed = "image/gif"
        elif name.endswith((".jpg", ".jpeg")):
            sniffed = "image/jpeg"
    if sniffed in {"image/heic", "image/heif", "image/avif"}:
        _try_register_heif()
    try:
        from PIL import Image, ImageOps
    except Exception as e:
        logger.warning("Pillow unavailable for vision convert: %s", e)
        return data, sniffed if sniffed in VISION_MIME else fallback_mime
    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
            im.seek(0)
        im = ImageOps.exif_transpose(im) or im
        if im.mode != "RGB":
            im = im.convert("RGB")
        max_edge = _settings()["max_edge"]
        if max(im.size) > max_edge:
            im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        payload = _save(im, "JPEG", quality=max(70, _settings()["jpeg_quality"]), optimize=True)
        if payload:
            return payload, "image/jpeg"
    except Exception as e:
        logger.warning("prepare_vision_image failed (%s); sending original", e)
    mime = sniffed if sniffed in VISION_MIME else fallback_mime
    if mime == "image/jpg":
        mime = "image/jpeg"
    return data, mime


def optimize_upload(data: bytes, content_type: str = "", filename: str = "") -> OptimizeResult:
    """Orijinal veya daha küçük yüksek kaliteli varyant döner. Asla raise etmez."""
    original = OptimizeResult(
        data=data,
        content_type=(content_type or "application/octet-stream").split(";")[0].strip()
        or "application/octet-stream",
        ext=(filename.rsplit(".", 1)[-1].lower() if filename and "." in filename else "bin"),
        original_size=len(data),
        stored_size=len(data),
        reason="skipped",
    )
    cfg = _settings()
    if not enabled() or not data:
        original.reason = "disabled"
        return original
    sniffed = _sniff_type(data, original.content_type)
    if sniffed not in IMAGE_TYPES and not sniffed.startswith("image/"):
        original.reason = "not_image"
        return original
    original.content_type = sniffed or original.content_type
    original.ext = EXT_FOR_TYPE.get(original.content_type, original.ext)
    if len(data) < cfg["skip_under"]:
        original.reason = "already_small"
        return original

    if original.content_type in {"image/heic", "image/heif"}:
        _try_register_heif()

    try:
        from PIL import Image, ImageOps
    except Exception as e:
        logger.warning("Pillow unavailable, skipping image optimize: %s", e)
        original.reason = "no_pillow"
        return original

    try:
        im = Image.open(io.BytesIO(data))
        im.load()
        if getattr(im, "is_animated", False) and getattr(im, "n_frames", 1) > 1:
            original.reason = "animated"
            original.width, original.height = im.size
            return original
        # EXIF yönünü düzelt; kaydederken metadata kopyalanmaz → ek MB düşer
        im = ImageOps.exif_transpose(im) or im
        original.width, original.height = im.size
        w, h = im.size
        max_edge = cfg["max_edge"]
        if max(w, h) > max_edge:
            im.thumbnail((max_edge, max_edge), Image.Resampling.LANCZOS)
        alpha = _has_alpha(im)
        if im.mode not in ("RGB", "RGBA"):
            im = im.convert("RGBA" if alpha else "RGB")
        elif alpha and im.mode != "RGBA":
            im = im.convert("RGBA")
        elif not alpha and im.mode == "RGBA":
            im = im.convert("RGB")

        candidates: list[Tuple[bytes, str, str]] = []
        rgb = (
            im.convert("RGB")
            if im.mode == "RGBA" and not alpha
            else (im if im.mode == "RGB" else im.convert("RGB"))
        )
        if not alpha:
            candidates.append(
                (
                    _save(
                        rgb,
                        "JPEG",
                        quality=cfg["jpeg_quality"],
                        optimize=True,
                        progressive=True,
                    ),
                    "image/jpeg",
                    "jpg",
                )
            )
        try:
            webp_src = im if (alpha and im.mode == "RGBA") else rgb
            candidates.append(
                (
                    _save(webp_src, "WEBP", quality=cfg["webp_quality"], method=6),
                    "image/webp",
                    "webp",
                )
            )
            if alpha:
                # Logolar için kayıpsız WebP denemesi
                candidates.append(
                    (
                        _save(webp_src, "WEBP", lossless=True, method=6),
                        "image/webp",
                        "webp",
                    )
                )
        except Exception:
            pass
        if original.content_type == "image/png" or alpha:
            png_src = im.convert("RGBA") if alpha else rgb
            candidates.append(
                (_save(png_src, "PNG", optimize=True, compress_level=9), "image/png", "png")
            )

        best = min(candidates, key=lambda c: len(c[0])) if candidates else None
        if not best:
            original.reason = "no_candidate"
            return original
        payload, ctype, ext = best
        if len(payload) >= int(len(data) * (1.0 - cfg["min_savings"])):
            original.reason = "no_savings"
            original.width, original.height = im.size
            return original
        logger.info(
            "image_opt: %s → %s (%s→%s bytes, -%s%%, %sx%s)",
            filename or sniffed,
            ext,
            len(data),
            len(payload),
            round(100.0 * (len(data) - len(payload)) / max(len(data), 1), 1),
            im.size[0],
            im.size[1],
        )
        return OptimizeResult(
            data=payload,
            content_type=ctype,
            ext=ext,
            original_size=len(data),
            stored_size=len(payload),
            width=im.size[0],
            height=im.size[1],
            optimized=True,
            reason="compressed",
        )
    except Exception as e:
        logger.warning("image optimize failed (%s); storing original", e)
        original.reason = "error"
        return original

