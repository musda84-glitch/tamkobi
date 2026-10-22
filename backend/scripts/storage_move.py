"""Şirketi depolama kipleri arasında taşır.

Komut:
  python -m scripts.storage_move --company <id> --to <shared_v2|dedicated|legacy>
      [--dry-run] [--apply] [--rollback <move_id>] [--recover <move_id>]

Varsayılan dry-run: hiçbir şey yazılmaz. --apply kopyalar, sağlama
tutar, sonra router kataloğundaki kipi değiştirir. Kaynak veri silinmez.
Hata olursa kip değişmez, hedefe yazılanlar temizlenir, kilit açılır.
--recover çökmüş taşımanın kilidini ve yarım hedef veriyi temizler; kip
değişmez.

Yazma kilidi katalogdadır. Kopyadan önce ve kip değiştikten sonra, diğer
süreçlerin önbelleği dolsun diye en az TTL kadar beklenir. Dosya
(disk) içerikleri taşınmaz: yol belgenin içindedir, baytlar ortak
diskte kalır. Bağlantı ayarı okunur, yazdırılmaz.
"""
from __future__ import annotations

import argparse
import asyncio
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
from dataclasses import dataclass, field
from datetime import datetime, timezone

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402

BATCH = 50
_META = frozenset({"storage_moves", "storage_move_locks"})
LOCKS = "storage_move_locks"
_ID_MAX = 191
_COMPANY_MAX = 64
_CONTROL = None  # storage_router yüklendikten sonra dolar


