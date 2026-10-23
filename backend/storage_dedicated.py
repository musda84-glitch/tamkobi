"""Dedicated firma veritabanı.

DSN yalnız mühürlü dedicated_dsn_ref alanından çözülür. Havuz firma
başına bir bağlantıdır, LRU ile sınırlıdır. Şema storage_migrations
ile kurulmuş olmalıdır; burada tablo açılmaz. Havuz ya da şema
hazır değilse açık hata verilir, legacy koleksiyona düşülmez.
"""
from __future__ import annotations

import contextvars
import copy
import hashlib
import inspect
import logging
import os
import sqlite3
import threading
import uuid
from collections import OrderedDict
from contextlib import contextmanager

import storage_router
from mysql_store import (
    DuplicateKeyError,
    aggregate_rows,
    apply_update,
    dumps,
    loads,
    match_query,
    new_upsert_doc,
    project_doc,
    values_at,
)
from storage_backend import (
    DeleteResult,
    InsertManyResult,
    InsertOneResult,
    ListCursor,
    StorageCollection,
    StorageCursor,
    UpdateResult,
)
from storage_migrations.masking import RedactFilter, add_secret
from storage_migrations.session import connect
from storage_migrations.targets import (
    CatalogError,
    LegacyTargetError,
    UsageError,
    parse_target,
    resolve_dsn,
    unseal_dedicated_ref,
)

_POOL_MAX = "STORAGE_DEDICATED_POOL_MAX"
_POOL_IDLE = "STORAGE_DEDICATED_POOL_IDLE_SECONDS"
_MEMORY_ONLY = "Firma kipleri yalnız bellek kataloğundan okunur."
_SEALED_MAX = 1024
# 0004_storage_records. 0003 docs_v2 paketinden bağımsızdır.
STORAGE_RECORDS_VERSION = 4
_DOC_ID_MAX = 191
_COMPANY_ID_MAX = 64

_pools: "OrderedDict[str, _Pool]" = OrderedDict()
_sealed: "OrderedDict[str, str]" = OrderedDict()
_registry_lock = threading.Lock()
_generation_seq = 0
# Taşıma kendi oturumunu kullanır. Havuz bağlantısının izolasyonu değişmez.
_read_session: "contextvars.ContextVar" = contextvars.ContextVar(
    "dedicated_read_session",
    default=None,
)


def use_read_session(company_id: str, session):
    return _read_session.set((str(company_id or ""), session))


def reset_read_session(token) -> None:
    if token is not None:
        _read_session.reset(token)


def read_session(company_id: str = ""):
    item = _read_session.get()
    if item is None:
        return None
    if company_id and item[0] != str(company_id):
        return None
    return item[1]


def _lock():
    return _registry_lock


def _next_generation() -> int:
    """Havuz kuşağı. id(session) GC sonrası tekrarlanabildiği için artan sayaç."""
    global _generation_seq
    _generation_seq += 1
    return _generation_seq


def _now() -> float:
    import time

    return time.monotonic()


def _logger() -> logging.Logger:
    log = logging.getLogger("storage_dedicated")
    if not any(isinstance(item, RedactFilter) for item in log.filters):
        log.addFilter(RedactFilter())
    return log


_log = _logger()


class DedicatedStorageError(storage_router.StorageModeError):
    """Dedicated arka uç kullanılamadı. İleti DSN taşımaz."""

    def __init__(self, message: str, *, company_id: str = ""):
        super().__init__(message, company_id=company_id, mode=storage_router.DEDICATED)


class _Pool:
    def __init__(self, company_id: str, key: str, session):
        self.company_id = company_id
        self.key = key
        self.session = session
        self.in_use = 0
        self.last_used = _now()
        self.closed = False
        self.generation = _next_generation()
        self.op_lock = threading.RLock()

    def __repr__(self) -> str:
        return f"_Pool(company_id={self.company_id!r}, closed={self.closed})"


def pool_max() -> int:
    try:
        value = int((os.environ.get(_POOL_MAX) or "8").strip())
    except ValueError:
        value = 8
    return value if value >= 1 else 1


