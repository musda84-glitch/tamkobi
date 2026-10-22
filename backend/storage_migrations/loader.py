"""Numaralı migration dosyalarını sırayla yükler."""
from __future__ import annotations

import hashlib
import importlib.util
import re
import sys
from dataclasses import dataclass
from pathlib import Path

from .errors import MigrationError

_FILE = re.compile(r"^(\d{4})_([a-z0-9_]+)\.(sql|py)$")
_ALLOWED = re.compile(r"^(create|insert|alter)\b", re.IGNORECASE)
_DOCS = re.compile(r"\bdocs\b", re.IGNORECASE)


@dataclass(frozen=True)
class Migration:
    version: int
    name: str
    checksum: str
    steps: tuple[str, ...]
    mysql_steps: tuple[str, ...] = ()


def steps_for(migration: Migration, dialect: str) -> tuple[str, ...]:
    """MySQL/MariaDB adımları ayrıysa onları, değilse ortak adımları verir."""
    if dialect == "mysql" and migration.mysql_steps:
        return migration.mysql_steps
    return migration.steps


def migrations_dir() -> Path:
    return Path(__file__).resolve().parent / "migrations"


def load_migrations(directory: Path | None = None) -> tuple[Migration, ...]:
    """0001'den kesintisiz artan dosyalar. Yüklemek veritabanına yazmaz."""
    root = directory or migrations_dir()
    found: dict[int, Migration] = {}
    if not root.is_dir():
        raise MigrationError("Migration klasörü yok.")
    for path in sorted(root.iterdir()):
        if not path.is_file():
            continue
        match = _FILE.match(path.name)
        if match is None:
            continue
        version = int(match.group(1))
        name = match.group(2)
        if version in found:
            raise MigrationError(f"{version:04d} birden fazla dosyada.")
        if path.suffix == ".sql":
            item = _load_sql(path, version, name)
        else:
            item = _load_py(path, version, name)
        found[version] = item
    if not found:
        raise MigrationError("Migration dosyası yok.")
    ordered = [found[key] for key in sorted(found)]
    expect = list(range(1, len(ordered) + 1))
    if [item.version for item in ordered] != expect:
        raise MigrationError("Migration numaraları 0001'den kesintisiz artmalı.")
    return tuple(ordered)


def _checksum(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _load_sql(path: Path, version: int, name: str) -> Migration:
    steps = tuple(_require_step(part, path.name) for part in split_sql(path.read_text(encoding="utf-8")))
    if not steps:
        raise MigrationError(f"{path.name} boş.")
    return Migration(version, name, _checksum(path), steps)


def _load_py(path: Path, version: int, name: str) -> Migration:
    module_name = f"_storage_mig_{version}_{name}"
    spec = importlib.util.spec_from_file_location(module_name, path)
    if spec is None or spec.loader is None:
        raise MigrationError(f"{path.name} yüklenemedi.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[module_name] = module
    try:
        spec.loader.exec_module(module)
    finally:
        sys.modules.pop(module_name, None)
    raw = getattr(module, "STEPS", None)
    if not isinstance(raw, (list, tuple)) or not raw:
        raise MigrationError(f"{path.name} STEPS boş.")
    steps = tuple(_require_step(part, path.name) for part in raw)
    mysql_raw = getattr(module, "MYSQL_STEPS", None)
    mysql_steps: tuple[str, ...] = ()
    if mysql_raw is not None:
        if not isinstance(mysql_raw, (list, tuple)) or not mysql_raw:
            raise MigrationError(f"{path.name} MYSQL_STEPS boş.")
        mysql_steps = tuple(_require_step(part, path.name) for part in mysql_raw)
    return Migration(version, name, _checksum(path), steps, mysql_steps)


def _require_step(step, filename: str) -> str:
    if not isinstance(step, str):
        raise MigrationError(f"{filename} adımı metin değil.")
    text = step.strip().rstrip(";").strip()
    if not text:
        raise MigrationError(f"{filename} boş adım.")
    if not _ALLOWED.match(text):
        raise MigrationError(f"{filename} adımı izinli değil.")
    if _DOCS.search(text):
        raise MigrationError(f"{filename} docs tablosuna dokunamaz.")
    return text


def split_sql(text: str) -> list[str]:
    """Yorum satırlarını at, tırnak dışındaki noktalı virgülde böl."""
    parts: list[str] = []
    buf: list[str] = []
    quote = ""
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        if quote:
            buf.append(ch)
            if ch == quote and text[i - 1] != "\\":
                quote = ""
            i += 1
            continue
        if ch in ("'", '"'):
            quote = ch
            buf.append(ch)
            i += 1
            continue
        if ch == "-" and text[i:i + 2] == "--":
            newline = text.find("\n", i)
            i = length if newline < 0 else newline
            continue
        if ch == ";":
            statement = "".join(buf).strip()
            if statement:
                parts.append(statement)
            buf = []
            i += 1
            continue
        buf.append(ch)
        i += 1
    tail = "".join(buf).strip()
    if tail:
        parts.append(tail)
    return parts