class MoveError(RuntimeError):
    """Taşıma durdu. İleti sır taşımaz."""


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
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _freeze(doc: dict) -> str:
    body = dict(doc)
    body.pop("_row_updated_at", None)
    return json.dumps(body, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def _digest(docs) -> str:
    parts = sorted(_freeze(doc) for doc in docs)
    return hashlib.sha256("\n".join(parts).encode("utf-8")).hexdigest()


def _bytes(docs) -> int:
    return sum(len(_freeze(doc).encode("utf-8")) for doc in docs)


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
    """Koleksiyon bu kipte katalog db[name] dışında mı durur?

    legacy katalogun kendisidir. shared_v2 ve dedicated her adı şirket
    deposuna alır; company, membership, token ve platform türleri de
    buraya düşerse kopyalanır. Meta tablolar taşınmaz.
    """
    if name in _META or mode == storage_router.LEGACY:
        return False
    if mode == storage_router.DEDICATED:
        return True
    try:
        routed = storage_router.collection_for_mode(db, mode, company_id, name)
        return routed is not db[name]
    except Exception:
        return mode == storage_router.SHARED_V2


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


async def _sleep_beat(db, company_id: str, move_id: str, seconds: float) -> None:
    """Beklerken kalp atışını yeniler. Eşik 30 sn; adım en fazla 5 sn."""
    await _beat(db, company_id, move_id)
    left = max(0.0, float(seconds or 0))
    while left > 0:
        chunk = min(5.0, left)
        time.sleep(chunk)
        left -= chunk
        await _beat(db, company_id, move_id)


async def _sleep_lock(db, company_id: str, move_id: str) -> None:
    await _sleep_beat(db, company_id, move_id, storage_router.lock_ttl())


async def _sleep_mode(db, company_id: str, move_id: str) -> None:
    await _sleep_beat(db, company_id, move_id, storage_router.mode_ttl())


async def _pulse(db, company_id: str, move_id: str) -> None:
    """Uzun okuma ve kopya sırasında kalp atışı. İptal edilince susar."""
    while True:
        await asyncio.sleep(5)
        try:
            await _beat(db, company_id, move_id)
        except asyncio.CancelledError:
            raise
        except Exception:
            return


async def _stop_pulse(task) -> None:
    if task is None:
        return
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
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
    try:
        stamp = datetime.strptime(str(row.get("heartbeat_at") or ""), "%Y-%m-%dT%H:%M:%SZ")
        stamp = stamp.replace(tzinfo=timezone.utc)
    except ValueError:
        return 10**9
    return time.time() - stamp.timestamp()


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


async def _read(db, mode: str, company_id: str, name: str, company: dict):
    coll = _open(db, mode, company_id, name, company)
    kind = _kind(name)
    if mode == storage_router.LEGACY and kind in ("company", "membership", "platform", "token"):
        rows = await _collect(coll.find({}))
        return [row for row in rows if _belongs(row, name, company_id)]
    return await _collect(coll.find({"company_id": company_id}))


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


async def _legacy_names(db, company_id: str, route_mode: str) -> list[str]:
    found = []
    for name in await _list_names(db):
        if name in _META:
            continue
        if route_mode and route_mode != storage_router.LEGACY:
            if not _routed_away(db, route_mode, company_id, name):
                continue
        docs = await _read(db, storage_router.LEGACY, company_id, name, {})
        if docs:
            found.append(name)
    return sorted(found)


async def _names(db, mode: str, company_id: str, company: dict, route_mode: str = "") -> list[str]:
    if mode == storage_router.LEGACY:
        return await _legacy_names(db, company_id, route_mode or mode)
    if mode == storage_router.SHARED_V2:
        try:
            return list(storage_shared_v2.list_company_collections(company_id))
        except Exception as exc:
            raise MoveError(_safe(exc)) from None
    try:
        return list(storage_dedicated.list_collections(company_id, _dedicated_dsn(company)))
    except MoveError:
        raise
    except Exception as exc:
        raise MoveError(_safe(exc)) from None


async def _company(db, company_id: str):
    found = db.companies.find_one({"_id": company_id})
    if inspect.isawaitable(found):
        found = await found
    return found if isinstance(found, dict) else None


def _prepare(doc: dict, company_id: str, name: str = "") -> dict:
    body = copy.deepcopy(doc)
    body["_id"] = str(body.get("_id") or "")
    if name == "companies" or _kind(name) == "company":
        for field in _control_fields():
            body.pop(field, None)
    if not str(body.get("company_id") or "").strip():
        body["company_id"] = company_id
    return body


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


async def _insert_docs(coll, company_id: str, docs) -> list[str]:
    ids = []
    with storage_router.bypass_write_lock(company_id):
        for doc in docs:
            await coll.insert_one(doc)
            ids.append(str(doc["_id"]))
    return ids


async def _delete_ids(coll, company_id: str, ids) -> None:
    with storage_router.bypass_write_lock(company_id):
        for doc_id in ids:
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


async def _inspect(db, company, company_id: str, to_mode: str) -> MoveReport:
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
        names = await _names(db, source, company_id, company, to_mode)
    except MoveError as exc:
        report.errors.append(str(exc))
        report.status = "reddedildi"
        return report
    for name in names:
        try:
            docs = await _read(db, source, company_id, name, company)
            target_docs = await _read(db, to_mode, company_id, name, company)
        except MoveError as exc:
            report.errors.append(str(exc))
            continue
        except Exception as exc:
            report.errors.append(_safe(exc))
            continue
        prepared = [_prepare(doc, company_id, name) for doc in docs if doc.get("_id")]
        doc_errors, doc_conflicts = _check_docs(name, prepared, company_id)
        report.errors.extend(doc_errors)
        report.conflicts.extend(doc_conflicts)
        if target_docs and not (name == "companies" and to_mode == storage_router.LEGACY):
            report.conflicts.append(f"{name}: hedefte kayıt var")
        report.collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": _bytes(prepared),
            "target": _target_table(to_mode, name),
            "target_count": len(target_docs),
        })
        report.counts[name] = {"source": len(prepared), "target": len(target_docs)}
        report.checksums[name] = {"source": _digest(prepared), "target": ""}
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
    return [tuple(str(part) for part in row) for row in rows]


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


