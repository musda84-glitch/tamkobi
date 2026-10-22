"""Hedef listesi StorageRouter firma kiplerinden okunur.

Kip storage_router.public_mode ile gelir. Bu modül kipi yeniden tanımlamaz.
Legacy hedef uygulanmaz. dedicated_dsn_ref listede basılmaz; çözme yalnız
dedicated kip doğrulandıktan sonra yapılır.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

import storage_router

from .errors import CatalogError, LegacyTargetError, UsageError

_ID = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
_ENV = re.compile(r"^[A-Z][A-Z0-9_]{0,80}$")
_MODE = re.compile(r"^[a-z0-9_-]{1,32}$")
SHARED_DSN_ENV = "STORAGE_SHARED_V2_DSN"


@dataclass(frozen=True)
class TargetSpec:
    name: str
    mode: str
    env_ref: str = ""
    company_id: str = ""


@dataclass(frozen=True)
class TargetRef:
    name: str
    mode: str
    company_id: str = ""
    blocked: str = ""

    def public(self) -> str:
        extra = f" {self.blocked}" if self.blocked else ""
        return f"{self.name} kip={self.mode}{extra}"


def list_targets(db) -> tuple[TargetRef, ...]:
    """Legacy firmalar listede yok. shared_v2 tek hedeftir. DSN alanı okunmaz."""
    shared = False
    rows = []
    for doc in company_documents(db):
        mode = storage_router.public_mode(doc.get(storage_router.MODE_FIELD))
        cid = _safe_id(str(doc.get("_id") or ""))
        if mode == storage_router.LEGACY:
            continue
        if mode == storage_router.SHARED_V2:
            shared = True
            continue
        if mode == storage_router.DEDICATED:
            rows.append(TargetRef(name=f"{storage_router.DEDICATED}:{cid}", mode=storage_router.DEDICATED, company_id=cid))
            continue
        label = mode if _MODE.match(mode) else "unknown"
        rows.append(
            TargetRef(name=f"blocked:{cid}", mode=label, company_id=cid, blocked="bilinmeyen kip")
        )
    if shared:
        rows.append(TargetRef(name=storage_router.SHARED_V2, mode=storage_router.SHARED_V2))
    rows.sort(key=_rank)
    return tuple(rows)


def _rank(item: TargetRef):
    if item.mode == storage_router.SHARED_V2 and not item.blocked:
        return (0, item.name)
    if item.blocked:
        return (2, item.name)
    return (1, item.name)


def parse_target(raw: str) -> TargetSpec:
    text = str(raw or "").strip()
    if not text:
        raise UsageError("Hedef boş.")
    lower = text.lower()
    if lower == storage_router.LEGACY:
        raise LegacyTargetError("Legacy hedef reddedildi.")
    if lower == storage_router.SHARED_V2:
        return TargetSpec(name=storage_router.SHARED_V2, mode=storage_router.SHARED_V2, env_ref=SHARED_DSN_ENV)
    dedicated_prefix = storage_router.DEDICATED + ":"
    if lower.startswith(dedicated_prefix):
        cid = text.split(":", 1)[1].strip()
        if not _ID.match(cid):
            raise UsageError("Dedicated hedef kimliği geçersiz.")
        return TargetSpec(
            name=f"{storage_router.DEDICATED}:{cid}",
            mode=storage_router.DEDICATED,
            company_id=cid,
        )
    if lower.startswith("ref:"):
        env_name = text.split(":", 1)[1].strip()
        if not _ENV.match(env_name):
            raise UsageError("DSN referansı ortam değişkeni adı olmalı.")
        return TargetSpec(name=f"ref:{env_name}", mode="ref", env_ref=env_name)
    raise UsageError("Hedef dsn-ref veya legacy dışı kip olmalı.")


def resolve_dsn(spec: TargetSpec, db) -> str:
    """Bağlantı dizesi. Çağıran bunu yazdırmaz."""
    if spec.env_ref:
        import os

        value = (os.environ.get(spec.env_ref) or "").strip()
        if not value:
            raise CatalogError(f"Ortam değişkeni boş: {spec.env_ref}")
        return _require_dsn(value)
    if spec.mode == storage_router.DEDICATED:
        return _dedicated_dsn(db, spec.company_id)
    raise UsageError("Hedef çözülemedi.")


def company_documents(db) -> list[dict]:
    """Bellekteki firma belgeleri. Canlı havuz burada bekletilmez."""
    try:
        source = db["companies"]
    except Exception as exc:
        raise CatalogError("Firma kataloğu okunamadı.") from exc
    docs = getattr(source, "docs", None)
    if not isinstance(docs, list):
        raise CatalogError("Firma kipleri yalnız bellek kataloğundan okunur. Canlı veritabanı açılmaz.")
    return [doc for doc in docs if isinstance(doc, dict)]


def _dedicated_dsn(db, company_id: str) -> str:
    doc = _find_company(db, company_id)
    mode = storage_router.public_mode(doc.get(storage_router.MODE_FIELD))
    if mode == storage_router.LEGACY:
        raise LegacyTargetError("Legacy hedef reddedildi.")
    if mode != storage_router.DEDICATED:
        label = mode if _MODE.match(str(mode)) else "unknown"
        raise LegacyTargetError(f"Hedef kip dedicated değil: {label}.")
    sealed = doc.get(storage_router.DSN_FIELD)
    if not isinstance(sealed, str) or not sealed.strip():
        raise CatalogError("Dedicated DSN referansı yok.")
    return _require_dsn(_unseal(sealed))


def _find_company(db, company_id: str) -> dict:
    for doc in company_documents(db):
        if str(doc.get("_id") or "") == company_id:
            return doc
    raise CatalogError("Firma yok.")


def _unseal(sealed: str) -> str:
    from comm_service import decrypt

    try:
        plain = decrypt(sealed)
    except Exception as exc:
        raise CatalogError("DSN referansı çözülemedi.") from exc
    return str(plain or "")


def _require_dsn(value: str) -> str:
    text = str(value or "").strip()
    if "://" not in text:
        raise CatalogError("DSN referansı çözülemedi.")
    return text


def _safe_id(value: str) -> str:
    if _ID.match(value):
        return value
    return "gizli"
