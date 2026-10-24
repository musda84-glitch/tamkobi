"""Şirketi depolama kipleri arasında taşır.

Komut:
  python -m scripts.storage_move --company <id> --to <shared_v2|dedicated|legacy>
      [--dry-run] [--apply] [--rollback <move_id>] [--recover <move_id>]

Varsayılan dry-run: hiçbir şey yazılmaz. --apply önce yazma kilidi
olmadan ön kopya yapar. Kilit altında yalnız tombstone ve updated_at
farkı uygulanır, sağlama tutulur, sonra kip değişir. Kaynak silinmez.
Hata olursa kip değişmez, hedefe yazılanlar temizlenir, kilit açılır.
--recover yalnız bu move_id'nin bayat kilidine dokunur. Kilit başka
taşımadaysa kayıt abandoned olur; hedef veri silinmez.

Yazma kilidi katalogdadır. Kopyadan önce ve kip değiştikten sonra, diğer
süreçlerin önbelleği dolsun diye en az TTL kadar beklenir. Dosya
(disk) içerikleri taşınmaz: yol belgenin içindedir, baytlar ortak
diskte kalır. Bağlantı ayarı okunur, yazdırılmaz.

Taşıma shared_v2 ve dedicated okuma/yazmasını kendi bağlantısında yapar.
Uygulama bağlantısının izolasyon düzeyi değişmez. Taşıma bağlantısı
READ COMMITTED'dir ve her okumadan sonra işlemi kapatır.
"""
from __future__ import annotations

import argparse
import asyncio
import contextvars
import copy
import hashlib
import inspect
import json
import logging
import os
import socket
import sys
import time
import uuid
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timezone

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402

BATCH = 1000
_BEAT_GAP = 5.0
_PROGRESS_GAP = 5.0
_CHANGED_SQL = (
    "SELECT doc FROM docs WHERE collection=%s AND company_id=%s "
    "AND updated_at>=%s ORDER BY updated_at ASC, id ASC"
)
_MOVE_INDEX = "idx_docs_coll_company_upd"
# Sağlamada move_id ile ayıklanan satırlar. Koleksiyonun kendisi,
# router şirket deposuna veriyorsa kopyalanır.
_MOVER_ROWS = frozenset({"storage_moves", "storage_move_locks", "sync_tombstones"})
LOCKS = "storage_move_locks"
_OWNER_MEMORY = asyncio.Lock()
_MOVER_DEPTH: "contextvars.ContextVar[int]" = contextvars.ContextVar(
    "storage_mover_depth",
    default=0,
)
_PRIVATE_SQL_MODE = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"
_ID_MAX = 191
_COMPANY_MAX = 64
_CONTROL = None  # storage_router yüklendikten sonra dolar


class MoveError(RuntimeError):
    """Taşıma durdu. İleti sır taşımaz."""


class LockLost(MoveError):
    """Kilit satırı artık bu move_id'ye ait değil."""


@dataclass
class MoveReport:
    ok: bool = False
    wrote: bool = False
    dry_run: bool = True
    move_id: str = ""
    company_id: str = ""
    from_mode: str = ""
    to_mode: str = ""
    status: str = ""
    collections: list = field(default_factory=list)
    conflicts: list = field(default_factory=list)
    errors: list = field(default_factory=list)
    counts: dict = field(default_factory=dict)
    checksums: dict = field(default_factory=dict)
    steps: list = field(default_factory=list)
    duration_ms: int = 0
    locked_ms: int = 0

    def public(self) -> dict:
        """Sır, DSN ve mühür içermeyen görünüm."""
        return {
            "ok": self.ok,
            "wrote": self.wrote,
            "dry_run": self.dry_run,
            "move_id": self.move_id,
            "company_id": storage_router._safe_company(self.company_id),
            "from_mode": self.from_mode,
            "to_mode": self.to_mode,
            "status": self.status,
            "collections": list(self.collections),
            "conflicts": list(self.conflicts),
            "errors": list(self.errors),
            "counts": self.counts,
            "checksums": self.checksums,
            "steps": list(self.steps),
            "duration_ms": self.duration_ms,
            "locked_ms": self.locked_ms,
        }


def _logger() -> logging.Logger:
    log = logging.getLogger("storage_move")
    try:
        from storage_migrations.masking import RedactFilter
    except Exception:
        return log
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log


def _safe(exc: BaseException) -> str:
    return storage_router.public_store_error(exc)


def _now() -> str:
    """Mikrosaniye. Aynı saniyedeki kalp atışı da satırı değiştirir."""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _freeze(doc: dict) -> str:
    body = dict(doc)
    body.pop("_row_updated_at", None)
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _digest(docs) -> str:
    parts = sorted(_freeze(doc) for doc in docs)
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _bytes(docs) -> int:
    return sum(len(_freeze(doc).encode("utf-8")) for doc in docs)


def _bytes_and_digest(docs) -> tuple:
    """Tek JSON geçişi. Bayt ve sağlama ayrı ayrı dondurmakla aynı sonucu verir."""
    parts = []
    total = 0
    for doc in docs:
        frozen = _freeze(doc)
        total += len(frozen.encode("utf-8"))
        parts.append(frozen)
    parts.sort()
    digest = hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()
    return total, digest


def _chunks(items, size: int):
    step = max(1, int(size or 1))
    rows = list(items)
    for index in range(0, len(rows), step):
        yield rows[index:index + step]


def _kind(name: str) -> str:
    from tenant_scope import collection_kind

    return collection_kind(name)


def _control_fields() -> tuple:
    return (
        storage_router.WRITE_LOCK_FIELD,
        storage_router.MODE_FIELD,
        storage_router.EPOCH_FIELD,
        storage_router.DSN_FIELD,
    )


def _routed_away(db, mode: str, company_id: str, name: str) -> bool:
    """Router bu adı şirket deposuna veriyorsa True.

    Karar collection_for_mode ile aynıdır: dönüş db[name] değilse
    koleksiyon kopyalanır, sağlanır ve source-intact'e girer.
    """
    if mode == storage_router.LEGACY:
        return False
    if mode == storage_router.DEDICATED:
        return True
    try:
        routed = storage_router.collection_for_mode(db, mode, company_id, name)
        return routed is not db[name]
    except Exception:
        return True


def _ignore_set(move_ids) -> set:
    return {str(item) for item in (move_ids or ()) if item}


def _without_mover(name: str, docs, move_ids) -> list:
    """Taşımanın kendi storage_moves, kilit ve mezar taşı satırları."""
    skip = _ignore_set(move_ids)
    if not skip or name not in _MOVER_ROWS:
        return list(docs or [])
    kept = []
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        ident = str(doc.get("_id") or "")
        mid = str(doc.get("move_id") or "")
        if name == "storage_moves" and ident in skip:
            continue
        if mid in skip:
            continue
        kept.append(doc)
    return kept


def _prepare_private_mysql(conn) -> None:
    """Yalnız taşımanın kendi bağlantısı. Uygulama oturumuna yazılmaz."""
    cursor = conn.cursor()
    cursor.execute("SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED")
    cursor.execute(f"SET SESSION sql_mode='{_PRIVATE_SQL_MODE}'")
    conn.commit()


def _as_text(value, encoding: str = "utf-8") -> str:
    if value is None:
        return ""
    if isinstance(value, (bytes, bytearray)):
        return value.decode(encoding, "replace")
    return str(value)


def _clone_mysql(conn):
    import pymysql

    return pymysql.connect(
        host=_as_text(getattr(conn, "host", None)) or "127.0.0.1",
        port=int(getattr(conn, "port", None) or 3306),
        user=_as_text(getattr(conn, "user", None)),
        password=_as_text(getattr(conn, "password", None), "latin1"),
        database=_as_text(getattr(conn, "db", None)),
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=5,
    )


def _shared_kind() -> str:
    """Uygulama bağlantısını açmadan shared lehçesi. mysql, sqlite veya boş."""
    app = storage_shared_v2.get_store()
    if app.conn is not None:
        return app.dialect if app.dialect in ("mysql", "sqlite") else ""
    dsn = os.environ.get(storage_shared_v2.ENV_DSN, "").strip()
    if not dsn:
        return ""
    scheme = dsn.split("://", 1)[0].lower()
    if scheme in ("mysql", "mariadb") or scheme.startswith("mysql+") or scheme.startswith("mariadb+"):
        return "mysql"
    if scheme in ("sqlite", "sqlite3"):
        return "sqlite"
    return ""