async def _wipe(db, company, company_id: str, mode: str, copied: dict) -> None:
    for name, ids in copied.items():
        if not ids:
            continue
        coll = _open(db, mode, company_id, name, company)
        await _delete_ids(coll, company_id, ids)


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


async def _copy(db, company, company_id: str, source: str, target: str, copied: dict, *, batch_size: int, on_batch, move_id: str):
    names = await _names(db, source, company_id, company, target)
    counts = {}
    checksums = {}
    steps = [{"name": "kilitle", "status": "tamam"}, {"name": "bekle:kilit", "status": "tamam"}]
    collections = []
    unique_parts = []
    for name in names:
        await _beat(db, company_id, move_id)
        docs = await _read(db, source, company_id, name, company)
        prepared = [_prepare(doc, company_id, name) for doc in docs if doc.get("_id")]
        doc_errors, doc_conflicts = _check_docs(name, prepared, company_id)
        if doc_errors or doc_conflicts:
            raise MoveError("Kaynak doğrulanamadı.")
        existing = await _read(db, target, company_id, name, company)
        if existing and not (name == "companies" and target == storage_router.LEGACY):
            raise MoveError(f"{name}: hedefte kayıt var")
        if name == "companies" and target == storage_router.LEGACY:
            await _sync_catalog_company(db, company_id, prepared[0] if prepared else {})
            loaded = await _read(db, target, company_id, name, company)
            source_sum = _digest(prepared)
            target_sum = _digest([_prepare(doc, company_id, name) for doc in loaded if doc.get("_id")])
            if source_sum != target_sum:
                raise MoveError("sağlama uyuşmadı")
            counts[name] = {"source": len(prepared), "target": len(loaded)}
            checksums[name] = {"source": source_sum, "target": target_sum}
            collections.append({
                "name": name,
                "count": len(prepared),
                "bytes": _bytes(prepared),
                "target": _target_table(target, name),
                "target_count": len(loaded),
            })
            steps.append({"name": f"kopyala:{name}", "status": "tamam", "count": len(prepared)})
            continue
        coll = _open(db, target, company_id, name, company)
        if target == storage_router.SHARED_V2:
            await _mirror_uniques(db, source, name, coll)
        copied[name] = []
        written = 0
        for batch in _chunks(prepared, batch_size):
            await _beat(db, company_id, move_id)
            ids = await _insert_docs(coll, company_id, batch)
            copied[name].extend(ids)
            written += len(ids)
            await _hook(on_batch, name, written)
        loaded = await _read(db, target, company_id, name, company)
        source_sum = _digest(prepared)
        target_sum = _digest([_prepare(doc, company_id, name) for doc in loaded if doc.get("_id")])
        if len(loaded) != len(prepared) or source_sum != target_sum:
            raise MoveError("sağlama uyuşmadı")
        if target == storage_router.SHARED_V2 or source == storage_router.SHARED_V2:
            side = coll if target == storage_router.SHARED_V2 else _open(db, source, company_id, name, company)
            digest, count = _ensure_unique(company_id, name, side, prepared if target == storage_router.SHARED_V2 else loaded)
            if count:
                unique_parts.append((name, digest, count))
        counts[name] = {"source": len(prepared), "target": len(loaded)}
        checksums[name] = {"source": source_sum, "target": target_sum}
        collections.append({
            "name": name,
            "count": len(prepared),
            "bytes": _bytes(prepared),
            "target": _target_table(target, name),
            "target_count": len(loaded),
        })
        steps.append({"name": f"kopyala:{name}", "status": "tamam", "count": len(prepared)})
        steps.append({"name": f"sağlama:{name}", "status": "tamam"})
    if unique_parts:
        body = "\n".join(f"{name}|{digest}|{count}" for name, digest, count in unique_parts)
        total = sum(count for _name, _digest, count in unique_parts)
        checksums["t_row_unique"] = {
            "source": hashlib.sha256(body.encode("utf-8")).hexdigest(),
            "target": hashlib.sha256(body.encode("utf-8")).hexdigest(),
        }
        counts["t_row_unique"] = {"source": total, "target": total}
        steps.append({"name": "sağlama:t_row_unique", "status": "tamam", "count": total})
    return counts, checksums, steps, collections


