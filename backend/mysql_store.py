"""MySQL-backed document store with a Motor/MongoDB-like async API.

TamKobi historically used MongoDB collections. This module stores the same
JSON documents in MySQL 8 (utf8mb4 + JSON column) so existing backend code
keeps using db.<collection>.find / update_one / etc.
"""
from __future__ import annotations

import copy
import json
import os
import re
import time
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

MISSING = object()
SKIP_TOMBSTONE = frozenset({"sync_tombstones", "trash", "login_attempts", "activity_logs", "notifications"})


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


def _audit_sql(op: str, collection: str, doc_id=None, duration_ms: float = 0):
    try:
        from applog import log_sql
        log_sql(op, collection, doc_id=doc_id, duration_ms=duration_ms)
    except Exception:
        pass


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
    url = (os.environ.get("MYSQL_URL") or os.environ.get("DATABASE_URL") or "").strip()
    if url.startswith("mysql"):
        # Accept mysql://, mysql+pymysql://, mysql+aiomysql://
        if url.startswith("mysql+"):
            url = "mysql://" + url.split("://", 1)[1]
        parsed = urlparse(url)
        db = (parsed.path or "/tamkobi").lstrip("/") or "tamkobi"
        return {
            "host": parsed.hostname or "127.0.0.1",
            "port": parsed.port or 3306,
            "user": unquote(parsed.username or "root"),
            "password": unquote(parsed.password or ""),
            "db": db.split("?")[0] or "tamkobi",
            "charset": "utf8mb4",
            "autocommit": True,
        }
    return {
        "host": os.environ.get("MYSQL_HOST", "127.0.0.1"),
        "port": int(os.environ.get("MYSQL_PORT", "3306")),
        "user": os.environ.get("MYSQL_USER", "tamkobi"),
        "password": os.environ.get("MYSQL_PASSWORD") or "",
        "db": os.environ.get("MYSQL_DATABASE") or os.environ.get("DB_NAME") or "tamkobi",
        "charset": "utf8mb4",
        "autocommit": True,
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


_SAFE_FIELD = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_DATEISH = re.compile(r"^\d{4}(-\d{2}(-\d{2})?)?")
_PREFIX_RE = re.compile(r"^\^[\w.\-/]+$")


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
        expr = _json_unquote(k)
        if not isinstance(v, dict):
            if isinstance(v, bool) or isinstance(v, (int, float)):
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


def ensure_docs_query_helpers(cur, db_name: str) -> None:
    """Stored company_id + index so tenant report queries skip other firms."""
    cur.execute(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND COLUMN_NAME='company_id'",
        (db_name,),
    )
    if int((cur.fetchone() or [0])[0] or 0) == 0:
        cur.execute(
            "ALTER TABLE docs ADD COLUMN company_id VARCHAR(191) "
            "GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED"
        )
    cur.execute(
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND INDEX_NAME='idx_docs_coll_company'",
        (db_name,),
    )
    if int((cur.fetchone() or [0])[0] or 0) == 0:
        cur.execute("CREATE INDEX idx_docs_coll_company ON docs (collection, company_id)")


async def ensure_docs_query_helpers_async(cur, db_name: str) -> None:
    await cur.execute(
        "SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND COLUMN_NAME='company_id'",
        (db_name,),
    )
    row = await cur.fetchone()
    if int((row or [0])[0] or 0) == 0:
        await cur.execute(
            "ALTER TABLE docs ADD COLUMN company_id VARCHAR(191) "
            "GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED"
        )
    await cur.execute(
        "SELECT COUNT(*) FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=%s AND TABLE_NAME='docs' AND INDEX_NAME='idx_docs_coll_company'",
        (db_name,),
    )
    row = await cur.fetchone()
    if int((row or [0])[0] or 0) == 0:
        await cur.execute("CREATE INDEX idx_docs_coll_company ON docs (collection, company_id)")


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


def eval_expr(doc: dict, expr):
    if isinstance(expr, str) and expr.startswith("$") and not expr.startswith("$$"):
        return scalar_at(doc, expr[1:])
    if isinstance(expr, dict):
        if "$ifNull" in expr:
            a, b = expr["$ifNull"]
            v = eval_expr(doc, a)
            return eval_expr(doc, b) if v is MISSING or v is None else v
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
        cur = scalar_at(out, k)
        if cur is MISSING or cur is None:
            _set_path(out, k, [v], query)
        elif isinstance(cur, list) and v not in cur:
            cur.append(v)
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


def sort_docs(docs: List[dict], key) -> List[dict]:
    if not key:
        return docs
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
  company_id VARCHAR(191) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id),
  INDEX idx_docs_coll_company (collection, company_id)
  company_id VARCHAR(64) GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id),
  KEY idx_docs_coll_company (collection, company_id)
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
    """Idempotent ALTERs for databases created before generated company_id."""
    stmts: List[str] = []
    if "company_id" not in columns:
        stmts.append(
            "ALTER TABLE docs ADD COLUMN company_id VARCHAR(64) "
            "GENERATED ALWAYS AS (JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id'))) STORED"
        )
    if "idx_docs_coll_company" not in indexes:
        stmts.append("ALTER TABLE docs ADD INDEX idx_docs_coll_company (collection, company_id)")
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
        docs = await self._coll._load_filtered(self._query)
        docs = sort_docs(docs, self._sort)
        if self._skip:
            docs = docs[self._skip :]
        cap = length if length is not None else self._limit
        if self._limit is not None:
            docs = docs[: self._limit]
        if cap is not None:
            docs = docs[:cap]
        return [project_doc(d, self._projection) for d in docs]

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