def _open_private_shared():
    """MySQL shared için ayrı bağlantı. SQLite uygulama bağlantısında kalır."""
    if _shared_kind() != "mysql":
        return None
    app = storage_shared_v2.get_store()
    owned = True
    if app.conn is not None:
        try:
            conn = _clone_mysql(app.conn)
        except Exception:
            raise MoveError("Taşıma bağlantısı açılmadı.") from None
    else:
        dsn = os.environ.get(storage_shared_v2.ENV_DSN, "").strip()
        try:
            conn, dialect, owned = storage_shared_v2._connect(dsn)
        except Exception:
            raise MoveError("Taşıma bağlantısı açılmadı.") from None
        if dialect != "mysql":
            if owned and conn is not None:
                conn.close()
            raise MoveError("Taşıma bağlantısı açılmadı.")
    try:
        _prepare_private_mysql(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        raise MoveError("Taşıma bağlantısı açılmadı.") from None
    store = storage_shared_v2.SharedV2Store()
    store.attach(conn, "mysql", owned=owned)
    store.indexes = app.indexes
    return store


def _open_private_dedicated(company_id: str, company: dict):
    from storage_migrations.session import connect

    try:
        session = connect(_dedicated_dsn(company), write=True)
    except MoveError:
        raise
    except Exception:
        raise MoveError("Taşıma bağlantısı açılmadı.") from None
    if getattr(session, "dialect", "") == "mysql" and getattr(session, "conn", None) is not None:
        try:
            _prepare_private_mysql(session.conn)
        except Exception:
            try:
                session.close()
            except Exception:
                pass
            raise MoveError("Taşıma bağlantısı açılmadı.") from None
    return session


def _finish_private_reads() -> None:
    """Taşıma bağlantısının işlemini kapat. Uygulama bağlantısına dokunma."""
    store = storage_shared_v2.read_store()
    if store is not None and getattr(store, "conn", None) is not None and store.dialect == "mysql":
        try:
            store.commit_locked()
        except Exception:
            try:
                with store.op_lock:
                    store.conn.rollback()
            except Exception:
                pass
    session = storage_dedicated.read_session()
    if session is not None and getattr(session, "conn", None) is not None and getattr(session, "dialect", "") == "mysql":
        try:
            session.commit()
        except Exception:
            try:
                session.rollback()
            except Exception:
                pass


class _MoverIO:
    """Taşımanın shared ve dedicated bağlantıları. İç içe çağrı yenisini açmaz."""

    def __init__(self, company_id: str, company, modes):
        self.company_id = str(company_id or "")
        self.company = company if isinstance(company, dict) else None
        self.modes = {storage_router.normalize_mode(item) for item in modes if item}
        if self.company is not None:
            self.modes.add(storage_router.normalize_mode(self.company.get(storage_router.MODE_FIELD)))
        self.nested = False
        self.shared = None
        self.shared_token = None
        self.dedicated = None
        self.dedicated_token = None
        self._depth_token = None

    def __enter__(self):
        if _MOVER_DEPTH.get():
            self.nested = True
            self._depth_token = _MOVER_DEPTH.set(_MOVER_DEPTH.get() + 1)
            return self
        self._depth_token = _MOVER_DEPTH.set(1)
        try:
            if _shared_kind() == "mysql":
                self.shared = _open_private_shared()
                self.shared_token = storage_shared_v2.use_read_store(self.shared)
            if storage_router.DEDICATED in self.modes and self.company is not None:
                self.dedicated = _open_private_dedicated(self.company_id, self.company)
                self.dedicated_token = storage_dedicated.use_read_session(self.company_id, self.dedicated)
        except Exception:
            self._close()
            _MOVER_DEPTH.reset(self._depth_token)
            self._depth_token = None
            raise
        return self

    def _close(self) -> None:
        if self.shared_token is not None:
            storage_shared_v2.reset_read_store(self.shared_token)
            self.shared_token = None
        if self.dedicated_token is not None:
            storage_dedicated.reset_read_session(self.dedicated_token)
            self.dedicated_token = None
        shared = self.shared
        self.shared = None
        if shared is not None:
            try:
                shared.close()
            except Exception:
                pass
        dedicated = self.dedicated
        self.dedicated = None
        if dedicated is not None:
            try:
                dedicated.close()
            except Exception:
                pass

    def __exit__(self, exc_type, exc, tb):
        if self._depth_token is not None:
            _MOVER_DEPTH.reset(self._depth_token)
            self._depth_token = None
        if not self.nested:
            self._close()
        return False


@contextmanager
def _mover_io(company_id: str, company, *modes):
    io = _MoverIO(company_id, company, modes)
    with io:
        yield io


def _belongs(doc: dict, name: str, company_id: str) -> bool:
    if not isinstance(doc, dict):
        return False
    kind = _kind(name)
    if kind == "company":
        return str(doc.get("_id") or "") == company_id
    if kind == "membership":
        raw = doc.get("company_ids") or []
        if isinstance(raw, str):
            raw = [raw]
        ids = {str(item) for item in raw if item is not None}
        if company_id in ids:
            return True
    return str(doc.get("company_id") or "") == company_id


def _seconds(env_name: str, default: float) -> float:
    raw = os.environ.get(env_name, "")
    if not str(raw).strip():
        return max(0.0, float(default))
    try:
        return max(0.0, float(raw))
    except (TypeError, ValueError):
        return max(0.0, float(default))


def _owner_host() -> str:
    return socket.gethostname() or "unknown"


async def _sleep_beat(db, company_id: str, move_id: str, seconds: float, lost=None) -> None:
    """Beklerken kalp atışını yeniler. Eşik 30 sn; adım en fazla 5 sn."""
    await _beat(db, company_id, move_id, lost)
    left = max(0.0, float(seconds or 0))
    while left > 0:
        chunk = min(5.0, left)
        time.sleep(chunk)
        left -= chunk
        await _beat(db, company_id, move_id, lost)


async def _sleep_lock(db, company_id: str, move_id: str, lost=None) -> None:
    await _sleep_beat(db, company_id, move_id, storage_router.lock_ttl(), lost)


async def _sleep_mode(db, company_id: str, move_id: str, lost=None) -> None:
    await _sleep_beat(db, company_id, move_id, storage_router.mode_ttl(), lost)


async def _pulse(db, company_id: str, move_id: str, lost: list) -> None:
    """Uzun okuma ve kopya sırasında kalp atışı. İptal edilince susar."""
    while True:
        await asyncio.sleep(5)
        try:
            await _beat(db, company_id, move_id, lost)
        except asyncio.CancelledError:
            raise
        except LockLost as exc:
            if not lost:
                lost.append(exc)
            return
        except Exception:
            return


async def _stop_pulse(task) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except (asyncio.CancelledError, LockLost, Exception):
        pass


def _stale_seconds() -> float:
    return _seconds("STORAGE_MOVE_STALE_SECONDS", 30.0)


def _pid_alive(pid: int) -> bool:
    if pid <= 0:
        return False
    try:
        os.kill(int(pid), 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True


def _heartbeat_age(row: dict) -> float:
    text = str((row or {}).get("heartbeat_at") or "")
    for fmt in ("%Y-%m-%dT%H:%M:%S.%fZ", "%Y-%m-%dT%H:%M:%SZ"):
        try:
            stamp = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
        except ValueError:
            continue
        return time.time() - stamp.timestamp()
    return 10**9


def _lock_stale(row: dict) -> bool:
    """Bayatlık kalp atışı eşiği veya aynı hostta ölü pid.

    Başka hosttaki taze kalp atışı, pid bu makinede yok diye çalınmaz.
    """
    if not isinstance(row, dict):
        return True
    host = str(row.get("owner_host") or "")
    try:
        pid = int(row.get("owner_pid") or 0)
    except (TypeError, ValueError):
        pid = 0
    if host and host == _owner_host() and pid and not _pid_alive(pid):
        return True
    return _heartbeat_age(row) >= _stale_seconds()


def _is_duplicate(exc: BaseException) -> bool:
    try:
        from mysql_store import DuplicateKeyError
    except Exception:
        DuplicateKeyError = ()  # type: ignore
    if DuplicateKeyError and isinstance(exc, DuplicateKeyError):
        return True
    text = str(exc).lower()
    return "duplicate" in text or "zaten var" in text


def _target_table(mode: str, name: str) -> str:
    if mode == storage_router.LEGACY:
        return name
    if mode == storage_router.SHARED_V2:
        import storage_tables

        spec = storage_tables.SPECS.get(name)
        if spec is not None:
            return spec.table
        return "docs_v2"
    return "storage_records"


def _dedicated_dsn(company: dict) -> str:
    sealed = (company or {}).get(storage_router.DSN_FIELD)
    if not isinstance(sealed, str) or not sealed.strip():
        raise MoveError("Dedicated DSN referansı yok.")
    from storage_migrations.masking import add_secret
    from storage_migrations.targets import unseal_dedicated_ref

    dsn = unseal_dedicated_ref(sealed)
    add_secret(dsn)
    return dsn


def _open(db, mode: str, company_id: str, name: str, company: dict):
    if mode == storage_router.LEGACY:
        return db[name]
    if mode == storage_router.SHARED_V2:
        return storage_router.collection_for_mode(db, mode, company_id, name)
    return storage_dedicated.DedicatedCollection(company_id, name, _dedicated_dsn(company))


async def _collect(cursor):
    if hasattr(cursor, "to_list"):
        rows = cursor.to_list(None)
        if inspect.isawaitable(rows):
            rows = await rows
        return [dict(row) for row in list(rows or []) if isinstance(row, dict)]
    rows = []
    if hasattr(cursor, "__aiter__"):
        async for doc in cursor:
            if isinstance(doc, dict):
                rows.append(dict(doc))
        return rows
    return [dict(row) for row in list(cursor or []) if isinstance(row, dict)]


async def _read(db, mode: str, company_id: str, name: str, company: dict, ignore_moves=()):
    """Her okuma kendi işlemini kapatır. Kaynak ve hedef ayrı taze okumadır."""
    _finish_private_reads()
    try:
        coll = _open(db, mode, company_id, name, company)
        kind = _kind(name)
        if mode == storage_router.LEGACY and kind in ("company", "membership", "platform", "token"):
            rows = await _collect(coll.find({}))
            docs = [row for row in rows if _belongs(row, name, company_id)]
        else:
            docs = await _collect(coll.find({"company_id": company_id}))
    finally:
        _finish_private_reads()
    return _without_mover(name, docs, ignore_moves)


def _sql_collections(settings: dict):
    """list_collection_names yokken docs tablosundan adlar. Ayar loglanmaz."""
    try:
        import pymysql

        import db_ssl
    except Exception:
        return None
    conn = None
    try:
        conn = pymysql.connect(
            host=settings.get("host") or "127.0.0.1",
            port=int(settings.get("port") or 3306),
            user=settings.get("user") or "",
            password=settings.get("password") or "",
            database=settings.get("db") or "",
            charset=settings.get("charset") or "utf8mb4",
            autocommit=True,
            connect_timeout=3,
            **db_ssl.connect_kwargs(settings),
        )
        with conn.cursor() as cur:
            cur.execute("SELECT DISTINCT collection FROM docs")
            rows = cur.fetchall()
    except Exception:
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass
    return [str(row[0]) for row in rows if row and row[0]]


async def _list_names(db) -> list[str]:
    fn = getattr(db, "list_collection_names", None)
    if fn is not None:
        try:
            listed = fn()
            if inspect.isawaitable(listed):
                listed = await listed
            return [str(name) for name in listed or [] if name]
        except Exception:
            pass
    settings = getattr(db, "_settings", None)
    if isinstance(settings, dict) and settings.get("host") and settings.get("db"):
        listed = _sql_collections(settings)
        if listed is not None:
            return listed
    cols = getattr(db, "_cols", None)
    if isinstance(cols, dict):
        return [str(name) for name in cols if name]
    return []


async def _legacy_names(db, company_id: str, route_mode: str, ignore_moves=()) -> list[str]:
    found = []
    for name in await _list_names(db):
        if name == "t_row_unique":
            continue
        if route_mode and route_mode != storage_router.LEGACY:
            if not _routed_away(db, route_mode, company_id, name):
                continue
        docs = await _read(db, storage_router.LEGACY, company_id, name, {}, ignore_moves)
        if docs:
            found.append(name)
    return sorted(found)


def _public_names(names) -> list[str]:
    return sorted(name for name in names or [] if name and name != "t_row_unique")


async def _names(db, mode: str, company_id: str, company: dict, route_mode: str = "", ignore_moves=()) -> list[str]:
    _finish_private_reads()
    try:
        if mode == storage_router.LEGACY:
            names = _public_names(await _legacy_names(db, company_id, route_mode or mode, ignore_moves))
        elif mode == storage_router.SHARED_V2:
            try:
                names = _public_names(storage_shared_v2.list_company_collections(company_id))
            except Exception as exc:
                raise MoveError(_safe(exc)) from None
        else:
            try:
                names = _public_names(storage_dedicated.list_collections(company_id, _dedicated_dsn(company)))
            except MoveError:
                raise
            except Exception as exc:
                raise MoveError(_safe(exc)) from None
    finally:
        _finish_private_reads()
    if not _ignore_set(ignore_moves):
        return names
    kept = []
    for name in names:
        if name not in _MOVER_ROWS:
            kept.append(name)
            continue
        if await _read(db, mode, company_id, name, company, ignore_moves):
            kept.append(name)
    return kept


async def _company(db, company_id: str):
    found = db.companies.find_one({"_id": company_id})
    if inspect.isawaitable(found):
        found = await found
    return found if isinstance(found, dict) else None


# Üst düzey alanlar değişir. İç içe nesnelere dokunulmaz; yazan taraf kendi kopyasını alır.
_PREPARE_OFFLOAD_AT = 32


def _prepare(doc: dict, company_id: str, name: str = "") -> dict:
    body = dict(doc)
    body["_id"] = str(body.get("_id") or "")
    if name == "companies" or _kind(name) == "company":
        for field in _control_fields():
            body.pop(field, None)
    if not str(body.get("company_id") or "").strip():
        body["company_id"] = company_id
    return body


def _prepare_many(docs, company_id: str, name: str = "") -> list:
    return [_prepare(doc, company_id, name) for doc in docs if isinstance(doc, dict) and doc.get("_id")]


async def _prepare_docs(docs, company_id: str, name: str = "") -> list:
    rows = [doc for doc in docs or [] if isinstance(doc, dict) and doc.get("_id")]
    if len(rows) < _PREPARE_OFFLOAD_AT:
        return [_prepare(doc, company_id, name) for doc in rows]
    import platform_lease

    return await platform_lease.call_blocking(_prepare_many, rows, company_id, name)


def _count_and_bytes(docs, company_id: str, name: str = "") -> tuple:
    prepared = _prepare_many(docs, company_id, name)
    return len(prepared), _bytes(prepared)


async def _measure_docs(docs, company_id: str, name: str = "") -> tuple:
    """Kayıt sayısı ve kanonik bayt. Büyük küme döngünün dışında dondurulur.

    Taşıma ve checksum bu fonksiyonu tam belge listesiyle çağırır.
    Periyodik ölçüm measure_collection kullanır; burası satır çekmeye devam eder.
    """
    rows = [doc for doc in docs or [] if isinstance(doc, dict) and doc.get("_id")]
    if len(rows) < _PREPARE_OFFLOAD_AT:
        return _count_and_bytes(rows, company_id, name)
    import platform_lease

    return await platform_lease.call_blocking(_count_and_bytes, rows, company_id, name)


async def measure_collection(db, mode: str, company_id: str, name: str, company: dict, *, with_bytes: bool = True):
    """Periyodik hacim. SQL sayımı varsa (adet, bayt), yoksa None.

    None yalnız bellek kataloğu içindir; çağıran o zaman tam okur.
    SQL hatası yukarı çıkar. Tam okumaya düşülmez.
    with_bytes False ise yalnız COUNT(*). Belge gövdesi okunmaz.
    """
    _finish_private_reads()
    try:
        coll = _open(db, mode, company_id, name, company)
        fn = getattr(coll, "measure_volume", None)
        if fn is None:
            return None
        result = fn(company_id, with_bytes=with_bytes)
        if inspect.isawaitable(result):
            result = await result
        if not isinstance(result, tuple) or len(result) != 2:
            return None
        return int(result[0] or 0), int(result[1] or 0)
    finally:
        _finish_private_reads()


async def _shared_volume_names(company_id: str) -> list[str]:
    if _shared_kind() == "mysql":
        import platform_lease

        names = await platform_lease.call_blocking(
            storage_shared_v2.list_company_collections, company_id,
        )
    else:
        names = storage_shared_v2.list_company_collections(company_id)
    return _public_names(names)


async def _legacy_volume_names(db, company_id: str):
    """Paylaşılan docs'ta DISTINCT collection. Gövde okunmaz. Bellek kataloğu None."""
    getter = getattr(db, "__getitem__", None)
    if getter is None:
        return None
    try:
        coll = db["companies"]
    except Exception:
        return None
    fetch = getattr(coll, "_fetch_rows", None)
    if fetch is None:
        return None
    rows = fetch(
        "SELECT DISTINCT collection FROM docs WHERE company_id=%s",
        [str(company_id)],
    )
    if inspect.isawaitable(rows):
        rows = await rows
    return [str(row[0]) for row in rows or [] if row and row[0]]


async def volume_names(db, mode: str, company_id: str, company: dict) -> list[str]:
    """Ölçümün koleksiyon listesi. Belge satırı çekmez.

    Taşıma _names ile kalır. Bellek kataloğunda _names'e düşülür.
    """
    kind = storage_router.normalize_mode(mode)
    if kind == storage_router.DEDICATED:
        import storage_dedicated

        names = await storage_dedicated.list_collections_async(
            company_id, _dedicated_dsn(company),
        )
        return _public_names(names)
    if kind == storage_router.SHARED_V2:
        return await _shared_volume_names(company_id)
    listed = await _legacy_volume_names(db, company_id)
    if listed is not None:
        return _public_names(listed)
    return await _names(db, kind, company_id, company, kind)


def _prepare_with_stats_sync(docs, company_id: str, name: str = ""):
    prepared = _prepare_many(docs, company_id, name)
    nbytes, digest = _bytes_and_digest(prepared)
    return prepared, nbytes, digest


async def _prepare_with_stats(docs, company_id: str, name: str = ""):
    rows = [doc for doc in docs or [] if isinstance(doc, dict) and doc.get("_id")]
    if len(rows) < _PREPARE_OFFLOAD_AT:
        return _prepare_with_stats_sync(rows, company_id, name)
    import platform_lease

    return await platform_lease.call_blocking(_prepare_with_stats_sync, rows, company_id, name)


def _check_docs(name: str, docs, company_id: str):
    errors = []
    conflicts = []
    seen = set()
    if len(company_id) > _COMPANY_MAX:
        errors.append("company_id çok uzun")
    for doc in docs:
        if not isinstance(doc, dict) or not str(doc.get("_id") or "").strip():
            errors.append(f"{name}: _id yok")
            continue
        ident = str(doc.get("_id"))
        if ident in seen:
            conflicts.append(f"{name}: tekrar eden _id")
        seen.add(ident)
        if len(ident) > _ID_MAX:
            errors.append(f"{name}: _id çok uzun")
        current = doc.get("company_id")
        if current is not None and str(current) != company_id:
            errors.append(f"{name}: company_id uyuşmuyor")
    return errors, conflicts


async def _hook(on_batch, name: str, count: int) -> None:
    if on_batch is None:
        return
    result = on_batch(name, count)
    if inspect.isawaitable(result):
        await result


def _needs_row_unique(coll) -> bool:
    database = getattr(coll, "_db", None)
    indexes = getattr(database, "_indexes", None)
    if not isinstance(indexes, dict):
        return False
    return bool(indexes.get(getattr(coll, "name", ""), []))


async def _insert_bulk(coll, docs) -> list[str] | None:
    """Tek işlemde çoklu ekleme. Uygun değilse None; çağıran satır satır yazar."""
    if not docs:
        return []
    _finish_private_reads()
    if isinstance(coll, storage_dedicated.DedicatedCollection):
        from mysql_store import dumps

        def work(session):
            sql = "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)"
            adapted = sql.replace("?", "%s") if session.dialect == "mysql" else sql
            params = [(coll.name, str(doc["_id"]), dumps(doc)) for doc in docs]
            cursor = session.conn.cursor()
            cursor.executemany(adapted, params)
            session.commit()

        coll._run(work)
        return [str(doc["_id"]) for doc in docs]
    if isinstance(coll, storage_shared_v2.SharedV2Collection):
        def write():
            coll._begin()
            try:
                for doc in docs:
                    coll._check_unique(doc, None)
                    coll._insert_row(doc)
                    coll._sync_unique(doc)
                coll._commit()
            except Exception as exc:
                coll._fail(exc)

        coll._run_write(write)
        coll._invalidate()
        return [str(doc["_id"]) for doc in docs]
    if hasattr(coll, "_replace_rows") and not _needs_row_unique(coll):
        from mysql_store import dumps

        rows = [(coll.name, str(doc["_id"]), dumps(doc)) for doc in docs]
        await coll._replace_rows(rows)
        return [str(doc["_id"]) for doc in docs]
    return None


async def _replace_bulk(coll, docs) -> bool:
    """Hedefteki satırın üzerine yazar. Olmazsa False."""
    if not docs:
        return True
    _finish_private_reads()
    if isinstance(coll, storage_dedicated.DedicatedCollection):
        from mysql_store import dumps

        def work(session):
            sql = storage_dedicated._upsert_sql(session.dialect)
            adapted = sql.replace("?", "%s") if session.dialect == "mysql" else sql
            params = [(coll.name, str(doc["_id"]), dumps(doc)) for doc in docs]
            cursor = session.conn.cursor()
            cursor.executemany(adapted, params)
            session.commit()

        coll._run(work)
        return True
    if isinstance(coll, storage_shared_v2.SharedV2Collection):
        def write():
            coll._begin()
            try:
                for doc in docs:
                    coll._check_unique(doc, doc.get("_id"))
                    coll._update_row(doc, doc["_id"])
                    coll._sync_unique(doc)
                coll._commit()
            except Exception as exc:
                coll._fail(exc)

        coll._run_write(write)
        coll._invalidate()
        return True
    if hasattr(coll, "_replace_rows") and not _needs_row_unique(coll):
        from mysql_store import dumps

        rows = [(coll.name, str(doc["_id"]), dumps(doc)) for doc in docs]
        await coll._replace_rows(rows)
        return True
    return False


async def _insert_docs(coll, company_id: str, docs) -> list[str]:
    with storage_router.bypass_write_lock(company_id):
        ids = await _insert_bulk(coll, docs)
        if ids is not None:
            return ids
        ids = []
        for doc in docs:
            await coll.insert_one(doc)
            ids.append(str(doc["_id"]))
        return ids


async def _replace_docs(coll, company_id: str, docs) -> None:
    with storage_router.bypass_write_lock(company_id):
        if await _replace_bulk(coll, docs):
            return
        for doc in docs:
            await coll.delete_one({"_id": doc["_id"], "company_id": company_id})
            await coll.insert_one(doc)


async def _delete_bulk(coll, company_id: str, ids) -> bool:
    pending = [str(item) for item in ids if item]
    if not pending:
        return True
    _finish_private_reads()
    if isinstance(coll, storage_dedicated.DedicatedCollection):
        def work(session):
            step = 500
            for index in range(0, len(pending), step):
                part = pending[index:index + step]
                marks = ",".join(["?"] * len(part))
                sql = f"DELETE FROM storage_records WHERE collection=? AND doc_id IN ({marks})"
                session.execute(sql, (coll.name, *part))
            session.commit()

        coll._run(work)
        return True
    if isinstance(coll, storage_shared_v2.SharedV2Collection):
        def write():
            coll._begin()
            try:
                step = 500
                for index in range(0, len(pending), step):
                    part = pending[index:index + step]
                    coll._drop_unique(part)
                    coll._delete_ids(part)
                coll._commit()
            except Exception as exc:
                coll._fail(exc)

        coll._run_write(write)
        coll._invalidate()
        return True
    return False


async def _delete_ids(coll, company_id: str, ids) -> None:
    pending = [str(item) for item in ids if item]
    if not pending:
        return
    with storage_router.bypass_write_lock(company_id):
        if await _delete_bulk(coll, company_id, pending):
            return
        for doc_id in pending:
            await coll.delete_one({"_id": doc_id, "company_id": company_id})


def _empty(company_id: str, to_mode: str, message: str, *, dry_run: bool) -> MoveReport:
    report = MoveReport(
        ok=False,
        wrote=False,
        dry_run=dry_run,
        company_id=company_id,
        to_mode=to_mode,
        status="reddedildi",
    )
    report.errors.append(message)
    return report


async def _inspect(db, company, company_id: str, to_mode: str, ignore_moves=()) -> MoveReport:
    report = MoveReport(dry_run=True, wrote=False, company_id=company_id, to_mode=to_mode)
    if not company_id:
        report.errors.append("company_id boş")
        report.status = "reddedildi"
        return report
    if to_mode not in storage_router.KNOWN_MODES:
        report.errors.append("Hedef kip bilinmiyor.")
        report.status = "reddedildi"
        return report
    if not company:
        report.errors.append("Şirket bulunamadı.")
        report.status = "reddedildi"
        return report
    source = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
    report.from_mode = source
    if source not in storage_router.KNOWN_MODES:
        report.errors.append("Kaynak kip bilinmiyor.")
        report.status = "reddedildi"
        return report
    if source == to_mode:
        report.errors.append("Şirket zaten bu kipte.")
        report.status = "reddedildi"
        return report
    if storage_router.DEDICATED in (source, to_mode):
        sealed = company.get(storage_router.DSN_FIELD)
        if not isinstance(sealed, str) or not sealed.strip():
            report.errors.append("Dedicated DSN referansı yok.")
    if report.errors:
        report.status = "reddedildi"
        return report
    try:
        names = await _names(db, source, company_id, company, to_mode, ignore_moves)
    except MoveError as exc:
        report.errors.append(str(exc))
        report.status = "reddedildi"
        return report
    for name in names:
        try:
            docs = await _read(db, source, company_id, name, company, ignore_moves)
            target_docs = await _read(db, to_mode, company_id, name, company, ignore_moves)
        except MoveError as exc:
            report.errors.append(str(exc))
            continue
        except Exception as exc:
            report.errors.append(_safe(exc))
            continue
        prepared, nbytes, digest = await _prepare_with_stats(docs, company_id, name)
        doc_errors, doc_conflicts = _check_docs(name, prepared, company_id)
        report.errors.extend(doc_errors)
        report.conflicts.extend(doc_conflicts)
        if target_docs and not (name == "companies" and to_mode == storage_router.LEGACY):
            report.conflicts.append(f"{name}: hedefte kayıt var")
        report.collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": nbytes,
            "target": _target_table(to_mode, name),
            "target_count": len(target_docs),
        })
        report.counts[name] = {"source": len(prepared), "target": len(target_docs)}
        report.checksums[name] = {"source": digest, "target": ""}
    if report.errors or report.conflicts:
        report.ok = False
        report.status = "reddedildi"
        return report
    report.ok = True
    report.status = "dry-run"
    return report