async def _lock_docs(db, company_id: str) -> list:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        return await _collect(db[LOCKS].find({"_id": company_id}))


async def _release_lock(db, company_id: str, move_id: str) -> None:
    from tenant_scope import unscoped

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


async def _remember_plan(db, company_id: str, move_id: str, source: str, names: list) -> None:
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            await db[LOCKS].update_one(
                {"_id": company_id, "move_id": move_id},
                {"$set": {"from_mode": source, "collections": list(names), "heartbeat_at": _now()}},
            )


async def _beat(db, company_id: str, move_id: str) -> None:
    if not move_id:
        return
    from tenant_scope import unscoped

    with unscoped("depolama taşıma kilidi"):
        with storage_router.bypass_write_lock(company_id):
            await db[LOCKS].update_one(
                {"_id": company_id, "move_id": move_id},
                {"$set": {
                    "heartbeat_at": _now(),
                    "owner_pid": os.getpid(),
                    "owner_host": _owner_host(),
                }},
            )


async def _clear_flag(db, company_id: str) -> None:
    try:
        await _flag(db, company_id, False)
        storage_router.note_write_lock(company_id, False)
    except Exception:
        _logger().info("taşıma company=%s durum=kilit", storage_router._safe_company(company_id))


async def apply_move(db, company_id: str, to_mode: str, *, batch_size: int = BATCH, on_batch=None) -> MoveReport:
    """Kopyalar ve kipi değiştirir. Kaynak silinmez. Şirket başına kilitlenir."""
    cid = str(company_id or "").strip()
    mode = storage_router.normalize_mode(to_mode)
    if not storage_router.enabled():
        return _empty(cid, mode, "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    if not cid:
        return _empty(cid, mode, "company_id boş", dry_run=False)
    held = False
    opened = False
    pulse = None
    started = time.monotonic()
    move_id = uuid.uuid4().hex
    copied: dict = {}
    company = None
    source = ""
    try:
        await _acquire_lock(db, cid, move_id, mode)
        held = True
        company = await _company(db, cid)
        report = await _inspect(db, company, cid, mode)
        report.dry_run = False
        report.move_id = move_id
        if not report.ok:
            return report
        source = report.from_mode
        names = [row.get("name") for row in report.collections if row.get("name")]
        await _remember_plan(db, cid, move_id, source, names)
        await _flag(db, cid, True)
        storage_router.note_write_lock(cid, True)
        opened = True
        await _sleep_lock(db, cid, move_id)
        await _save_move(db, cid, {
            "_id": move_id,
            "company_id": cid,
            "from_mode": source,
            "to_mode": mode,
            "status": "running",
            "steps": [{"name": "kilitle", "status": "tamam"}, {"name": "bekle:kilit", "status": "tamam"}],
            "counts": {},
            "checksums": {},
            "collections": names,
            "started_at": _now(),
            "finished_at": "",
            "duration_ms": 0,
            "error": "",
        })
        pulse = asyncio.create_task(_pulse(db, cid, move_id))
        try:
            counts, checksums, steps, collections = await _copy(
                db, company, cid, source, mode, copied,
                batch_size=batch_size, on_batch=on_batch, move_id=move_id,
            )
        except Exception as exc:
            await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            return MoveReport(
                ok=False, wrote=False, dry_run=False, move_id=move_id, company_id=cid,
                from_mode=source, to_mode=mode, status="failed", errors=[_safe(exc)],
                duration_ms=_elapsed(started),
            )
        try:
            await _set_mode(db, cid, mode)
        except Exception as exc:
            await _fail_copy(db, company, cid, mode, move_id, copied, exc, started)
            return MoveReport(
                ok=False, wrote=False, dry_run=False, move_id=move_id, company_id=cid,
                from_mode=source, to_mode=mode, status="failed", errors=[_safe(exc)],
                duration_ms=_elapsed(started),
            )
        steps.append({"name": "kip", "status": "tamam"})
        steps.append({"name": "bekle:kip", "status": "tamam"})
        await _sleep_mode(db, cid, move_id)
        duration = _elapsed(started)
        await _patch_move(db, cid, move_id, {
            "status": "completed",
            "steps": steps,
            "counts": counts,
            "checksums": checksums,
            "finished_at": _now(),
            "duration_ms": duration,
            "error": "",
        })
        await _clear_flag(db, cid)
        opened = False
        await _sleep_lock(db, cid, move_id)
        _logger().info("taşıma company=%s durum=completed", storage_router._safe_company(cid))
        return MoveReport(
            ok=True, wrote=True, dry_run=False, move_id=move_id, company_id=cid,
            from_mode=source, to_mode=mode, status="completed", collections=collections,
            counts=counts, checksums=checksums, steps=steps, duration_ms=duration,
        )
    finally:
        await _stop_pulse(pulse)
        if opened:
            await _clear_flag(db, cid)
            await _sleep_lock(db, cid, move_id)
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


async def _source_intact(db, company, company_id: str, mode: str, counts: dict, route_mode: str = "") -> bool:
    try:
        live = await _names(db, mode, company_id, company, route_mode)
    except Exception:
        return False
    recorded = sorted(key for key in (counts or []) if key != "t_row_unique")
    if sorted(live) != recorded:
        return False
    for name in recorded:
        docs = await _read(db, mode, company_id, name, company)
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


async def _reverse(db, company, company_id: str, source_mode: str, current_mode: str, *, batch_size: int, on_batch):
    """Güncel kipi eski kipe eşitler. Güncel taraftaki veri silinmez."""
    current_names = await _names(db, current_mode, company_id, company, current_mode)
    source_names = await _names(db, source_mode, company_id, company, current_mode)
    names = sorted(set(current_names) | set(source_names))
    if "companies" in names:
        names = [item for item in names if item != "companies"] + ["companies"]
    journal = []
    checksums = {}
    counts = {}
    steps = [{"name": "kilitle", "status": "tamam"}]
    collections = []
    for name in names:
        current_docs = await _read(db, current_mode, company_id, name, company)
        previous_docs = await _read(db, source_mode, company_id, name, company)
        current_prepared = [_prepare(doc, company_id, name) for doc in current_docs if doc.get("_id")]
        previous_by_id = {str(doc.get("_id")): doc for doc in previous_docs if doc.get("_id")}
        current_by_id = {str(doc.get("_id")): doc for doc in current_prepared}
        if name == "companies" and source_mode == storage_router.LEGACY:
            await _sync_catalog_company(db, company_id, current_prepared[0] if current_prepared else {})
            loaded = await _read(db, source_mode, company_id, name, company)
            fresh = await _read(db, current_mode, company_id, name, company)
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
        loaded = await _read(db, source_mode, company_id, name, company)
        fresh = await _read(db, current_mode, company_id, name, company)
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
    pulse = None
    started = time.monotonic()
    journal: list = []
    company = None
    rollback_id = uuid.uuid4().hex
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
        if not await _source_intact(db, company, cid, source, counts, current):
            report = _empty(cid, source, "Kaynak veri durmuyor.", dry_run=False)
            report.move_id = mid
            report.from_mode = current
            return report
        await _flag(db, cid, True)
        storage_router.note_write_lock(cid, True)
        opened = True
        await _sleep_lock(db, cid, rollback_id)
        pulse = asyncio.create_task(_pulse(db, cid, rollback_id))
        try:
            journal, new_counts, checksums, steps, collections = await _reverse(
                db, company, cid, source, current, batch_size=batch_size, on_batch=on_batch,
            )
        except Exception as exc:
            try:
                await _restore(db, company, cid, source, journal)
            except Exception as restore_exc:
                _logger().info(
                    "taşıma company=%s durum=geri-temizlik error=%s",
                    storage_router._safe_company(cid),
                    _safe(restore_exc),
                )
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
        await _set_mode(db, cid, source)
        steps.append({"name": "kip", "status": "tamam"})
        steps.append({"name": "bekle:kip", "status": "tamam"})
        await _sleep_mode(db, cid, rollback_id)
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
        await _clear_flag(db, cid)
        opened = False
        await _sleep_lock(db, cid, rollback_id)
        _logger().info("taşıma company=%s durum=rolled_back", storage_router._safe_company(cid))
        return MoveReport(
            ok=True, wrote=True, dry_run=False, move_id=mid, company_id=cid,
            from_mode=current, to_mode=source, status="rolled_back",
            collections=collections, counts=new_counts, checksums=checksums,
            steps=steps, duration_ms=duration,
        )
    finally:
        await _stop_pulse(pulse)
        if opened:
            await _clear_flag(db, cid)
            await _sleep_lock(db, cid, rollback_id)
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
                cur = conn.cursor()
                cur.execute(adapted, params)
                conn.commit()
            else:
                conn.execute(adapted, params)
        except Exception:
            return


async def recover_move(db, move_id: str) -> MoveReport:
    """Çökmüş taşımanın kilidini ve yarım hedefi temizler. Kip değişmez."""
    mid = str(move_id or "").strip()
    if not storage_router.enabled():
        return _empty("", "", "Depolama yönlendiricisi kapalı. Taşıma yazılmaz.", dry_run=False)
    record = await _load_move(db, mid) if mid else None
    if not record:
        return _empty("", "", "Taşıma kaydı yok.", dry_run=False)
    if record.get("status") in ("completed", "rolled_back", "recovered"):
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
    lock = next((row for row in rows if row.get("move_id") == mid), None)
    if lock is None and rows:
        lock = rows[0]
    if lock and lock.get("move_id") == mid and not _lock_stale(lock):
        report = _empty(cid, source, "Taşıma hâlâ çalışıyor.", dry_run=False)
        report.move_id = mid
        return report
    live = storage_router.normalize_mode(company.get(storage_router.MODE_FIELD))
    if live == source and target != storage_router.LEGACY:
        names = list(record.get("collections") or [])
        if lock and lock.get("collections"):
            names = list(lock.get("collections") or names)
        try:
            await _wipe_names(db, company, cid, target, names)
        except Exception as exc:
            return _empty(cid, source, _safe(exc), dry_run=False)
    elif live == source and isinstance(record.get("copied"), dict):
        try:
            await _wipe(db, company, cid, target, record.get("copied") or {})
        except Exception as exc:
            return _empty(cid, source, _safe(exc), dry_run=False)
    await _clear_flag(db, cid)
    await _sleep_lock(db, cid, str((lock or {}).get("move_id") or mid))
    if lock:
        try:
            await _release_lock(db, cid, str(lock.get("move_id") or ""))
        except Exception:
            pass
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
    args = parser.parse_args(argv)
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
        coro = rollback_move(catalog, args.rollback)
    elif args.apply and not args.dry_run:
        if not str(args.company or "").strip() or not str(args.to or "").strip():
            sys.stderr.write("Apply için --company ve --to gerekir.\n")
            return 2
        coro = apply_move(catalog, args.company, args.to)
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
        else:
            outcome["error"] = "bilinmeyen"
    except Exception as exc:
        outcome["error"] = type(exc).__name__
    _publish()


if __name__ == "__main__":
    raise SystemExit(main())