def pool_idle_seconds() -> float:
    try:
        value = float((os.environ.get(_POOL_IDLE) or "60").strip())
    except ValueError:
        value = 60.0
    return value if value >= 0 else 60.0


def reset_pools() -> None:
    """Testler havuzu ve mühür önbelleğini kapatır."""
    with _lock():
        for company_id in list(_pools):
            _close_unlocked(company_id)
        _pools.clear()
        _sealed.clear()


def is_open(company_id: str) -> bool:
    pool = _pools.get(str(company_id or ""))
    return pool is not None and not pool.closed


def acquire(company_id: str, dsn: str) -> str:
    """Testler havuzu meşgul tutar. release ile bırakılır."""
    checkout(company_id, dsn)
    return str(company_id)


def release(company_id: str) -> None:
    cid = str(company_id or "")
    with _lock():
        pool = _pools.get(cid)
        if pool is None:
            return
        if pool.in_use > 0:
            pool.in_use -= 1
        pool.last_used = _now()


def generation(company_id: str):
    pool = _pools.get(str(company_id or ""))
    if pool is None or pool.closed:
        return None
    return pool.generation


def expected_schema_version() -> int:
    return STORAGE_RECORDS_VERSION


async def note_company(db, company_id: str) -> None:
    """Mühürlü referansı hatırlar. Düz metin DSN saklamaz."""
    cid = str(company_id or "").strip()
    if not cid:
        return
    docs = _memory_docs(db)
    if docs is not None:
        for doc in docs:
            if str((doc or {}).get("_id") or "") == cid:
                _remember_doc(cid, doc)
                return
        return
    await _remember_async(db, cid)


def collection(db, company_id: str, name: str) -> "DedicatedCollection":
    """Koleksiyon. Bağlantı ilk işlemde açılır. Legacy dönmez."""
    cid = str(company_id or "").strip()
    dsn = _dsn_for(db, cid)
    add_secret(dsn)
    coll = DedicatedCollection(cid, str(name or ""), dsn)
    try:
        setattr(coll, "_catalog_db", db)
    except Exception:
        pass
    return coll


def list_collections(company_id: str, dsn: str) -> list[str]:
    """Firmanın dedicated koleksiyon adları. Yazmaz. DSN loglanmaz."""
    cid = str(company_id or "").strip()
    add_secret(dsn)
    with _session(cid, dsn) as session:
        _assert_schema(session, cid)
        rows = session.fetchall(
            "SELECT DISTINCT collection FROM storage_records WHERE company_id = ?",
            (cid,),
        )
    return sorted({str(row[0]) for row in rows if row and row[0]})


def checkout(company_id: str, dsn: str) -> _Pool:
    cid = str(company_id or "").strip()
    add_secret(dsn)
    key = hashlib.sha256(dsn.encode()).hexdigest()
    with _lock():
        _close_idle()
        existing = _pools.get(cid)
        if existing is not None and not existing.closed and existing.key == key:
            existing.in_use += 1
            existing.last_used = _now()
            _pools.move_to_end(cid)
            return existing
        if existing is not None:
            if existing.in_use > 0:
                raise DedicatedStorageError("Dedicated havuzu dolu.", company_id=cid)
            _close_unlocked(cid)
        while len(_pools) >= pool_max():
            victim = _oldest_idle()
            if victim is None:
                raise DedicatedStorageError("Dedicated havuzu dolu.", company_id=cid)
            _close_unlocked(victim)
        pool = _open(cid, dsn, key)
        pool.in_use += 1
        _pools[cid] = pool
        _pools.move_to_end(cid)
        return pool


@contextmanager
def _session(company_id: str, dsn: str):
    override = read_session(company_id)
    if override is not None:
        yield override
        return
    pool = checkout(company_id, dsn)
    try:
        with pool.op_lock:
            if pool.closed or pool.session is None:
                raise DedicatedStorageError("Dedicated havuzu açılamadı.", company_id=company_id)
            yield pool.session
    finally:
        release(company_id)


