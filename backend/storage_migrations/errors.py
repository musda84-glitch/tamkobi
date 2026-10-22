"""Migration aracı hataları. İletiler DSN taşımaz."""
from __future__ import annotations


class MigrationError(RuntimeError):
    """Şema aracı hatası."""


class LegacyTargetError(MigrationError):
    """Legacy docs hedefi veya canlı uygulama veritabanı."""


class CatalogError(MigrationError):
    """Firma kip listesi okunamadı."""


class ChecksumError(MigrationError):
    """Uygulanmış migration dosyası değişmiş."""


class DryRunError(MigrationError):
    """Dry-run yazma denemesi."""


class UsageError(MigrationError):
    """Komut satırı hedefi geçersiz."""