async def plan_move(db, company_id: str, to_mode: str) -> MoveReport:
    """Dry-run. Yazmaz, kilitlemez."""
    cid = str(company_id or "").strip()
    mode = storage_router.normalize_mode(to_mode)
    company = await _company(db, cid) if cid else None
    if cid and company is None and mode in storage_router.KNOWN_MODES:
        report = _empty(cid, mode, "Şirket bulunamadı.", dry_run=True)
        return report
    try:
        with _mover_io(cid, company, mode):
            report = await _inspect(db, company, cid, mode if mode in storage_router.KNOWN_MODES else str(to_mode or ""))
    except Exception as exc:
        report = _empty(cid, str(to_mode or ""), _safe(exc), dry_run=True)
    report.dry_run = True
    report.wrote = False
    _logger().info(
        "taşıma company=%s durum=%s",
        storage_router._safe_company(cid),
        "dry-run" if report.ok else "reddedildi",
    )
    return report


async def _flag(db, company_id: str, locked: bool) -> None:
    with storage_router.bypass_write_lock(company_id):
        await db.companies.update_one(
            {"_id": company_id},
            {"$set": {storage_router.WRITE_LOCK_FIELD: bool(locked)}},
        )


async def _save_move(db, company_id: str, doc: dict) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        with storage_router.bypass_write_lock(company_id):
            await db.storage_moves.insert_one(doc)


async def _patch_move(db, company_id: str, move_id: str, fields: dict) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        with storage_router.bypass_write_lock(company_id):
            await db.storage_moves.update_one({"_id": move_id}, {"$set": fields})


async def _load_move(db, move_id: str):
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        found = db.storage_moves.find_one({"_id": move_id})
        if inspect.isawaitable(found):
            found = await found
    return found if isinstance(found, dict) else None


async def _set_mode(db, company_id: str, mode: str) -> None:
    with storage_router.bypass_write_lock(company_id):
        await db.companies.update_one(
            {"_id": company_id},
            {"$set": {storage_router.MODE_FIELD: mode}, "$inc": {storage_router.EPOCH_FIELD: 1}},
        )
    storage_router.forget_mode(company_id)


def _fetch_unique(company_id: str, names: list) -> list:
    """t_row_unique satırları. Tablo yoksa boş liste. DSN loglanmaz."""
    if not names:
        return []
    import storage_tables

    _finish_private_reads()
    store = storage_shared_v2.get_store()
    try:
        conn = store.connection()
    except Exception:
        return []
    table = storage_tables.UNIQUE_TABLE
    marks = ",".join(["?"] * len(names))
    sql = (
        f"SELECT collection, doc_id, field_name, value_hash FROM {table} "
        f"WHERE company_id=? AND collection IN ({marks}) "
        "ORDER BY collection, doc_id, field_name"
    )
    adapted = sql.replace("?", "%s") if getattr(store, "dialect", "") == "mysql" else sql
    params = (company_id, *names)
    try:
        if getattr(store, "dialect", "") == "mysql":
            cur = conn.cursor()
            cur.execute(adapted, params)
            rows = cur.fetchall()
        else:
            rows = conn.execute(adapted, params).fetchall()
    except Exception:
        return []
    found = [tuple(str(part) for part in row) for row in rows]
    _finish_private_reads()
    return found


def _expected_unique(coll, docs) -> list:
    if not hasattr(coll, "_unique_slots"):
        return []
    found = []
    for doc in docs:
        doc_id = str(doc.get("_id") or "")
        try:
            slots = coll._unique_slots(doc)
        except Exception:
            return []
        for field_name, _value, value_hash in slots:
            found.append((getattr(coll, "name", ""), doc_id, str(field_name), str(value_hash)))
    return sorted(found)


