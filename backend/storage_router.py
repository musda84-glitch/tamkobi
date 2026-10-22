"""Firma bazlı depolama yönlendiricisi.

STORAGE_ROUTER_ENABLED kapalıyken (varsayılan) bu modül okunmaz: TenantDB
bugünkü koleksiyonu döner. Bayrak açıkken firma ayarı kısa TTL ile
önbelleğe alınır; her istekte companies sorgusu yapılmaz.

Bu sürüm yalnız legacy arka ucunu tanır. shared_v2, dedicated ve
bilinmeyen bir kip sessizce legacy'ye düşmez; açık hata verir.
Alanı olmayan mevcut firmalar legacy sayılır.

dedicated_dsn_ref şemada durur. Değer düz metin yazılmaz; mühür
comm_service.encrypt ile atılır. Bu modül o alanı okumaz.
"""
from __future__ import annotations

import os
import time
from typing import Any, Optional

LEGACY = "legacy"
SHARED_V2 = "shared_v2"
DEDICATED = "dedicated"
KNOWN_MODES = frozenset({LEGACY, SHARED_V2, DEDICATED})
DSN_FIELD = "dedicated_dsn_ref"
MODE_FIELD = "storage_mode"
ENV_FLAG = "STORAGE_ROUTER_ENABLED"
TTL_SECONDS = 15.0

_ON = frozenset({"1", "true", "yes", "on"})
_MISS = object()
_cache: dict[str, tuple[str, float]] = {}
read_count = 0


class StorageModeError(RuntimeError):
    """Kip legacy değil ya da önbellek dolmadan arka uç istendi."""

    def __init__(self, message: str, *, company_id: str = "", mode: str = ""):
        self.company_id = str(company_id or "")
        self.mode = str(mode or "")
        super().__init__(message)


def _now() -> float:
    return time.monotonic()


def enabled() -> bool:
    """Ortam bayrağı. Boş veya tanımsız değer kapalıdır."""
    return os.environ.get(ENV_FLAG, "").strip().lower() in _ON


def reset() -> None:
    """Testler önbelleği ve sayacı sıfırlar. Ortam bayrağına dokunmaz."""
    global read_count
    _cache.clear()
    read_count = 0


def public_mode(raw: Any) -> str:
    """Super-admin gösterimi. Boş alan legacy. Hata atmaz, DSN döndürmez."""
    return normalize_mode(raw)


def company_storage_view(company: Optional[dict]) -> dict:
    """Salt okunur firma alanı. dedicated_dsn_ref yanıta girmez."""
    body = company or {}
    return {MODE_FIELD: public_mode(body.get(MODE_FIELD))}


def normalize_mode(raw: Any) -> str:
    """Yok ya da boş → legacy. Bilinen kipler küçük harf. Bilinmeyen metin durur."""
    if raw is None:
        return LEGACY
    text = str(raw).strip()
    if not text:
        return LEGACY
    lowered = text.lower()
    if lowered in KNOWN_MODES:
        return lowered
    return text


def reject_unless_legacy(mode: str, company_id: str = "") -> None:
    if mode == LEGACY:
        return
    if mode in (SHARED_V2, DEDICATED):
        raise StorageModeError(
            f"Depolama kipi henüz yok: {mode}. Bu sürüm yalnız legacy arka ucunu kullanır.",
            company_id=company_id,
            mode=mode,
        )
    raise StorageModeError(
        f"Bilinmeyen depolama kipi: {mode}. İzin verilen değerler: legacy, shared_v2, dedicated.",
        company_id=company_id,
        mode=mode,
    )


def seal_dedicated_dsn(dsn: str) -> str:
    """İlerideki dedicated DSN referansı. Düz metin döndürmez. Bu PR okunmaz."""
    text = str(dsn or "")
    if not text.strip():
        raise ValueError("DSN boş")
    from comm_service import encrypt

    sealed = encrypt(text)
    if not sealed or sealed == text or not str(sealed).startswith("gAAAA"):
        raise RuntimeError("DSN şifrelenemedi")
    return sealed


def _cached(company_id: str):
    row = _cache.get(company_id)
    if not row:
        return _MISS
    mode, exp = row
    if _now() >= exp:
        return _MISS
    return mode


def _store(company_id: str, mode: str) -> str:
    _cache[company_id] = (mode, _now() + TTL_SECONDS)
    return mode


def _bump() -> None:
    global read_count
    read_count += 1


def _companies(db):
    return db["companies"]


def _mode_from_doc(doc: Optional[dict]) -> str:
    if not doc:
        return LEGACY
    return normalize_mode(doc.get(MODE_FIELD))


def _read_sync(db, company_id: str) -> str:
    """Bellek içi docs listesi varsa senkron okur. MySQL havuzu burada bekletilmez."""
    docs = getattr(_companies(db), "docs", None)
    if not isinstance(docs, list):
        raise StorageModeError(
            "Depolama kipi önbelleği boş. Firma ayarı bu çağrıda okunamaz.",
            company_id=company_id,
        )
    _bump()
    found = None
    for doc in docs:
        if str((doc or {}).get("_id") or "") == company_id:
            found = doc
            break
    return _store(company_id, _mode_from_doc(found))


async def load_mode(db, company_id: str) -> str:
    """Firma kipini döndürür. TTL dolmadan companies sorgusu yapmaz.

    shared_v2 / dedicated / bilinmeyen kip burada hata atmaz; seçim
    legacy_collection içindedir. Projeksiyon yalnız storage_mode ister.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    if hit is not _MISS:
        return hit
    _bump()
    doc = await _companies(db).find_one({"_id": cid}, {MODE_FIELD: 1})
    return _store(cid, _mode_from_doc(doc))


def legacy_collection(db, company_id: str, name: str):
    """Legacy arka uç: aynı db[name]. Diğer kipler açık hata.

    Bayrak kapalıyken TenantDB bu fonksiyonu çağırmaz.
    """
    cid = str(company_id or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    hit = _cached(cid)
    mode = hit if hit is not _MISS else _read_sync(db, cid)
    reject_unless_legacy(mode, cid)
    return db[name]
