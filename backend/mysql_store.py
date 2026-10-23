"""MySQL-backed document store with a Motor/MongoDB-like async API.

TamKobi historically used MongoDB collections. This module stores the same
JSON documents in MySQL 8 (utf8mb4 + JSON column) so existing backend code
keeps using db.<collection>.find / update_one / etc.
"""
from __future__ import annotations

import asyncio
import contextvars
import copy
import json
import os
import re
import sys
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

import db_ssl

MISSING = object()
# Bayrak kapalıyken bu liste değişmez. Taşımanın kendi silmeleri
# tag_tombstone ile move_id yazar; genel dışlama buraya eklenmez.
SKIP_TOMBSTONE = frozenset({
    "sync_tombstones",
    "trash",
    "login_attempts",
    "activity_logs",
    "notifications",
})
_tombstone_move_id: contextvars.ContextVar[str] = contextvars.ContextVar(
    "storage_tombstone_move_id",
    default="",
)


@contextmanager
def tag_tombstone(move_id: str):
    """Bu bloktaki silmelerin mezar taşına move_id yazar."""
    token = _tombstone_move_id.set(str(move_id or ""))
    try:
        yield
    finally:
        _tombstone_move_id.reset(token)


def iso_ts(value) -> str:
    if value is None:
        return datetime.now(timezone.utc).isoformat()
    if isinstance(value, datetime):
        ts = value if value.tzinfo else value.replace(tzinfo=timezone.utc)
        return ts.astimezone(timezone.utc).isoformat()
    text = str(value).replace(" ", "T")
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return datetime.now(timezone.utc).isoformat()
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat()


def parse_ts(value: Optional[str]):
    if not value:
        return None
    text = str(value).strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).replace(tzinfo=None)


def _doc_change_stamp(doc: dict):
    """Satırın değişim anı. Yazının damgası, yoksa belgedeki updated_at / created_at."""
    if not isinstance(doc, dict):
        return None
    for key in ("_row_updated_at", "updated_at", "created_at"):
        raw = doc.get(key)
        if not raw:
            continue
        parsed = parse_ts(str(raw))
        if parsed is not None:
            return parsed
    return None


def changed_window(docs, since: Optional[str], limit: int = 3000):
    """changed_since sayfası. since boşsa tamamı. Sınır satırı tekrar gelir.

    Dönüş: (belgeler, cursor, more). Cursor ISO zamandır.
    """
    parsed = parse_ts(since)
    try:
        cap = int(limit)
    except (TypeError, ValueError):
        cap = 3000
    if cap < 1:
        cap = 1
    ranked = []
    for doc in docs or []:
        if not isinstance(doc, dict):
            continue
        stamp = _doc_change_stamp(doc)
        ranked.append((stamp or datetime.min, str(doc.get("_id") or ""), stamp, doc))
    ranked.sort(key=lambda item: (item[0], item[1]))
    if parsed is not None:
        ranked = [item for item in ranked if item[2] is not None and item[2] >= parsed]
    more = len(ranked) > cap
    page = ranked[:cap]
    out = []
    cursor = since
    for _order, _ident, stamp, doc in page:
        body = dict(doc)
        if stamp is not None:
            text = iso_ts(stamp)
            body["_row_updated_at"] = text
            cursor = text
        out.append(body)
    if not out and parsed is None:
        cursor = iso_ts(datetime.now(timezone.utc))
    elif not out:
        cursor = since
    return out, cursor, more


def _audit_sql(op: str, collection: str, doc_id=None, duration_ms: float = 0, **fields):
    try:
        from applog import log_sql
        log_sql(op, collection, doc_id=doc_id, duration_ms=duration_ms, **fields)
    except Exception:
        pass


_LOCK_OPS = frozenset({
    "insert_one",
    "insert_many",
    "update_one",
    "update_many",
    "update_one_atomic",
    "replace_one",
    "delete_one",
    "delete_many",
    "find_one_and_update",
})


def _guard(name, op, **kw):
    """Kiracı koruması. Yazmayı bozmaz; yalnız TenantScopeViolation yukarı çıkar.

    Yönlendirici açıkken yazma, katalogdaki storage_write_lock alanına bakar.
    Bayrak kapalıyken bu kontrol çalışmaz.
    """
    catalog = kw.pop("catalog", None)
    try:
        from tenant_scope import TenantScopeViolation, check
    except Exception:
        check = None
        TenantScopeViolation = ()  # type: ignore
    if check is not None:
        try:
            check(name, op, **kw)
        except TenantScopeViolation:
            raise
        except Exception:
            pass
    if op not in _LOCK_OPS:
        return
    try:
        import storage_router
    except Exception:
        return
    if not storage_router.enabled():
        return
    cid = _lock_company(op, kw)
    if cid:
        storage_router.assert_writable(cid, db=catalog)


def _lock_company(op, kw) -> str:
    doc = kw.get("doc")
    query = kw.get("query")
    if op == "insert_one" and isinstance(doc, dict):
        return str(doc.get("company_id") or "")
    if op == "insert_many" and isinstance(doc, (list, tuple)):
        for item in doc:
            if isinstance(item, dict) and item.get("company_id"):
                return str(item.get("company_id"))
        return ""
    if op == "replace_one" and isinstance(doc, dict) and doc.get("company_id"):
        return str(doc.get("company_id"))
    if isinstance(query, dict) and isinstance(query.get("company_id"), str):
        return query["company_id"]
    update = kw.get("update")
    if isinstance(update, dict):
        for key in ("$set", "$setOnInsert"):
            body = update.get(key)
            if isinstance(body, dict) and body.get("company_id"):
                return str(body.get("company_id"))
    return ""


def _maintenance_company_ids(op, kw) -> list:
    import storage_router

    found = _catalog_company_ids(kw.get("query"), kw.get("doc"), kw.get("update"))
    cid = _lock_company(op, kw)
    if cid:
        text = storage_router.canonical_company_id(cid)
        if text and text not in found:
            found.append(text)
    return found


async def _reject_maintenance(coll, op: str, **kw) -> None:
    """Bakım (storage_write_lock) yazmayı keser. Okuma bu fonksiyona gelmez.

    Kontrol koleksiyonu ve taşımanın yazarı geçer. Bellek kataloğunda sayaç artmaz.
    """
    if op not in _LOCK_OPS:
        return
    import storage_router

    if storage_router._PASSTHROUGH.get():
        return
    name = str(getattr(coll, "name", "") or "")
    if name in storage_router._CONTROL_COLLECTIONS:
        return
    db = getattr(coll, "_db", None) or getattr(coll, "db", None)
    for cid in _maintenance_company_ids(op, kw):
        if storage_router._writer.get() == cid:
            continue
        if await storage_router.maintenance_locked(db, cid):
            raise storage_router.StorageWriteLocked(
                storage_router.WRITE_LOCK_MESSAGE, company_id=cid,
            )


def _reject_maintenance_sync(coll, op: str, **kw) -> None:
    """Senkron yazma. Olay döngüsünde pymysql açmaz; yalnız taze önbelleğe bakar."""
    if op not in _LOCK_OPS:
        return
    import storage_router

    if storage_router._PASSTHROUGH.get():
        return
    name = str(getattr(coll, "name", "") or "")
    if name in storage_router._CONTROL_COLLECTIONS:
        return
    db = getattr(coll, "_db", None) or getattr(coll, "db", None)
    on_loop = storage_router._on_loop()
    for cid in _maintenance_company_ids(op, kw):
        if storage_router._writer.get() == cid:
            continue
        if on_loop:
            if storage_router.maintenance_cached(cid):
                raise storage_router.StorageWriteLocked(
                    storage_router.WRITE_LOCK_MESSAGE, company_id=cid,
                )
            continue
        if storage_router.company_write_locked(cid, db=db):
            raise storage_router.StorageWriteLocked(
                storage_router.WRITE_LOCK_MESSAGE, company_id=cid,
            )


async def _route_write(coll, op: str, **kw):
    import storage_router

    await _reject_maintenance(coll, op, **kw)
    return await storage_router.route_legacy_write(coll, op, **kw)


async def _route_read(coll, query):
    """Dedicated/shared_v2 okuması. None ise katalog sürer. DSN hatası yukarı çıkar."""
    import storage_router

    return await storage_router.route_legacy_read(coll, query)


def _aligned_query(query):
    import storage_router

    return storage_router.align_query_company(query)


def _catalog_company_ids(query=None, doc=None, update=None) -> list:
    import storage_router

    found = []

    def add(value) -> None:
        if not isinstance(value, str):
            return
        text = storage_router.canonical_company_id(value)
        if text and text not in found:
            found.append(text)

    direct = storage_router._query_company_id(query)
    if direct and direct not in found:
        found.append(direct)
    if isinstance(doc, dict):
        add(doc.get("company_id"))
    elif isinstance(doc, (list, tuple)):
        for item in doc:
            if isinstance(item, dict):
                add(item.get("company_id"))
    if isinstance(update, dict):
        for key in ("$set", "$setOnInsert"):
            body = update.get(key)
            if isinstance(body, dict):
                add(body.get("company_id"))
    return found


def _catalog_db(coll):
    return getattr(coll, "_db", None) or getattr(coll, "db", None)


def _catalog_skips(coll, cid: str) -> bool:
    import storage_router

    if not storage_router.enabled() or storage_router._PASSTHROUGH.get():
        return True
    name = str(getattr(coll, "name", "") or "")
    if name in storage_router._CONTROL_COLLECTIONS:
        return True
    if not cid or storage_router._writer.get() == cid:
        return True
    return False


async def _block_shared_copy(coll, *, query=None, doc=None, update=None, write: bool = False) -> None:
    """Dedicated/shared_v2 paylaşılan docs kopyasına inmez.

    Bayrak kapalı, kontrol koleksiyonu, legacy ve taşımanın yazarı serbest.
    Okuma ile yazma `storage_decision` kullanır.
    """
    import storage_router

    db = _catalog_db(coll)
    for cid in _catalog_company_ids(query, doc, update):
        if _catalog_skips(coll, cid):
            continue
        mode, _epoch, locked = await storage_router.storage_decision(db, cid)
        if mode == storage_router.LEGACY:
            continue
        if locked and write:
            raise storage_router.StorageWriteLocked(
                storage_router.WRITE_LOCK_MESSAGE, company_id=cid,
            )
        raise storage_router.StorageModeError(
            storage_router.catalog_blocked_message(mode, cid, write=write),
            company_id=cid,
            mode=mode,
        )


def _sync_catalog_mode(db, cid: str) -> str:
    import storage_router

    cached = storage_router._view_cached(cid)
    if cached is not None:
        return cached[0]
    if db is not None:
        memory = storage_router._memory_doc(db, cid)
        if memory is not storage_router._UNREAD:
            return storage_router._mode_from_doc(memory if isinstance(memory, dict) else None)
    if storage_router._on_loop():
        return "unknown"
    mode, _epoch, _locked = storage_router.storage_decision_sync(db, cid)
    return mode


def _block_shared_copy_sync(coll, *, query=None, doc=None, update=None, write: bool = False) -> None:
    """Senkron yol dedicated satırı docs tablosundan okumaz ve yazmaz."""
    import storage_router

    db = _catalog_db(coll)
    for cid in _catalog_company_ids(query, doc, update):
        if _catalog_skips(coll, cid):
            continue
        mode = _sync_catalog_mode(db, cid)
        if mode == storage_router.LEGACY:
            continue
        if mode == "unknown":
            message = f"Kip doğrulanamadı; paylaşılan katalog kullanılmadı. company={cid}"
            known = ""
        else:
            message = storage_router.catalog_blocked_message(mode, cid, write=write)
            known = mode
        raise storage_router.StorageModeError(message, company_id=cid, mode=known)


def _pipeline_match(pipeline) -> dict:
    for stage in pipeline or []:
        if isinstance(stage, dict) and isinstance(stage.get("$match"), dict):
            return stage["$match"]
    return {}


def _route_write_sync(coll, op: str, **kw):
    import storage_router

    _reject_maintenance_sync(coll, op, **kw)
    return storage_router.route_legacy_write_sync(coll, op, **kw)


class DuplicateKeyError(Exception):
    pass


class InsertOneResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class InsertManyResult:
    def __init__(self, inserted_ids):
        self.inserted_ids = inserted_ids


class UpdateResult:
    def __init__(self, matched_count=0, modified_count=0, upserted_id=None):
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class DeleteResult:
    def __init__(self, deleted_count=0):
        self.deleted_count = deleted_count


def mysql_settings_from_env() -> Dict[str, Any]:
    try:
        from setup_state import load_database_settings
        file_cfg = load_database_settings()
    except Exception:
        file_cfg = None
    if file_cfg:
        return file_cfg
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("mysql"):
        # Accept mysql://, mysql+pymysql://, mysql+aiomysql://
        if url.startswith("mysql+"):
            url = "mysql://" + url.split("://", 1)[1]
        parsed = urlparse(url)
        db = (parsed.path or "/tamkobi").lstrip("/") or "tamkobi"
        host = parsed.hostname or "127.0.0.1"
        ssl_mode, ssl_ca = db_ssl.resolve(host)
        return {
            "host": host,
            "port": parsed.port or 3306,
            "user": unquote(parsed.username or "root"),
            "password": unquote(parsed.password or ""),
            "db": db.split("?")[0] or "tamkobi",
            "charset": "utf8mb4",
            "autocommit": True,
            "ssl_mode": ssl_mode,
            "ssl_ca": ssl_ca,
        }
    host = os.environ.get("MYSQL_HOST", "127.0.0.1")
    ssl_mode, ssl_ca = db_ssl.resolve(host)
    return {
        "host": host,
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ.get("MYSQL_USER", "tamkobi"),
        "password": os.environ.get("MYSQL_PASSWORD") or "",
        "db": os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or "tamkobi",
        "charset": "utf8mb4",
        "autocommit": True,
        "ssl_mode": ssl_mode,
        "ssl_ca": ssl_ca,
    }