def _write_unique_row(company_id: str, collection: str, field_name: str, field_value: str, value_hash: str, doc_id: str) -> None:
    import storage_tables

    store = storage_shared_v2.get_store()
    conn = store.connection()
    sql = (
        f"INSERT INTO {storage_tables.UNIQUE_TABLE} "
        "(company_id, collection, field_name, field_value, value_hash, doc_id) "
        "VALUES (?,?,?,?,?,?)"
    )
    adapted = sql.replace("?", "%s") if getattr(store, "dialect", "") == "mysql" else sql
    params = (company_id, collection, field_name, field_value, value_hash, doc_id)
    if getattr(store, "dialect", "") == "mysql":
        with store.op_lock:
            cur = conn.cursor()
            cur.execute(adapted, params)
            conn.commit()
    else:
        conn.execute(adapted, params)


async def _mirror_uniques(db, source: str, name: str, coll) -> None:
    """Kaynak benzersiz indeksi hedefe taşır ki t_row_unique yazılsın."""
    specs = []
    if source == storage_router.SHARED_V2:
        specs = list(storage_shared_v2.get_store().indexes.get(name) or [])
    else:
        raw = db[name]
        database = getattr(raw, "_db", None)
        if database is not None and hasattr(database, "_indexes"):
            specs = list(database._indexes.get(name) or [])
    if not specs or not hasattr(coll, "create_index"):
        return
    from storage_shared_v2 import index_spec_parts

    for item in specs:
        spec, unique, partial = index_spec_parts(item)
        if not unique or not spec:
            continue
        kwargs = {}
        if partial:
            kwargs["partialFilterExpression"] = partial
        await coll.create_index(list(spec), unique=True, **kwargs)


def _ensure_unique(company_id: str, name: str, coll, docs) -> tuple:
    """t_row_unique satırını doğrudan okur, eksikse yazar, özeti döner."""
    if not hasattr(coll, "_unique_slots"):
        return "", 0
    expected_slots = []
    for doc in docs:
        doc_id = str(doc.get("_id") or "")
        try:
            slots = list(coll._unique_slots(doc))
        except Exception:
            slots = []
        for field_name, field_value, value_hash in slots:
            expected_slots.append((name, doc_id, str(field_name), str(field_value), str(value_hash)))
    if not expected_slots:
        return "", 0
    actual = _fetch_unique(company_id, [name])
    have = {(row[0], row[1], row[2], row[3]) for row in actual}
    for coll_name, doc_id, field_name, field_value, value_hash in expected_slots:
        key = (coll_name, doc_id, field_name, value_hash)
        if key in have:
            continue
        _write_unique_row(company_id, coll_name, field_name, field_value, value_hash, doc_id)
    actual = _fetch_unique(company_id, [name])
    expected = sorted((coll_name, doc_id, field_name, value_hash) for coll_name, doc_id, field_name, _value, value_hash in expected_slots)
    if actual != expected:
        raise MoveError("t_row_unique sağlama uyuşmadı")
    digest = hashlib.sha256("\n".join("|".join(row) for row in actual).encode("utf-8")).hexdigest()
    return digest, len(actual)


async def _materialize_copied(db, company, company_id: str, mode: str, copied: dict) -> dict:
    """Kayıttaki özeti silinecek kimliklere çevirir. Eski liste biçimi durur."""
    out = {}
    for name, spec in (copied or {}).items():
        if isinstance(spec, dict) and spec.get("wipe") == "company":
            docs = await _read(db, mode, company_id, name, company)
            out[name] = [str(doc.get("_id")) for doc in docs if doc.get("_id")]
        elif isinstance(spec, (list, tuple)):
            out[name] = [str(item) for item in spec if item]
    return out


async def _wipe(db, company, company_id: str, mode: str, copied: dict) -> None:
    """Yalnız verilen kimlikler. Başka taşımanın satırına dokunmaz."""
    own = {}
    for name, ids in (copied or {}).items():
        if not isinstance(ids, (list, tuple)) or not ids:
            continue
        own[name] = [str(item) for item in ids if item]
        if not own[name]:
            continue
        coll = _open(db, mode, company_id, name, company)
        await _delete_ids(coll, company_id, own[name])
    if mode == storage_router.SHARED_V2 and own:
        _delete_unique_ids(company_id, own)


async def _sync_catalog_company(db, company_id: str, doc: dict) -> None:
    """Katalog şirket satırının kontrol alanlarını koruyarak profili eşitler."""
    body = _prepare(doc or {"_id": company_id}, company_id, "companies")
    current = await _company(db, company_id) or {}
    for field in _control_fields():
        if field in current:
            body[field] = current[field]
    body["_id"] = company_id
    with storage_router.bypass_write_lock(company_id):
        await db.companies.delete_one({"_id": company_id})
        await db.companies.insert_one(body)


class _Pace:
    """Kalp atışı ve ilerleme yazısını zamana yayar."""

    def __init__(self):
        self.beat = 0.0
        self.saved = 0.0


def _summary(progress: dict) -> dict:
    return {name: dict(spec) for name, spec in (progress or {}).items()}


def _mark_progress(progress, name, copied, batches) -> None:
    progress[name] = {
        "wipe": "company",
        "count": len(copied.get(name) or []),
        "batches": int(batches.get(name) or 0),
    }


async def _remember_progress(db, company_id, move_id, progress, pace, *, force: bool = False) -> None:
    """Aralık özeti. Kimlik listesi satır satır yazılmaz."""
    if not move_id:
        return
    now = time.monotonic()
    if not force and pace.saved and now - pace.saved < _PROGRESS_GAP:
        return
    await _patch_move(db, company_id, move_id, {"copied": _summary(progress)})
    pace.saved = time.monotonic()


async def _beat_due(db, company_id, move_id, lost, pace) -> None:
    """Kalp atışı en fazla 5 sn'de bir. Kayıp kilit hemen durdurur."""
    if lost:
        raise lost[0]
    if not move_id:
        return
    now = time.monotonic()
    if pace.beat and now - pace.beat < _BEAT_GAP:
        return
    await _beat(db, company_id, move_id, lost)
    pace.beat = time.monotonic()


def _sql_delta_ok(name: str) -> bool:
    return _kind(name) not in ("company", "membership", "platform", "token")


def _open_catalog_reader(db):
    """Katalog okuması için kısa ömürlü bağlantı. Havuzun izolasyonu değişmez."""
    import pymysql

    settings = dict(getattr(db, "_settings", None) or {})
    conn = pymysql.connect(
        host=str(settings.get("host") or "127.0.0.1"),
        port=int(settings.get("port") or 3306),
        user=str(settings.get("user") or ""),
        password=str(settings.get("password") or ""),
        database=str(settings.get("db") or ""),
        charset="utf8mb4",
        autocommit=False,
        connect_timeout=5,
    )
    try:
        _prepare_private_mysql(conn)
    except Exception:
        try:
            conn.close()
        except Exception:
            pass
        raise
    return conn


def _ensure_move_index(conn) -> None:
    cursor = conn.cursor()
    try:
        cursor.execute(
            f"CREATE INDEX {_MOVE_INDEX} ON docs (collection, company_id, updated_at)"
        )
        conn.commit()
    except Exception:
        try:
            conn.rollback()
        except Exception:
            pass


async def _watermark(db):
    """Legacy SQL saati. Yoksa ön kopya tam farkla kapanır."""
    if not _sql_catalog(db):
        return None
    conn = None
    try:
        await db._ensure()
        conn = _open_catalog_reader(db)
        _ensure_move_index(conn)
        cursor = conn.cursor()
        cursor.execute("SELECT NOW(6)")
        row = cursor.fetchone()
        conn.commit()
        return row[0] if row else None
    except Exception:
        return None
    finally:
        if conn is not None:
            try:
                conn.close()
            except Exception:
                pass


def _query_changed(conn, collection: str, company_id: str, since) -> list:
    from mysql_store import loads

    cursor = conn.cursor()
    cursor.execute(_CHANGED_SQL, (collection, company_id, since))
    found = []
    for row in cursor.fetchall():
        doc = loads(row[0])
        if isinstance(doc, dict):
            found.append(doc)
    conn.commit()
    return found


def _tombstones_since(conn, company_id: str, since, ignore) -> dict:
    """Koleksiyon başına silinen kimlikler. Aralık updated_at indeksini kullanır."""
    skip = _ignore_set(ignore)
    grouped: dict = {}
    for doc in _query_changed(conn, "sync_tombstones", company_id, since):
        if str(doc.get("move_id") or "") in skip:
            continue
        coll_name = str(doc.get("collection") or "")
        doc_id = str(doc.get("doc_id") or "")
        if not coll_name or not doc_id:
            continue
        bucket = grouped.setdefault(coll_name, [])
        if doc_id not in bucket:
            bucket.append(doc_id)
    return grouped


async def _hook_precopy(on_precopy) -> None:
    if on_precopy is None:
        return
    result = on_precopy()
    if inspect.isawaitable(result):
        await result


def _span(mark) -> int:
    if mark is None:
        return 0
    return int((time.monotonic() - mark) * 1000)


async def _put_docs(coll, company_id: str, docs, copied, name: str) -> None:
    have = set(copied.get(name) or [])
    fresh = []
    existing = []
    for doc in docs:
        ident = str(doc.get("_id") or "")
        if not ident:
            continue
        if ident in have:
            existing.append(doc)
        else:
            fresh.append(doc)
    if fresh:
        ids = await _insert_docs(coll, company_id, fresh)
        copied.setdefault(name, []).extend(ids)
    if existing:
        await _replace_docs(coll, company_id, existing)


async def _drop_docs(coll, company_id: str, name: str, ids, target: str, source: str) -> None:
    pending = [str(item) for item in ids if item]
    if not pending:
        return
    await _delete_ids(coll, company_id, pending)
    if target == storage_router.SHARED_V2 or source == storage_router.SHARED_V2:
        _delete_unique_ids(company_id, {name: pending})


async def _apply_sql_delta(conn, tombs, db, company, company_id, source, target, name, copied, watermark, ignore) -> None:
    live = _query_changed(conn, name, company_id, watermark)
    live = _without_mover(name, live, ignore)
    pending = [
        doc for doc in live
        if isinstance(doc, dict) and doc.get("_id") and _belongs(doc, name, company_id)
    ]
    prepared = await _prepare_docs(pending, company_id, name)
    live_ids = {str(doc["_id"]) for doc in prepared}
    drop = [doc_id for doc_id in tombs.get(name) or [] if doc_id not in live_ids]
    coll = _open(db, target, company_id, name, company)
    if drop:
        await _drop_docs(coll, company_id, name, drop, target, source)
    if prepared:
        await _put_docs(coll, company_id, prepared, copied, name)


def _diff_rows_sync(source_rows, target_rows):
    source_by = {str(doc["_id"]): doc for doc in source_rows}
    target_by = {str(doc["_id"]): doc for doc in target_rows}
    changed = []
    for ident, doc in source_by.items():
        old = target_by.get(ident)
        if old is None or _freeze(old) != _freeze(doc):
            changed.append(doc)
    missing = [ident for ident in target_by if ident not in source_by]
    return changed, missing


async def _diff_rows(source_rows, target_rows):
    if len(source_rows) + len(target_rows) < _PREPARE_OFFLOAD_AT:
        return _diff_rows_sync(source_rows, target_rows)
    import platform_lease

    return await platform_lease.call_blocking(_diff_rows_sync, source_rows, target_rows)


async def _apply_full_diff(db, company, company_id, source, target, name, copied, ignore) -> None:
    fresh_source = await _read(db, source, company_id, name, company, ignore)
    fresh_target = await _read(db, target, company_id, name, company, ignore)
    source_rows = await _prepare_docs(fresh_source, company_id, name)
    target_rows = await _prepare_docs(fresh_target, company_id, name)
    changed, missing = await _diff_rows(source_rows, target_rows)
    coll = _open(db, target, company_id, name, company)
    if missing:
        await _drop_docs(coll, company_id, name, missing, target, source)
    if changed:
        await _put_docs(coll, company_id, changed, copied, name)


def _store_verified(name, source_rows, target_rows, target, counts, checksums, collections, steps) -> None:
    # Sağlama _digest üzerinden gider. Uyuşmazlık geri almayı bu çağrı tetikler.
    source_sum = _digest(source_rows)
    target_sum = _digest(target_rows)
    if len(source_rows) != len(target_rows) or source_sum != target_sum:
        raise MoveError("sağlama uyuşmadı")
    counts[name] = {"source": len(source_rows), "target": len(target_rows)}
    checksums[name] = {"source": source_sum, "target": target_sum}
    collections.append({
        "name": name,
        "count": len(source_rows),
        "bytes": _bytes(source_rows),
        "target": _target_table(target, name),
        "target_count": len(target_rows),
    })
    steps.append({"name": f"kopyala:{name}", "status": "tamam", "count": len(source_rows)})
    steps.append({"name": f"sağlama:{name}", "status": "tamam"})


async def _verify_stored(name, source_rows, target_rows, target, counts, checksums, collections, steps) -> None:
    heavy = len(source_rows) >= _PREPARE_OFFLOAD_AT or len(target_rows) >= _PREPARE_OFFLOAD_AT
    if not heavy:
        _store_verified(name, source_rows, target_rows, target, counts, checksums, collections, steps)
        return
    import platform_lease

    await platform_lease.call_blocking(
        _store_verified, name, source_rows, target_rows, target, counts, checksums, collections, steps,
    )


