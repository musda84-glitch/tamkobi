"""DSN değerlerini logdan ve çıktıdan çıkarır."""
from __future__ import annotations

import contextvars
import logging
import re
from contextlib import contextmanager
from urllib.parse import unquote, urlparse

_secrets: contextvars.ContextVar[tuple[str, ...]] = contextvars.ContextVar(
    "storage_migration_secrets",
    default=(),
)
_URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s\"']+", re.IGNORECASE)
_SCHEME = re.compile(r"^[a-z][a-z0-9+.-]*$", re.IGNORECASE)


def add_secret(value: str) -> None:
    """Çözülmüş DSN ve parçalarını bu kapsamda maskele."""
    text = str(value or "")
    found = list(_secrets.get())
    if len(text) >= 4 and text not in found:
        found.append(text)
    parts = _parts(text)
    for part in parts:
        if part not in found:
            found.append(part)
    _secrets.set(tuple(found))


def _parts(dsn: str) -> list[str]:
    if "://" not in dsn:
        return []
    normalized = dsn
    if dsn.startswith("mysql+") or dsn.startswith("mariadb+"):
        normalized = "mysql://" + dsn.split("://", 1)[1]
    elif dsn.startswith("mariadb://"):
        normalized = "mysql://" + dsn.split("://", 1)[1]
    parsed = urlparse(normalized)
    found = []
    password = unquote(parsed.password or "")
    if len(password) >= 4:
        found.append(password)
    path = parsed.path or ""
    if len(path) >= 4:
        found.append(path)
    if parsed.scheme in ("sqlite", "sqlite3") and len(path) >= 4:
        found.append(path)
    return found


def mask_dsn(dsn: str) -> str:
    """Şema kalır, kimlik ve yol kalmaz."""
    text = str(dsn or "").strip()
    if "://" not in text:
        return "***" if text else ""
    scheme = text.split("://", 1)[0]
    if not _SCHEME.match(scheme):
        return "***"
    return f"{scheme.lower()}://***"


def scrub(value) -> str:
    """Kayıtlı sırları ve URL benzeri parçaları değiştir."""
    text = value if isinstance(value, str) else str(value)
    for secret in _secrets.get():
        if secret:
            text = text.replace(secret, "***")
    return _URL.sub(lambda match: match.group(0).split("://", 1)[0] + "://***", text)


@contextmanager
def secret_scope():
    """Komut boyunca biriken sırları komut bitince sil."""
    token = _secrets.set(())
    try:
        yield
    finally:
        _secrets.reset(token)


class RedactFilter(logging.Filter):
    """storage_migrations log kayıtlarından DSN siler."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = scrub(record.msg)
        else:
            record.msg = scrub(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(scrub(item) if isinstance(item, str) else item for item in record.args)
        elif isinstance(record.args, dict):
            record.args = {
                key: scrub(val) if isinstance(val, str) else val
                for key, val in record.args.items()
            }
        record.exc_info = None
        record.exc_text = None
        return True


def logger() -> logging.Logger:
    log = logging.getLogger("storage_migrations")
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log
