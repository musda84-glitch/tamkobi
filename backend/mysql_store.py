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
import uuid
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse

MISSING = object()


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
        "password": os.environ.get("MYSQL_PASSWORD", "tamkobi"),
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


SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS docs (
  collection VARCHAR(128) NOT NULL,
  id VARCHAR(191) NOT NULL,
  doc JSON NOT NULL,
  updated_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (collection, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS meta_indexes (
  collection VARCHAR(128) NOT NULL,
  name VARCHAR(191) NOT NULL,
  spec JSON NOT NULL,
  unique_index TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
"""


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
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute("SELECT doc FROM docs WHERE collection=%s", (self.name,))
                rows = await cur.fetchall()
        return [loads(r[0]) for r in rows]

    async def _load_filtered(self, query: Optional[dict]) -> List[dict]:
        docs = await self._load_all()
        if not query:
            return docs
        # fast path: _id equality
        if list(query.keys()) == ["_id"] and not isinstance(query.get("_id"), dict):
            return [d for d in docs if d.get("_id") == query["_id"]]
        return [d for d in docs if match_query(d, query)]

    async def _save(self, doc: dict):
        await self._db._ensure()
        doc = copy.deepcopy(doc)
        if not doc.get("_id"):
            doc["_id"] = str(uuid.uuid4())
        await self._check_unique(doc, exclude_id=None)
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                await cur.execute(
                    "REPLACE INTO docs (collection, id, doc) VALUES (%s,%s,%s)",
                    (self.name, str(doc["_id"]), dumps(doc)),
                )

    async def _delete_ids(self, ids: Sequence[str]) -> int:
        if not ids:
            return 0
        await self._db._ensure()
        async with self._db._pool.acquire() as conn:
            async with conn.cursor() as cur:
                placeholders = ",".join(["%s"] * len(ids))
                await cur.execute(
                    f"DELETE FROM docs WHERE collection=%s AND id IN ({placeholders})",
                    (self.name, *[str(i) for i in ids]),
                )
                return cur.rowcount

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

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        docs = await self._load_filtered(query)
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
            base = {}
            new_doc = apply_update(base, update, query, is_insert=True)
            if not new_doc.get("_id"):
                new_doc["_id"] = str(uuid.uuid4())
            # copy equality fields from query when simple
            for k, v in (query or {}).items():
                if not str(k).startswith("$") and not isinstance(v, dict) and k not in new_doc:
                    _set_path(new_doc, k, v)
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
        n = await self._delete_ids([docs[0]["_id"]])
        return DeleteResult(n)

    async def delete_many(self, query: dict):
        docs = await self._load_filtered(query)
        n = await self._delete_ids([d["_id"] for d in docs if d.get("_id") is not None])
        return DeleteResult(n)

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