async def _precopy(db, company, company_id, source, target, copied, progress, batches, *, batch_size, move_id, lost, pace) -> list:
    """Yazma kilidi yokken kaynak anlık görüntüsünü hedefe alır."""
    names = await _names(db, source, company_id, company, target, (move_id,))
    mirrored = set()
    for name in names:
        await _beat_due(db, company_id, move_id, lost, pace)
        if name == "companies" and target == storage_router.LEGACY:
            continue
        docs = await _read(db, source, company_id, name, company, (move_id,))
        prepared = await _prepare_docs(docs, company_id, name)
        doc_errors, doc_conflicts = _check_docs(name, prepared, company_id)
        if doc_errors or doc_conflicts:
            raise MoveError("Kaynak doğrulanamadı.")
        existing = await _read(db, target, company_id, name, company, (move_id,))
        if existing:
            raise MoveError(f"{name}: hedefte kayıt var")
        if not prepared:
            continue
        coll = _open(db, target, company_id, name, company)
        if target == storage_router.SHARED_V2 and name not in mirrored:
            await _mirror_uniques(db, source, name, coll)
            mirrored.add(name)
        copied[name] = []
        batches[name] = 0
        _mark_progress(progress, name, copied, batches)
        await _remember_progress(db, company_id, move_id, progress, pace, force=True)
        for batch in _chunks(prepared, batch_size):
            await _beat_due(db, company_id, move_id, lost, pace)
            ids = await _insert_docs(coll, company_id, batch)
            copied[name].extend(ids)
            batches[name] += 1
            _mark_progress(progress, name, copied, batches)
            await _remember_progress(db, company_id, move_id, progress, pace)
        await _remember_progress(db, company_id, move_id, progress, pace, force=True)
    return names


async def _catch_up(db, company, company_id, source, target, copied, progress, batches, names, *, watermark, on_batch, move_id, lost, pace):
    """Kilit altında son fark ve sağlama. on_batch bu aşamada çalışır."""
    ignore = (move_id,)
    live_names = await _names(db, source, company_id, company, target, ignore)
    live_set = set(live_names)
    ordered = list(names)
    for name in live_names:
        if name not in ordered:
            ordered.append(name)
    reader = None
    sql_ok = watermark is not None and source == storage_router.LEGACY and _sql_catalog(db)
    if sql_ok:
        try:
            reader = _open_catalog_reader(db)
        except Exception:
            sql_ok = False
    tombs = {}
    if reader is not None:
        try:
            tombs = _tombstones_since(reader, company_id, watermark, ignore)
        except Exception:
            try:
                reader.close()
            except Exception:
                pass
            reader = None
            sql_ok = False
            tombs = {}
    counts = {}
    checksums = {}
    steps = [
        {"name": "kilitle", "status": "tamam"},
        {"name": "bekle:kilit", "status": "tamam"},
        {"name": "on-kopya", "status": "tamam"},
    ]
    collections = []
    unique_parts = []
    saw_sql = False
    mirrored = set(copied)
    try:
        for name in ordered:
            await _beat_due(db, company_id, move_id, lost, pace)
            await _hook(on_batch, name, len(copied.get(name) or []))
            await _beat(db, company_id, move_id, lost)
            pace.beat = time.monotonic()
            if name == "companies" and target == storage_router.LEGACY:
                docs = await _read(db, source, company_id, name, company, ignore)
                prepared = await _prepare_docs(docs, company_id, name)
                await _sync_catalog_company(db, company_id, prepared[0] if prepared else {})
                loaded = await _read(db, target, company_id, name, company, ignore)
                fresh_source = await _read(db, source, company_id, name, company, ignore)
                source_rows = await _prepare_docs(fresh_source, company_id, name)
                target_rows = await _prepare_docs(loaded, company_id, name)
                await _verify_stored(name, source_rows, target_rows, target, counts, checksums, collections, steps)
                continue
            coll = _open(db, target, company_id, name, company)
            if target == storage_router.SHARED_V2 and name not in mirrored:
                await _mirror_uniques(db, source, name, coll)
                mirrored.add(name)
            if reader is not None and _sql_delta_ok(name):
                await _apply_sql_delta(
                    reader, tombs, db, company, company_id, source, target, name, copied, watermark, ignore,
                )
                saw_sql = True
            else:
                await _apply_full_diff(db, company, company_id, source, target, name, copied, ignore)
            if copied.get(name) or progress.get(name):
                _mark_progress(progress, name, copied, batches)
                await _remember_progress(db, company_id, move_id, progress, pace, force=True)
            fresh_source = await _read(db, source, company_id, name, company, ignore)
            fresh_target = await _read(db, target, company_id, name, company, ignore)
            source_rows = await _prepare_docs(fresh_source, company_id, name)
            target_rows = await _prepare_docs(fresh_target, company_id, name)
            if not source_rows and not target_rows and name not in live_set:
                continue
            await _verify_stored(name, source_rows, target_rows, target, counts, checksums, collections, steps)
            if target == storage_router.SHARED_V2 or source == storage_router.SHARED_V2:
                side = coll if target == storage_router.SHARED_V2 else _open(db, source, company_id, name, company)
                rows = target_rows if target == storage_router.SHARED_V2 else source_rows
                digest, count = _ensure_unique(company_id, name, side, rows)
                if count:
                    unique_parts.append((name, digest, count))
        steps.append({"name": "fark", "status": "tamam", "yontem": "tombstone" if saw_sql else "tam"})
        if unique_parts:
            body = "\n".join(f"{item}|{digest}|{count}" for item, digest, count in unique_parts)
            total = sum(count for _item, _digest, count in unique_parts)
            checksums["t_row_unique"] = {
                "source": hashlib.sha256(body.encode("utf-8")).hexdigest(),
                "target": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            }
            counts["t_row_unique"] = {"source": total, "target": total}
            steps.append({"name": "sağlama:t_row_unique", "status": "tamam", "count": total})
        return counts, checksums, steps, collections
    finally:
        if reader is not None:
            try:
                reader.close()
            except Exception:
                pass


async def _foreign_lock(db, company_id: str, move_id: str) -> bool:
    rows = await _lock_docs(db, company_id)
    return any(str(row.get("move_id") or "") != move_id for row in rows)


async def _lock_docs(db, company_id: str) -> list:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        return await _collect(db[LOCKS].find({"_id": company_id}))


async def _release_lock(db, company_id: str, move_id: str) -> None:
    from mysql_store import tag_tombstone
    from tenant_scope import unscoped

    with tag_tombstone(move_id):
        with unscoped("depolama taşıma kilidi"):
            with storage_router.bypass_write_lock(company_id):
                await db[LOCKS].delete_one({"_id": company_id, "move_id": move_id})


async def _takeover_lock(db, company_id: str, old: dict, body: dict) -> None:
    from tenant_scope import unscoped

    fields = {key: value for key, value in body.items() if key != "_id"}
    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            updated = await db[LOCKS].find_one_and_update(
                {
                    "_id": company_id,
                    "move_id": old.get("move_id"),
                    "heartbeat_at": old.get("heartbeat_at"),
                },
                {"$set": fields},
            )
    if not isinstance(updated, dict) or updated.get("move_id") != body["move_id"]:
        raise storage_router.StorageMoveBusy("Bu şirketin taşıması sürüyor.")


async def _acquire_lock(db, company_id: str, move_id: str, target: str) -> None:
    """Şirket başına tek running satır. Başka şirketleri bekletmez."""
    body = {
        "_id": company_id,
        "company_id": company_id,
        "move_id": move_id,
        "status": "running",
        "heartbeat_at": _now(),
        "owner_pid": os.getpid(),
        "owner_host": _owner_host(),
        "from_mode": "",
        "to_mode": target,
        "collections": [],
    }
    rows = await _lock_docs(db, company_id)
    if any(row.get("move_id") != move_id and not _lock_stale(row) for row in rows):
        raise storage_router.StorageMoveBusy("Bu şirketin taşıması sürüyor.")
    if any(row.get("move_id") == move_id for row in rows):
        return
    stale = [row for row in rows if _lock_stale(row)]
    if stale:
        await _takeover_lock(db, company_id, stale[0], body)
        return
    from tenant_scope import unscoped

    try:
        with unscoped("depolama taşıma kilidi"):
            with storage_router.bypass_write_lock(company_id):
                await db[LOCKS].insert_one(dict(body))
    except Exception as exc:
        if not _is_duplicate(exc):
            raise MoveError(_safe(exc)) from None
        rows = await _lock_docs(db, company_id)
        if any(row.get("move_id") == move_id for row in rows):
            return
        if any(not _lock_stale(row) for row in rows):
            raise storage_router.StorageMoveBusy("Bu şirketin taşıması sürüyor.")
        if rows:
            await _takeover_lock(db, company_id, rows[0], body)
            return
        raise storage_router.StorageMoveBusy("Bu şirketin taşıması sürüyor.")
    rows = await _lock_docs(db, company_id)
    ranked = sorted(rows, key=lambda row: (str(row.get("heartbeat_at") or ""), str(row.get("move_id") or "")))
    winner = ranked[0] if ranked else None
    if winner is None or winner.get("move_id") != move_id:
        await _release_lock(db, company_id, move_id)
        raise storage_router.StorageMoveBusy("Bu şirketin taşıması sürüyor.")


def _sql_catalog(db) -> bool:
    return hasattr(db, "_ensure") and isinstance(getattr(db, "_settings", None), dict)


def _matched(result) -> int:
    matched = getattr(result, "matched_count", None)
    if matched is None:
        matched = getattr(result, "modified_count", 0)
    try:
        return int(matched or 0)
    except (TypeError, ValueError):
        return 0


async def _remember_plan(db, company_id: str, move_id: str, source: str, names: list) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            result = await db[LOCKS].update_one(
                {"_id": company_id, "move_id": move_id},
                {"$set": {"from_mode": source, "collections": list(names), "heartbeat_at": _now()}},
            )
    if _matched(result) != 1:
        raise LockLost("Taşıma kilidi kayboldu.")


async def _beat(db, company_id: str, move_id: str, lost=None) -> None:
    """0 satır: kilit artık bu move_id'de değil. Taşıyıcı hemen durur."""
    if not move_id:
        return
    if lost:
        raise lost[0]
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            result = await db[LOCKS].update_one(
                {"_id": company_id, "move_id": move_id},
                {"$set": {
                    "heartbeat_at": _now(),
                    "owner_pid": os.getpid(),
                    "owner_host": _owner_host(),
                }},
            )
    if _matched(result) != 1:
        exc = LockLost("Taşıma kilidi kayboldu.")
        if isinstance(lost, list) and not lost:
            lost.append(exc)
        raise exc


async def _commit_owner(db, company_id: str, move_id: str, *, mode: str | None = None, unlock: bool = False) -> bool:
    """Kip ve katalog kilidi tek işlem. Kilit satırı bu move_id değilse hiçbir şey yazılmaz."""
    if _sql_catalog(db):
        ok = await _commit_owner_sql(db, company_id, move_id, mode=mode, unlock=unlock)
    else:
        ok = await _commit_owner_memory(db, company_id, move_id, mode=mode, unlock=unlock)
    if not ok:
        return False
    if mode is not None or unlock:
        storage_router.forget_mode(company_id)
    if unlock:
        storage_router.note_write_lock(company_id, False)
    return True


async def _commit_owner_memory(db, company_id: str, move_id: str, *, mode: str | None, unlock: bool) -> bool:
    from tenant_scope import unscoped

    async with _OWNER_MEMORY:
        return await _commit_owner_memory_locked(db, company_id, move_id, mode=mode, unlock=unlock)


async def _commit_owner_memory_locked(db, company_id: str, move_id: str, *, mode: str | None, unlock: bool) -> bool:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            result = await db[LOCKS].update_one(
                {"_id": company_id, "move_id": move_id},
                {"$set": {
                    "heartbeat_at": _now(),
                    "owner_pid": os.getpid(),
                    "owner_host": _owner_host(),
                }},
            )
    if _matched(result) != 1:
        return False
    if mode is None and not unlock:
        return True
    fields = {}
    update: dict = {"$set": fields}
    if mode is not None:
        fields[storage_router.MODE_FIELD] = mode
        update["$inc"] = {storage_router.EPOCH_FIELD: 1}
    if unlock:
        fields[storage_router.WRITE_LOCK_FIELD] = False
    with storage_router.bypass_write_lock(company_id):
        await db.companies.update_one({"_id": company_id}, update)
    return True