def _open(company_id: str, dsn: str, key: str) -> _Pool:
    try:
        session = connect(dsn, write=True)
    except LegacyTargetError:
        raise DedicatedStorageError("Dedicated hedefi reddedildi.", company_id=company_id) from None
    except DedicatedStorageError:
        raise
    except Exception:
        _log.warning("dedicated havuzu açılamadı company=%s", _safe_id(company_id))
        raise DedicatedStorageError("Dedicated havuzu açılamadı.", company_id=company_id) from None
    return _Pool(company_id, key, session)


def _close_idle() -> None:
    limit = pool_idle_seconds()
    now = _now()
    stale = []
    for company_id, pool in _pools.items():
        if pool.in_use > 0 or pool.closed:
            continue
        if now - pool.last_used >= limit:
            stale.append(company_id)
    for company_id in stale:
        _close_unlocked(company_id)


def _oldest_idle():
    for company_id, pool in _pools.items():
        if pool.in_use <= 0 and not pool.closed:
            return company_id
    return None


def _close_unlocked(company_id: str) -> None:
    pool = _pools.pop(company_id, None)
    if pool is None:
        return
    pool.closed = True
    session = pool.session
    pool.session = None
    if session is not None:
        try:
            session.close()
        except Exception:
            return


def _dsn_for(db, company_id: str) -> str:
    spec_name = f"{storage_router.DEDICATED}:{company_id}"
    try:
        spec = parse_target(spec_name)
        return resolve_dsn(spec, db)
    except CatalogError as exc:
        if not str(exc).startswith(_MEMORY_ONLY):
            raise DedicatedStorageError(_public(exc), company_id=company_id) from None
    except (LegacyTargetError, UsageError) as exc:
        raise DedicatedStorageError(_public(exc), company_id=company_id) from None
    sealed = _sealed.get(company_id)
    if not sealed:
        raise DedicatedStorageError("Dedicated DSN referansı yok.", company_id=company_id)
    try:
        return unseal_dedicated_ref(sealed)
    except CatalogError:
        raise DedicatedStorageError("DSN referansı çözülemedi.", company_id=company_id) from None


def _public(exc: Exception) -> str:
    text = str(exc or "").strip()
    if not text or "://" in text or "@" in text or "gAAAA" in text or len(text) > 180:
        return "Dedicated havuzu açılamadı."
    return text


def _safe_id(company_id: str) -> str:
    text = str(company_id or "")
    if text and all(ch.isalnum() or ch in "-_" for ch in text) and len(text) <= 80:
        return text
    return "gizli"


def _memory_docs(db):
    try:
        source = db["companies"]
    except Exception:
        return None
    docs = getattr(source, "docs", None)
    if isinstance(docs, list):
        return docs
    return None


def _remember_doc(company_id: str, doc: dict) -> None:
    if not isinstance(doc, dict):
        return
    if storage_router.public_mode(doc.get(storage_router.MODE_FIELD)) != storage_router.DEDICATED:
        return
    sealed = doc.get(storage_router.DSN_FIELD)
    if isinstance(sealed, str) and sealed.strip():
        _remember(company_id, sealed.strip())


def _remember(company_id: str, sealed: str) -> None:
    _sealed[company_id] = sealed
    _sealed.move_to_end(company_id)
    while len(_sealed) > _SEALED_MAX:
        _sealed.popitem(last=False)


async def _remember_async(db, company_id: str) -> None:
    try:
        companies = db["companies"]
    except Exception:
        return
    find_one = getattr(companies, "find_one", None)
    if find_one is None:
        return
    try:
        found = find_one(
            {"_id": company_id},
            {storage_router.DSN_FIELD: 1, storage_router.MODE_FIELD: 1},
        )
        if inspect.isawaitable(found):
            found = await found
    except Exception:
        raise DedicatedStorageError("Dedicated firma kataloğu okunamadı.", company_id=company_id) from None
    if isinstance(found, dict):
        _remember_doc(company_id, found)


