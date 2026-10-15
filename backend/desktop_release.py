"""Windows masaüstü kurulum dosyası: GitHub Releases desktop-v* veya DESKTOP_DOWNLOAD_URL.

GET /api/desktop/latest oturum ister. Sürüm yoksa veya GitHub hata verirse 500 değil
{available: false} döner. Başarılı sonuç 10 dakika önbelleğe alınır; ortam değişkenindeki
indirme adresi önbelleğin dışında, her istekte önceliklidir.
"""
from __future__ import annotations

import logging
import os
import re
import time
from typing import Any, Dict, List, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")
_current_user = None

GITHUB_RELEASES_URL = "https://api.github.com/repos/musda84-glitch/tamkobi/releases"
TAG_PREFIX = "desktop-v"
CACHE_TTL_SEC = 10 * 60
_VERSION_IN_URL = re.compile(r"(\d+\.\d+\.\d+)")
_UNSET: Any = object()

_cache_expires = 0.0
_cache_release: Any = _UNSET


def init(get_current_user):
    global _current_user
    _current_user = get_current_user


def clear_cache() -> None:
    """Testler önbelleği sıfırlasın."""
    global _cache_expires, _cache_release
    _cache_expires = 0.0
    _cache_release = _UNSET


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Masaüstü indirme auth bağlanmadı.")
    return await _current_user(request)


def _http_url(url: str) -> str:
    raw = (url or "").strip()
    if raw.startswith("https://") or raw.startswith("http://"):
        return raw
    return ""


def override_download_url() -> str:
    return _http_url(os.environ.get("DESKTOP_DOWNLOAD_URL") or "")


def _version_from_url(url: str) -> str:
    match = _VERSION_IN_URL.search(url or "")
    return match.group(1) if match else ""


def _installer_url(assets: Any) -> str:
    """Windows kurulum dosyası. .msi varsa o, yoksa .exe."""
    msi: List[str] = []
    exe: List[str] = []
    for asset in assets or []:
        if not isinstance(asset, dict):
            continue
        name = str(asset.get("name") or "").lower()
        url = _http_url(str(asset.get("browser_download_url") or ""))
        if not url:
            continue
        if name.endswith(".msi"):
            msi.append(url)
        elif name.endswith(".exe"):
            exe.append(url)
    if msi:
        return msi[0]
    if exe:
        return exe[0]
    return ""


def parse_desktop_release(releases: Any) -> Optional[Dict[str, str]]:
    """En son yayınlanmış desktop-v* sürümü. Taslaklar yok sayılır.

    Kurulum dosyası olan en yeni sürüm seçilir. Hiçbirinde .msi/.exe yoksa
    en yeninin sürüm bilgisi döner; indirme adresi boş kalır.
    """
    if not isinstance(releases, list):
        raise ValueError("GitHub releases yanıtı liste değil.")
    candidates: List[Dict[str, str]] = []
    for rel in releases:
        if not isinstance(rel, dict) or rel.get("draft"):
            continue
        tag = str(rel.get("tag_name") or "")
        if not tag.startswith(TAG_PREFIX):
            continue
        version = tag[len(TAG_PREFIX):].lstrip("vV").strip()
        if not version:
            continue
        candidates.append({
            "version": version,
            "download_url": _installer_url(rel.get("assets")),
            "published_at": str(rel.get("published_at") or rel.get("created_at") or ""),
            "notes": str(rel.get("body") or "").strip(),
        })
    if not candidates:
        return None
    candidates.sort(key=lambda item: item["published_at"], reverse=True)
    for item in candidates:
        if item["download_url"]:
            return item
    return candidates[0]


async def fetch_github_releases() -> list:
    headers = {
        "Accept": "application/vnd.github+json",
        "User-Agent": "tamkobi-desktop",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(GITHUB_RELEASES_URL, headers=headers, params={"per_page": 100})
        resp.raise_for_status()
        data = resp.json()
    if not isinstance(data, list):
        raise ValueError("GitHub releases yanıtı liste değil.")
    return data


async def cached_desktop_release() -> Optional[Dict[str, str]]:
    """GitHub sonucu 10 dakika. Hata önbelleğe yazılmaz; bir sonraki istek yeniden dener."""
    global _cache_expires, _cache_release
    now = time.monotonic()
    if _cache_release is not _UNSET and now < _cache_expires:
        return _cache_release
    parsed = parse_desktop_release(await fetch_github_releases())
    _cache_release = parsed
    _cache_expires = time.monotonic() + CACHE_TTL_SEC
    return parsed


def _available(version: str, download_url: str, published_at: str = "", notes: str = "") -> Dict[str, Any]:
    return {
        "available": True,
        "version": version,
        "download_url": download_url,
        "published_at": published_at or "",
        "notes": notes or "",
    }


def _with_override(release: Optional[Dict[str, str]], override: str) -> Dict[str, Any]:
    if release and release.get("version"):
        url = override or release.get("download_url") or ""
        if url:
            return _available(release["version"], url, release.get("published_at") or "", release.get("notes") or "")
    if override:
        version = _version_from_url(override)
        if version:
            return _available(version, override)
    return {"available": False}


async def latest_desktop_payload() -> Dict[str, Any]:
    override = override_download_url()
    try:
        release = await cached_desktop_release()
    except Exception as exc:
        logger.warning("Masaüstü sürümü alınamadı: %s", exc)
        if override:
            version = _version_from_url(override)
            if version:
                return _available(version, override)
        return {"available": False}
    return _with_override(release, override)


@router.get("/desktop/latest")
async def desktop_latest(_user: dict = Depends(_user_dep)):
    """Oturum açmış firma kullanıcısı. Sürüm yoksa veya GitHub hata verirse {available: false}."""
    return await latest_desktop_payload()