async def _commit_owner_sql(db, company_id: str, move_id: str, *, mode: str | None, unlock: bool) -> bool:
    """SELECT … FOR UPDATE, WHERE move_id, etkilenen satır 1. Değilse geri alınır."""
    from mysql_store import dumps, loads

    await db._ensure()
    async with db._pool.acquire() as conn:
        await conn.begin()
        try:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT doc FROM docs WHERE collection=%s AND id=%s FOR UPDATE",
                    (LOCKS, company_id),
                )
                row = await cur.fetchone()
                if not row:
                    await conn.rollback()
                    return False
                lock_doc = loads(row[0])
                if str(lock_doc.get("move_id") or "") != move_id:
                    await conn.rollback()
                    return False
                lock_doc["heartbeat_at"] = _now()
                lock_doc["owner_pid"] = os.getpid()
                lock_doc["owner_host"] = _owner_host()
                await cur.execute(
                    "UPDATE docs SET doc=%s WHERE collection=%s AND id=%s "
                    "AND JSON_UNQUOTE(JSON_EXTRACT(doc, '$.move_id'))=%s",
                    (dumps(lock_doc), LOCKS, company_id, move_id),
                )
                if cur.rowcount != 1:
                    await conn.rollback()
                    return False
                if mode is not None or unlock:
                    await cur.execute(
                        "SELECT doc FROM docs WHERE collection=%s AND id=%s FOR UPDATE",
                        ("companies", company_id),
                    )
                    company_row = await cur.fetchone()
                    if not company_row:
                        await conn.rollback()
                        return False
                    company = loads(company_row[0])
                    if mode is not None:
                        company[storage_router.MODE_FIELD] = mode
                        try:
                            company[storage_router.EPOCH_FIELD] = int(company.get(storage_router.EPOCH_FIELD) or 0) + 1
                        except (TypeError, ValueError):
                            company[storage_router.EPOCH_FIELD] = 1
                    if unlock:
                        company[storage_router.WRITE_LOCK_FIELD] = False
                    await cur.execute(
                        "UPDATE docs SET doc=%s WHERE collection=%s AND id=%s",
                        (dumps(company), "companies", company_id),
                    )
                    if cur.rowcount != 1:
                        await cur.execute(
                            "SELECT doc FROM docs WHERE collection=%s AND id=%s",
                            ("companies", company_id),
                        )
                        check_row = await cur.fetchone()
                        check = loads(check_row[0]) if check_row else {}
                        mode_ok = mode is None or storage_router.normalize_mode(check.get(storage_router.MODE_FIELD)) == storage_router.normalize_mode(mode)
                        lock_ok = (not unlock) or not bool(check.get(storage_router.WRITE_LOCK_FIELD))
                        if not mode_ok or not lock_ok:
                            await conn.rollback()
                            return False
            await conn.commit()
            return True
        except Exception:
            try:
                await conn.rollback()
            except Exception:
                pass
            raise


async def _clear_flag(db, company_id: str) -> None:
    try:
        await _flag(db, company_id, False)
        storage_router.note_write_lock(company_id, False)
    except Exception:
        _logger().info("taşıma company=%s durum=kilit", storage_router._safe_company(company_id))