def _assert_schema(session, company_id: str) -> None:
    expected = expected_schema_version()
    names = session.tables()
    if "schema_version" not in names or "storage_records" not in names:
        raise DedicatedStorageError("Dedicated şema sürümü eski.", company_id=company_id)
    rows = session.fetchall(
        "SELECT version FROM schema_version WHERE state = ?",
        ("applied",),
    )
    applied = {int(row[0]) for row in rows}
    if expected not in applied:
        raise DedicatedStorageError("Dedicated şema sürümü eski.", company_id=company_id)


def _duplicate(exc: Exception) -> bool:
    if isinstance(exc, sqlite3.IntegrityError):
        return True
    name = type(exc).__name__.lower()
    if "integrity" in name:
        return True
    text = str(getattr(exc, "args", ("",))[0] if getattr(exc, "args", None) else "").lower()
    return "duplicate" in text or "unique" in text


def _stored_company_id(value):
    """Üretilmiş company_id kolonuna yazılacak metin. Yoksa None."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return str(value)
    try:
        return dumps(value)
    except Exception:
        return str(value)


def _reject_field_lengths(doc_id, doc) -> None:
    """Strict modda VARCHAR taşması 1406 olur. Yazmadan önce alan adıyla reddet."""
    ident = "" if doc_id is None else str(doc_id)
    if len(ident) > _DOC_ID_MAX:
        raise ValueError(f"doc_id en fazla {_DOC_ID_MAX} karakter olabilir.")
    if not isinstance(doc, dict):
        return
    stored = _stored_company_id(doc.get("company_id"))
    if stored is not None and len(stored) > _COMPANY_ID_MAX:
        raise ValueError(f"company_id en fazla {_COMPANY_ID_MAX} karakter olabilir.")


def _reject_update_lengths(query, update) -> None:
    """Uzunluk kilidi beklemez. Hatalı alan adı kilitten önce gelir."""
    if isinstance(query, dict) and query.get("_id") is not None and not isinstance(query.get("_id"), dict):
        _reject_field_lengths(query.get("_id"), {})
    if not isinstance(update, dict):
        return
    if any(str(key).startswith("$") for key in update):
        for key in ("$set", "$setOnInsert"):
            body = update.get(key)
            if isinstance(body, dict):
                _reject_field_lengths(body.get("_id"), body)
        return
    _reject_field_lengths(update.get("_id"), update)


def _upsert_sql(dialect: str) -> str:
    if dialect == "mysql":
        return "REPLACE INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)"
    return "INSERT OR REPLACE INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)"


class DedicatedCollection(StorageCollection):
    def __init__(self, company_id: str, name: str, dsn: str):
        super().__init__(name)
        self.company_id = company_id
        self._dsn = dsn

    def __repr__(self) -> str:
        return f"DedicatedCollection(company_id={self.company_id!r}, name={self.name!r})"

    async def _reject_locked(self) -> None:
        await storage_router.guard_pinned_write(
            self.company_id,
            db=getattr(self, "_catalog_db", None),
            pinned_mode=getattr(self, "_pinned_mode", None),
            pinned_epoch=getattr(self, "_pinned_epoch", None),
        )

    def _guard(self, op: str, **kwargs) -> None:
        try:
            from tenant_scope import TenantScopeViolation, check
        except Exception:
            return
        try:
            check(self.name, op, **kwargs)
        except TenantScopeViolation:
            raise
        except Exception:
            return

    def _run(self, fn):
        with _session(self.company_id, self._dsn) as session:
            try:
                _assert_schema(session, self.company_id)
                return fn(session)
            except DedicatedStorageError:
                try:
                    session.rollback()
                except Exception:
                    pass
                raise
            except (DuplicateKeyError, ValueError):
                try:
                    session.rollback()
                except Exception:
                    pass
                raise
            except Exception as exc:
                try:
                    from tenant_scope import TenantScopeViolation
                except Exception:
                    TenantScopeViolation = ()  # type: ignore
                if TenantScopeViolation and isinstance(exc, TenantScopeViolation):
                    raise
                try:
                    session.rollback()
                except Exception:
                    pass
                if _duplicate(exc):
                    raise DuplicateKeyError("Kayıt zaten var.") from None
                raise DedicatedStorageError("Dedicated işlemi kesildi.", company_id=self.company_id) from None

    def _load(self, session) -> list:
        rows = session.fetchall(
            "SELECT doc FROM storage_records WHERE collection = ?",
            (self.name,),
        )
        return [loads(row[0]) for row in rows]

    def _matched(self, session, query) -> list:
        return [doc for doc in self._load(session) if match_query(doc, query)]

    def _write(self, session, doc: dict) -> None:
        body = dict(doc)
        if not body.get("_id"):
            body["_id"] = str(uuid.uuid4())
        _reject_field_lengths(body["_id"], body)
        session.execute(
            _upsert_sql(session.dialect),
            (self.name, str(body["_id"]), dumps(body)),
        )

    def _delete_ids(self, session, ids) -> int:
        removed = 0
        for doc_id in ids:
            session.execute(
                "DELETE FROM storage_records WHERE collection = ? AND doc_id = ?",
                (self.name, str(doc_id)),
            )
            removed += 1
        return removed

    def find(self, query=None, projection=None):
        self._guard("find", query=query)

        async def load():
            return self._run(lambda session: self._matched(session, query))

        return StorageCursor(load, projection)

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        self._guard("find_one", query=query)
        cursor = self.find(query, projection)
        if sort:
            cursor.sort(sort)
        if skip:
            cursor.skip(skip)
        cursor.limit(1)
        rows = await cursor.to_list(1)
        return rows[0] if rows else None

    async def count_documents(self, query=None):
        self._guard("count_documents", query=query)
        return self._run(lambda session: len(self._matched(session, query)))

    async def distinct(self, key, query=None):
        self._guard("distinct", query=query)

        def work(session):
            seen = []
            for doc in self._matched(session, query):
                for value in values_at(doc, key) or []:
                    if value not in seen:
                        seen.append(value)
            return seen

        return self._run(work)

    def aggregate(self, pipeline):
        self._guard("aggregate", pipeline=pipeline)

        async def load():
            def work(session):
                docs = self._load(session)
                return aggregate_rows(docs, pipeline)

            return self._run(work)

        return ListCursor(load)

    async def insert_one(self, doc: dict):
        self._guard("insert_one", doc=doc)
        body = copy.deepcopy(doc or {})
        if not body.get("_id"):
            body["_id"] = str(uuid.uuid4())
        _reject_field_lengths(body["_id"], body)
        await self._reject_locked()

        def work(session):
            try:
                session.execute(
                    "INSERT INTO storage_records (collection, doc_id, doc) VALUES (?, ?, ?)",
                    (self.name, str(body["_id"]), dumps(body)),
                )
                session.commit()
            except Exception as exc:
                try:
                    session.rollback()
                except Exception:
                    pass
                if _duplicate(exc):
                    raise DuplicateKeyError("Kayıt zaten var.") from None
                raise

        self._run(work)
        return InsertOneResult(body["_id"])

    async def insert_many(self, docs, ordered: bool = True):
        self._guard("insert_many", doc=docs)
        prepared = [copy.deepcopy(item or {}) for item in list(docs or [])]
        for item in prepared:
            if not item.get("_id"):
                item["_id"] = str(uuid.uuid4())
            _reject_field_lengths(item.get("_id"), item)
        await self._reject_locked()
        ids = []
        for item in prepared:
            if not ordered:
                try:
                    result = await self.insert_one(item)
                except DuplicateKeyError:
                    continue
                ids.append(result.inserted_id)
                continue
            result = await self.insert_one(item)
            ids.append(result.inserted_id)
        return InsertManyResult(ids)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        _reject_update_lengths(query, update)
        await self._reject_locked()
        self._guard("update_one", query=query, update=update, upsert=upsert)

        def work(session):
            found = self._matched(session, query)
            if not found:
                if not upsert:
                    return UpdateResult(0, 0, None)
                created = new_upsert_doc(update, query)
                self._write(session, created)
                session.commit()
                return UpdateResult(0, 1, created.get("_id"))
            old = found[0]
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc == old:
                return UpdateResult(1, 0, None)
            self._replace_doc(session, old, new_doc)
            session.commit()
            return UpdateResult(1, 1, None)

        return self._run(work)

    async def update_one_atomic(self, query: dict, update: dict):
        _reject_update_lengths(query, update)
        await self._reject_locked()
        self._guard("update_one_atomic", query=query, update=update)
        doc_id = (query or {}).get("_id")
        if doc_id is None or isinstance(doc_id, dict):
            raise ValueError("update_one_atomic requires equality _id in query")
        return await self.update_one(query, update, upsert=False)

    async def update_many(self, query: dict, update: dict, upsert: bool = False):
        _reject_update_lengths(query, update)
        await self._reject_locked()
        self._guard("update_many", query=query, update=update, upsert=upsert)

        def work(session):
            found = self._matched(session, query)
            if not found:
                if not upsert:
                    return UpdateResult(0, 0, None)
                created = new_upsert_doc(update, query)
                self._write(session, created)
                session.commit()
                return UpdateResult(0, 1, created.get("_id"))
            changed = 0
            for old in found:
                new_doc = apply_update(old, update, query, is_insert=False)
                if new_doc == old:
                    continue
                self._replace_doc(session, old, new_doc)
                changed += 1
            if changed:
                session.commit()
            return UpdateResult(len(found), changed, None)

        return self._run(work)

    async def replace_one(self, query: dict, replacement: dict, upsert: bool = False):
        body = copy.deepcopy(replacement or {})
        _reject_update_lengths(query, body)
        await self._reject_locked()
        self._guard("replace_one", query=query, doc=replacement)

        def work(session):
            found = self._matched(session, query)
            if not found:
                if not upsert:
                    return UpdateResult(0, 0, None)
                if not body.get("_id"):
                    body["_id"] = str(uuid.uuid4())
                self._write(session, body)
                session.commit()
                return UpdateResult(0, 1, body.get("_id"))
            old = found[0]
            body["_id"] = old.get("_id") or body.get("_id")
            self._replace_doc(session, old, body)
            session.commit()
            return UpdateResult(1, 1, None)

        return self._run(work)

    async def find_one_and_update(
        self,
        query: dict,
        update: dict,
        upsert: bool = False,
        return_document=True,
        projection=None,
    ):
        _reject_update_lengths(query, update)
        await self._reject_locked()
        self._guard("find_one_and_update", query=query, update=update, upsert=upsert)

        def work(session):
            found = self._matched(session, query)
            if not found:
                if not upsert:
                    return None
                created = new_upsert_doc(update, query)
                self._write(session, created)
                session.commit()
                return project_doc(created, projection)
            old = found[0]
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                self._replace_doc(session, old, new_doc)
                session.commit()
            chosen = new_doc if return_document else old
            return project_doc(chosen, projection)

        return self._run(work)

    async def delete_one(self, query: dict):
        _reject_update_lengths(query, None)
        await self._reject_locked()
        self._guard("delete_one", query=query)

        def work(session):
            found = self._matched(session, query)
            if not found:
                return DeleteResult(0)
            self._delete_ids(session, [found[0].get("_id")])
            session.commit()
            return DeleteResult(1)

        return self._run(work)

    async def delete_many(self, query: dict):
        _reject_update_lengths(query, None)
        await self._reject_locked()
        self._guard("delete_many", query=query)

        def work(session):
            found = self._matched(session, query)
            if not found:
                return DeleteResult(0)
            self._delete_ids(session, [doc.get("_id") for doc in found if doc.get("_id") is not None])
            session.commit()
            return DeleteResult(len(found))

        return self._run(work)

    def _replace_doc(self, session, old: dict, new_doc: dict) -> None:
        old_id = old.get("_id")
        new_id = new_doc.get("_id") or old_id
        new_doc["_id"] = new_id
        if old_id is not None and str(old_id) != str(new_id):
            self._delete_ids(session, [old_id])
        self._write(session, new_doc)
