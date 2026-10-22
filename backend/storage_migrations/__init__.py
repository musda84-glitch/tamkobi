"""Sürümlü, idempotent şema migration aracı.

Her hedefte schema_version tutulur. Legacy docs veritabanına ve canlı
uygulama veritabanına uygulanmaz. Yazma yalnız apply --confirm ile olur.
"""
from __future__ import annotations

from .engine import apply, plan, status
from .errors import CatalogError, ChecksumError, LegacyTargetError, MigrationError
from .targets import list_targets

__all__ = [
    "CatalogError",
    "ChecksumError",
    "LegacyTargetError",
    "MigrationError",
    "apply",
    "list_targets",
    "plan",
    "status",
]
