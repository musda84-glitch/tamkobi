"""Object storage: Emergent objstore when keyed, otherwise local disk fallback.

Stok kartı / dosya yüklemeleri `EMERGENT_LLM_KEY` yokken veya objstore
erişilemezken de çalışsın diye yerel depolamaya düşer.
"""
from __future__ import annotations

import json
import logging
import os
from pathlib import Path
from typing import Optional, Tuple

import requests

logger = logging.getLogger(__name__)

STORAGE_BASE = (os.environ.get("INTEGRATION_PROXY_URL") or "").strip() or "https://integrations.emergentagent.com"
STORAGE_URL = STORAGE_BASE.rstrip("/") + "/objstore/api/v1/storage"
APP_NAME = "tamkobi"

_DEFAULT_LOCAL = Path(__file__).resolve().parent / "data" / "objstore"
LOCAL_ROOT = Path(os.environ.get("LOCAL_STORAGE_DIR") or str(_DEFAULT_LOCAL)).resolve()

storage_key: Optional[str] = None
_backend: Optional[str] = None  # "remote" | "local"


def _emergent_key() -> str:
    return (os.environ.get("EMERGENT_LLM_KEY") or "").strip()


def _normalized_key(path: str) -> str:
    rel = (path or "").lstrip("/").replace("\\", "/")
    parts = [p for p in rel.split("/") if p and p not in (".", "..")]
    if not parts:
        raise ValueError("Geçersiz depolama yolu.")
    return "/".join(parts)


def _safe_local_path(path: str) -> Path:
    """Object key → absolute path under LOCAL_ROOT (path traversal korumalı)."""
    key = _normalized_key(path)
    target = LOCAL_ROOT.joinpath(*key.split("/")).resolve()
    if not str(target).startswith(str(LOCAL_ROOT) + os.sep) and target != LOCAL_ROOT:
        raise ValueError("Geçersiz depolama yolu.")
    return target


def _meta_path(file_path: Path) -> Path:
    return file_path.with_suffix(file_path.suffix + ".meta.json")


def _use_remote() -> bool:
    """Uzak objstore kullanılabilir mi? Anahtar yoksa deneme."""
    global _backend
    if _backend == "local":
        return False
    if not _emergent_key():
        _backend = "local"
        return False
    return True


def init_storage(force: bool = False) -> Optional[str]:
    """Uzak storage_key üretir; anahtar yok/başarısızsa None (local moda düşer)."""
    global storage_key, _backend
    if not _emergent_key():
        _backend = "local"
        storage_key = None
        LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        return None
    if storage_key and not force and _backend == "remote":
        return storage_key
    try:
        resp = requests.post(
            f"{STORAGE_URL}/init",
            json={"emergent_key": _emergent_key()},
            timeout=30,
        )
        resp.raise_for_status()
        storage_key = resp.json()["storage_key"]
        _backend = "remote"
        return storage_key
    except Exception as e:
        logger.warning("Objstore init failed (%s); falling back to local disk at %s", e, LOCAL_ROOT)
        _backend = "local"
        storage_key = None
        LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
        return None


def _put_local(path: str, data: bytes, content_type: str) -> dict:
    LOCAL_ROOT.mkdir(parents=True, exist_ok=True)
    key = _normalized_key(path)
    target = _safe_local_path(key)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    _meta_path(target).write_text(
        json.dumps({"content_type": content_type or "application/octet-stream", "size": len(data)}),
        encoding="utf-8",
    )
    return {"path": key, "size": len(data), "backend": "local"}


def _get_local(path: str) -> Tuple[bytes, str]:
    key = _normalized_key(path)
    target = _safe_local_path(key)
    if not target.is_file():
        raise FileNotFoundError(key)
    ctype = "application/octet-stream"
    meta = _meta_path(target)
    if meta.is_file():
        try:
            ctype = json.loads(meta.read_text(encoding="utf-8")).get("content_type") or ctype
        except Exception:
            pass
    return target.read_bytes(), ctype


def put_object(path: str, data: bytes, content_type: str) -> dict:
    path = _normalized_key(path)
    if _use_remote():
        key = init_storage()
        if key:
            try:
                resp = requests.put(
                    f"{STORAGE_URL}/objects/{path}",
                    headers={"X-Storage-Key": key, "Content-Type": content_type},
                    data=data,
                    timeout=120,
                )
                if resp.status_code == 404:
                    key = init_storage(force=True)
                    resp = requests.put(
                        f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key, "Content-Type": content_type},
                        data=data,
                        timeout=120,
                    )
                resp.raise_for_status()
                body = resp.json() if resp.content else {}
                if not isinstance(body, dict):
                    body = {}
                body.setdefault("path", path)
                body.setdefault("size", len(data))
                body["backend"] = "remote"
                return body
            except Exception as e:
                logger.warning("Objstore put failed (%s); falling back to local for %s", e, path)
                global _backend
                _backend = "local"
    return _put_local(path, data, content_type)


def get_object(path: str) -> Tuple[bytes, str]:
    path = _normalized_key(path)
    # Yerelde varsa onu tercih et (fallback ile yazılmış dosyalar)
    try:
        return _get_local(path)
    except FileNotFoundError:
        pass
    if _use_remote():
        key = init_storage()
        if key:
            resp = requests.get(
                f"{STORAGE_URL}/objects/{path}",
                headers={"X-Storage-Key": key},
                timeout=60,
            )
            if resp.status_code == 404:
                key = init_storage(force=True)
                if key:
                    resp = requests.get(
                        f"{STORAGE_URL}/objects/{path}",
                        headers={"X-Storage-Key": key},
                        timeout=60,
                    )
            if resp.status_code == 200:
                return resp.content, resp.headers.get("Content-Type", "application/octet-stream")
            if resp.status_code != 404:
                resp.raise_for_status()
    return _get_local(path)


def storage_backend() -> str:
    """Teşhis: 'remote' | 'local' | 'unknown'."""
    if _backend:
        return _backend
    return "remote" if _emergent_key() else "local"