def dumps(doc: dict) -> str:
    return json.dumps(doc, ensure_ascii=False, default=str)


def loads(raw) -> dict:
    if raw is None:
        return {}
    if isinstance(raw, (bytes, bytearray)):
        raw = raw.decode("utf-8")
    if isinstance(raw, dict):
        return raw
    return json.loads(raw)


REPLACE_BATCH = 200


def chunk_list(items: Optional[Sequence[Any]], size: int = REPLACE_BATCH) -> List[list]:
    """Split a sequence into slices of `size` (at least 1)."""
    n = max(1, int(size or 1))
    seq = list(items or [])
    return [seq[i:i + n] for i in range(0, len(seq), n)]


def index_spec_parts(item):
    """(fields, unique, partialFilterExpression or None)."""
    if not isinstance(item, (list, tuple)) or not item:
        return (), False, None
    fields = item[0] if isinstance(item[0], (list, tuple)) else (item[0],)
    unique = bool(item[1]) if len(item) > 1 else False
    partial = item[2] if len(item) > 2 and isinstance(item[2], dict) and item[2] else None
    return fields, unique, partial


def has_unique_index(indexes) -> bool:
    """True when any stored index spec is unique (sku/barcode on products are not)."""
    for item in indexes or []:
        if len(item) >= 2 and bool(item[1]):
            return True
    return False


def _bson_type_matches(val, type_name) -> bool:
    if type_name == "string":
        return isinstance(val, str)
    if type_name in ("number", "double"):
        return isinstance(val, (int, float)) and not isinstance(val, bool)
    if type_name == "int":
        return isinstance(val, int) and not isinstance(val, bool)
    if type_name == "bool":
        return isinstance(val, bool)
    if type_name == "object":
        return isinstance(val, dict)
    if type_name == "array":
        return isinstance(val, list)
    return True


def unique_index_applies(doc: dict, partial) -> bool:
    """Partial unique index: documents outside partialFilterExpression do not collide."""
    if not partial:
        return True
    if not isinstance(doc, dict) or not isinstance(partial, dict):
        return False
    for key, cond in partial.items():
        if isinstance(cond, dict) and "$type" in cond and not str(key).startswith("$"):
            val = scalar_at(doc, key)
            if val is MISSING or not _bson_type_matches(val, cond.get("$type")):
                return False
            rest = {op: rhs for op, rhs in cond.items() if op != "$type"}
            if rest and not match_query(doc, {key: rest}):
                return False
            continue
        if not match_query(doc, {key: cond}):
            return False
    return True


_SAFE_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_DATEISH = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?")
_PREFIX_RE = re.compile(r"^\^[\w.\-/]+$")
# Generated STORED columns. SQL must name the column (not JSON_EXTRACT) so
# idx_docs_coll_company* can be used.
_INDEXED_DOC_FIELDS = ("account_id", "partner_id")
_GENERATED_DOC_COLUMNS = (
    ("company_id", "$.company_id", "VARCHAR(64)"),
    ("account_id", "$.account_id", "VARCHAR(191)"),
    ("partner_id", "$.partner_id", "VARCHAR(191)"),
)
_GENERATED_DOC_INDEXES = (
    ("idx_docs_coll_company", "(collection, company_id)"),
    ("idx_docs_coll_company_account", "(collection, company_id, account_id)"),
    ("idx_docs_coll_company_partner", "(collection, company_id, partner_id)"),
)


def _json_unquote(field: str) -> str:
    return f"JSON_UNQUOTE(JSON_EXTRACT(doc,'$.{field}'))"


def sql_pushdown(collection: str, query: Optional[dict]) -> Tuple[str, list]:
    """Prefilter `docs` in MySQL. Caller still applies match_query for correctness."""
    if query and list(query.keys()) == ["_id"] and not isinstance(query.get("_id"), dict):
        return "SELECT doc FROM docs WHERE collection=%s AND id=%s", [collection, str(query["_id"])]
    clauses = ["collection=%s"]
    params: list = [collection]
    for k, v in (query or {}).items():
        if str(k).startswith("$") or not _SAFE_FIELD.match(k):
            continue
        if k == "_id" and not isinstance(v, dict):
            clauses.append("id=%s")
            params.append(str(v))
            continue
        if k == "_id" and isinstance(v, dict) and "$in" in v and v["$in"]:
            ids = [str(x) for x in v["$in"]]
            ph = ",".join(["%s"] * len(ids))
            clauses.append(f"id IN ({ph})")
            params.extend(ids)
            continue
        if k == "company_id" and not isinstance(v, dict):
            clauses.append("company_id=%s")
            params.append(str(v))
            continue
        expr = k if k in _INDEXED_DOC_FIELDS else _json_unquote(k)
        if not isinstance(v, dict):
            # None ve sayılar SQL'de metne çevrilince eşleşmez (str(None) == "None"),
            # JSON null ile karşılaştırma da yanlış sonuç verir; bunları Python tarafına bırak.
            if v is None or isinstance(v, (bool, int, float)):
                continue
            clauses.append(f"{expr} = %s")
            params.append(str(v))
            continue
        if "$regex" in v:
            rx = str(v.get("$regex") or "")
            if _PREFIX_RE.match(rx):
                clauses.append(f"{expr} LIKE %s")
                params.append(rx[1:] + "%")
        for op, sqlop in (("$gte", ">="), ("$lte", "<="), ("$gt", ">"), ("$lt", "<")):
            if op not in v:
                continue
            val = v[op]
            if isinstance(val, bool) or isinstance(val, (int, float)):
                continue
            sval = str(val)
            if not _DATEISH.match(sval):
                continue
            clauses.append(f"{expr} {sqlop} %s")
            params.append(sval)
        if "$ne" in v and isinstance(v["$ne"], str):
            clauses.append(f"({expr} <> %s OR {expr} IS NULL)")
            params.append(v["$ne"])
        if "$in" in v and v["$in"] and all(isinstance(x, str) for x in v["$in"]):
            ph = ",".join(["%s"] * len(v["$in"]))
            clauses.append(f"{expr} IN ({ph})")
            params.extend(v["$in"])
        if "$nin" in v and v["$nin"] and all(isinstance(x, str) for x in v["$nin"]):
            ph = ",".join(["%s"] * len(v["$nin"]))
            clauses.append(f"({expr} NOT IN ({ph}) OR {expr} IS NULL)")
            params.extend(v["$nin"])
    return "SELECT doc FROM docs WHERE " + " AND ".join(clauses), params


def sql_company_ids(collection: str, query: Optional[dict]) -> Tuple[str, list]:
    """Aynı süzgeç, yalnız company_id kolonu. Belge gövdesi okunmaz."""
    sql, params = sql_pushdown(collection, query)
    prefix = "SELECT doc FROM "
    if not sql.startswith(prefix):
        raise ValueError("company_id sorgusu kurulamadı")
    return "SELECT DISTINCT company_id FROM " + sql[len(prefix):], params


def sql_count_exact(collection: str, query: Optional[dict]) -> Optional[Tuple[str, list]]:
    """COUNT(*) SQL when every query clause is fully pushable (no Python post-filter).

    Used by count_documents to avoid loading JSON blobs for simple KPI/list counts.
    Returns None when any clause must stay in Python (bool/None/numeric/$or/…).
    """
    q = query or {}
    if any(str(k).startswith("$") for k in q):
        return None
    for k, v in q.items():
        if not _SAFE_FIELD.match(k):
            return None
        if k == "_id":
            if isinstance(v, dict):
                if list(v.keys()) != ["$in"] or not v.get("$in") or not all(isinstance(x, (str, int)) for x in v["$in"]):
                    return None
            elif not isinstance(v, (str, int)):
                return None
            continue
        if k == "company_id" and not isinstance(v, dict):
            continue
        if not isinstance(v, dict):
            if v is None or isinstance(v, (bool, int, float)):
                return None
            continue
        # Operators — only those sql_pushdown always applies.
        allowed = set(v.keys())
        if not allowed or not allowed.issubset({"$in", "$nin", "$ne", "$regex", "$gte", "$lte", "$gt", "$lt"}):
            return None
        if "$in" in v and (not v["$in"] or not all(isinstance(x, str) for x in v["$in"])):
            return None
        if "$nin" in v and (not v["$nin"] or not all(isinstance(x, str) for x in v["$nin"])):
            return None
        if "$ne" in v and not isinstance(v["$ne"], str):
            return None
        if "$regex" in v:
            rx = str(v.get("$regex") or "")
            if not _PREFIX_RE.match(rx):
                return None
        for op in ("$gte", "$lte", "$gt", "$lt"):
            if op not in v:
                continue
            val = v[op]
            if isinstance(val, (bool, int, float)) or not _DATEISH.match(str(val)):
                return None
    select_sql, params = sql_pushdown(collection, q)
    count_sql = select_sql.replace("SELECT doc FROM", "SELECT COUNT(*) FROM", 1)
    return count_sql, params


# --- Exact read pushdown (ORDER BY / LIMIT / projection) -----------------
#
# find().sort().limit()/to_list() used to: sql_pushdown (a partial WHERE) →
# fetch every matching doc as JSON → match_query → sort_docs → slice →
# project_doc. This planner runs only when the WHOLE read is equivalent to
# that pipeline. Otherwise the caller keeps the old path unchanged.
# There is no mixed mode (SQL LIMIT on a filter Python still has to recheck).

_SQL_SORT_FIELDS = frozenset({"created_at", "date", "issue_date", "account_name"})
_PY_OP_ORDER = ("$regex", "$in", "$nin", "$ne", "$exists", "$gt", "$gte", "$lt", "$lte", "$eq", "$not", "$elemMatch")
_DATE_SQL = (("$gt", ">"), ("$gte", ">="), ("$lt", "<"), ("$lte", "<="))
_PARSE_IN_THREAD_AT = 2000
_OFFLOAD_AT = 32
_MAX_SQL_LIMIT = 18446744073709551615
_HOT_NAMES = frozenset({"companies", "users"})
_HOT_MAX = 2048
_SQL_SLOT: contextvars.ContextVar = contextvars.ContextVar("mysql_sql_slot", default=None)


def sql_page_pushdown_enabled() -> bool:
    """SQL page pushdown stays off unless MYSQL_STORE_SQL_PUSHDOWN is enabled.

    Only ``1``, ``true``, ``yes``, and ``on`` turn it on. Unset, empty, ``0``,
    and any other value keep the previous Python read path. On a server, set
    ``MYSQL_STORE_SQL_PUSHDOWN=1`` and restart to enable; set ``0`` and restart
    to roll back.
    """
    raw = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
    if raw is None:
        return False
    return str(raw).strip().lower() in {"1", "true", "yes", "on"}


def _loads_rows(rows) -> List[dict]:
    return [loads(r[0]) for r in rows or []]


async def _loads_rows_async(rows) -> List[dict]:
    if rows is not None and len(rows) >= _PARSE_IN_THREAD_AT:
        return await asyncio.to_thread(_loads_rows, rows)
    return _loads_rows(rows)


def _hot_ttl() -> float:
    try:
        value = float(os.environ.get("HOT_DOC_CACHE_TTL", "5"))
    except (TypeError, ValueError):
        value = 5.0
    return value if value >= 0 else 0.0


class _HotDocs:
    """companies/users için süreç içi kısa TTL. İstekten bağımsızdır."""

    def __init__(self):
        self._items: Dict[tuple, tuple] = {}

    def get(self, name: str, doc_id: str):
        if _hot_ttl() <= 0:
            return None
        key = (name, str(doc_id))
        row = self._items.get(key)
        if not row:
            return None
        expires, doc = row
        if time.monotonic() >= expires:
            self._items.pop(key, None)
            return None
        return copy.deepcopy(doc)

    def put(self, name: str, doc: dict) -> None:
        if name not in _HOT_NAMES or _hot_ttl() <= 0 or not isinstance(doc, dict):
            return
        ident = doc.get("_id")
        if ident is None:
            return
        self._items[(name, str(ident))] = (time.monotonic() + _hot_ttl(), copy.deepcopy(doc))
        if len(self._items) > _HOT_MAX:
            self._items.clear()

    def drop(self, name: str, doc_id=None) -> None:
        if name not in _HOT_NAMES and doc_id is None:
            return
        if doc_id is None:
            self._items = {key: val for key, val in self._items.items() if key[0] != name}
            return
        self._items.pop((name, str(doc_id)), None)

    def clear(self) -> None:
        self._items.clear()


_hot_docs = _HotDocs()


def lookup_hot(name: str, doc_id: str):
    return _hot_docs.get(name, doc_id)


def remember_hot(name: str, doc: dict) -> None:
    _hot_docs.put(name, doc)


def forget_hot(name: str, doc_id=None) -> None:
    _hot_docs.drop(name, doc_id)


def note_hot_write(name: str, doc_id=None) -> None:
    """Yazma önbelleği düşürür. Okuma bir sonraki turda taze belge alır."""
    forget_hot(name, doc_id)


def clear_hot_cache() -> None:
    _hot_docs.clear()


def hot_ident(name: str, query, skip=0):
    if name not in _HOT_NAMES or skip:
        return None
    if not isinstance(query, dict) or set(query.keys()) != {"_id"}:
        return None
    value = query.get("_id")
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return None
    return str(value)


