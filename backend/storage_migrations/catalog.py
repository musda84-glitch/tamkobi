"""Komut satırı firma kataloğu.

STORAGE_COMPANY_CATALOG yalnız sqlite dosyasıdır. Canlı MySQL açılmaz.
Dosyada company_catalog tablosu vardır; DSN düz metin yazılmaz.
"""
from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from types import SimpleNamespace

import storage_router

from .errors import CatalogError
from .session import sqlite_path

_ENV = "STORAGE_COMPANY_CATALOG"


class CliCatalog:
    def __init__(self, docs: list):
        self._docs = docs

    def __getitem__(self, name):
        if name != "companies":
            raise KeyError(name)
        return SimpleNamespace(docs=list(self._docs))


def load_cli_catalog():
    """Ortam boşsa None. mysql şeması ve eksik dosya bağlantı açmaz."""
    raw = (os.environ.get(_ENV) or "").strip()
    if not raw:
        return None
    lowered = raw.lower()
    if lowered.startswith("mysql") or lowered.startswith("mariadb"):
        raise CatalogError("Firma kataloğu canlı veritabanı olamaz.")
    if not lowered.startswith("sqlite"):
        raise CatalogError("Firma kataloğu yalnız sqlite dosyasından okunur.")
    try:
        path = sqlite_path(raw)
    except Exception:
        raise CatalogError("Firma kataloğu okunamadı.") from None
    if not os.path.exists(path):
        raise CatalogError("Firma kataloğu yok.")
    uri = Path(path).resolve().as_uri() + "?mode=ro"
    try:
        conn = sqlite3.connect(uri, uri=True)
    except sqlite3.Error:
        raise CatalogError("Firma kataloğu okunamadı.") from None
    try:
        try:
            rows = conn.execute(
                "SELECT company_id, storage_mode, dedicated_dsn_ref FROM company_catalog"
            ).fetchall()
        except sqlite3.Error:
            raise CatalogError("Firma kataloğu okunamadı.") from None
    finally:
        conn.close()
    docs = []
    for company_id, mode, sealed in rows:
        cid = str(company_id or "").strip()
        if not cid:
            continue
        doc = {"_id": cid}
        if mode is not None:
            doc[storage_router.MODE_FIELD] = mode
        if isinstance(sealed, str) and sealed.strip():
            doc[storage_router.DSN_FIELD] = sealed.strip()
        docs.append(doc)
    return CliCatalog(docs)