async def apply_move(db, company_id: str, to_mode: str, *, batch_size: int = BATCH, on_batch=None, on_precopy=None) -> MoveReport:
    """Ön kopya kilit dışında, son fark ve sağlama kilit altında. Kaynak silinmez."""
    cid = str(company_id or "").strip()
    mode = storage_router.normalize_mode(to_mode)
    if not storage_router.enabled():
        return _empty(cid, mode, "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    if not cid:
        return _empty(cid, mode, "company_id boş", dry_run=False)
    held = False
    opened = False
    lost = False
    committed = False
    pulse = None
    lost_box: list = []
    started = time.monotonic()
    lock_mark = None
    move_id = uuid.uuid4().hex
    copied: dict = {}
    progress: dict = {}
    batches: dict = {}
    pace = _Pace()
    company = None
    source = ""
    mover_io = None
    try:
        await _acquire_lock(db, cid, move_id, mode)
        held = True
        company = await _company(db, cid)
        if company:
            mover_io = _mover_io(cid, company, mode)
            try:
                mover_io.__enter__()
            except MoveError as exc:
                return _empty(cid, mode, str(exc), dry_run=False)
        report = await _inspect(db, company, cid, mode, (move_id,))
        report.dry_run = False
        report.move_id = move_id
        if not report.ok:
            return report
        source = report.from_mode
        names = [row.get("name") for row in report.collections if row.get("name")]
        await _remember_plan(db, cid, move_id, source, names)
        watermark = await _watermark(db)
        await _save_move(db, cid, {
            "_id": move_id,
            "company_id": cid,
            "from_mode": source,
            "to_mode": mode,
            "status": "running",
            "steps": [{"name": "on-kopya", "status": "basladi"}],
            "counts": {},
            "checksums": {},
            "collections": names,
            "copied": {},
            "started_at": _now(),
            "finished_at": "",
            "duration_ms": 0,
            "error": "",
        })
        pulse = asyncio.create_task(_pulse(db, cid, move_id, lost_box))
        try:
            await _precopy(
                db, company, cid, source, mode, copied, progress, batches,
                batch_size=batch_size, move_id=move_id, lost=lost_box, pace=pace,
            )
            await _hook_precopy(on_precopy)
            await _flag(db, cid, True)
            storage_router.note_write_lock(cid, True)
            opened = True
            lock_mark = time.monotonic()
            await _sleep_lock(db, cid, move_id, lost_box)
            counts, checksums, steps, collections = await _catch_up(
                db, company, cid, source, mode, copied, progress, batches, names,
                watermark=watermark, on_batch=on_batch, move_id=move_id, lost=lost_box, pace=pace,
            )
            await _sleep_mode(db, cid, move_id, lost_box)
            # Doğrulama temiz. Kilit açık kalır; süper yönetici kapatır.
            if not await _commit_owner(db, cid, move_id, mode=mode, unlock=False):
                raise LockLost("Taşıma kilidi kayboldu.")
            committed = True
            opened = False
            storage_router.note_write_lock(cid, True)
        except LockLost as exc:
            lost = True
            if not await _foreign_lock(db, cid, move_id):
                await _clear_flag(db, cid)
                opened = False
                lost = False
            if not committed:
                await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            return MoveReport(
                ok=False, wrote=False, dry_run=False, move_id=move_id, company_id=cid,
                from_mode=source, to_mode=mode, status="failed", errors=[_safe(exc)],
                duration_ms=_elapsed(started), locked_ms=_span(lock_mark),
            )
        except Exception as exc:
            if not committed:
                await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            return MoveReport(
                ok=False, wrote=False, dry_run=False, move_id=move_id, company_id=cid,
                from_mode=source, to_mode=mode, status="failed", errors=[_safe(exc)],
                duration_ms=_elapsed(started), locked_ms=_span(lock_mark),
            )
        steps.append({"name": "kip", "status": "tamam"})
        steps.append({"name": "bekle:kip", "status": "tamam"})
        duration = _elapsed(started)
        locked_ms = _span(lock_mark)
        await _patch_move(db, cid, move_id, {
            "status": "completed",
            "steps": steps,
            "counts": counts,
            "checksums": checksums,
            "copied": _summary(progress),
            "finished_at": _now(),
            "duration_ms": duration,
            "error": "",
        })
        try:
            await _sleep_lock(db, cid, move_id, lost_box)
        except LockLost:
            pass
        _logger().info("taşıma company=%s durum=completed", storage_router._safe_company(cid))
        return MoveReport(
            ok=True, wrote=True, dry_run=False, move_id=move_id, company_id=cid,
            from_mode=source, to_mode=mode, status="completed", collections=collections,
            counts=counts, checksums=checksums, steps=steps, duration_ms=duration,
            locked_ms=locked_ms,
        )
    except LockLost as exc:
        lost = True
        if cid and not await _foreign_lock(db, cid, move_id):
            try:
                await _clear_flag(db, cid)
            except Exception:
                pass
            opened = False
            lost = False
        return MoveReport(
            ok=False, wrote=False, dry_run=False, move_id=move_id, company_id=cid,
            from_mode=source, to_mode=mode, status="failed", errors=[_safe(exc)],
            duration_ms=_elapsed(started), locked_ms=_span(lock_mark),
        )
    finally:
        await _stop_pulse(pulse)
        if mover_io is not None:
            mover_io.__exit__(None, None, None)
            mover_io = None
        if opened and not lost and not committed:
            try:
                if await _commit_owner(db, cid, move_id, unlock=True):
                    try:
                        await _sleep_lock(db, cid, move_id, lost_box)
                    except LockLost:
                        pass
            except Exception:
                _logger().info("taşıma company=%s durum=kilit", storage_router._safe_company(cid))
        if held:
            try:
                await _release_lock(db, cid, move_id)
            except Exception:
                _logger().info("taşıma company=%s durum=kilit-satiri", storage_router._safe_company(cid))


async def _running_move(db, company_id: str):
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kaydı"):
        cursor = db.storage_moves.find({"status": "running"})
        rows = await _collect(cursor)
    for row in rows:
        if str(row.get("company_id") or "") == company_id or row.get("status") == "running":
            return row
    return None


def _elapsed(started: float) -> int:
    return int((time.monotonic() - started) * 1000)


async def _fail_copy(db, company, company_id: str, mode: str, move_id: str, copied: dict, exc, started: float) -> None:
    try:
        await _wipe(db, company, company_id, mode, copied)
    except Exception as wipe_exc:
        _logger().info(
            "taşıma company=%s durum=temizlik error=%s",
            storage_router._safe_company(company_id),
            _safe(wipe_exc),
        )
    if not move_id:
        return
    try:
        await _patch_move(db, company_id, move_id, {
            "status": "failed",
            "finished_at": _now(),
            "duration_ms": _elapsed(started),
            "error": _safe(exc),
        })
    except Exception:
        _logger().info(
            "taşıma company=%s durum=kayit",
            storage_router._safe_company(company_id),
        )


async def _source_intact(db, company, company_id: str, mode: str, counts: dict, route_mode: str = "", ignore_moves=()) -> bool:
    try:
        live = await _names(db, mode, company_id, company, route_mode, ignore_moves)
    except Exception:
        return False
    recorded = sorted(key for key in (counts or []) if key != "t_row_unique")
    if sorted(live) != recorded:
        return False
    for name in recorded:
        docs = await _read(db, mode, company_id, name, company, ignore_moves)
        expected = int((counts.get(name) or {}).get("source") or 0)
        if len(docs) != expected:
            return False
    return True


async def _restore(db, company, company_id: str, mode: str, journal: list) -> None:
    for name, doc_id, previous, action in reversed(journal):
        coll = _open(db, mode, company_id, name, company)
        with storage_router.bypass_write_lock(company_id):
            if action in ("insert", "replace"):
                await coll.delete_one({"_id": doc_id, "company_id": company_id})
            if action in ("delete", "replace") and previous is not None:
                await coll.insert_one(_prepare(previous, company_id, name))


async def _reverse(db, company, company_id: str, source_mode: str, current_mode: str, *, batch_size: int, on_batch, move_id: str = "", lost=None, ignore_moves=()):
    """Güncel kipi eski kipe eşitler. Güncel taraftaki veri silinmez."""
    skip = ignore_moves or ((move_id,) if move_id else ())
    current_names = await _names(db, current_mode, company_id, company, current_mode, skip)
    source_names = await _names(db, source_mode, company_id, company, current_mode, skip)
    names = sorted(set(current_names) | set(source_names))
    if "companies" in names:
        names = [item for item in names if item != "companies"] + ["companies"]
    journal = []
    checksums = {}
    counts = {}
    steps = [{"name": "kilitle", "status": "tamam"}]
    collections = []
    pace = _Pace()
    for name in names:
        await _beat_due(db, company_id, move_id, lost, pace)
        current_docs = await _read(db, current_mode, company_id, name, company, skip)
        previous_docs = await _read(db, source_mode, company_id, name, company, skip)
        current_prepared = await _prepare_docs(current_docs, company_id, name)
        previous_by_id = {str(doc.get("_id")): doc for doc in previous_docs if doc.get("_id")}
        current_by_id = {str(doc.get("_id")): doc for doc in current_prepared}
        if name == "companies" and source_mode == storage_router.LEGACY:
            await _sync_catalog_company(db, company_id, current_prepared[0] if current_prepared else {})
            loaded = await _read(db, source_mode, company_id, name, company, skip)
            fresh = await _read(db, current_mode, company_id, name, company, skip)
            left = _digest([_prepare(doc, company_id, name) for doc in loaded])
            right = _digest([_prepare(doc, company_id, name) for doc in fresh])
            if left != right:
                raise MoveError("sağlama uyuşmadı")
            counts[name] = {"source": len(loaded), "target": len(fresh)}
            checksums[name] = {"source": left, "target": right}
            collections.append({
                "name": name,
                "count": len(fresh),
                "bytes": _bytes([_prepare(doc, company_id, name) for doc in fresh]),
                "target": _target_table(source_mode, name),
                "target_count": len(loaded),
            })
            steps.append({"name": f"geri:{name}", "status": "tamam", "count": len(fresh)})
            continue
        coll = _open(db, source_mode, company_id, name, company)
        pending = []
        for doc_id, doc in current_by_id.items():
            old = previous_by_id.get(doc_id)
            if old is not None and _freeze(_prepare(old, company_id, name)) == _freeze(doc):
                continue
            action = "replace" if old is not None else "insert"
            pending.append((doc_id, doc, copy.deepcopy(old) if old is not None else None, action))
        for doc_id, old in previous_by_id.items():
            if doc_id not in current_by_id:
                pending.append((doc_id, None, copy.deepcopy(old), "delete"))
        written = 0
        for batch in _chunks(pending, batch_size):
            await _beat_due(db, company_id, move_id, lost, pace)
            for doc_id, doc, old, action in batch:
                journal.append((name, doc_id, old, action))
                with storage_router.bypass_write_lock(company_id):
                    if action in ("replace", "delete"):
                        await coll.delete_one({"_id": doc_id, "company_id": company_id})
                    if doc is not None:
                        await coll.insert_one(doc)
                written += 1
            if pending:
                await _hook(on_batch, name, written)
                await _beat(db, company_id, move_id, lost)
                pace.beat = time.monotonic()
        loaded = await _read(db, source_mode, company_id, name, company, skip)
        fresh = await _read(db, current_mode, company_id, name, company, skip)
        left = _digest([_prepare(doc, company_id, name) for doc in loaded])
        right = _digest([_prepare(doc, company_id, name) for doc in fresh])
        if len(loaded) != len(fresh) or left != right:
            raise MoveError("sağlama uyuşmadı")
        counts[name] = {"source": len(loaded), "target": len(fresh)}
        checksums[name] = {"source": left, "target": right}
        collections.append({
            "name": name,
            "count": len(fresh),
            "bytes": _bytes([_prepare(doc, company_id, name) for doc in fresh]),
            "target": _target_table(source_mode, name),
            "target_count": len(loaded),
        })
        steps.append({"name": f"geri:{name}", "status": "tamam", "count": len(fresh)})
        steps.append({"name": f"sağlama:{name}", "status": "tamam"})
    return journal, counts, checksums, steps, collections


async def rollback_move(db, move_id: str, *, batch_size: int = BATCH, on_batch=None) -> MoveReport:
    """Tamamlanmış taşımayı, kaynak duruyorsa eski kipe döndürür."""
    mid = str(move_id or "").strip()
    if not storage_router.enabled():
        return _empty("", "", "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    record = await _load_move(db, mid) if mid else None
    if not record:
        return _empty("", "", "Taşıma kaydı yok.", dry_run=False)
    cid = str(record.get("company_id") or "")
    source = storage_router.normalize_mode(record.get("from_mode"))
    current = storage_router.normalize_mode(record.get("to_mode"))
    if record.get("status") != "completed":
        report = _empty(cid, source, "Yalnız tamamlanmış taşıma geri alınır.", dry_run=False)
        report.move_id = mid
        report.from_mode = source
        return report
    held = False
    opened = False
    lost = False
    committed = False
    pulse = None
    lost_box: list = []
    started = time.monotonic()
    journal: list = []
    company = None
    rollback_id = uuid.uuid4().hex
    mover_io = None
    try:
        await _acquire_lock(db, cid, rollback_id, source)
        held = True
        company = await _company(db, cid)
        if not company:
            return _empty(cid, source, "Şirket bulunamadı.", dry_run=False)
        live_mode = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
        if live_mode != current:
            report = _empty(cid, source, "Kip kayıtla uyuşmuyor.", dry_run=False)
            report.move_id = mid
            report.from_mode = current
            return report
        counts = record.get("counts") if isinstance(record.get("counts"), dict) else {}
        mover_io = _mover_io(cid, company, source, current)
        try:
            mover_io.__enter__()
        except MoveError as exc:
            return _empty(cid, source, str(exc), dry_run=False)
        if not await _source_intact(db, company, cid, source, counts, current, (mid, rollback_id)):
            report = _empty(cid, source, "Kaynak veri durmuyor.", dry_run=False)
            report.move_id = mid
            report.from_mode = current
            return report
        await _flag(db, cid, True)
        storage_router.note_write_lock(cid, True)
        opened = True
        await _sleep_lock(db, cid, rollback_id, lost_box)
        pulse = asyncio.create_task(_pulse(db, cid, rollback_id, lost_box))
        try:
            journal, new_counts, checksums, steps, collections = await _reverse(
                db, company, cid, source, current,
                batch_size=batch_size, on_batch=on_batch, move_id=rollback_id, lost=lost_box,
                ignore_moves=(mid, rollback_id),
            )
            await _sleep_mode(db, cid, rollback_id, lost_box)
            if not await _commit_owner(db, cid, rollback_id, mode=source, unlock=True):
                raise LockLost("Taşıma kilidi kayboldu.")
            committed = True
            opened = False
        except Exception as exc:
            if not committed:
                try:
                    await _restore(db, company, cid, source, journal)
                except Exception as restore_exc:
                    _logger().info(
                        "taşıma company=%s durum=geri-temizlik error=%s",
                        storage_router._safe_company(cid),
                        _safe(restore_exc),
                    )
            if isinstance(exc, LockLost):
                lost = True
                if not await _foreign_lock(db, cid, rollback_id):
                    await _clear_flag(db, cid)
                    opened = False
                    lost = False
            _logger().info(
                "taşıma company=%s durum=geri-failed error=%s",
                storage_router._safe_company(cid),
                _safe(exc),
            )
            return MoveReport(
                ok=False, wrote=False, dry_run=False, move_id=mid, company_id=cid,
                from_mode=current, to_mode=source, status="completed",
                errors=[_safe(exc)], duration_ms=_elapsed(started),
            )
        steps.append({"name": "kip", "status": "tamam"})
        steps.append({"name": "bekle:kip", "status": "tamam"})
        duration = _elapsed(started)
        previous_steps = list(record.get("steps") or [])
        await _patch_move(db, cid, mid, {
            "status": "rolled_back",
            "steps": previous_steps + steps,
            "checksums": checksums,
            "finished_at": _now(),
            "duration_ms": int(record.get("duration_ms") or 0) + duration,
            "error": "",
        })
        try:
            await _sleep_lock(db, cid, rollback_id, lost_box)
        except LockLost:
            pass
        _logger().info("taşıma company=%s durum=rolled_back", storage_router._safe_company(cid))
        return MoveReport(
            ok=True, wrote=True, dry_run=False, move_id=mid, company_id=cid,
            from_mode=current, to_mode=source, status="rolled_back",
            collections=collections, counts=new_counts, checksums=checksums,
            steps=steps, duration_ms=duration,
        )
    except LockLost as exc:
        lost = True
        if cid and not await _foreign_lock(db, cid, rollback_id):
            try:
                await _clear_flag(db, cid)
            except Exception:
                pass
            opened = False
            lost = False
        return MoveReport(
            ok=False, wrote=False, dry_run=False, move_id=mid, company_id=cid,
            from_mode=current, to_mode=source, status="completed",
            errors=[_safe(exc)], duration_ms=_elapsed(started),
        )
    finally:
        await _stop_pulse(pulse)
        if mover_io is not None:
            mover_io.__exit__(None, None, None)
            mover_io = None
        if opened and not lost and not committed:
            try:
                if await _commit_owner(db, cid, rollback_id, unlock=True):
                    try:
                        await _sleep_lock(db, cid, rollback_id, lost_box)
                    except LockLost:
                        pass
            except Exception:
                _logger().info("taşıma company=%s durum=kilit", storage_router._safe_company(cid))
        if held:
            try:
                await _release_lock(db, cid, rollback_id)
            except Exception:
                _logger().info("taşıma company=%s durum=kilit-satiri", storage_router._safe_company(cid))


async def _wipe_names(db, company, company_id: str, mode: str, names: list) -> None:
    copied = {}
    for name in names or []:
        if not name or name == "t_row_unique":
            continue
        docs = await _read(db, mode, company_id, name, company)
        copied[name] = [str(doc.get("_id")) for doc in docs if doc.get("_id")]
    await _wipe(db, company, company_id, mode, copied)
    if mode == storage_router.SHARED_V2 and copied:
        _delete_unique_ids(company_id, copied)


def _delete_unique_ids(company_id: str, copied: dict) -> None:
    import storage_tables

    store = storage_shared_v2.get_store()
    try:
        conn = store.connection()
    except Exception:
        return
    table = storage_tables.UNIQUE_TABLE
    for name, ids in copied.items():
        if not ids:
            continue
        marks = ",".join(["?"] * len(ids))
        sql = (
            f"DELETE FROM {table} WHERE company_id=? AND collection=? AND doc_id IN ({marks})"
        )
        adapted = sql.replace("?", "%s") if getattr(store, "dialect", "") == "mysql" else sql
        params = (company_id, name, *ids)
        try:
            if getattr(store, "dialect", "") == "mysql":
                with store.op_lock:
                    cur = conn.cursor()
                    cur.execute(adapted, params)
                    conn.commit()
            else:
                conn.execute(adapted, params)
        except Exception:
            return


async def _mark_abandoned(db, company_id: str, move_id: str, source: str) -> MoveReport:
    await _patch_move(db, company_id, move_id, {
        "status": "abandoned",
        "finished_at": _now(),
        "error": "",
    })
    _logger().info("taşıma company=%s durum=abandoned", storage_router._safe_company(company_id))
    return MoveReport(
        ok=True,
        wrote=False,
        dry_run=False,
        move_id=move_id,
        company_id=company_id,
        from_mode=source,
        to_mode=source,
        status="abandoned",
    )


async def recover_move(db, move_id: str) -> MoveReport:
    """Bayat kendi kilidini bırakır. Başka taşımanın kilidine ve hedefine dokunmaz."""
    mid = str(move_id or "").strip()
    if not storage_router.enabled():
        return _empty("", "", "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    record = await _load_move(db, mid) if mid else None
    if not record:
        return _empty("", "", "Taşıma kaydı yok.", dry_run=False)
    if record.get("status") in ("completed", "rolled_back", "recovered", "abandoned"):
        report = _empty("", "", "Bu taşıma kurtarılmaz.", dry_run=False)
        report.move_id = mid
        report.status = str(record.get("status") or "")
        return report
    cid = str(record.get("company_id") or "")
    source = storage_router.normalize_mode(record.get("from_mode"))
    target = storage_router.normalize_mode(record.get("to_mode"))
    company = await _company(db, cid)
    if not company:
        return _empty(cid, source, "Şirket bulunamadı.", dry_run=False)
    rows = await _lock_docs(db, cid)
    own = next((row for row in rows if str(row.get("move_id") or "") == mid), None)
    others = [row for row in rows if str(row.get("move_id") or "") != mid]
    if own is not None and not _lock_stale(own):
        report = _empty(cid, source, "Taşıma hâlâ çalışıyor.", dry_run=False)
        report.move_id = mid
        return report
    if others:
        return await _mark_abandoned(db, cid, mid, source)
    copied = record.get("copied") if isinstance(record.get("copied"), dict) else {}
    live = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
    if own is not None and _lock_stale(own):
        if live == source and copied:
            try:
                with _mover_io(cid, company, target):
                    own = await _materialize_copied(db, company, cid, target, copied)
                    await _wipe(db, company, cid, target, own)
            except Exception as exc:
                return _empty(cid, source, _safe(exc), dry_run=False)
        await _clear_flag(db, cid)
        try:
            await _sleep_lock(db, cid, mid)
        except LockLost:
            pass
        try:
            await _release_lock(db, cid, mid)
        except Exception:
            pass
    elif not rows:
        if live == source and copied:
            try:
                with _mover_io(cid, company, target):
                    own = await _materialize_copied(db, company, cid, target, copied)
                    await _wipe(db, company, cid, target, own)
            except Exception as exc:
                return _empty(cid, source, _safe(exc), dry_run=False)
        await _clear_flag(db, cid)
    await _patch_move(db, cid, mid, {
        "status": "recovered",
        "finished_at": _now(),
        "error": "",
    })
    fresh = await _company(db, cid)
    still = storage_router.normalize_mode((fresh or {}).get(storage_router.MODE_FIELD))
    _logger().info("taşıma company=%s durum=recovered", storage_router._safe_company(cid))
    return MoveReport(
        ok=True,
        wrote=True,
        dry_run=False,
        move_id=mid,
        company_id=cid,
        from_mode=still,
        to_mode=still,
        status="recovered",
    )


def render(report: MoveReport) -> str:
    """Operatör raporu. DSN, sır, VKN ve ETTN yazılmaz."""
    lines = [
        f"taşıma: {report.status or ('dry-run' if report.dry_run else 'apply')}",
        f"şirket: {storage_router._safe_company(report.company_id)}",
        f"kaynak: {report.from_mode or '-'}",
        f"hedef: {report.to_mode or '-'}",
    ]
    if report.move_id:
        lines.append(f"kayıt: {report.move_id}")
    if not report.collections:
        lines.append("koleksiyon yok")
    for row in report.collections:
        lines.append(
            f"{row.get('name')} sayı={row.get('count')} bayt={row.get('bytes')} hedef={row.get('target')}"
        )
    for item in report.conflicts:
        lines.append(f"çakışma: {item}")
    for item in report.errors:
        lines.append(f"hata: {item}")
    if report.dry_run or not report.wrote:
        lines.append("yazılmadı")
    else:
        lines.append(f"süre_ms: {report.duration_ms}")
        lines.append(f"kilit_ms: {report.locked_ms}")
    from storage_migrations.masking import scrub

    return scrub("\n".join(lines) + "\n")


def main(argv=None, catalog=None) -> int:
    from storage_migrations.masking import scrub, secret_scope

    with secret_scope():
        try:
            return _main(argv, catalog)
        except storage_router.StorageMoveBusy as exc:
            sys.stderr.write(scrub(str(exc)) + "\n")
            return 1
        except Exception as exc:
            sys.stderr.write(scrub(_safe(exc)) + "\n")
            return 1


def _app_db_configured() -> bool:
    if any(os.environ.get(key) for key in ("MYSQL_URL", "DATABASE_URL", "MYSQL_HOST")):
        return True
    try:
        from setup_state import load_database_settings

        return bool(load_database_settings())
    except Exception:
        return False


def open_app_catalog():
    """Uygulama ile aynı katalog. Ayar ve .env içeriği yazdırılmaz."""
    try:
        from dotenv import load_dotenv

        load_dotenv(os.path.join(_BACKEND, ".env"))
    except Exception:
        pass
    try:
        from setup_state import apply_saved_secrets

        apply_saved_secrets()
    except Exception:
        pass
    if not _app_db_configured():
        return None
    try:
        from mysql_store import MySQLClient, mysql_settings_from_env

        settings = mysql_settings_from_env()
        name = str((settings or {}).get("db") or "").strip()
        if not name:
            return None
        return MySQLClient()[name]
    except Exception:
        return None


async def _shutdown_owned(catalog) -> None:
    """CLI'nin açtığı havuzu aynı döngüde kapatır. Verilen kataloga dokunmaz."""
    pool = getattr(catalog, "_pool", None)
    closer = getattr(catalog, "close", None)
    if pool is not None and closer is not None:
        try:
            result = closer()
            if inspect.isawaitable(result):
                await result
        except Exception:
            pass
    try:
        storage_shared_v2.reset_store()
    except Exception:
        pass


async def _run_cli(catalog, coro, *, owned: bool):
    try:
        return await coro
    finally:
        if owned:
            await _shutdown_owned(catalog)


def _main(argv, catalog) -> int:
    parser = argparse.ArgumentParser(prog="python -m scripts.storage_move")
    parser.add_argument("--company", default="", help="company_id")
    parser.add_argument("--to", default="", help="shared_v2, dedicated veya legacy")
    parser.add_argument("--dry-run", action="store_true", help="yazma; varsayılan budur")
    parser.add_argument("--apply", action="store_true", help="kopyala ve kipi değiştir")
    parser.add_argument("--rollback", default="", help="tamamlanmış taşıma kaydı")
    parser.add_argument("--recover", default="", help="çökmüş taşımanın kilidini temizle")
    parser.add_argument("--batch-size", type=int, default=0, help="kopya parti boyu")
    args = parser.parse_args(argv)
    batch_size = args.batch_size if args.batch_size and args.batch_size > 0 else BATCH
    owned = catalog is None
    if catalog is None:
        catalog = open_app_catalog()
    if catalog is None:
        sys.stderr.write("Firma kataloğu yok.\n")
        return 2
    chosen = [bool(args.rollback), bool(args.recover), bool(args.apply)]
    if sum(1 for item in chosen if item) > 1:
        sys.stderr.write("Apply, geri alma ve kurtarma birlikte kullanılmaz.\n")
        return 2
    if args.recover:
        coro = recover_move(catalog, args.recover)
    elif args.rollback:
        coro = rollback_move(catalog, args.rollback, batch_size=batch_size)
    elif args.apply and not args.dry_run:
        if not str(args.company or "").strip() or not str(args.to or "").strip():
            sys.stderr.write("Apply için --company ve --to gerekir.\n")
            return 2
        coro = apply_move(catalog, args.company, args.to, batch_size=batch_size)
    else:
        if not str(args.company or "").strip() or not str(args.to or "").strip():
            sys.stderr.write("Dry-run için --company ve --to gerekir.\n")
            return 2
        coro = plan_move(catalog, args.company, args.to)
    report = asyncio.run(_run_cli(catalog, coro, owned=owned))
    sys.stdout.write(render(report))
    if report.ok:
        return 0
    if report.status == "failed":
        return 1
    return 2


def _process_entry(spec: dict) -> None:
    """Ayrı süreçte taşıma veya yazma dener. Sonucu dosyaya yazar. Sır yazmaz."""
    os.environ.update({str(key): str(value) for key, value in (spec.get("env") or {}).items()})
    action = str(spec.get("action") or "")
    result_path = str(spec.get("result") or "")
    ready = str(spec.get("ready") or "")
    release = str(spec.get("release") or "")
    tried = str(spec.get("tried") or "")
    outcome: dict = {"action": action}

    def _publish() -> None:
        if not result_path:
            return
        from storage_migrations.masking import scrub

        Path_write = outcome
        text = scrub(json.dumps(Path_write, ensure_ascii=False, default=str))
        with open(result_path, "w", encoding="utf-8") as handle:
            handle.write(text)

    try:
        from mysql_store import MySQLClient, mysql_settings_from_env

        settings = mysql_settings_from_env()
        db = MySQLClient()[str(settings.get("db") or "")]
        company_id = str(spec.get("company_id") or "")
        if action == "apply":
            async def _on_batch(_name, _count):
                if ready and not os.path.exists(ready):
                    with open(ready, "w", encoding="utf-8") as handle:
                        handle.write("1")
                while release and not os.path.exists(release):
                    time.sleep(0.02)

            async def _apply_and_close():
                try:
                    return await apply_move(
                        db, company_id, str(spec.get("to_mode") or ""), batch_size=1, on_batch=_on_batch,
                    )
                finally:
                    closer = getattr(db, "close", None)
                    if closer is not None:
                        try:
                            result = closer()
                            if inspect.isawaitable(result):
                                await result
                        except Exception:
                            pass
                    try:
                        storage_shared_v2.reset_store()
                    except Exception:
                        pass

            try:
                report = asyncio.run(_apply_and_close())
                outcome.update({"ok": report.ok, "status": report.status, "move_id": report.move_id, "error": ""})
            except storage_router.StorageMoveBusy:
                outcome.update({"ok": False, "status": "busy", "move_id": "", "error": "busy"})
        elif action == "write":
            async def _write():
                while ready and not os.path.exists(ready):
                    await asyncio.sleep(0.02)
                blocked = False
                message = ""
                try:
                    await db.orders.insert_one({
                        "_id": "o-blocked",
                        "company_id": company_id,
                        "order_number": "S-block",
                        "order_status": "open",
                        "channel": "manual",
                        "total_amount": 1,
                    })
                except storage_router.StorageWriteLocked as exc:
                    blocked = True
                    message = str(exc)
                except Exception as exc:
                    message = type(exc).__name__
                if tried:
                    with open(tried, "w", encoding="utf-8") as handle:
                        handle.write("1")
                while release and not os.path.exists(release):
                    await asyncio.sleep(0.02)
                mode = await storage_router.load_mode(db, company_id)
                landed = ""
                try:
                    import tenant_db
                    from tenant_scope import TenantScope

                    scope = TenantScope(
                        company_id=company_id,
                        allowed=frozenset({company_id}),
                        kind="user",
                        actor_id="proc",
                        reason="test",
                    )
                    handle_db = tenant_db.TenantDB(db, scope)
                    await handle_db.products.insert_one({
                        "_id": "p-after",
                        "name": "Sonra",
                        "sku": "P-after",
                        "price": 4,
                    })
                    found = await handle_db.products.find_one({"_id": "p-after"})
                    landed = "ok" if found else ""
                except Exception as exc:
                    landed = type(exc).__name__
                return {
                    "blocked": blocked,
                    "message": message,
                    "mode": mode,
                    "landed": landed,
                }

            async def _write_and_close():
                try:
                    return await _write()
                finally:
                    closer = getattr(db, "close", None)
                    if closer is not None:
                        try:
                            result = closer()
                            if inspect.isawaitable(result):
                                await result
                        except Exception:
                            pass
                    try:
                        storage_shared_v2.reset_store()
                    except Exception:
                        pass

            outcome.update(asyncio.run(_write_and_close()))
        elif action == "durability":
            async def _once(attempts, phase, label, doc_id, field, value, fn):
                row = {
                    "phase": phase,
                    "label": label,
                    "id": doc_id,
                    "field": field,
                    "value": value,
                    "ok": False,
                }
                try:
                    await fn()
                    row["ok"] = True
                except storage_router.StorageWriteLocked as exc:
                    row["locked"] = True
                    row["message"] = str(exc)
                except Exception as exc:
                    row["error"] = type(exc).__name__
                    row["message"] = str(exc)[:180]
                attempts.append(row)

            async def _durability():
                while ready and not os.path.exists(ready):
                    await asyncio.sleep(0.02)
                import tenant_db
                from tenant_scope import TenantScope

                scope = TenantScope(
                    company_id=company_id,
                    allowed=frozenset({company_id}),
                    kind="user",
                    actor_id="proc",
                    reason="test",
                )
                handle = tenant_db.TenantDB(db, scope)
                store = await storage_router.open_company_store(db, company_id)
                attempts = []
                await _once(attempts, "during", "tenant", "p-tenant-lock", "name", "Kilitli", lambda: handle.products.insert_one({
                    "_id": "p-tenant-lock", "name": "Kilitli", "sku": "SKU-tenant-lock", "price": 1,
                }))
                await _once(attempts, "during", "raw_update", "p-seed", "name", "Ara", lambda: db.products.update_one(
                    {"_id": "p-seed"}, {"$set": {"name": "Ara"}},
                ))
                await _once(attempts, "during", "raw_insert", "p-raw-lock", "name", "Ham", lambda: db.products.insert_one({
                    "_id": "p-raw-lock", "company_id": company_id, "name": "Ham", "sku": "SKU-raw-lock", "price": 2,
                }))
                await _once(attempts, "during", "store", "p-store-lock", "name", "Depo", lambda: store.products.insert_one({
                    "_id": "p-store-lock", "name": "Depo", "sku": "SKU-store-lock", "price": 3,
                }))
                if tried:
                    with open(tried, "w", encoding="utf-8") as marker:
                        marker.write("1")
                while release and not os.path.exists(release):
                    await asyncio.sleep(0.02)
                await _once(attempts, "after", "tenant", "p-tenant-after", "name", "TenantSon", lambda: handle.products.insert_one({
                    "_id": "p-tenant-after", "name": "TenantSon", "sku": "SKU-tenant-after", "price": 4,
                }))
                await _once(attempts, "after", "raw_update", "p-seed", "name", "Son", lambda: db.products.update_one(
                    {"_id": "p-seed"}, {"$set": {"name": "Son"}},
                ))
                await _once(attempts, "after", "raw_insert", "p-raw-after", "name", "HamSon", lambda: db.products.insert_one({
                    "_id": "p-raw-after", "company_id": company_id, "name": "HamSon", "sku": "SKU-raw-after", "price": 5,
                }))
                await _once(attempts, "after", "store", "p-store-after", "name", "DepoSon", lambda: store.products.insert_one({
                    "_id": "p-store-after", "name": "DepoSon", "sku": "SKU-store-after", "price": 6,
                }))
                return {"attempts": attempts}

            async def _durability_and_close():
                try:
                    return await _durability()
                finally:
                    closer = getattr(db, "close", None)
                    if closer is not None:
                        try:
                            result = closer()
                            if inspect.isawaitable(result):
                                await result
                        except Exception:
                            pass
                    try:
                        storage_shared_v2.reset_store()
                    except Exception:
                        pass

            outcome.update(asyncio.run(_durability_and_close()))
        elif action == "gap":
            async def _gap():
                import tenant_db
                from tenant_scope import TenantScope

                scope = TenantScope(
                    company_id=company_id,
                    allowed=frozenset({company_id}),
                    kind="user",
                    actor_id="proc",
                    reason="test",
                )
                handle = tenant_db.TenantDB(db, scope)
                store = await storage_router.open_company_store(db, company_id)
                rounds = int(spec.get("rounds") or 8)
                rows = []
                for index in range(rounds):
                    trio = (
                        ("tenant", f"gap-tenant-{index}", lambda doc_id, number=index: handle.products.insert_one({
                            "_id": doc_id, "name": f"T{number}", "sku": f"SKU-T-{number}", "price": number,
                        })),
                        ("raw", f"gap-raw-{index}", lambda doc_id, number=index: db.products.insert_one({
                            "_id": doc_id, "company_id": company_id, "name": f"R{number}", "sku": f"SKU-R-{number}", "price": number,
                        })),
                        ("store", f"gap-store-{index}", lambda doc_id, number=index: store.products.insert_one({
                            "_id": doc_id, "name": f"S{number}", "sku": f"SKU-S-{number}", "price": number,
                        })),
                    )
                    for _label, doc_id, fn in trio:
                        await fn(doc_id)
                        rows.append(doc_id)
                return {"rows": rows}

            async def _gap_and_close():
                try:
                    return await _gap()
                finally:
                    closer = getattr(db, "close", None)
                    if closer is not None:
                        try:
                            result = closer()
                            if inspect.isawaitable(result):
                                await result
                        except Exception:
                            pass
                    try:
                        storage_shared_v2.reset_store()
                    except Exception:
                        pass

            outcome.update(asyncio.run(_gap_and_close()))
        else:
            outcome["error"] = "bilinmeyen"
    except Exception as exc:
        outcome["error"] = type(exc).__name__
    _publish()


if __name__ == "__main__":
    raise SystemExit(main())