def _caller_label() -> str:
    """Yavaş sorgu uyarısındaki çağıran. Sorgu parametresi ve VKN yazılmaz."""
    endpoint = ""
    try:
        import applog
        endpoint = applog.current_sql_endpoint()
    except Exception:
        endpoint = ""
    fn = ""
    frame = sys._getframe(1)
    for _ in range(16):
        frame = frame.f_back
        if frame is None:
            break
        mod = str(frame.f_globals.get("__name__") or "")
        if "mysql_store" in mod or mod.startswith("asyncio"):
            continue
        short = mod.rsplit(".", 1)[-1]
        fn = f"{short}.{frame.f_code.co_name}"
        break
    text = " ".join(part for part in (endpoint, fn) if part)
    text = re.sub(r"\d{10,}", "#", text)
    return text[:160]


def _emit_sql_slot(process_ms: float = 0) -> None:
    slot = _SQL_SLOT.get()
    if not slot:
        return
    _SQL_SLOT.set(None)
    acquire_ms = float(slot.get("acquire_ms") or 0)
    query_ms = float(slot.get("query_ms") or 0)
    if process_ms <= 0 and slot.get("mark"):
        process_ms = (time.perf_counter() - float(slot["mark"])) * 1000
    _audit_sql(
        "SELECT",
        slot.get("collection") or "",
        duration_ms=acquire_ms + query_ms + process_ms,
        acquire_ms=round(acquire_ms, 1),
        query_ms=round(query_ms, 1),
        process_ms=round(process_ms, 1),
        caller=_caller_label(),
    )


async def offload(fn, *args, size: int = 0):
    """Büyük Python işini event loop dışına alır. Küçük liste aynı sonucu yerinde üretir."""
    if size >= _OFFLOAD_AT:
        return await asyncio.to_thread(fn, *args)
    return fn(*args)


def _filter_docs(docs, query) -> List[dict]:
    if not query:
        return list(docs or [])
    return [doc for doc in docs or [] if match_query(doc, query)]


async def filter_matching(docs, query) -> List[dict]:
    if not query:
        return list(docs or [])
    return await offload(_filter_docs, docs, query, size=len(docs or []))


def materialize_docs(rows, query=None) -> List[dict]:
    docs = [loads(row[0]) for row in rows or []]
    if query:
        return [doc for doc in docs if match_query(doc, query)]
    return docs


async def materialize_docs_async(rows, query=None) -> List[dict]:
    return await offload(materialize_docs, rows, query, size=len(rows or []))


def _finish_read(docs, sort, skip, limit, length, projection) -> List[dict]:
    rows = sort_docs(list(docs or []), sort)
    if skip:
        rows = rows[skip:]
    cap = length if length is not None else limit
    if limit is not None:
        rows = rows[:limit]
    if cap is not None:
        rows = rows[:cap]
    return [project_doc(doc, projection) for doc in rows]


def changed_since_sql(collection: str, since: Optional[str], company_id: Optional[str], limit: int):
    """changed_since sayfası. company_id kısa ise indeksli kolon, değilse JSON."""
    sql = "SELECT doc, updated_at FROM docs WHERE collection=%s"
    args: List[Any] = [collection]
    parsed = parse_ts(since)
    if parsed is not None:
        sql += " AND updated_at >= %s"
        args.append(parsed)
    if company_id:
        if len(str(company_id)) <= 64:
            sql += " AND company_id=%s"
        else:
            sql += " AND JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))=%s"
        args.append(company_id)
    try:
        cap = int(limit)
    except (TypeError, ValueError):
        cap = 3000
    if cap < 1:
        cap = 1
    sql += " ORDER BY updated_at ASC, id ASC LIMIT %s"
    args.append(cap + 1)
    return sql, args, parsed, cap


def _materialize_changed(rows, since, limit: int, parsed):
    more = len(rows) > limit
    page = list(rows or [])[:limit]
    docs = []
    cursor = since
    for raw, updated in page:
        doc = loads(raw)
        stamp = iso_ts(updated)
        doc["_row_updated_at"] = stamp
        docs.append(doc)
        cursor = stamp
    if not docs and parsed is None:
        cursor = iso_ts(datetime.now(timezone.utc))
    elif not docs:
        cursor = since
    return docs, cursor, more


def indexed_prefilter_keeps(doc: dict, query: Optional[dict]) -> bool:
    """sql_pushdown WHERE'sinin bu belgeyi elemesi. Uygulanmayan madde elemez.

    Tam eşleşme değildir; ardından match_query çalışır. sql_count_exact
    doluysa bu süzgeç tek başına match_query ile aynı kümeyi vermelidir.
    """
    if not isinstance(doc, dict):
        return False
    if not query:
        return True
    for key, val in query.items():
        if str(key).startswith("$") or not _SAFE_FIELD.match(str(key)):
            continue
        if key == "_id" and not isinstance(val, dict):
            if str(doc.get("_id")) != str(val):
                return False
            continue
        if key == "_id" and isinstance(val, dict) and val.get("$in"):
            if not all(isinstance(item, str) for item in val["$in"]):
                continue
            if str(doc.get("_id")) not in [str(item) for item in val["$in"]]:
                return False
            continue
        if key == "company_id" and not isinstance(val, dict):
            raw = doc.get("company_id")
            if not isinstance(raw, str) or raw != str(val):
                return False
            continue
        current = doc.get(key, MISSING)
        if not isinstance(val, dict):
            if val is None or isinstance(val, (bool, int, float)):
                continue
            if not isinstance(current, str) or current != str(val):
                return False
            continue
        if "$regex" in val:
            rx = str(val.get("$regex") or "")
            if _PREFIX_RE.match(rx):
                if not isinstance(current, str) or not current.startswith(rx[1:]):
                    return False
        for op, cmpop in (("$gte", ">="), ("$lte", "<="), ("$gt", ">"), ("$lt", "<")):
            if op not in val:
                continue
            bound = val[op]
            if isinstance(bound, (bool, int, float)) or not _DATEISH.match(str(bound)):
                continue
            if not isinstance(current, str):
                return False
            if cmpop == ">=" and not current >= str(bound):
                return False
            if cmpop == "<=" and not current <= str(bound):
                return False
            if cmpop == ">" and not current > str(bound):
                return False
            if cmpop == "<" and not current < str(bound):
                return False
        if "$ne" in val and isinstance(val["$ne"], str):
            if isinstance(current, str) and current == val["$ne"]:
                return False
        if "$in" in val and val["$in"] and all(isinstance(item, str) for item in val["$in"]):
            if not isinstance(current, str) or current not in val["$in"]:
                return False
        if "$nin" in val and val["$nin"] and all(isinstance(item, str) for item in val["$nin"]):
            if isinstance(current, str) and current in val["$nin"]:
                return False
    return True


def _json_extract(field: str) -> str:
    return f"JSON_EXTRACT(doc,'$.{field}')"


def _json_type(field: str) -> str:
    return f"JSON_TYPE({_json_extract(field)})"


def _value_expr(field: str) -> str:
    """Column or JSON text. ``field`` is already a safe identifier."""
    if field == "_id":
        return "id"
    if field == "company_id" or field in _INDEXED_DOC_FIELDS:
        return field
    return _json_unquote(field)


def _python_operator(cond: dict) -> Optional[str]:
    for op in _PY_OP_ORDER:
        if op in cond:
            return op
    return None


def _dateish_bound(val) -> bool:
    if isinstance(val, bool) or isinstance(val, (int, float)):
        return False
    return bool(_DATEISH.match(str(val)))


def _sort_key_expr(field: str, missing_token: str) -> str:
    """Match sort_docs / newest_first for strings and JSON null / missing keys.

    Explicit sorts hit TypeError on None and fall back to str(), and str(None)
    is ``None``. newest_first uses ``created_at or ""`` instead.
    """
    return (
        f"(CASE WHEN {_json_extract(field)} IS NULL OR {_json_type(field)} = 'NULL' "
        f"THEN '{missing_token}' ELSE {_json_unquote(field)} END)"
    )


def _plan_sort(sort):
    """``('newest',)`` or ``('fields', pairs)``. None → this sort cannot be pushed."""
    if not sort:
        return ("newest",)
    if isinstance(sort, str):
        pairs = [(sort, 1)]
    elif (
        isinstance(sort, tuple)
        and len(sort) == 2
        and isinstance(sort[0], str)
        and not isinstance(sort[1], (list, tuple))
    ):
        pairs = [sort]
    else:
        try:
            pairs = list(sort)
        except TypeError:
            return None
    norm = []
    for item in pairs:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            return None
        field, direction = item[0], item[1]
        if not isinstance(field, str) or field not in _SQL_SORT_FIELDS:
            return None
        if direction not in (1, -1):
            return None
        norm.append((field, 1 if direction == 1 else -1))
    if not norm:
        return ("newest",)
    return ("fields", norm)


def _order_sql(sort_plan) -> str:
    if sort_plan[0] == "newest":
        # newest_first: (str(created_at or ""), str(_id)) reversed — _id is part of
        # the key, so ties go high _id first, not stable input order.
        key = _sort_key_expr("created_at", "")
        return f"ORDER BY {key} COLLATE utf8mb4_bin DESC, id COLLATE utf8mb4_bin DESC"
    pairs = sort_plan[1]
    # sort_docs applies one reverse flag, taken from the LAST field only, to the
    # whole key tuple. Earlier directions are ignored. Ties keep input order;
    # InnoDB returns this table in PRIMARY KEY (collection, id) order, so the
    # stable tie-break is id ASC and is NOT reversed with the key.
    direction = "DESC" if pairs[-1][1] == -1 else "ASC"
    cols = ", ".join(
        f"{_sort_key_expr(field, 'None')} COLLATE utf8mb4_bin {direction}"
        for field, _dir in pairs
    )
    return f"ORDER BY {cols}, id ASC"


def _probe_fields(sort_plan) -> List[str]:
    if sort_plan[0] == "newest":
        return ["created_at"]
    return [field for field, _dir in sort_plan[1]]


def _sort_probe_sql(where_sql: str, fields: Sequence[str]) -> str:
    checks = []
    for field in fields:
        checks.append(
            f"({_json_type(field)} IS NOT NULL AND {_json_type(field)} NOT IN ('STRING','NULL'))"
        )
    return f"SELECT 1 FROM docs WHERE {where_sql} AND ({' OR '.join(checks)}) LIMIT 1"


def _page_bounds(skip, limit, length) -> Optional[Tuple[int, Optional[int]]]:
    try:
        skip_n = int(skip or 0)
    except (TypeError, ValueError):
        return None
    if skip_n < 0:
        return None
    caps = []
    for raw in (limit, length):
        if raw is None:
            continue
        try:
            n = int(raw)
        except (TypeError, ValueError):
            return None
        if n < 0:
            return None
        caps.append(n)
    cap = min(caps) if caps else None
    return skip_n, cap


def _projection_mode(projection) -> Optional[str]:
    """'doc', a JSON_OBJECT select expression, or None (caller must use project_doc on the old path)."""
    if not projection:
        return "doc"
    if not isinstance(projection, dict):
        return None
    include_keys: List[str] = []
    exclude_id = False
    saw_include = False
    for key, val in projection.items():
        if val in (1, True):
            saw_include = True
            if key == "_id":
                continue
            if not isinstance(key, str) or not _SAFE_FIELD.match(str(key)):
                return None
            include_keys.append(key)
            continue
        if val in (0, False):
            if key == "_id":
                exclude_id = True
                continue
            return None
        return None
    if not saw_include:
        return None
    fields: List[str] = []
    if not exclude_id:
        fields.append("_id")
    fields.extend(include_keys)
    obj_args = []
    remove_args = []
    for field in fields:
        path = "$._id" if field == "_id" else f"$.{field}"
        obj_args.append(f"'{field}', JSON_EXTRACT(doc,'{path}')")
        remove_args.append(
            f"IF(JSON_CONTAINS_PATH(doc,'one','{path}'), '$.__absent__', '$.{field}')"
        )
    return "JSON_REMOVE(JSON_OBJECT(" + ", ".join(obj_args) + "), " + ", ".join(remove_args) + ")"


def reorder_projected(doc: dict, projection: Optional[dict]) -> dict:
    """Key order follows project_doc (set iteration). Values already came from SQL."""
    if not doc or not projection or _projection_mode(projection) in (None, "doc"):
        return doc
    include = {k for k, v in projection.items() if v}
    out = {}
    if "_id" not in projection or projection.get("_id"):
        if "_id" in doc:
            out["_id"] = doc["_id"]
    for key in include:
        if key == "_id":
            continue
        if key in doc:
            out[key] = copy.deepcopy(doc[key])
    return out


def _pure_ne_sql(field: str) -> str:
    return (
        f"({_json_extract(field)} IS NULL"
        f" OR {_json_type(field)} = 'NULL'"
        f" OR ({_json_type(field)} = 'STRING' AND {_json_unquote(field)} COLLATE utf8mb4_bin <> %s)"
        f" OR ({_json_type(field)} = 'ARRAY' AND NOT JSON_CONTAINS({_json_extract(field)}, JSON_QUOTE(%s)))"
        f" OR ({_json_type(field)} IS NOT NULL AND {_json_type(field)} NOT IN ('NULL','STRING','ARRAY'))"
        f")"
    )


def _array_contains_sql(field: str, n: int) -> str:
    parts = " OR ".join(
        f"JSON_CONTAINS({_json_extract(field)}, JSON_QUOTE(%s))" for _i in range(n)
    )
    return parts or "0"


def _pure_in_sql(field: str, n: int) -> str:
    ph = ",".join(["%s"] * n)
    return (
        f"(({_json_type(field)} = 'STRING' AND {_json_unquote(field)} COLLATE utf8mb4_bin IN ({ph}))"
        f" OR ({_json_type(field)} = 'ARRAY' AND ({_array_contains_sql(field, n)})))"
    )


def _pure_nin_sql(field: str, n: int) -> str:
    ph = ",".join(["%s"] * n)
    return (
        f"({_json_extract(field)} IS NULL OR {_json_type(field)} = 'NULL'"
        f" OR NOT ("
        f"({_json_type(field)} = 'STRING' AND {_json_unquote(field)} COLLATE utf8mb4_bin IN ({ph}))"
        f" OR ({_json_type(field)} = 'ARRAY' AND ({_array_contains_sql(field, n)}))"
        f"))"
    )