class MySQLCollection:
    def __init__(self, db: "MySQLDatabase", name: str):
        self._db = db
        self.name = name

    async def _load_all(self) -> List[dict]:
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT doc FROM docs WHERE collection=%s", (self.name,))
                rows = await cur.fetchall()
        _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        return [loads(r[0]) for r in rows]

    async def _load_sql(self, sql: str, params: list) -> List[dict]:
        await self._db._ensure()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, params)
                rows = await cur.fetchall()
        return [loads(r[0]) for r in rows]

    async def _load_filtered(self, query: Optional[dict]) -> List[dict]:
        sql, params = sql_pushdown(self.name, query)
        try:
            docs = await self._load_sql(sql, params)
        except Exception:
            docs = await self._load_all()
    async def _load_by_company(self, company_id) -> List[dict]:
        await self._db._ensure()
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "SELECT doc FROM docs WHERE collection=%s AND company_id=%s",
                    (self.name, str(company_id)),
                )
                rows = await cur.fetchall()
        _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        return [loads(r[0]) for r in rows]

    async def _load_filtered(self, query: Optional[dict]) -> List[dict]:
        cid = _simple_eq(query, "company_id")
        if cid is not None:
            docs = await self._load_by_company(cid)
            rest = {k: v for k, v in (query or {}).items() if k != "company_id"}
            if not rest:
                return docs
            return [d for d in docs if match_query(d, rest)]
        docs = await self._load_all()
        if not query:
            return docs
        return [d for d in docs if match_query(d, query)]

    async def _save(self, doc: dict):
        await self._db._ensure()
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        await self._check_unique(doc, exclude_id=None)
        t0 = time.perf_counter()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "REPLACE INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                    (self.name, str(doc["_id"]), dumps(doc)),
                )
        _audit_sql("REPLACE", self.name, doc_id=doc.get("_id"), duration_ms=(time.perf_counter() - t0) * 1000)

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
        return n

    async def _check_unique(self, doc: dict, exclude_id):
        indexes = self._db._indexes.get(self.name) or []
        if not indexes:
            return
        others = [d for d in await self._load_all() if d.get("_id") != exclude_id and d.get("_id") != doc.get("_id")]
        for spec, unique in indexes:
            if not unique:
                continue
            key = tuple(scalar_at(doc, f) for f in spec)
            for o in others:
                if tuple(scalar_at(o, f) for f in spec) == key and all(v is not MISSING for v in key):
                    raise DuplicateKeyError(f"duplicate key {spec}={key} on {self.name}")

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None, sort=None, skip=0):
        docs = await self._load_filtered(query)
        docs = sort_docs(docs, normalize_sort(sort))
        if skip:
            docs = docs[skip:]
        if not docs:
            return None
        return project_doc(docs[0], projection)

    def find(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        return MySQLCursor(self, query, projection)

    async def insert_one(self, doc: dict):
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
        return InsertOneResult(doc["_id"])

    async def insert_many(self, docs: Iterable[dict], ordered: bool = True):
        ids = []
        for d in docs:
            r = await self.insert_one(d)
            ids.append(r.inserted_id)
        return InsertManyResult(ids)

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
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

    async def update_many(self, query: dict, update: dict, upsert: bool = False):
        docs = await self._load_filtered(query)
        if not docs:
            if upsert:
                return await self.update_one(query, update, upsert=True)
            return UpdateResult(0, 0, None)
        modified = 0
        for old in docs:
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                await self._check_unique(new_doc, exclude_id=old.get("_id"))
                await self._save(new_doc)
                modified += 1
        return UpdateResult(len(docs), modified, None)

    async def replace_one(self, query: dict, replacement: dict, upsert: bool = False):
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
        docs = await self._load_filtered(query)
        if not docs:
            return DeleteResult(0)
        await self._record_tombstones(docs[:1])
        n = await self._delete_ids([docs[0]["_id"]])
        return DeleteResult(n)

    async def delete_many(self, query: dict):
        docs = await self._load_filtered(query)
        await self._record_tombstones(docs)
        n = await self._delete_ids([d["_id"] for d in docs if d.get("_id") is not None])
        return DeleteResult(n)

    async def _record_tombstones(self, docs: Sequence[dict]):
        if self.name in SKIP_TOMBSTONE or not docs:
            return
        now = datetime.now(timezone.utc).isoformat()
        for d in docs:
            did = d.get("_id")
            if not did:
                continue
            await self._db.sync_tombstones.insert_one({
                "_id": f"{self.name}:{did}:{uuid.uuid4().hex[:8]}",
                "collection": self.name,
                "doc_id": str(did),
                "company_id": d.get("company_id"),
                "deleted_at": now,
            })

    async def changed_since(self, since: Optional[str] = None, company_id: Optional[str] = None, limit: int = 3000) -> Tuple[List[dict], Optional[str], bool]:
        """SQL-level delta: rows whose docs.updated_at is >= since, optionally scoped by company_id."""
        await self._db._ensure()
        sql = "SELECT doc, updated_at FROM docs WHERE collection=%s"
        args: List[Any] = [self.name]
        parsed = parse_ts(since)
        if parsed is not None:
            sql += " AND updated_at >= %s"
            args.append(parsed)
        if company_id:
            sql += " AND JSON_UNQUOTE(JSON_EXTRACT(doc, '$.company_id')) = %s"
            args.append(company_id)
        sql += " ORDER BY updated_at ASC, id ASC LIMIT %s"
        args.append(int(limit) + 1)
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(sql, args)
                rows = await cur.fetchall()
        more = len(rows) > limit
        rows = rows[:limit]
        docs = []
        cursor = since
        for raw, updated in rows:
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

    async def count_documents(self, query: Optional[dict] = None):
        return len(await self._load_filtered(query))

    async def distinct(self, key: str, query: Optional[dict] = None):
        docs = await self._load_filtered(query)
        seen = []
        for d in docs:
            for v in values_at(d, key) or []:
                if v not in seen:
                    seen.append(v)
        return seen

    async def create_index(self, keys, unique: bool = False, **_kwargs):
        if isinstance(keys, str):
            fields = [keys]
            name = keys
        else:
            fields = [k[0] if isinstance(k, (list, tuple)) else k for k in keys]
            name = "_".join(fields)
        self._db._indexes.setdefault(self.name, [])
        spec = (tuple(fields), bool(unique))
        if spec not in self._db._indexes[self.name]:
            self._db._indexes[self.name].append(spec)
        await self._db._ensure()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "REPLACE INTO meta_indexes (collection, name, spec, unique_index) VALUES (%s,%s,%s,%s)",
                    (self.name, name, dumps({"fields": fields}), 1 if unique else 0),
                )
        return name


