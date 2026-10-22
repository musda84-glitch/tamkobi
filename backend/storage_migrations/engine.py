"""schema_version üzerinden sıralı, kaldığı yerden süren uygulama."""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone

from .errors import ChecksumError, DryRunError, LegacyTargetError, MigrationError
from .loader import Migration, load_migrations, steps_for
from .masking import logger
from .session import Session, schema_sql

_INDEX = re.compile(
    r"^CREATE\s+(?:UNIQUE\s+)?INDEX\s+(?:IF\s+NOT\s+EXISTS\s+)?"
    r"[`\"]?([A-Za-z0-9_]+)[`\"]?\s+ON\s+[`\"]?([A-Za-z0-9_]+)[`\"]?",
    re.IGNORECASE,
)

log = logger()


@dataclass(frozen=True)
class RowView:
    version: int
    name: str
    state: str
    step: int
    total: int


@dataclass(frozen=True)
class ApplyResult:
    rows: tuple[RowView, ...]
    advanced: int
    wrote: bool


def status(session: Session, migrations: tuple[Migration, ...] | None = None) -> tuple[RowView, ...]:
    """Okur. Tablo yoksa oluşturmaz."""
    pack = migrations if migrations is not None else load_migrations()
    guard_not_legacy(session)
    return _rows(session, pack)


def plan(session: Session, migrations: tuple[Migration, ...] | None = None) -> tuple[RowView, ...]:
    """Uygulanacak veya yarım kalmış sürümler. Yazmaz."""
    return tuple(row for row in status(session, migrations) if row.state != "uygulandı")


def apply(
    session: Session,
    migrations: tuple[Migration, ...] | None = None,
    *,
    confirm: bool = False,
    dry_run: bool = True,
) -> ApplyResult:
    """Yazma yalnız confirm ve dry_run=False iken. Yarım adım kaldığı yerden sürer."""
    pack = migrations if migrations is not None else load_migrations()
    if not confirm or dry_run:
        return ApplyResult(rows=status(session, pack), advanced=0, wrote=False)
    guard_not_legacy(session)
    _ensure_schema(session)
    advanced = 0
    for mig in pack:
        if _apply_one(session, mig):
            advanced += 1
    return ApplyResult(rows=_rows(session, pack), advanced=advanced, wrote=True)


def guard_not_legacy(session: Session) -> None:
    """docs tablosu olan veritabanına şema işi yapılmaz."""
    if "docs" in session.tables():
        raise LegacyTargetError("Legacy docs tablosu olan veritabanı reddedildi.")


def _ensure_schema(session: Session) -> None:
    if "schema_version" in session.tables():
        return
    session.execute(schema_sql())
    session.commit()


def _rows(session: Session, migrations: tuple[Migration, ...]) -> tuple[RowView, ...]:
    current = _read_all(session)
    views = []
    for mig in migrations:
        row = current.get(mig.version)
        total = len(steps_for(mig, session.dialect))
        if row is None:
            views.append(RowView(mig.version, mig.name, "bekliyor", 0, total))
            continue
        if row["checksum"] != mig.checksum:
            raise ChecksumError(f"{mig.version:04d} {mig.name} sağlama değişti.")
        step = int(row["step_no"])
        if row["state"] == "applied":
            views.append(RowView(mig.version, mig.name, "uygulandı", step, total))
        elif row["state"] == "applying":
            views.append(RowView(mig.version, mig.name, "sürüyor", step, total))
        else:
            raise MigrationError(f"{mig.version:04d} {mig.name} durumu okunamadı.")
    return tuple(views)


def _read_all(session: Session) -> dict[int, dict]:
    if "schema_version" not in session.tables():
        return {}
    rows = session.fetchall(
        "SELECT version, name, checksum, state, step_no, applied_at FROM schema_version"
    )
    found = {}
    for row in rows:
        found[int(row[0])] = {
            "version": int(row[0]),
            "name": str(row[1]),
            "checksum": str(row[2]),
            "state": str(row[3]),
            "step_no": int(row[4]),
            "applied_at": str(row[5] or ""),
        }
    return found


def _apply_one(session: Session, mig: Migration) -> bool:
    current = _read_all(session)
    row = current.get(mig.version)
    if row and row["checksum"] != mig.checksum:
        raise ChecksumError(f"{mig.version:04d} {mig.name} sağlama değişti.")
    if row and row["state"] == "applied":
        return False
    if row and row["state"] != "applying":
        raise MigrationError(f"{mig.version:04d} {mig.name} durumu okunamadı.")
    changed = False
    if row is None:
        session.execute(
            "INSERT INTO schema_version (version, name, checksum, state, step_no, applied_at) "
            "VALUES (?, ?, ?, ?, ?, ?)",
            (mig.version, mig.name, mig.checksum, "applying", 0, ""),
        )
        session.commit()
        done = 0
        changed = True
    else:
        done = int(row["step_no"])
    plan_steps = steps_for(mig, session.dialect)
    total = len(plan_steps)
    if done < 0 or done > total:
        raise MigrationError(f"{mig.version:04d} {mig.name} adım sayısı uyumsuz.")
    for index, step in enumerate(plan_steps):
        if index < done:
            continue
        try:
            if not _index_already_there(session, step):
                session.execute(step)
            session.execute(
                "UPDATE schema_version SET step_no = ? WHERE version = ?",
                (index + 1, mig.version),
            )
            session.commit()
        except (MigrationError, LegacyTargetError, ChecksumError, DryRunError):
            _quiet_rollback(session)
            raise
        except Exception:
            _quiet_rollback(session)
            raise MigrationError(f"{mig.version:04d} {mig.name} adım {index + 1} kesildi.") from None
        log.info("migration %s adım %s", f"{mig.version:04d}", index + 1)
        changed = True
        done = index + 1
    if done != total:
        raise MigrationError(f"{mig.version:04d} {mig.name} tamamlanmadı.")
    if row and row["state"] == "applied":
        return changed
    stamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    session.execute(
        "UPDATE schema_version SET state = ?, applied_at = ? WHERE version = ?",
        ("applied", stamp, mig.version),
    )
    session.commit()
    return True


def _index_already_there(session: Session, step: str) -> bool:
    """CREATE INDEX yarım kalıp tekrar çalışırsa duplicate index vermesin.

    MySQL DDL oturumu kendisi commit eder. Adım numarası yazılmadan süreç
    düşerse index durur, ifade ikinci kez 1061 verir. Var olan index atlanır.
    """
    match = _INDEX.match(step.strip())
    if match is None:
        return False
    name, table = match.group(1), match.group(2)
    if session.dialect == "sqlite":
        rows = session.fetchall(
            "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = ? AND tbl_name = ?",
            (name, table),
        )
    else:
        rows = session.fetchall(
            "SELECT 1 FROM information_schema.statistics "
            "WHERE table_schema = DATABASE() AND table_name = ? AND index_name = ? LIMIT 1",
            (table, name),
        )
    return bool(rows)


def _quiet_rollback(session: Session) -> None:
    try:
        session.rollback()
    except Exception:
        return