def _ne_clause(field: str, value: str, *, inside_or: bool) -> Tuple[str, list]:
    if inside_or:
        return _pure_ne_sql(field), [value, value]
    expr = _value_expr(field)
    sql = f"(({expr} <> %s OR {expr} IS NULL) AND {_pure_ne_sql(field)})"
    return sql, [value, value, value]


def _in_clause(field: str, values: Sequence[str], *, inside_or: bool) -> Tuple[str, list]:
    vals = list(values)
    n = len(vals)
    if inside_or:
        return _pure_in_sql(field, n), vals + vals
    expr = _value_expr(field)
    ph = ",".join(["%s"] * n)
    sql = (
        f"({expr} IN ({ph}) AND {_json_type(field)} = 'STRING'"
        f" AND {expr} COLLATE utf8mb4_bin IN ({ph}))"
    )
    return sql, vals + vals


def _nin_clause(field: str, values: Sequence[str], *, inside_or: bool) -> Tuple[str, list]:
    vals = list(values)
    n = len(vals)
    if inside_or:
        return _pure_nin_sql(field, n), vals + vals
    expr = _value_expr(field)
    ph = ",".join(["%s"] * n)
    sql = (
        f"(({expr} NOT IN ({ph}) OR {expr} IS NULL) AND NOT {_pure_in_sql(field, n)})"
    )
    return sql, vals + vals + vals


def _date_clause(field: str, sqlop: str, value, *, inside_or: bool) -> Tuple[str, list]:
    expr = _value_expr(field)
    sval = str(value)
    types = f"{_json_type(field)} IN ('STRING','INTEGER','DOUBLE','DECIMAL')"
    if inside_or:
        null_ok = f"{_json_type(field)} = 'NULL'" if sqlop in ("<", "<=") else "0"
        sql = f"({null_ok} OR ({types} AND {expr} COLLATE utf8mb4_bin {sqlop} %s))"
        return sql, [sval]
    sql = f"({types} AND {expr} {sqlop} %s AND {expr} COLLATE utf8mb4_bin {sqlop} %s)"
    return sql, [sval, sval]


def _regex_clause(field: str, like: str, *, inside_or: bool) -> Tuple[str, list]:
    expr = _value_expr(field)
    types = f"{_json_type(field)} IN ('STRING','INTEGER','DOUBLE','DECIMAL')"
    if inside_or:
        return f"({types} AND {expr} COLLATE utf8mb4_bin LIKE %s)", [like]
    return f"({types} AND {expr} LIKE %s AND {expr} COLLATE utf8mb4_bin LIKE %s)", [like, like]


def _exists_clause(field: str, exists: bool) -> Tuple[str, list]:
    path = f"$.{field}"
    if exists:
        return f"JSON_CONTAINS_PATH(doc,'one','{path}')", []
    return f"(NOT JSON_CONTAINS_PATH(doc,'one','{path}'))", []


def _string_list(val) -> Optional[List[str]]:
    if not isinstance(val, (list, tuple)) or not val:
        return None
    if not all(isinstance(x, str) for x in val):
        return None
    return list(val)


def _field_ops(field: str, cond: dict, *, inside_or: bool) -> Optional[Tuple[str, list]]:
    if not isinstance(cond, dict):
        return None
    known = {"$in", "$nin", "$ne", "$regex", "$options", "$gte", "$lte", "$gt", "$lt", "$exists"}
    if any(k not in known for k in cond):
        return None
    py = _python_operator(cond)
    if py is None or py in ("$eq", "$not", "$elemMatch"):
        return None
    parts: List[str] = []
    params: List[Any] = []
    emitted = set()

    if "$regex" in cond:
        rx = str(cond.get("$regex") or "")
        options = str(cond.get("$options") or "")
        if options:
            if py == "$regex":
                return None
        elif _PREFIX_RE.match(rx):
            sql, ps = _regex_clause(field, rx[1:] + "%", inside_or=inside_or)
            parts.append(sql)
            params.extend(ps)
            emitted.add("$regex")
        elif py == "$regex":
            return None

    for op, sqlop in _DATE_SQL:
        if op not in cond:
            continue
        if not _dateish_bound(cond[op]):
            if py == op:
                return None
            continue
        sql, ps = _date_clause(field, sqlop, cond[op], inside_or=inside_or)
        parts.append(sql)
        params.extend(ps)
        emitted.add(op)

    if "$ne" in cond:
        if not isinstance(cond["$ne"], str):
            if py == "$ne":
                return None
        else:
            sql, ps = _ne_clause(field, cond["$ne"], inside_or=inside_or)
            parts.append(sql)
            params.extend(ps)
            emitted.add("$ne")

    if "$in" in cond:
        vals = _string_list(cond.get("$in"))
        if vals is None:
            if py == "$in":
                return None
        else:
            sql, ps = _in_clause(field, vals, inside_or=inside_or)
            parts.append(sql)
            params.extend(ps)
            emitted.add("$in")

    if "$nin" in cond:
        vals = _string_list(cond.get("$nin"))
        if vals is None:
            if py == "$nin":
                return None
        else:
            sql, ps = _nin_clause(field, vals, inside_or=inside_or)
            parts.append(sql)
            params.extend(ps)
            emitted.add("$nin")

    if py == "$exists":
        flag = cond.get("$exists")
        if not isinstance(flag, bool) and flag not in (0, 1):
            return None
        sql, ps = _exists_clause(field, bool(flag))
        parts.append(sql)
        params.extend(ps)
        emitted.add("$exists")

    if py not in emitted or not parts:
        return None
    return "(" + " AND ".join(parts) + ")", params


def _exact_id(val, *, inside_or: bool) -> Optional[Tuple[str, list]]:
    if isinstance(val, str):
        if inside_or:
            return "id COLLATE utf8mb4_bin = %s", [val]
        return "(id = %s AND id COLLATE utf8mb4_bin = %s)", [val, val]
    if isinstance(val, dict) and list(val.keys()) == ["$in"]:
        vals = _string_list(val.get("$in"))
        if not vals:
            return None
        ph = ",".join(["%s"] * len(vals))
        if inside_or:
            return f"id COLLATE utf8mb4_bin IN ({ph})", vals
        return f"(id IN ({ph}) AND id COLLATE utf8mb4_bin IN ({ph}))", vals + vals
    return None


def _exact_scalar(field: str, val: str, *, inside_or: bool) -> Tuple[str, list]:
    if inside_or:
        return (
            f"(({_json_type(field)} = 'STRING' AND {_json_unquote(field)} COLLATE utf8mb4_bin = %s)"
            f" OR ({_json_type(field)} = 'ARRAY' AND JSON_CONTAINS({_json_extract(field)}, JSON_QUOTE(%s))))",
            [val, val],
        )
    expr = _value_expr(field)
    return (
        f"({expr} = %s AND {_json_type(field)} = 'STRING' AND {expr} COLLATE utf8mb4_bin = %s)",
        [val, val],
    )


def _exact_field(field: str, val, *, inside_or: bool) -> Optional[Tuple[str, list]]:
    if field == "_id":
        return _exact_id(val, inside_or=inside_or)
    if isinstance(val, str):
        return _exact_scalar(field, val, inside_or=inside_or)
    if isinstance(val, dict) and any(str(k).startswith("$") for k in val):
        return _field_ops(field, val, inside_or=inside_or)
    return None


def _exact_filter(query: Optional[dict], *, inside_or: bool) -> Optional[Tuple[List[str], list]]:
    if query is None:
        query = {}
    if not isinstance(query, dict):
        return None
    clauses: List[str] = []
    params: list = []
    for key, val in query.items():
        if key in ("$or", "$and"):
            branches = val
            if not isinstance(branches, list) or not branches:
                return None
            parts = []
            joiner = " OR " if key == "$or" else " AND "
            for branch in branches:
                if not isinstance(branch, dict):
                    return None
                built = _exact_filter(branch, inside_or=True)
                if built is None:
                    return None
                sub_clauses, sub_params = built
                if not sub_clauses:
                    if key == "$or":
                        return None
                    continue
                parts.append("(" + " AND ".join(sub_clauses) + ")")
                params.extend(sub_params)
            if not parts:
                return None
            clauses.append("(" + joiner.join(parts) + ")")
            continue
        if str(key).startswith("$") or not _SAFE_FIELD.match(str(key)):
            return None
        built = _exact_field(str(key), val, inside_or=inside_or)
        if built is None:
            return None
        clause, ps = built
        clauses.append(clause)
        params.extend(ps)
    return clauses, params


def plan_exact_page(
    collection: str,
    query: Optional[dict],
    sort,
    skip=0,
    limit=None,
    length=None,
    projection: Optional[dict] = None,
) -> Optional[dict]:
    """SQL for one read, or None when the old Python path must be used as-is."""
    built = _exact_filter(query, inside_or=False)
    if built is None:
        return None
    clauses, params = built
    sort_plan = _plan_sort(sort)
    if sort_plan is None:
        return None
    bounds = _page_bounds(skip, limit, length)
    if bounds is None:
        return None
    select_expr = _projection_mode(projection)
    if select_expr is None:
        return None
    skip_n, cap = bounds
    where = "collection=%s"
    where_params: list = [collection, *params]
    if clauses:
        where += " AND " + " AND ".join(clauses)
    sql = f"SELECT {select_expr} FROM docs WHERE {where} {_order_sql(sort_plan)}"
    page_params = list(where_params)
    if cap is not None:
        sql += " LIMIT %s"
        page_params.append(int(cap))
        if skip_n:
            sql += " OFFSET %s"
            page_params.append(int(skip_n))
    elif skip_n:
        sql += " LIMIT %s OFFSET %s"
        page_params.extend([_MAX_SQL_LIMIT, int(skip_n)])
    return {
        "sql": sql,
        "params": page_params,
        "probe_sql": _sort_probe_sql(where, _probe_fields(sort_plan)),
        "probe_params": list(where_params),
        "reorder": select_expr != "doc",
    }


def _generated_column_sql(name: str, expr: str, sql_type: str) -> str:
    return (
        f"ALTER TABLE docs ADD COLUMN {name} {sql_type} "
        f"GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '{expr}'))) STORED"
    )


def ensure_docs_query_helpers(cur, db_name: str) -> None:
    """Stored company/account/partner ids + indexes so tenant queries skip other firms."""
    for name, expr, sql_type in _GENERATED_DOC_COLUMNS:
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND COLUMN_NAME=%s",
            (db_name, name),
        )
        if int((cur.fetchone() or [0])[0] or 0) == 0:
            cur.execute(_generated_column_sql(name, expr, sql_type))
    for index_name, cols in _GENERATED_DOC_INDEXES:
        cur.execute(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND INDEX_NAME=%s",
            (db_name, index_name),
        )
        if int((cur.fetchone() or [0])[0] or 0) == 0:
            cur.execute(f"CREATE INDEX {index_name} ON docs {cols}")


async def ensure_docs_query_helpers_async(cur, db_name: str) -> None:
    for name, expr, sql_type in _GENERATED_DOC_COLUMNS:
        await cur.execute(
            "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND COLUMN_NAME=%s",
            (db_name, name),
        )
        row = await cur.fetchone()
        if int((row or [0])[0] or 0) == 0:
            await cur.execute(_generated_column_sql(name, expr, sql_type))
    for index_name, cols in _GENERATED_DOC_INDEXES:
        await cur.execute(
            "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND INDEX_NAME=%s",
            (db_name, index_name),
        )
        row = await cur.fetchone()
        if int((row or [0])[0] or 0) == 0:
            await cur.execute(f"CREATE INDEX {index_name} ON docs {cols}")


def values_at(doc: Any, path: str) -> List[Any]:
    if not path:
        return [doc]
    parts = path.split(".")
    cur: List[Any] = [doc]
    for part in parts:
        nxt: List[Any] = []
        for node in cur:
            if isinstance(node, list):
                for el in node:
                    if isinstance(el, dict) and part in el:
                        nxt.append(el[part])
            elif isinstance(node, dict) and part in node:
                val = node[part]
                if isinstance(val, list) and part != parts[-1]:
                    nxt.extend(val)
                else:
                    nxt.append(val)
        cur = nxt
        if not cur:
            return []
    return cur


def scalar_at(doc: dict, path: str):
    vals = values_at(doc, path)
    if not vals:
        return MISSING
    return vals[0]


def _cmp(a, b) -> int:
    if a is MISSING:
        a = None
    if b is MISSING:
        b = None
    try:
        if a is None or b is None:
            return (a is not None) - (b is not None)
        if isinstance(a, (int, float)) and not isinstance(a, bool) and isinstance(b, (int, float)) and not isinstance(b, bool):
            return (a > b) - (a < b)
        return (str(a) > str(b)) - (str(a) < str(b))
    except Exception:
        return (str(a) > str(b)) - (str(a) < str(b))


def _regex_ok(val, pattern, options="") -> bool:
    flags = re.IGNORECASE if "i" in (options or "") else 0
    try:
        return re.search(pattern, "" if val is None else str(val), flags) is not None
    except re.error:
        return False