class MySQLDatabase:
    def __init__(self, settings: Optional[dict] = None):
        self._settings = settings or mysql_settings_from_env()
        self._pool = None
        self._indexes: Dict[str, List[Tuple[tuple, bool]]] = {}
        self._cols: Dict[str, MySQLCollection] = {}
        self.name = self._settings.get("db", "tamkobi")

    async def _ensure(self):
        if self._pool is None:
            import aiomysql
            cfg = {k: v for k, v in self._settings.items() if k in {"host", "port", "user", "password", "db", "charset", "autocommit"}}
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
                    await cur.execute("SELECT collection, spec, unique_index FROM meta_indexes")
                    for coll, spec, uniq in await cur.fetchall():
                        fields = tuple(loads(spec).get("fields") or [])
                        self._indexes.setdefault(coll, [])
                        item = (fields, bool(uniq))
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

    def _load_by_company(self, company_id):
        self._db._ensure()
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            cur.execute(
                "SELECT doc FROM docs WHERE collection=%s AND company_id=%s",
                (self.name, str(company_id)),
            )
            rows = cur.fetchall()
        _audit_sql("SELECT", self.name, duration_ms=(time.perf_counter() - t0) * 1000)
        return [loads(r[0]) for r in rows]

    def _load_filtered(self, query):
        sql, params = sql_pushdown(self.name, query)
        self._db._ensure()
        try:
            with self._db._conn.cursor() as cur:
                cur.execute(sql, params)
                docs = [loads(r[0]) for r in cur.fetchall()]
        except Exception:
            docs = self._load_all()
        cid = _simple_eq(query, "company_id")
        if cid is not None:
            docs = self._load_by_company(cid)
            rest = {k: v for k, v in (query or {}).items() if k != "company_id"}
            if not rest:
                return docs
            return [d for d in docs if match_query(d, rest)]
        docs = self._load_all()
        if not query:
            return docs
        return [d for d in docs if match_query(d, query)]

    def _save(self, doc: dict):
        self._db._ensure()
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        t0 = time.perf_counter()
        with self._db._conn.cursor() as cur:
            cur.execute(
                "REPLACE INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                (self.name, str(doc["_id"]), dumps(doc)),
            )
        _audit_sql("REPLACE", self.name, doc_id=doc.get("_id"), duration_ms=(time.perf_counter() - t0) * 1000)
        return doc

    def find_one(self, query=None, projection=None, sort=None, skip=0):
        docs = self._load_filtered(query)
        docs = sort_docs(docs, normalize_sort(sort))
        if skip:
            docs = docs[skip:]
        return project_doc(docs[0], projection) if docs else None

    def find(self, query=None, projection=None):
        return SyncMySQLCursor(self, query, projection)

    def insert_one(self, doc: dict):
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        self._save(doc)
        return InsertOneResult(doc["_id"])

    def insert_many(self, docs, ordered=True):
        return InsertManyResult([self.insert_one(d).inserted_id for d in docs])

    def update_one(self, query, update, upsert=False):
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
        docs = self._load_filtered(query)
        if not docs:
            return self.update_one(query, update, upsert=upsert) if upsert else UpdateResult(0, 0, None)
        modified = 0
        for old in docs:
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                self._save(new_doc)
                modified += 1
        return UpdateResult(len(docs), modified, None)

    def replace_one(self, query, replacement, upsert=False):
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
        return len(self._load_filtered(query))

    def distinct(self, key, query=None):
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
