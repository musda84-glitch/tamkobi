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
from datetime import datetime, timezone

import storage_router
from mysql_store import (
    DuplicateKeyError,
    aggregate_rows,
    apply_update,
    changed_window,
    dumps,
    loads,
    match_query,
    materialize_docs_async,
    new_upsert_doc,
    offload,
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
_EXT_MAX = 191
_BANK_KEY_TABLE = "storage_bank_external"

_pools: "OrderedDict[str, _Pool]" = OrderedDict()
_sealed: "OrderedDict[str, str]" = OrderedDict()
_missing_bank_key_logged: set[str] = set()
# Mühür, okunduğu storage_epoch ile birlikte durur. Epoch değişince eski ref kullanılmaz.
_sealed_epoch: dict[str, int] = {}
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
        _sealed_epoch.clear()
        _missing_bank_key_logged.clear()


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
    cid = storage_router.canonical_company_id(company_id)
    if not cid:
        return
    docs = _memory_docs(db)
    if docs is not None:
        found = _doc_for_company(docs, cid)
        if found is not None:
            _remember_doc(cid, found)
        return
    await _remember_async(db, cid)


def collection(db, company_id: str, name: str) -> "DedicatedCollection":
    """Koleksiyon. Bağlantı ilk işlemde açılır. Legacy dönmez."""
    cid = storage_router.canonical_company_id(company_id)
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
    company_id = storage_router.canonical_company_id(company_id)
    spec_name = f"{storage_router.DEDICATED}:{company_id}"
    try:
        spec = parse_target(spec_name)
        return resolve_dsn(spec, db)
    except CatalogError as exc:
        text = str(exc)
        if not text.startswith(_MEMORY_ONLY):
            if "DSN referansı yok" in text:
                raise DedicatedStorageError(
                    _missing_ref_message(company_id), company_id=company_id,
                ) from None
            raise DedicatedStorageError(_public(exc), company_id=company_id) from None
    except (LegacyTargetError, UsageError) as exc:
        raise DedicatedStorageError(_public(exc), company_id=company_id) from None
    sealed = sealed_for_current_epoch(company_id)
    if not sealed:
        raise DedicatedStorageError(_missing_ref_message(company_id), company_id=company_id)
    try:
        return unseal_dedicated_ref(sealed)
    except CatalogError:
        raise DedicatedStorageError("DSN referansı çözülemedi.", company_id=company_id) from None


def _missing_ref_message(company_id: str) -> str:
    """Şirket kimliği logda kalır. Mühür ve DSN metne girmez."""
    cid = str(company_id or "").strip()
    if cid and all(ch.isalnum() or ch in "-_" for ch in cid) and len(cid) <= 80:
        return f"Dedicated DSN referansı yok. company={cid}"
    return "Dedicated DSN referansı yok."


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


def _doc_for_company(docs, company_id: str):
    """Önce `_id`, yoksa JSON `id`. Satır kimliği ile belge kimliği ayrı olabilir."""
    cid = storage_router.canonical_company_id(company_id)
    if not cid:
        return None
    fallback = None
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        if storage_router._same_company(doc.get("_id"), cid):
            return doc
        if fallback is None and storage_router._same_company(doc.get("id"), cid):
            fallback = doc
    return fallback


def _memory_docs(db):
    try:
        source = db["companies"]
    except Exception:
        return None
    docs = getattr(source, "docs", None)
    if isinstance(docs, list):
        return docs
    return None


def _epoch_of(doc: dict) -> int:
    try:
        return int(doc.get(storage_router.EPOCH_FIELD) or 0)
    except (TypeError, ValueError):
        return 0


def _remember_doc(company_id: str, doc: dict) -> None:
    if not isinstance(doc, dict):
        return
    mode = storage_router.public_mode(doc.get(storage_router.MODE_FIELD))
    sync_ref_from_doc(company_id, doc, mode, _epoch_of(doc))


def forget_ref(company_id: str) -> None:
    """Bu sürecin mühür önbelleği. Havuz açık yazmayı kesmez."""
    cid = str(company_id or "")
    _sealed.pop(cid, None)
    _sealed_epoch.pop(cid, None)


def ref_ready(company_id: str, epoch: int) -> bool:
    """Bu epoch için dolu mühür var mı. Boş veya başka epoch hazır sayılmaz."""
    cid = str(company_id or "")
    sealed = _sealed.get(cid) or ""
    if not sealed.strip():
        return False
    seen = _sealed_epoch.get(cid)
    return seen is not None and int(seen) == int(epoch)


def sealed_for_current_epoch(company_id: str) -> str:
    """Taze kip önbelleğiyle aynı epoch'taki mühür. Eski epoch'un ref'i dönmez."""
    cid = str(company_id or "")
    sealed = (_sealed.get(cid) or "").strip()
    if not sealed:
        return ""
    row = storage_router._cache.get(cid)
    if not row or storage_router._now() >= row[1] or row[0] != storage_router.DEDICATED:
        return sealed
    seen = _sealed_epoch.get(cid)
    if seen is None or int(seen) != int(row[2]):
        return ""
    return sealed


def remember_sealed(company_id: str, sealed: str, epoch: int) -> None:
    """Mühürlü ref. Düz metin saklanmaz. Ref değişince boştaki havuz kapanır."""
    cid = str(company_id or "").strip()
    text = str(sealed or "").strip()
    if not cid or not text:
        return
    prev = _sealed.get(cid)
    if prev and prev != text:
        _drop_pool_if_idle(cid)
    _sealed[cid] = text
    _sealed_epoch[cid] = int(epoch)
    _sealed.move_to_end(cid)
    while len(_sealed) > _SEALED_MAX:
        gone, _old = _sealed.popitem(last=False)
        _sealed_epoch.pop(gone, None)


def sync_ref_from_doc(company_id: str, doc, mode: str, epoch: int) -> None:
    """Kip ile aynı belgedeki mühür. Dedicated ve ref boşsa eski epoch saklanmaz."""
    cid = str(company_id or "").strip()
    if not cid:
        return
    if mode != storage_router.DEDICATED:
        forget_ref(cid)
        return
    if not isinstance(doc, dict) or storage_router.DSN_FIELD not in doc:
        seen = _sealed_epoch.get(cid)
        if seen is not None and int(seen) != int(epoch):
            forget_ref(cid)
        return
    sealed = doc.get(storage_router.DSN_FIELD)
    if not isinstance(sealed, str) or not sealed.strip():
        forget_ref(cid)
        return
    remember_sealed(cid, sealed, int(epoch))


def _drop_pool_if_idle(company_id: str) -> None:
    cid = str(company_id or "")
    with _lock():
        pool = _pools.get(cid)
        if pool is None or pool.in_use > 0 or pool.closed:
            return
        _close_unlocked(cid)


async def _remember_async(db, company_id: str) -> None:
    try:
        companies = db["companies"]
    except Exception:
        return
    find_one = getattr(companies, "find_one", None)
    if find_one is None:
        return
    try:
        found = find_one({"_id": company_id})
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


def _missing_table(exc: BaseException) -> bool:
    """MySQL 1146 ve sqlite 'no such table'. Başka hatalar buraya girmez."""
    args = getattr(exc, "args", ())
    if args and args[0] == 1146:
        return True
    text = " ".join(str(part) for part in args).lower()
    if not text:
        text = str(exc or "").lower()
    return "no such table" in text or "doesn't exist" in text or "does not exist" in text


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


def _external_text(doc) -> str:
    if not isinstance(doc, dict):
        return ""
    return str(doc.get("external_id") or "").strip()


def _touch_row(doc: dict) -> dict:
    """Yazılan belgenin değişim damgası. API bunu istemciye vermeden ayıklar."""
    body = dict(doc)
    body["_row_updated_at"] = datetime.now(timezone.utc).isoformat()
    return body


def _distinct_values(docs, key):
    seen = []
    for doc in docs or []:
        for value in values_at(doc, key) or []:
            if value not in seen:
                seen.append(value)
    return seen


def _pipeline_match(pipeline):
    for stage in pipeline or []:
        if isinstance(stage, dict) and "$match" in stage:
            query = stage.get("$match")
            return query if isinstance(query, dict) else None
    return None


def _owned_window(docs, company_id, since, limit):
    """Firma sahibi süzgeci, ardından changed_window. NULL company_id kalır."""
    kept = []
    for doc in docs or []:
        owner = str(doc.get("company_id") or company_id)
        if storage_router.canonical_company_id(owner) != company_id:
            continue
        kept.append(doc)
    return changed_window(kept, since, limit)


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

    def _narrow_sql(self, query):
        """İndeksli doc_id / company_id daraltması. Eşleşmeyi match_query doğrular."""
        sql = "SELECT doc FROM storage_records WHERE collection = ?"
        args = [self.name]
        if not isinstance(query, dict):
            return sql, args
        ident = query.get("_id")
        if isinstance(ident, str):
            sql += " AND doc_id = ?"
            args.append(ident)
        elif isinstance(ident, dict):
            items = ident.get("$in")
            if isinstance(items, (list, tuple)) and all(isinstance(item, str) for item in items):
                if items:
                    marks = ",".join("?" for _ in items)
                    sql += f" AND doc_id IN ({marks})"
                    args.extend(items)
                elif set(ident.keys()) == {"$in"}:
                    sql += " AND 1=0"
        company = query.get("company_id")
        if isinstance(company, str) and len(company) <= 64:
            sql += " AND company_id = ?"
            args.append(company)
        return sql, args

    def _fetch_rows(self, session, query):
        sql, args = self._narrow_sql(query)
        return list(session.fetchall(sql, tuple(args)))

    def _load(self, session, query=None) -> list:
        return [loads(row[0]) for row in self._fetch_rows(session, query)]

    def _matched(self, session, query) -> list:
        return [doc for doc in self._load(session, query) if match_query(doc, query)]

    def _warn_missing_bank_key(self) -> None:
        cid = str(self.company_id or "")
        if cid in _missing_bank_key_logged:
            return
        _missing_bank_key_logged.add(cid)
        _log.warning(
            "storage_bank_external yok company=%s; banka external_id taraması kullanılıyor",
            _safe_id(cid),
        )

    def _key_table_ready(self, session) -> bool:
        """Anahtar tablosu yoksa veya varlık sorgusu 1146 verirse tarama yeter."""
        try:
            present = _BANK_KEY_TABLE in session.tables()
        except Exception as exc:
            if _missing_table(exc):
                self._warn_missing_bank_key()
                return False
            raise
        if not present:
            self._warn_missing_bank_key()
            return False
        return True

    def _release_bank_external(self, session, doc_id) -> None:
        if self.name != "bank_transactions" or not doc_id:
            return
        if not self._key_table_ready(session):
            return
        try:
            session.execute(
                f"DELETE FROM {_BANK_KEY_TABLE} WHERE company_id = ? AND doc_id = ?",
                (self.company_id, str(doc_id)),
            )
        except Exception as exc:
            if _missing_table(exc):
                self._warn_missing_bank_key()
                return
            raise

    def _claim_bank_external(self, session, doc: dict, *, inserting: bool) -> None:
        """(company_id, external_id) banka hareketinde tek olsun.

        Güncelleme mevcut kopyayı bozmaz; yeni ekleme aynı external_id'yi reddeder.
        Anahtar tablosu yoksa veya MySQL 1146 verirse tarama ikinci eklemeyi keser.
        """
        if self.name != "bank_transactions":
            return
        ext = _external_text(doc)
        if not ext:
            return
        own = str(doc.get("_id") or "")
        conflict = False
        for existing in self._load(session):
            if str(existing.get("_id") or "") == own:
                continue
            if _external_text(existing) != ext:
                continue
            owner = str(existing.get("company_id") or "")
            if owner and storage_router.canonical_company_id(owner) != self.company_id:
                continue
            conflict = True
            break
        if conflict:
            if inserting:
                raise DuplicateKeyError("Kayıt zaten var.")
            return
        if len(ext) > _EXT_MAX or not own:
            return
        if not self._key_table_ready(session):
            return
        self._release_bank_external(session, own)
        try:
            session.execute(
                f"INSERT INTO {_BANK_KEY_TABLE} (company_id, external_id, doc_id) VALUES (?, ?, ?)",
                (self.company_id, ext, own),
            )
        except Exception as exc:
            if _missing_table(exc):
                self._warn_missing_bank_key()
                return
            if _duplicate(exc):
                raise DuplicateKeyError("Kayıt zaten var.") from None
            raise

    def _write(self, session, doc: dict, *, inserting: bool = False) -> None:
        body = _touch_row(doc)
        if not body.get("_id"):
            body["_id"] = str(uuid.uuid4())
        _reject_field_lengths(body["_id"], body)
        self._claim_bank_external(session, body, inserting=inserting)
        session.execute(
            _upsert_sql(session.dialect),
            (self.name, str(body["_id"]), dumps(body)),
        )

    def _delete_ids(self, session, ids) -> int:
        removed = 0
        for doc_id in ids:
            self._release_bank_external(session, doc_id)
            session.execute(
                "DELETE FROM storage_records WHERE collection = ? AND doc_id = ?",
                (self.name, str(doc_id)),
            )
            removed += 1
        return removed

    def find(self, query=None, projection=None):
        self._guard("find", query=query)

        async def load():
            rows = self._run(lambda session: self._fetch_rows(session, query))
            return await materialize_docs_async(rows, query)

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

    async def changed_since(self, since=None, company_id=None, limit: int = 3000):
        """storage_records satırları. Paylaşılan docs tablosu okunmaz."""
        self._guard("changed_since", company_id=company_id)
        requested = str(company_id or "").strip()
        if requested and storage_router.canonical_company_id(requested) != self.company_id:
            return [], since, False
        rows = self._run(lambda session: self._fetch_rows(session, None))
        docs = await materialize_docs_async(rows)
        return await offload(_owned_window, docs, self.company_id, since, limit, size=len(docs))

    async def count_documents(self, query=None):
        self._guard("count_documents", query=query)
        rows = self._run(lambda session: self._fetch_rows(session, query))
        docs = await materialize_docs_async(rows, query)
        return len(docs)

    async def distinct(self, key, query=None):
        self._guard("distinct", query=query)
        rows = self._run(lambda session: self._fetch_rows(session, query))
        docs = await materialize_docs_async(rows, query)
        return await offload(_distinct_values, docs, key, size=len(docs))

    def aggregate(self, pipeline):
        self._guard("aggregate", pipeline=pipeline)
        match = _pipeline_match(pipeline)

        async def load():
            rows = self._run(lambda session: self._fetch_rows(session, match))
            docs = await materialize_docs_async(rows)
            return await offload(aggregate_rows, docs, pipeline, size=len(docs))

        return ListCursor(load)

    async def insert_one(self, doc: dict):
        self._guard("insert_one", doc=doc)
        body = _touch_row(copy.deepcopy(doc or {}))
        if not body.get("_id"):
            body["_id"] = str(uuid.uuid4())
        _reject_field_lengths(body["_id"], body)
        await self._reject_locked()

        def work(session):
            try:
                self._claim_bank_external(session, body, inserting=True)
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
                self._write(session, created, inserting=True)
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
                self._write(session, created, inserting=True)
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
                self._write(session, body, inserting=True)
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
                self._write(session, created, inserting=True)
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


def _migrate_sealed(sealed: str) -> int:
    """Bekleyen migration. Uygulanmış sürüm yeniden yazılmaz. DSN loglanmaz."""
    from storage_migrations.engine import apply as apply_schema
    from storage_migrations.session import connect
    from storage_migrations.targets import unseal_dedicated_ref

    dsn = unseal_dedicated_ref(sealed)
    add_secret(dsn)
    session = connect(dsn, write=True)
    try:
        result = apply_schema(session, confirm=True, dry_run=False)
        return int(result.advanced)
    finally:
        try:
            session.close()
        except Exception:
            pass


async def apply_pending_schemas(docs) -> list[dict]:
    """Dedicated belgelerdeki bekleyen şema adımları.

    Legacy atlanır. Mührü olmayan dedicated satır da atlanır. Bir şirket
    kesilirse diğerleri sürer. Dönüş company_id, advanced ve ok taşır.
    """
    import asyncio

    report = []
    seen = set()
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        mode, _epoch, _locked = storage_router._view(doc)
        if mode != storage_router.DEDICATED:
            continue
        cid = storage_router.canonical_company_id(str(doc.get("_id") or doc.get("id") or ""))
        if not cid or cid in seen:
            continue
        seen.add(cid)
        sealed = doc.get(storage_router.DSN_FIELD)
        label = _safe_id(cid)
        if not isinstance(sealed, str) or not sealed.strip():
            continue
        try:
            advanced = await asyncio.to_thread(_migrate_sealed, sealed)
        except Exception as exc:
            _log.warning(
                "dedicated migration atlandı company=%s error=%s",
                label,
                type(exc).__name__,
            )
            report.append({"company_id": label, "ok": False, "advanced": 0, "error": type(exc).__name__})
            continue
        _log.info("dedicated migration company=%s advanced=%s", label, advanced)
        report.append({"company_id": label, "ok": True, "advanced": advanced, "error": ""})
    return report