def _match_cond(val, cond) -> bool:
    if isinstance(cond, dict) and any(k.startswith("$") for k in cond):
        if "$regex" in cond:
            if val is MISSING:
                return False
            if isinstance(val, list):
                return any(_regex_ok(v, cond["$regex"], cond.get("$options", "")) for v in val)
            return _regex_ok(val, cond["$regex"], cond.get("$options", ""))
        if "$in" in cond:
            opts = cond["$in"] or []
            if val is MISSING:
                return None in opts
            if isinstance(val, list):
                return any(v in opts for v in val)
            return val in opts
        if "$nin" in cond:
            return not _match_cond(val, {"$in": cond["$nin"]})
        if "$ne" in cond:
            return not _eq(val, cond["$ne"])
        if "$exists" in cond:
            exists = val is not MISSING
            return exists if cond["$exists"] else not exists
        if "$gt" in cond:
            return val is not MISSING and _cmp(val, cond["$gt"]) > 0
        if "$gte" in cond:
            return val is not MISSING and _cmp(val, cond["$gte"]) >= 0
        if "$lt" in cond:
            return val is not MISSING and _cmp(val, cond["$lt"]) < 0
        if "$lte" in cond:
            return val is not MISSING and _cmp(val, cond["$lte"]) <= 0
        if "$eq" in cond:
            return _eq(val, cond["$eq"])
        if "$not" in cond:
            return not _match_cond(val, cond["$not"])
        if "$elemMatch" in cond and isinstance(val, list):
            return any(match_query(el if isinstance(el, dict) else {"_": el}, cond["$elemMatch"] if isinstance(cond["$elemMatch"], dict) else {"_": cond["$elemMatch"]}) for el in val)
        return True
    return _eq(val, cond)


def _eq(val, expected) -> bool:
    if expected is None:
        return val is MISSING or val is None
    if val is MISSING:
        return False
    if isinstance(val, list) and not isinstance(expected, list):
        return expected in val
    return val == expected


def _eval_cond(doc: dict, cond):
    """$cond: [if, then, else] veya {if, then, else}. Koşul $eq/$gte sonucudur."""
    if isinstance(cond, (list, tuple)) and len(cond) == 3:
        iff, then, els = cond
    elif isinstance(cond, dict):
        iff, then, els = cond.get("if"), cond.get("then"), cond.get("else")
    else:
        return 0
    return eval_expr(doc, then if eval_expr(doc, iff) else els)


def eval_expr(doc: dict, expr):
    if isinstance(expr, str) and expr.startswith("$") and not expr.startswith("$$"):
        return scalar_at(doc, expr[1:])
    if isinstance(expr, dict):
        if "$ifNull" in expr:
            a, b = expr["$ifNull"]
            v = eval_expr(doc, a)
            return eval_expr(doc, b) if v is MISSING or v is None else v
        if "$cond" in expr:
            return _eval_cond(doc, expr["$cond"])
        if "$lte" in expr:
            a, b = expr["$lte"]
            return _cmp(eval_expr(doc, a), eval_expr(doc, b)) <= 0
        if "$lt" in expr:
            a, b = expr["$lt"]
            return _cmp(eval_expr(doc, a), eval_expr(doc, b)) < 0
        if "$gte" in expr:
            a, b = expr["$gte"]
            return _cmp(eval_expr(doc, a), eval_expr(doc, b)) >= 0
        if "$gt" in expr:
            a, b = expr["$gt"]
            return _cmp(eval_expr(doc, a), eval_expr(doc, b)) > 0
        if "$eq" in expr:
            a, b = expr["$eq"]
            return _eq(eval_expr(doc, a), eval_expr(doc, b))
    return expr


def unique_conflict(doc: dict, others, indexes, collection: str = "") -> None:
    """Raise DuplicateKeyError when doc hits a unique index already held by others.

    partialFilterExpression (Mongo partial index) dışındaki belgeler anahtara girmez.
    $type koşulları unique_index_applies ile değerlendirilir.
    """
    for item in indexes or []:
        spec, unique, partial = index_spec_parts(item)
        if not unique or not spec:
            continue
        if not unique_index_applies(doc, partial):
            continue
        key = tuple(scalar_at(doc, f) for f in spec)
        if not all(v is not MISSING for v in key):
            continue
        for other in others or []:
            if not unique_index_applies(other, partial):
                continue
            if tuple(scalar_at(other, f) for f in spec) == key:
                raise DuplicateKeyError(f"duplicate key {spec}={key} on {collection}")


def match_query(doc: dict, query: Optional[dict]) -> bool:
    if not query:
        return True
    for key, cond in query.items():
        if key == "$and":
            if not all(match_query(doc, q) for q in cond):
                return False
            continue
        if key == "$or":
            if not any(match_query(doc, q) for q in cond):
                return False
            continue
        if key == "$nor":
            if any(match_query(doc, q) for q in cond):
                return False
            continue
        if key == "$expr":
            if not eval_expr(doc, cond):
                return False
            continue
        vals = values_at(doc, key)
        if not vals:
            if not _match_cond(MISSING, cond):
                return False
            continue
        if len(vals) == 1:
            if not _match_cond(vals[0], cond):
                return False
        else:
            if not any(_match_cond(v, cond) for v in vals):
                return False
    return True


def _set_path(doc: dict, path: str, value, query: Optional[dict] = None):
    parts = path.split(".")
    cur = doc
    for i, part in enumerate(parts):
        last = i == len(parts) - 1
        if part == "$":
            idx = _positional_index(cur if isinstance(cur, list) else None, parts[i + 1:] if not last else [], query, ".".join(parts[:i]))
            if idx is None or not isinstance(cur, list) or idx >= len(cur):
                return
            if last:
                cur[idx] = value
                return
            cur = cur[idx]
            continue
        if last:
            if isinstance(cur, list):
                return
            cur[part] = value
            return
        if isinstance(cur, list):
            return
        nxt = cur.get(part)
        if nxt is None or not isinstance(nxt, (dict, list)):
            cur[part] = {}
            nxt = cur[part]
        cur = nxt


def _positional_index(arr: Optional[list], _rest, query: Optional[dict], prefix: str) -> Optional[int]:
    if not isinstance(arr, list) or not arr:
        return None
    if not query:
        return 0
    for qk, qv in query.items():
        if str(qk).startswith("$"):
            continue
        if qk == prefix or str(qk).startswith(prefix + "."):
            tail = str(qk)[len(prefix) + 1 :] if str(qk).startswith(prefix + ".") else ""
            for i, el in enumerate(arr):
                if not tail:
                    if _match_cond(el, qv):
                        return i
                elif isinstance(el, dict) and _match_cond(scalar_at(el, tail), qv):
                    return i
    return 0


def _inc_path(doc: dict, path: str, amount):
    cur = scalar_at(doc, path)
    if cur is MISSING or cur is None:
        cur = 0
    try:
        _set_path(doc, path, cur + amount)
    except TypeError:
        _set_path(doc, path, amount)


def _unset_path(doc: dict, path: str):
    parts = path.split(".")
    cur = doc
    for part in parts[:-1]:
        if not isinstance(cur, dict) or part not in cur:
            return
        cur = cur[part]
    if isinstance(cur, dict):
        cur.pop(parts[-1], None)


def document_from_upsert(update: dict, query: Optional[dict] = None) -> dict:
    """Build the document inserted by an upsert.

    MongoDB copies simple equality fields from the selector onto the new
    document. We must do that *before* minting a random ``_id``, otherwise
    ``update_one({"_id": cid}, {"$setOnInsert": {...}}, upsert=True)`` would
    store a license under a random UUID and later ``find_one({"_id": cid})``
    would miss it.
    """
    new_doc = apply_update({}, update, query, is_insert=True)
    for k, v in (query or {}).items():
        if not str(k).startswith("$") and not isinstance(v, dict) and k not in new_doc:
            _set_path(new_doc, k, v)
    if not new_doc.get("_id"):
        new_doc["_id"] = str(uuid.uuid4())
    return new_doc


def apply_update(doc: dict, update: dict, query: Optional[dict] = None, is_insert: bool = False) -> dict:
    out = copy.deepcopy(doc)
    if not any(k.startswith("$") for k in update):
        new_id = out.get("_id") or update.get("_id")
        out = copy.deepcopy(update)
        if new_id:
            out["_id"] = new_id
        return out
    if is_insert and "$setOnInsert" in update:
        for k, v in update["$setOnInsert"].items():
            _set_path(out, k, v, query)
    for k, v in (update.get("$set") or {}).items():
        _set_path(out, k, v, query)
    for k, v in (update.get("$inc") or {}).items():
        _inc_path(out, k, v)
    for k, v in (update.get("$unset") or {}).items():
        _unset_path(out, k)
    for k, v in (update.get("$push") or {}).items():
        cur = scalar_at(out, k)
        if cur is MISSING or cur is None:
            _set_path(out, k, [v], query)
        elif isinstance(cur, list):
            cur.append(v)
            _set_path(out, k, cur, query)
    for k, v in (update.get("$addToSet") or {}).items():
        items = list(v.get("$each") or []) if isinstance(v, dict) and "$each" in v and set(v.keys()) <= {"$each"} else [v]
        cur = scalar_at(out, k)
        if cur is MISSING or cur is None:
            cur = []
        if not isinstance(cur, list):
            continue
        for item in items:
            if item not in cur:
                cur.append(item)
        _set_path(out, k, cur, query)
    for k, v in (update.get("$pull") or {}).items():
        cur = scalar_at(out, k)
        if isinstance(cur, list):
            _set_path(out, k, [x for x in cur if x != v], query)
    return out


def new_upsert_doc(update: dict, query: Optional[dict] = None) -> dict:
    """Build the inserted document for update_one(..., upsert=True).

    Mongo keeps equality filters (especially ``_id``) as the new document's
    identity. Generating a random ``_id`` first skipped copying the filter
    ``_id``, so trial/payment licenses were stored under a UUID nobody looked up.
    """
    new_doc = apply_update({}, update, query, is_insert=True)
    for k, v in (query or {}).items():
        if str(k).startswith("$") or isinstance(v, dict):
            continue
        if k not in new_doc:
            _set_path(new_doc, k, v)
    qid = (query or {}).get("_id")
    if qid is not None and not isinstance(qid, dict):
        new_doc["_id"] = qid
    if not new_doc.get("_id"):
        new_doc["_id"] = str(uuid.uuid4())
    return new_doc


def project_doc(doc: dict, projection: Optional[dict]) -> dict:
    if not projection:
        return copy.deepcopy(doc)
    include = {k for k, v in projection.items() if v}
    exclude = {k for k, v in projection.items() if not v}
    if include:
        out = {}
        if "_id" not in projection or projection.get("_id"):
            if "_id" in doc:
                out["_id"] = doc["_id"]
        for k in include:
            if k == "_id":
                continue
            val = scalar_at(doc, k)
            if val is not MISSING:
                if "." in k:
                    _set_path(out, k, copy.deepcopy(val))
                else:
                    out[k] = copy.deepcopy(val)
        return out
    out = copy.deepcopy(doc)
    for k in exclude:
        if k == "_id":
            out.pop("_id", None)
        else:
            _unset_path(out, k)
    return out


def normalize_sort(sort, direction=1):
    if not sort:
        return None
    if isinstance(sort, str):
        return [(sort, direction)]
    return sort


def newest_first(docs: List[dict]) -> List[dict]:
    """
    Sıralama istenmediğinde uygulanan varsayılan düzen.

    MySQL `docs` tablosunun birincil anahtarı (collection, id) ve id bir uuid4.
    Sıralamasız bir SELECT bu yüzden satırları rastgele uuid sırasında döndürür,
    kayıt sırasında değil. `.to_list(100)` gibi bir sınır o rastgele sıranın ilk
    100'ünü aldığı için yeni eklenen bir kayıt, uuid'si sona düşmüşse listede
    hiç görünmez. En yeniyi başa alarak sınır, kaybedilmesi en pahalı kayıtları
    değil en eskilerini kırpar.
    """
    return sorted(docs, key=lambda d: (str(d.get("created_at") or ""), str(d.get("_id") or "")), reverse=True)


def sort_docs(docs: List[dict], key) -> List[dict]:
    if not key:
        return newest_first(docs)
    if isinstance(key, str):
        pairs = [(key, 1)]
    elif isinstance(key, tuple) and len(key) == 2 and isinstance(key[0], str):
        pairs = [key]
    else:
        pairs = list(key)
    def sk(d):
        vals = []
        for field, direction in pairs:
            v = scalar_at(d, field)
            if v is MISSING:
                v = None
            vals.append(v)
        return tuple(vals)
    reverse = pairs[-1][1] == -1 if pairs else False
    try:
        return sorted(docs, key=sk, reverse=reverse)
    except TypeError:
        return sorted(docs, key=lambda d: [str(x) for x in sk(d)], reverse=reverse)


# Keep in sync with backend/schema.mysql.sql (CREATE TABLE bodies only; no CREATE DATABASE).
SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS docs (
  collection VARCHAR(128) NOT NULL,
  id VARCHAR(191) NOT NULL,
  doc JSON NOT NULL,
  company_id VARCHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED,
  account_id VARCHAR(191) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.account_id'))) STORED,
  partner_id VARCHAR(191) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.partner_id'))) STORED,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id),
  KEY idx_docs_coll_company (collection, company_id),
  KEY idx_docs_coll_company_account (collection, company_id, account_id),
  KEY idx_docs_coll_company_partner (collection, company_id, partner_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_indexes (
  collection VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  spec JSON NOT NULL,
  unique_index TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  level VARCHAR(16) NOT NULL,
  category VARCHAR(32) NOT NULL,
  event VARCHAR(64) NOT NULL,
  user_id VARCHAR(64) NULL,
  user_email VARCHAR(191) NULL,
  company_id VARCHAR(64) NULL,
  ip VARCHAR(64) NULL,
  method VARCHAR(16) NULL,
  path VARCHAR(512) NULL,
  status_code SMALLINT NULL,
  duration_ms INT NULL,
  collection_name VARCHAR(128) NULL,
  message TEXT NOT NULL,
  details JSON NULL,
  PRIMARY KEY (id),
  KEY idx_syslogs_created (created_at),
  KEY idx_syslogs_cat_created (category, created_at),
  KEY idx_syslogs_user (user_email, created_at),
  KEY idx_syslogs_event (event, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


def schema_upgrade_statements(columns: set, indexes: set) -> List[str]:
    """Idempotent ALTERs for generated company_id / account_id / partner_id."""
    stmts: List[str] = []
    for name, expr, sql_type in _GENERATED_DOC_COLUMNS:
        if name not in columns:
            stmts.append(_generated_column_sql(name, expr, sql_type))
    for index_name, cols in _GENERATED_DOC_INDEXES:
        if index_name not in indexes:
            stmts.append(f"ALTER TABLE docs ADD INDEX {index_name} {cols}")
    return stmts


def _simple_eq(query: Optional[dict], field: str):
    if not query or field not in query:
        return None
    val = query[field]
    if isinstance(val, dict):
        return None
    return val


class MySQLCursor:
    def __init__(self, coll: "MySQLCollection", query: Optional[dict], projection: Optional[dict]):
        self._coll = coll
        self._query = query or {}
        self._projection = projection
        self._sort = None
        self._limit = None
        self._skip = 0

    def sort(self, key, direction=1):
        if isinstance(key, str):
            self._sort = [(key, direction)]
        else:
            self._sort = key
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def skip(self, n: int):
        self._skip = n
        return self

    async def to_list(self, length=None):
        routed = await _route_read(self._coll, self._query)
        if routed is not None:
            query = _aligned_query(self._query)
            cursor = routed.find(query, self._projection)
            if self._sort:
                cursor.sort(self._sort)
            if self._skip:
                cursor.skip(self._skip)
            if self._limit is not None:
                cursor.limit(self._limit)
            rows = await cursor.to_list(length)
            return list(rows or [])
        await _block_shared_copy(self._coll, query=self._query, write=False)
        if sql_page_pushdown_enabled():
            pushed = await self._coll._read_page(
                self._query, self._sort, self._skip, self._limit, length, self._projection,
            )
            if pushed is not None:
                return pushed
        docs = await self._coll._load_filtered(self._query)
        return await offload(
            _finish_read, docs, self._sort, self._skip, self._limit, length, self._projection,
            size=len(docs),
        )

    def __aiter__(self):
        self._aiter_docs = None
        self._aiter_i = 0
        return self

    async def __anext__(self):
        if self._aiter_docs is None:
            self._aiter_docs = await self.to_list(None)
            self._aiter_i = 0
        if self._aiter_i >= len(self._aiter_docs):
            raise StopAsyncIteration
        d = self._aiter_docs[self._aiter_i]
        self._aiter_i += 1
        return d


def _emit_company_change(collection: str, doc) -> None:
    """İş olayı: tür + id. Yazmayı asla bozmaz."""
    if not isinstance(doc, dict):
        return
    try:
        import company_events
        company_events.note_change(collection, doc)
    except Exception:
        return


def _agg_number(doc: dict, expr) -> float:
    val = eval_expr(doc, expr)
    if val is MISSING or val is None:
        return 0.0
    try:
        return float(val)
    except (TypeError, ValueError):
        return 0.0


def _agg_group_id(doc: dict, expr):
    if expr is None:
        return None
    if isinstance(expr, str) and expr.startswith("$"):
        val = scalar_at(doc, expr[1:])
        return None if val is MISSING else val
    return expr


def aggregate_rows(docs: Sequence[dict], pipeline: Sequence[dict]) -> List[dict]:
    """$match + $group ($sum / $ifNull / $cond). Motor aggregate ile aynı satır şekli."""
    rows: List[dict] = list(docs or [])
    grouped: Optional[List[dict]] = None
    for stage in pipeline or []:
        if not isinstance(stage, dict) or len(stage) != 1:
            raise ValueError("aggregate aşaması tek operatör olmalı")
        op, spec = next(iter(stage.items()))
        if op == "$match":
            rows = [doc for doc in rows if match_query(doc, spec or {})]
            grouped = None
            continue
        if op == "$group":
            spec = spec or {}
            buckets: Dict[Any, dict] = {}
            order: List[Any] = []
            for doc in rows:
                key = _agg_group_id(doc, spec.get("_id"))
                if key not in buckets:
                    buckets[key] = {"_id": key}
                    order.append(key)
                bucket = buckets[key]
                for field, expr in spec.items():
                    if field == "_id" or not isinstance(expr, dict) or "$sum" not in expr:
                        continue
                    bucket[field] = bucket.get(field, 0.0) + _agg_number(doc, expr["$sum"])
            grouped = [buckets[key] for key in order]
            rows = grouped
            continue
        raise ValueError(f"desteklenmeyen aggregate aşaması: {op}")
    return grouped if grouped is not None else rows


class MySQLCollection:
    def __init__(self, db: "MySQLDatabase", name: str):
        self._db = db
        self.name = name

    async def _fetch_rows(self, sql: str, params: list):
        """Havuz beklemesi ile sorgu süresi ayrı ölçülür. İşleme süresi çağıran kapatır."""
        pending = _SQL_SLOT.get()
        if pending:
            _emit_sql_slot(0)
        await self._db._ensure()
        t_acquire = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            acquire_ms = (time.perf_counter() - t_acquire) * 1000
            t_query = time.perf_counter()
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
            query_ms = (time.perf_counter() - t_query) * 1000
        _SQL_SLOT.set({
            "collection": self.name,
            "acquire_ms": acquire_ms,
            "query_ms": query_ms,
            "mark": time.perf_counter(),
        })
        return rows

    async def _load_all(self) -> List[dict]:
        rows = await self._fetch_rows("SELECT doc FROM docs WHERE collection=%s", [self.name])
        return await _loads_rows_async(rows)

    async def _load_sql(self, sql: str, params: list) -> List[dict]:
        rows = await self._fetch_rows(sql, params)
        return await _loads_rows_async(rows)

    async def _read_page(self, query, sort, skip, limit, length, projection) -> Optional[List[dict]]:
        """Exact SQL page, or None so the caller runs the historical Python read."""
        await _block_shared_copy(self, query=query, write=False)
        plan = plan_exact_page(self.name, query, sort, skip, limit, length, projection)
        if not plan:
            return None
        try:
            blocked = await self._fetch_rows(plan["probe_sql"], plan["probe_params"])
            if blocked:
                _emit_sql_slot(0)
                return None
            docs = await self._load_sql(plan["sql"], plan["params"])
        except Exception:
            _emit_sql_slot(0)
            return None
        if plan["reorder"]:
            docs = [reorder_projected(d, projection) for d in docs]
        _emit_sql_slot(0)
        return docs

    async def _load_filtered(self, query: Optional[dict]) -> List[dict]:
        await _block_shared_copy(self, query=query, write=False)
        sql, params = sql_pushdown(self.name, query)
        try:
            docs = await self._load_sql(sql, params)
        except Exception:
            _emit_sql_slot(0)
            docs = await self._load_all()
        if query:
            docs = await filter_matching(docs, query)
        _emit_sql_slot(0)
        return docs

    async def distinct_company_ids(self, query: Optional[dict]) -> Optional[List[str]]:
        """Eşleşen satırların company_id değerleri. Hata olursa None; çağıran tam okur."""
        try:
            sql, params = sql_company_ids(self.name, query)
        except Exception:
            return None
        try:
            await self._db._ensure()
            async with self._db._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    await cur.execute(sql, params)
                    rows = await cur.fetchall()
        except Exception:
            return None
        found: List[str] = []
        for row in rows or []:
            if not row or row[0] is None:
                continue
            text = str(row[0]).strip()
            if not text or text == "null" or text in found:
                continue
            found.append(text)
        return found

    async def _replace_rows(self, rows: Sequence[Tuple[str, str, str]]):
        """Batch REPLACE so bulk flag updates do not do one round-trip per product."""
        packed = list(rows or [])
        if not packed:
            return
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                for part in chunk_list(packed, REPLACE_BATCH):
                    await cur.executemany(
                        "REPLACE INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                        part,
                    )
        _audit_sql("REPLACE", self.name, doc_id=f"{len(packed)}", duration_ms=(time.perf_counter() - t0) * 1000)

    async def _save(self, doc: dict):
        await self._db._ensure()
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        await self._check_unique(doc, exclude_id=None)
        await self._replace_rows([(self.name, str(doc["_id"]), dumps(doc))])
        note_hot_write(self.name, doc.get("_id"))
        _emit_company_change(self.name, doc)

    async def _delete_ids(self, ids: Sequence[str]) -> int:
        if not ids:
            return 0
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                placeholders = ",".join(["%s"] * len(ids))
                await cur.execute(
                    f"DELETE FROM docs WHERE collection=%s AND id IN ({placeholders})",
                    (self.name, *[str(i) for i in ids]),
                )
                n = cur.rowcount
        _audit_sql("DELETE", self.name, doc_id=",".join(str(i) for i in ids[:8]), duration_ms=(time.perf_counter() - t0) * 1000)
        note_hot_write(self.name)
        return n

    async def _check_unique(self, doc: dict, exclude_id):
        indexes = self._db._indexes.get(self.name) or []
        if not has_unique_index(indexes):
            return
        others = [d for d in await self._load_all() if d.get("_id") != exclude_id and d.get("_id") != doc.get("_id")]
        unique_conflict(doc, others, indexes, self.name)

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None, sort=None, skip=0):
        _guard(self.name, "find_one", query=query)
        routed = await _route_read(self, query)
        if routed is not None:
            return await routed.find_one(_aligned_query(query), projection, sort, skip)
        ident = hot_ident(self.name, query, skip)
        if ident is not None:
            hit = lookup_hot(self.name, ident)
            if hit is not None:
                return project_doc(hit, projection) if projection else hit
        await _block_shared_copy(self, query=query, write=False)
        if sql_page_pushdown_enabled():
            pushed = await self._read_page(query, normalize_sort(sort), skip, 1, 1, projection)
            if pushed is not None:
                found = pushed[0] if pushed else None
                if ident is not None and found is not None and not projection:
                    remember_hot(self.name, found)
                return found
        docs = await self._load_filtered(query)
        page = await offload(
            _finish_read, docs, normalize_sort(sort), skip, 1, 1, None, size=len(docs),
        )
        if not page:
            return None
        if ident is not None:
            remember_hot(self.name, page[0])
        return project_doc(page[0], projection) if projection else page[0]

    def find(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        _guard(self.name, "find", query=query)
        return MySQLCursor(self, query, projection)

    async def insert_one(self, doc: dict):
        note_hot_write(self.name)
        routed = await _route_write(self, "insert_one", doc=doc)
        if routed is not None:
            return await routed.insert_one(doc)
        await _block_shared_copy(self, doc=doc, write=True)
        _guard(self.name, "insert_one", doc=doc, catalog=self._db)
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        await self._check_unique(doc, exclude_id=None)
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                try:
                    await cur.execute(
                        "INSERT INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                        (self.name, str(doc["_id"]), dumps(doc)),
                    )
                except Exception as e:
                    err = str(e).lower()
                    if "duplicate" in err or getattr(e, "args", [None])[0] == 1062:
                        raise DuplicateKeyError(str(e)) from e
                    raise
        _audit_sql("INSERT", self.name, doc_id=doc.get("_id"), duration_ms=(time.perf_counter() - t0) * 1000)
        _emit_company_change(self.name, doc)
        note_hot_write(self.name, doc.get("_id"))
        return InsertOneResult(doc["_id"])

    async def insert_many(self, docs: Iterable[dict], ordered: bool = True):
        docs = list(docs or [])
        routed = await _route_write(self, "insert_many", doc=docs)
        if routed is not None:
            return await routed.insert_many(docs, ordered=ordered)
        await _block_shared_copy(self, doc=docs, write=True)
        _guard(self.name, "insert_many", doc=docs, catalog=self._db)
        ids = []
        for d in docs:
            r = await self.insert_one(d)
            ids.append(r.inserted_id)
        return InsertManyResult(ids)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        note_hot_write(self.name)
        routed = await _route_write(self, "update_one", query=query, update=update)
        if routed is not None:
            return await routed.update_one(query, update, upsert=upsert)
        await _block_shared_copy(self, query=query, update=update, write=True)
        _guard(self.name, "update_one", query=query, update=update, upsert=upsert, catalog=self._db)
        docs = await self._load_filtered(query)
        if not docs:
            if not upsert:
                return UpdateResult(0, 0, None)
            new_doc = document_from_upsert(update, query)
            new_doc = new_upsert_doc(update, query)
            await self._save(new_doc)
            return UpdateResult(0, 1, new_doc["_id"])
        old = docs[0]
        new_doc = apply_update(old, update, query, is_insert=False)
        changed = new_doc != old
        if changed:
            await self._check_unique(new_doc, exclude_id=old.get("_id"))
            await self._save(new_doc)
        return UpdateResult(1, 1 if changed else 0, None)

    async def update_one_atomic(self, query: dict, update: dict):
        """Koşullu güncellemeyi aynı bağlantıda kilitleyerek uygula.

        BEGIN → SELECT … FOR UPDATE → match_query → apply_update → UPDATE → COMMIT.
        `matched_count` kilit altında sorgu eşleşmesini yansıtır (eşzamanlı claim için).
        `query` içinde eşitlik `_id` zorunlu.
        """
        note_hot_write(self.name)
        routed = await _route_write(self, "update_one_atomic", query=query, update=update)
        if routed is not None:
            return await routed.update_one_atomic(query, update)
        await _block_shared_copy(self, query=query, update=update, write=True)
        _guard(self.name, "update_one_atomic", query=query, update=update, catalog=self._db)
        q = query or {}
        doc_id = q.get("_id")
        if doc_id is None or isinstance(doc_id, dict):
            raise ValueError("update_one_atomic requires equality _id in query")
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            await conn.begin()
            try:
                async with conn.cursor() as cur:
                    await cur.execute(
                        "SELECT doc FROM docs WHERE collection=%s AND id=%s FOR UPDATE",
                        (self.name, str(doc_id)),
                    )
                    row = await cur.fetchone()
                    if not row:
                        await conn.rollback()
                        _audit_sql(
                            "UPDATE_ATOMIC", self.name, doc_id=doc_id,
                            duration_ms=(time.perf_counter() - t0) * 1000,
                        )
                        return UpdateResult(0, 0, None)
                    old = loads(row[0])
                    if not match_query(old, q):
                        await conn.rollback()
                        _audit_sql(
                            "UPDATE_ATOMIC", self.name, doc_id=doc_id,
                            duration_ms=(time.perf_counter() - t0) * 1000,
                        )
                        return UpdateResult(0, 0, None)
                    new_doc = apply_update(old, update, q, is_insert=False)
                    changed = new_doc != old
                    if changed:
                        await cur.execute(
                            "UPDATE docs SET doc=%s WHERE collection=%s AND id=%s",
                            (dumps(new_doc), self.name, str(doc_id)),
                        )
                    await conn.commit()
                    _audit_sql(
                        "UPDATE_ATOMIC", self.name, doc_id=doc_id,
                        duration_ms=(time.perf_counter() - t0) * 1000,
                    )
                    if changed:
                        _emit_company_change(self.name, new_doc)
                    note_hot_write(self.name, doc_id)
                    return UpdateResult(1, 1 if changed else 0, None)
            except Exception:
                try:
                    await conn.rollback()
                except Exception:
                    pass
                raise

    async def update_many(self, query: dict, update: dict, upsert: bool = False):
        note_hot_write(self.name)
        routed = await _route_write(self, "update_many", query=query, update=update)
        if routed is not None:
            return await routed.update_many(query, update, upsert=upsert)
        await _block_shared_copy(self, query=query, update=update, write=True)
        _guard(self.name, "update_many", query=query, update=update, upsert=upsert, catalog=self._db)
        docs = await self._load_filtered(query)
        if not docs:
            if upsert:
                return await self.update_one(query, update, upsert=True)
            return UpdateResult(0, 0, None)
        changed: List[dict] = []
        for old in docs:
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                await self._check_unique(new_doc, exclude_id=old.get("_id"))
                changed.append(new_doc)
        if changed:
            rows = []
            for d in changed:
                doc = copy.deepcopy(d)
                if not doc.get("_id"):
                    doc["_id"] = str(uuid.uuid4())
                rows.append((self.name, str(doc["_id"]), dumps(doc)))
            await self._replace_rows(rows)
            note_hot_write(self.name)
            for doc in changed:
                _emit_company_change(self.name, doc)
        return UpdateResult(len(docs), len(changed), None)

    async def replace_one(self, query: dict, replacement: dict, upsert: bool = False):
        note_hot_write(self.name)
        routed = await _route_write(self, "replace_one", query=query, doc=replacement)
        if routed is not None:
            return await routed.replace_one(query, replacement, upsert=upsert)
        await _block_shared_copy(self, query=query, doc=replacement, write=True)
        _guard(self.name, "replace_one", query=query, doc=replacement, catalog=self._db)
        replacement = copy.deepcopy(replacement)
        docs = await self._load_filtered(query)
        if not docs:
            if not upsert:
                return UpdateResult(0, 0, None)
            if not replacement.get("_id"):
                replacement["_id"] = str(uuid.uuid4())
            await self._save(replacement)
            return UpdateResult(0, 1, replacement["_id"])
        old = docs[0]
        replacement["_id"] = old.get("_id") or replacement.get("_id")
        await self._save(replacement)
        return UpdateResult(1, 1, None)

    async def find_one_and_update(self, query: dict, update: dict, upsert: bool = False, return_document=True, projection=None):
        note_hot_write(self.name)
        routed = await _route_write(self, "find_one_and_update", query=query, update=update)
        if routed is not None:
            return await routed.find_one_and_update(
                query, update, upsert=upsert, return_document=return_document, projection=projection,
            )
        await _block_shared_copy(self, query=query, update=update, write=True)
        _guard(self.name, "find_one_and_update", query=query, update=update, upsert=upsert, catalog=self._db)
        docs = await self._load_filtered(query)
        if not docs:
            if not upsert:
                return None
            r = await self.update_one(query, update, upsert=True)
            doc = await self.find_one({"_id": r.upserted_id})
            return project_doc(doc, projection) if doc else None
        old = docs[0]
        new_doc = apply_update(old, update, query, is_insert=False)
        await self._save(new_doc)
        out = new_doc if return_document else old
        return project_doc(out, projection)

    async def delete_one(self, query: dict):
        note_hot_write(self.name)
        routed = await _route_write(self, "delete_one", query=query)
        if routed is not None:
            return await routed.delete_one(query)
        await _block_shared_copy(self, query=query, write=True)
        _guard(self.name, "delete_one", query=query, catalog=self._db)
        docs = await self._load_filtered(query)
        if not docs:
            return DeleteResult(0)
        await self._record_tombstones(docs[:1])
        n = await self._delete_ids([docs[0]["_id"]])
        if n:
            _emit_company_change(self.name, docs[0])
        return DeleteResult(n)

    async def delete_many(self, query: dict):
        note_hot_write(self.name)
        routed = await _route_write(self, "delete_many", query=query)
        if routed is not None:
            return await routed.delete_many(query)
        await _block_shared_copy(self, query=query, write=True)
        _guard(self.name, "delete_many", query=query, catalog=self._db)
        docs = await self._load_filtered(query)
        await self._record_tombstones(docs)
        n = await self._delete_ids([d["_id"] for d in docs if d.get("_id") is not None])
        if n:
            for doc in docs:
                _emit_company_change(self.name, doc)
        return DeleteResult(n)

    async def _record_tombstones(self, docs: Sequence[dict]):
        if self.name in SKIP_TOMBSTONE or not docs:
            return
        now = datetime.now(timezone.utc).isoformat()
        for d in docs:
            did = d.get("_id")
            if not did:
                continue
            body = {
                "_id": f"{self.name}:{did}:{uuid.uuid4().hex[:8]}",
                "collection": self.name,
                "doc_id": str(did),
                "company_id": d.get("company_id"),
                "deleted_at": now,
            }
            move_id = _tombstone_move_id.get()
            if move_id:
                body["move_id"] = move_id
            await self._db.sync_tombstones.insert_one(body)

    async def changed_since(self, since: Optional[str] = None, company_id: Optional[str] = None, limit: int = 3000) -> Tuple[List[dict], Optional[str], bool]:
        """SQL-level delta: rows whose docs.updated_at is >= since, optionally scoped by company_id.

        Dedicated ve shared_v2 şirket satırı paylaşılan docs tablosuna inmez.
        Yönlendirme yoksa (legacy, bayrak kapalı, taşımanın yazarı) katalog sorgusu sürer.
        """
        _guard(self.name, "changed_since", company_id=company_id)
        if company_id:
            routed = await _route_read(self, {"company_id": str(company_id)})
            if routed is not None:
                reader = getattr(routed, "changed_since", None)
                if reader is None:
                    import storage_router

                    raise storage_router.StorageModeError(
                        storage_router.catalog_blocked_message(
                            str(getattr(routed, "_pinned_mode", "") or ""),
                            str(company_id),
                            write=False,
                        ),
                        company_id=str(company_id),
                    )
                result = reader(since, company_id=company_id, limit=limit)
                if hasattr(result, "__await__"):
                    result = await result
                return result
            await _block_shared_copy(self, query={"company_id": str(company_id)}, write=False)
        sql, args, parsed, cap = changed_since_sql(self.name, since, company_id, limit)
        rows = await self._fetch_rows(sql, args)
        docs, cursor, more = await offload(
            _materialize_changed, rows, since, cap, parsed, size=len(rows or []),
        )
        _emit_sql_slot(0)
        return docs, cursor, more

    async def count_documents(self, query: Optional[dict] = None):
        _guard(self.name, "count_documents", query=query)
        routed = await _route_read(self, query)
        if routed is not None:
            return int(await routed.count_documents(_aligned_query(query)) or 0)
        await _block_shared_copy(self, query=query, write=False)
        exact = sql_count_exact(self.name, query)
        if exact:
            sql, params = exact
            await self._db._ensure()
            t_acquire = time.perf_counter()
            async with self._db._pool.acquire() as conn:
                acquire_ms = (time.perf_counter() - t_acquire) * 1000
                t_query = time.perf_counter()
                async with conn.cursor() as cur:
                    await cur.execute(sql, params)
                    row = await cur.fetchone()
                query_ms = (time.perf_counter() - t_query) * 1000
            _audit_sql(
                "COUNT", self.name,
                duration_ms=acquire_ms + query_ms,
                acquire_ms=round(acquire_ms, 1),
                query_ms=round(query_ms, 1),
                process_ms=0,
                caller=_caller_label(),
            )
            return int((row or [0])[0] or 0)
        return len(await self._load_filtered(query))

    def aggregate(self, pipeline):
        """Motor ile aynı: aggregate() senkron, to_list() async. $match + $group."""
        _guard(self.name, "aggregate", pipeline=pipeline)

        async def _rows():
            routed = await _route_read(self, _pipeline_match(pipeline))
            if routed is not None:
                import storage_router

                cursor = routed.aggregate(storage_router.align_pipeline_company(pipeline))
                rows = await cursor.to_list(None)
                return list(rows or [])
            await _block_shared_copy(self, query=_pipeline_match(pipeline), write=False)
            docs: List[dict] = []
            matched = False
            for stage in pipeline or []:
                if isinstance(stage, dict) and "$match" in stage and not matched:
                    docs = await self._load_filtered(stage.get("$match"))
                    matched = True
                    break
            if not matched:
                docs = await self._load_filtered({})
            return await offload(aggregate_rows, docs, pipeline, size=len(docs))

        cursor_box: Dict[str, Any] = {}

        class _LazyCursor:
            async def to_list(self, length=None):
                if "rows" not in cursor_box:
                    cursor_box["rows"] = await _rows()
                rows = cursor_box["rows"]
                if length is None:
                    return list(rows)
                return list(rows)[: int(length)]

        return _LazyCursor()

    async def distinct(self, key: str, query: Optional[dict] = None):
        _guard(self.name, "distinct", query=query)
        routed = await _route_read(self, query)
        if routed is not None:
            return await routed.distinct(key, _aligned_query(query))
        await _block_shared_copy(self, query=query, write=False)
        docs = await self._load_filtered(query)
        seen = []
        for d in docs:
            for v in values_at(d, key) or []:
                if v not in seen:
                    seen.append(v)
        return seen

    async def create_index(self, keys, unique: bool = False, **kwargs):
        if isinstance(keys, str):
            fields = [keys]
            name = keys
        else:
            fields = [k[0] if isinstance(k, (list, tuple)) else k for k in keys]
            name = "_".join(fields)
        partial = kwargs.get("partialFilterExpression")
        if isinstance(partial, dict) and partial:
            partial = copy.deepcopy(partial)
        else:
            partial = None
        self._db._indexes.setdefault(self.name, [])
        spec = (tuple(fields), bool(unique), partial) if partial else (tuple(fields), bool(unique))
        if spec not in self._db._indexes[self.name]:
            self._db._indexes[self.name].append(spec)
        stored = {"fields": fields}
        if partial:
            stored["partialFilterExpression"] = partial
        await self._db._ensure()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "REPLACE INTO meta_indexes (collection, name, spec, unique_index) VALUES (%s,%s,%s,%s)",
                    (self.name, name, dumps(stored), 1 if unique else 0),
                )
        return name


class MySQLDatabase:
    def __init__(self, settings: Optional[dict] = None):
        self._settings = settings or mysql_settings_from_env()
        self._pool = None
        self._indexes: Dict[str, List[Tuple[tuple, bool]]] = {}
        self._cols: Dict[str, MySQLCollection] = {}
        self.name = self._settings.get("db", "tamkobi")

    async def reconfigure(self, settings: dict):
        """Reconnect the pool after the first-run wizard writes new credentials."""
        await self.close()
        self._settings = dict(settings)
        self.name = self._settings.get("db", "tamkobi")
        self._indexes = {}
        await self._ensure()

    async def _ensure(self):
        if self._pool is None:
            import aiomysql
            cfg = {k: v for k, v in self._settings.items() if k in {"host", "port", "user", "password", "db", "charset", "autocommit"}}
            db_ssl.warn_if_unverified(self._settings)
            cfg.update(db_ssl.connect_kwargs(self._settings))
            self._pool = await aiomysql.create_pool(minsize=1, maxsize=10, **cfg)
            async with self._pool.acquire() as conn:
                async with conn.cursor() as cur:
                    for stmt in [s.strip() for s in SCHEMA_SQL.split(";") if s.strip()]:
                        await cur.execute(stmt)
                    try:
                        await ensure_docs_query_helpers_async(cur, self._settings.get("db", "tamkobi"))
                    except Exception:
                        pass
                    await cur.execute("SHOW COLUMNS FROM docs")
                    cols = {r[0] for r in await cur.fetchall()}
                    await cur.execute("SHOW INDEX FROM docs")
                    idxs = {r[2] for r in await cur.fetchall()}
                    for stmt in schema_upgrade_statements(cols, idxs):
                        await cur.execute(stmt)
                    try:
                        await cur.execute("CREATE INDEX idx_docs_coll_upd ON docs (collection, updated_at)")
                    except Exception:
                        pass
                    try:
                        await cur.execute(
                            "CREATE INDEX idx_docs_coll_company_upd "
                            "ON docs (collection, company_id, updated_at)"
                        )
                    except Exception:
                        pass
                    await cur.execute("SELECT collection, spec, unique_index FROM meta_indexes")
                    for coll, spec, uniq in await cur.fetchall():
                        parsed = loads(spec) or {}
                        if not isinstance(parsed, dict):
                            parsed = {}
                        fields = tuple(parsed.get("fields") or [])
                        partial = parsed.get("partialFilterExpression")
                        if not isinstance(partial, dict) or not partial:
                            partial = None
                        self._indexes.setdefault(coll, [])
                        item = (fields, bool(uniq), partial) if partial else (fields, bool(uniq))
                        if item not in self._indexes[coll]:
                            self._indexes[coll].append(item)

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name: str) -> MySQLCollection:
        if name not in self._cols:
            self._cols[name] = MySQLCollection(self, name)
        return self._cols[name]

    async def list_collection_names(self) -> List[str]:
        await self._ensure()
        async with self._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT DISTINCT collection FROM docs")
                rows = await cur.fetchall()
        return [r[0] for r in rows]

    async def close(self):
        if self._pool is not None:
            self._pool.close()
            await self._pool.wait_closed()
            self._pool = None

    def close_sync(self):
        if self._pool is not None:
            self._pool.close()


class MySQLClient:
    """Drop-in stand-in for AsyncIOMotorClient: client[db_name] -> MySQLDatabase."""

    def __init__(self, *_args, **_kwargs):
        self._db = MySQLDatabase()
        self._named = {self._db.name: self._db}

    def __getitem__(self, name: str) -> MySQLDatabase:
        if name not in self._named:
            settings = mysql_settings_from_env()
            settings["db"] = name
            self._named[name] = MySQLDatabase(settings)
        return self._named[name]

    def close(self):
        for d in self._named.values():
            d.close_sync()

    async def close_async(self):
        for d in self._named.values():
            await d.close()


def _sync_connect(settings: dict):
    import pymysql
    return pymysql.connect(
        host=settings["host"],
        port=int(settings["port"]),
        user=settings["user"],
        password=settings["password"],
        database=settings["db"],
        charset=settings.get("charset") or "utf8mb4",
        autocommit=True,
        **db_ssl.connect_kwargs(settings),
    )


class SyncMySQLCursor:
    def __init__(self, coll: "SyncMySQLCollection", query, projection):
        self._coll = coll
        self._query = query or {}
        self._projection = projection
        self._sort = None
        self._limit = None
        self._skip = 0

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else key
        return self

    def limit(self, n: int):
        self._limit = n
        return self

    def skip(self, n: int):
        self._skip = n
        return self

    def to_list(self, length=None):
        _block_shared_copy_sync(self._coll, query=self._query, write=False)
        if sql_page_pushdown_enabled():
            pushed = self._coll._read_page(
                self._query, self._sort, self._skip, self._limit, length, self._projection,
            )
            if pushed is not None:
                return pushed
        docs = self._coll._load_filtered(self._query)
        docs = sort_docs(docs, self._sort)
        if self._skip:
            docs = docs[self._skip :]
        if self._limit is not None:
            docs = docs[: self._limit]
        if length is not None:
            docs = docs[:length]
        return [project_doc(d, self._projection) for d in docs]

    def __iter__(self):
        return iter(self.to_list(None))


class SyncMySQLCollection:
    def __init__(self, db: "SyncMySQLDatabase", name: str):
        self._db = db
        self.name = name

    def _load_all(self):
        self._db._ensure()
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            cur.execute("SELECT doc FROM docs WHERE collection=%s", (self.name,))
            rows = cur.fetchall()
        _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        return [loads(r[0]) for r in rows]

    def distinct_company_ids(self, query):
        """Eşleşen satırların company_id değerleri. Hata olursa None."""
        try:
            sql, params = sql_company_ids(self.name, query)
        except Exception:
            return None
        try:
            self._db._ensure()
            with self._db._conn.cursor() as cur:
                cur.execute(sql, params)
                rows = cur.fetchall()
        except Exception:
            return None
        found = []
        for row in rows or []:
            if not row or row[0] is None:
                continue
            text = str(row[0]).strip()
            if not text or text == "null" or text in found:
                continue
            found.append(text)
        return found

    def _load_filtered(self, query):
        _block_shared_copy_sync(self, query=query, write=False)
        sql, params = sql_pushdown(self.name, query)
        self._db._ensure()
        t0 = time.perf_counter()
        try:
            with self._db._conn.cursor() as cur:
                cur.execute(sql, params)
                docs = [loads(r[0]) for r in cur.fetchall()]
            _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        except Exception:
            docs = self._load_all()
        if not query:
            return docs
        return [d for d in docs if match_query(d, query)]

    def _replace_rows(self, rows: Sequence[Tuple[str, str, str]]):
        packed = list(rows or [])
        if not packed:
            return
        self._db._ensure()
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            for part in chunk_list(packed, REPLACE_BATCH):
                cur.executemany(
                    "REPLACE INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                    part,
                )
        _audit_sql("REPLACE", self.name, doc_id=f"{len(packed)}", duration_ms=(time.perf_counter() - t0) * 1000)

    def _save(self, doc: dict):
        self._db._ensure()
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        self._replace_rows([(self.name, str(doc["_id"]), dumps(doc))])
        return doc

    def _fetch_rows(self, sql: str, params: list):
        self._db._ensure()
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()
        _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        return rows

    def _read_page(self, query, sort, skip, limit, length, projection):
        _block_shared_copy_sync(self, query=query, write=False)
        plan = plan_exact_page(self.name, query, sort, skip, limit, length, projection)
        if not plan:
            return None
        try:
            if self._fetch_rows(plan["probe_sql"], plan["probe_params"]):
                return None
            docs = _loads_rows(self._fetch_rows(plan["sql"], plan["params"]))
        except Exception:
            return None
        if plan["reorder"]:
            return [reorder_projected(d, projection) for d in docs]
        return docs

    def find_one(self, query=None, projection=None, sort=None, skip=0):
        _guard(self.name, "find_one", query=query)
        _block_shared_copy_sync(self, query=query, write=False)
        if sql_page_pushdown_enabled():
            pushed = self._read_page(query, normalize_sort(sort), skip, 1, 1, projection)
            if pushed is not None:
                return pushed[0] if pushed else None
        docs = self._load_filtered(query)
        docs = sort_docs(docs, normalize_sort(sort))
        if skip:
            docs = docs[skip:]
        return project_doc(docs[0], projection) if docs else None

    def find(self, query=None, projection=None):
        _guard(self.name, "find", query=query)
        return SyncMySQLCursor(self, query, projection)

    def insert_one(self, doc: dict):
        _route_write_sync(self, "insert_one", doc=doc)
        _block_shared_copy_sync(self, doc=doc, write=True)
        _guard(self.name, "insert_one", doc=doc, catalog=self._db)
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        self._save(doc)
        return InsertOneResult(doc["_id"])

    def insert_many(self, docs, ordered=True):
        _route_write_sync(self, "insert_many", doc=docs)
        _block_shared_copy_sync(self, doc=docs, write=True)
        _guard(self.name, "insert_many", doc=docs, catalog=self._db)
        return InsertManyResult([self.insert_one(d).inserted_id for d in docs])

    def update_one(self, query, update, upsert=False):
        _route_write_sync(self, "update_one", query=query, update=update)
        _block_shared_copy_sync(self, query=query, update=update, write=True)
        _guard(self.name, "update_one", query=query, update=update, upsert=upsert, catalog=self._db)
        docs = self._load_filtered(query)
        if not docs:
            if not upsert:
                return UpdateResult(0, 0, None)
            new_doc = document_from_upsert(update, query)
            new_doc = new_upsert_doc(update, query)
            self._save(new_doc)
            return UpdateResult(0, 1, new_doc["_id"])
        old = docs[0]
        new_doc = apply_update(old, update, query, is_insert=False)
        changed = new_doc != old
        if changed:
            self._save(new_doc)
        return UpdateResult(1, 1 if changed else 0, None)

    def update_many(self, query, update, upsert=False):
        _route_write_sync(self, "update_many", query=query, update=update)
        _block_shared_copy_sync(self, query=query, update=update, write=True)
        _guard(self.name, "update_many", query=query, update=update, upsert=upsert, catalog=self._db)
        docs = self._load_filtered(query)
        if not docs:
            return self.update_one(query, update, upsert=upsert) if upsert else UpdateResult(0, 0, None)
        changed = []
        for old in docs:
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                changed.append(new_doc)
        if changed:
            rows = []
            for d in changed:
                doc = copy.deepcopy(d)
                if not doc.get("_id"):
                    doc["_id"] = str(uuid.uuid4())
                rows.append((self.name, str(doc["_id"]), dumps(doc)))
            self._replace_rows(rows)
        return UpdateResult(len(docs), len(changed), None)

    def replace_one(self, query, replacement, upsert=False):
        _route_write_sync(self, "replace_one", query=query, doc=replacement)
        _block_shared_copy_sync(self, query=query, doc=replacement, write=True)
        _guard(self.name, "replace_one", query=query, doc=replacement, catalog=self._db)
        replacement = copy.deepcopy(replacement)
        docs = self._load_filtered(query)
        if not docs:
            if not upsert:
                return UpdateResult(0, 0, None)
            if not replacement.get("_id"):
                replacement["_id"] = str(uuid.uuid4())
            self._save(replacement)
            return UpdateResult(0, 1, replacement["_id"])
        replacement["_id"] = docs[0].get("_id")
        self._save(replacement)
        return UpdateResult(1, 1, None)

    def delete_one(self, query):
        _route_write_sync(self, "delete_one", query=query)
        _block_shared_copy_sync(self, query=query, write=True)
        _guard(self.name, "delete_one", query=query, catalog=self._db)
        docs = self._load_filtered(query)
        if not docs:
            return DeleteResult(0)
        self._db._ensure()
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            cur.execute("DELETE FROM docs WHERE collection=%s AND id=%s", (self.name, str(docs[0]["_id"])))
            n = cur.rowcount
        _audit_sql("DELETE", self.name, doc_id=docs[0].get("_id"), duration_ms=(time.perf_counter() - t0) * 1000)
        return DeleteResult(n)

    def delete_many(self, query):
        _route_write_sync(self, "delete_many", query=query)
        _block_shared_copy_sync(self, query=query, write=True)
        _guard(self.name, "delete_many", query=query, catalog=self._db)
        docs = self._load_filtered(query)
        if not docs:
            return DeleteResult(0)
        self._db._ensure()
        ids = [str(d["_id"]) for d in docs]
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(
                f"DELETE FROM docs WHERE collection=%s AND id IN ({placeholders})",
                (self.name, *ids),
            )
            n = cur.rowcount
        _audit_sql("DELETE", self.name, doc_id=",".join(ids[:8]), duration_ms=(time.perf_counter() - t0) * 1000)
        return DeleteResult(n)

    def count_documents(self, query=None):
        _guard(self.name, "count_documents", query=query)
        _block_shared_copy_sync(self, query=query, write=False)
        exact = sql_count_exact(self.name, query)
        if exact:
            sql, params = exact
            self._db._ensure()
            t0 = time.perf_counter()
            with self._db._conn.cursor() as cur:
                cur.execute(sql, params)
                row = cur.fetchone()
            _audit_sql("COUNT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
            return int((row or [0])[0] or 0)
        return len(self._load_filtered(query))

    def distinct(self, key, query=None):
        _guard(self.name, "distinct", query=query)
        _block_shared_copy_sync(self, query=query, write=False)
        seen = []
        for d in self._load_filtered(query):
            for v in values_at(d, key) or []:
                if v not in seen:
                    seen.append(v)
        return seen

    def create_index(self, keys, unique=False, **_kwargs):
        return keys if isinstance(keys, str) else "_".join(k[0] if isinstance(k, (list, tuple)) else k for k in keys)


class SyncMySQLDatabase:
    def __init__(self, settings: Optional[dict] = None):
        self._settings = settings or mysql_settings_from_env()
        self._conn = None
        self._cols = {}
        self.name = self._settings.get("db", "tamkobi")

    def _ensure(self):
        if self._conn is None:
            self._conn = _sync_connect(self._settings)
            with self._conn.cursor() as cur:
                for stmt in [s.strip() for s in SCHEMA_SQL.split(";") if s.strip()]:
                    cur.execute(stmt)
                try:
                    ensure_docs_query_helpers(cur, self._settings.get("db", "tamkobi"))
                except Exception:
                    pass
                cur.execute("SHOW COLUMNS FROM docs")
                cols = {r[0] for r in cur.fetchall()}
                cur.execute("SHOW INDEX FROM docs")
                idxs = {r[2] for r in cur.fetchall()}
                for stmt in schema_upgrade_statements(cols, idxs):
                    cur.execute(stmt)
                try:
                    cur.execute("CREATE INDEX idx_docs_coll_upd ON docs (collection, updated_at)")
                except Exception:
                    pass
                try:
                    cur.execute(
                        "CREATE INDEX idx_docs_coll_company_upd "
                        "ON docs (collection, company_id, updated_at)"
                    )
                except Exception:
                    pass

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name: str) -> SyncMySQLCollection:
        if name not in self._cols:
            self._cols[name] = SyncMySQLCollection(self, name)
        return self._cols[name]

    def list_collection_names(self):
        self._ensure()
        with self._conn.cursor() as cur:
            cur.execute("SELECT DISTINCT collection FROM docs")
            return [r[0] for r in cur.fetchall()]

    def close(self):
        if self._conn is not None:
            self._conn.close()
            self._conn = None


class SyncMySQLClient:
    """Drop-in stand-in for pymongo.MongoClient."""

    def __init__(self, *_args, **_kwargs):
        self._db = SyncMySQLDatabase()
        self._named = {self._db.name: self._db}

    def __getitem__(self, name: str) -> SyncMySQLDatabase:
        if name not in self._named:
            settings = mysql_settings_from_env()
            settings["db"] = name
            self._named[name] = SyncMySQLDatabase(settings)
        return self._named[name]

    def close(self):
        for d in self._named.values():
            d.close()
