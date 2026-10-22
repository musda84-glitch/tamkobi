"""shared_v2 belge arka ucu.

docs_v2 satırı bir firmaya aittir. Filtre, sıralama ve limit SQL'e indirilir.
İndirilemeyen operatör yanlış satır üretmez; firma kapsamında Python yoluna
döner ve neden loglanır. Belge değeri loglanmaz.

Tablo bu modülde yaratılmaz. Şema storage_migrations 0003 içindedir.
"""
from __future__ import annotations

import copy
import logging
import os
import sqlite3
from urllib.parse import unquote, urlparse

from mysql_store import (
    DeleteResult,
    DuplicateKeyError,
    InsertManyResult,
    InsertOneResult,
    UpdateResult,
    _PREFIX_RE,
    _SAFE_FIELD,
    _guard,
    aggregate_rows,
    apply_update,
    dumps,
    has_unique_index,
    index_spec_parts,
    loads,
    match_query,
    new_upsert_doc,
    normalize_sort,
    project_doc,
    scalar_at,
    sort_docs,
    unique_conflict,
    unique_index_applies,
    values_at,
    MISSING,
)

log = logging.getLogger("storage_shared_v2")

# Sık okunan JSON alanları. Gerekçe PR açıklamasında.
GENERATED_COLUMNS = (
    ("g_status", "status"),
    ("g_contact_id", "contact_id"),
    ("g_date", "date"),
    ("g_created_at", "created_at"),
    ("g_account_id", "account_id"),
    ("g_invoice_number", "invoice_number"),
    ("g_sku", "sku"),
    ("g_barcode", "barcode"),
    ("g_partner_id", "partner_id"),
    ("g_account_name", "account_name"),
    ("g_issue_date", "issue_date"),
    ("g_order_number", "order_number"),
)
_COLUMN_OF = {field: column for column, field in GENERATED_COLUMNS}
ENV_DSN = "STORAGE_SHARED_V2_DSN"
_MAX_LIMIT = 18446744073709551615

_store = None


class _NoPush(Exception):
    def __init__(self, reason: str):
        self.reason = reason
        super().__init__(reason)


class SharedV2Store:
    """Süreciçi bağlantı. Kuruluş bağlantı açmaz, tablo yaratmaz."""

    def __init__(self):
        self.conn = None
        self.dialect = "sqlite"
        self.owned = False
        self._opener = None
        self.indexes: dict = {}
        self.python_scans = 0
        self.docs_loaded = 0
        self.statements: list = []
        self.last_plan = ""
        self.last_unique_plan = ""
        self.capture_plans = False
        self.scalar_ok: set = set()
        self.scalar_bad: set = set()

    def attach(self, conn, dialect: str, owned: bool = False) -> None:
        self.conn = conn
        self.dialect = dialect
        self.owned = owned

    def connection(self):
        if self.conn is None:
            if self._opener is None:
                self._opener = _opener_from_env()
            conn, dialect, owned = self._opener()
            self.attach(conn, dialect, owned)
        return self.conn

    def close(self) -> None:
        conn = self.conn
        self.conn = None
        if conn is not None and self.owned:
            conn.close()


def get_store() -> SharedV2Store:
    global _store
    if _store is None:
        _store = SharedV2Store()
    return _store


def reset_store() -> None:
    """Testler bağlantıyı ve sayaçları bırakır."""
    global _store
    if _store is not None:
        _store.close()
    _store = None


def bind_sqlite(conn) -> SharedV2Store:
    """Testler hazır sqlite bağlantısını verir. Sahipliği almaz."""
    store = get_store()
    store.attach(conn, "sqlite", owned=False)
    return store


def collection_for(company_id: str, name: str) -> "SharedV2Collection":
    cid = str(company_id or "").strip()
    coll = str(name or "").strip()
    if not cid:
        raise ValueError("company_id boş")
    if not coll:
        raise ValueError("collection boş")
    return SharedV2Collection(get_store(), cid, coll)


def _opener_from_env():
    dsn = os.environ.get(ENV_DSN, "").strip()
    if not dsn:
        raise RuntimeError("shared_v2 hedefi ayarlı değil")

    def open_it():
        try:
            return _connect(dsn)
        except RuntimeError:
            raise
        except Exception:
            raise RuntimeError("shared_v2 hedefi açılmadı") from None

    return open_it


def _connect(dsn: str):
    scheme = dsn.split("://", 1)[0].lower()
    if scheme in ("sqlite", "sqlite3"):
        conn = sqlite3.connect(_sqlite_path(dsn), isolation_level=None, check_same_thread=False)
        return conn, "sqlite", True
    if scheme in ("mysql", "mariadb") or scheme.startswith("mysql+") or scheme.startswith("mariadb+"):
        return _connect_mysql(dsn), "mysql", True
    raise RuntimeError("shared_v2 hedefi desteklenmiyor")


def _sqlite_path(dsn: str) -> str:
    rest = dsn.split("://", 1)[1]
    if rest == "/:memory:":
        return ":memory:"
    if rest.startswith("/"):
        return rest
    return rest or ":memory:"


def _connect_mysql(dsn: str):
    import pymysql

    url = dsn
    if url.startswith("mysql+") or url.startswith("mariadb+"):
        url = "mysql://" + url.split("://", 1)[1]
    elif url.startswith("mariadb://"):
        url = "mysql://" + url.split("://", 1)[1]
    parsed = urlparse(url)
    conn = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        database=(parsed.path or "/").lstrip("/").split("?")[0],
        charset="utf8mb4",
        autocommit=False,
    )
    return conn


class SharedV2Cursor:
    def __init__(self, coll: "SharedV2Collection", query, projection):
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
        return await self._coll._read(
            self._query, self._sort, self._skip, self._limit, length, self._projection,
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
        doc = self._aiter_docs[self._aiter_i]
        self._aiter_i += 1
        return doc


class SharedV2Collection:
    def __init__(self, store: SharedV2Store, company_id: str, name: str):
        self.store = store
        self.company_id = company_id
        self.name = name

    def find(self, query=None, projection=None):
        _guard(self.name, "find", query=query)
        return SharedV2Cursor(self, query, projection)

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        _guard(self.name, "find_one", query=query)
        rows = await self._read(query, normalize_sort(sort), skip, 1, 1, projection)
        return rows[0] if rows else None

    async def count_documents(self, query=None):
        _guard(self.name, "count_documents", query=query)
        where, reason = self._where_plan(query or {})
        if where is None:
            self._log_fallback(reason)
            return len(self._python_match(query))
        sql, params = where
        row = self._run("SELECT COUNT(*) FROM docs_v2 WHERE " + sql, params).fetchone()
        return int((row or [0])[0] or 0)

    async def distinct(self, key, query=None):
        _guard(self.name, "distinct", query=query)
        docs = await self._match_docs(query)
        seen = []
        for doc in docs:
            for value in values_at(doc, key) or []:
                if value not in seen:
                    seen.append(value)
        return seen

    def aggregate(self, pipeline):
        _guard(self.name, "aggregate", pipeline=pipeline)
        coll = self
        stages = list(pipeline or [])

        class _Cursor:
            async def to_list(self, length=None):
                docs = None
                for stage in stages:
                    if isinstance(stage, dict) and "$match" in stage:
                        docs = await coll._match_docs(stage.get("$match"))
                        break
                if docs is None:
                    docs = await coll._match_docs({})
                rows = aggregate_rows(docs, stages)
                if length is None:
                    return list(rows)
                return list(rows)[: int(length)]

        return _Cursor()

    async def insert_one(self, doc):
        _guard(self.name, "insert_one", doc=doc)
        body = self._prepare(doc)
        self._begin()
        try:
            self._check_unique(body, None)
            self._run(
                "INSERT INTO docs_v2 (company_id, collection, id, doc) VALUES (?,?,?,?)",
                (self.company_id, self.name, str(body["_id"]), dumps(body)),
            )
            self._commit()
        except DuplicateKeyError:
            self._rollback()
            raise
        except Exception as exc:
            self._rollback()
            if _is_duplicate(exc):
                raise DuplicateKeyError("duplicate key") from None
            raise
        self._invalidate()
        _note(self.name, body)
        return InsertOneResult(body["_id"])

    async def insert_many(self, docs, ordered: bool = True):
        _guard(self.name, "insert_many", doc=docs)
        ids = []
        for doc in docs or []:
            ids.append((await self.insert_one(doc)).inserted_id)
        return InsertManyResult(ids)

    async def update_one(self, query, update, upsert: bool = False):
        _guard(self.name, "update_one", query=query, update=update, upsert=upsert)
        old = await self._first(query)
        if old is None:
            if not upsert:
                return UpdateResult(0, 0, None)
            created = self._prepare(new_upsert_doc(update, query))
            result = await self.insert_one(created)
            return UpdateResult(0, 1, result.inserted_id)
        new_doc = apply_update(old, update, query, is_insert=False)
        if new_doc == old:
            return UpdateResult(1, 0, None)
        new_doc = self._prepare(new_doc)
        new_doc["_id"] = old.get("_id") or new_doc.get("_id")
        self._begin()
        try:
            self._check_unique(new_doc, old.get("_id"))
            self._run(
                "UPDATE docs_v2 SET doc=? WHERE company_id=? AND collection=? AND id=?",
                (dumps(new_doc), self.company_id, self.name, str(old["_id"])),
            )
            self._commit()
        except DuplicateKeyError:
            self._rollback()
            raise
        except Exception:
            self._rollback()
            raise
        self._invalidate()
        _note(self.name, new_doc)
        return UpdateResult(1, 1, None)

    async def update_one_atomic(self, query, update):
        _guard(self.name, "update_one_atomic", query=query, update=update)
        q = query or {}
        doc_id = q.get("_id")
        if doc_id is None or isinstance(doc_id, dict):
            raise ValueError("update_one_atomic requires equality _id in query")
        self._begin()
        try:
            row = self._run(
                "SELECT doc FROM docs_v2 WHERE company_id=? AND collection=? AND id=?",
                (self.company_id, self.name, str(doc_id)),
            ).fetchone()
            if not row:
                self._rollback()
                return UpdateResult(0, 0, None)
            old = loads(row[0])
            if not match_query(old, q):
                self._rollback()
                return UpdateResult(0, 0, None)
            new_doc = apply_update(old, update, q, is_insert=False)
            changed = new_doc != old
            if changed:
                new_doc = self._prepare(new_doc)
                new_doc["_id"] = old.get("_id")
                self._check_unique(new_doc, old.get("_id"))
                self._run(
                    "UPDATE docs_v2 SET doc=? WHERE company_id=? AND collection=? AND id=?",
                    (dumps(new_doc), self.company_id, self.name, str(doc_id)),
                )
            self._commit()
        except Exception:
            self._rollback()
            raise
        if changed:
            self._invalidate()
            _note(self.name, new_doc)
        return UpdateResult(1, 1 if changed else 0, None)

    async def update_many(self, query, update, upsert: bool = False):
        _guard(self.name, "update_many", query=query, update=update, upsert=upsert)
        docs = await self._match_docs(query)
        if not docs:
            if upsert:
                return await self.update_one(query, update, upsert=True)
            return UpdateResult(0, 0, None)
        changed = []
        for old in docs:
            new_doc = apply_update(old, update, query, is_insert=False)
            if new_doc != old:
                new_doc = self._prepare(new_doc)
                new_doc["_id"] = old.get("_id") or new_doc.get("_id")
                changed.append(new_doc)
        if changed:
            self._begin()
            try:
                for doc in changed:
                    self._check_unique(doc, doc.get("_id"))
                    self._run(
                        "UPDATE docs_v2 SET doc=? WHERE company_id=? AND collection=? AND id=?",
                        (dumps(doc), self.company_id, self.name, str(doc["_id"])),
                    )
                self._commit()
            except Exception:
                self._rollback()
                raise
            self._invalidate()
            for doc in changed:
                _note(self.name, doc)
        return UpdateResult(len(docs), len(changed), None)

    async def replace_one(self, query, replacement, upsert: bool = False):
        _guard(self.name, "replace_one", query=query, doc=replacement)
        old = await self._first(query)
        if old is None:
            if not upsert:
                return UpdateResult(0, 0, None)
            body = self._prepare(replacement)
            result = await self.insert_one(body)
            return UpdateResult(0, 1, result.inserted_id)
        body = self._prepare(replacement)
        body["_id"] = old.get("_id") or body.get("_id")
        self._begin()
        try:
            self._check_unique(body, old.get("_id"))
            self._run(
                "UPDATE docs_v2 SET doc=? WHERE company_id=? AND collection=? AND id=?",
                (dumps(body), self.company_id, self.name, str(body["_id"])),
            )
            self._commit()
        except Exception:
            self._rollback()
            raise
        self._invalidate()
        _note(self.name, body)
        return UpdateResult(1, 1, None)

    async def find_one_and_update(
        self, query, update, upsert: bool = False, return_document=True, projection=None,
    ):
        _guard(self.name, "find_one_and_update", query=query, update=update, upsert=upsert)
        old = await self._first(query)
        if old is None:
            if not upsert:
                return None
            created = self._prepare(new_upsert_doc(update, query))
            await self.insert_one(created)
            out = created if return_document else None
            if out is None:
                return None
            return project_doc(out, projection) if projection else copy.deepcopy(out)
        new_doc = apply_update(old, update, query, is_insert=False)
        new_doc = self._prepare(new_doc)
        new_doc["_id"] = old.get("_id") or new_doc.get("_id")
        if new_doc != old:
            self._begin()
            try:
                self._check_unique(new_doc, old.get("_id"))
                self._run(
                    "UPDATE docs_v2 SET doc=? WHERE company_id=? AND collection=? AND id=?",
                    (dumps(new_doc), self.company_id, self.name, str(new_doc["_id"])),
                )
                self._commit()
            except Exception:
                self._rollback()
                raise
            self._invalidate()
            _note(self.name, new_doc)
        out = new_doc if return_document else old
        return project_doc(out, projection) if projection else copy.deepcopy(out)

    async def delete_one(self, query):
        _guard(self.name, "delete_one", query=query)
        old = await self._first(query)
        if old is None:
            return DeleteResult(0)
        self._run(
            "DELETE FROM docs_v2 WHERE company_id=? AND collection=? AND id=?",
            (self.company_id, self.name, str(old["_id"])),
        )
        self._invalidate()
        _note(self.name, old)
        return DeleteResult(1)

    async def delete_many(self, query):
        _guard(self.name, "delete_many", query=query)
        where, reason = self._where_plan(query or {})
        if where is None:
            self._log_fallback(reason)
            docs = self._python_match(query)
            if not docs:
                return DeleteResult(0)
            ids = [str(doc["_id"]) for doc in docs if doc.get("_id") is not None]
            marks = ",".join(["?"] * len(ids))
            cur = self._run(
                f"DELETE FROM docs_v2 WHERE company_id=? AND collection=? AND id IN ({marks})",
                (self.company_id, self.name, *ids),
            )
            self._invalidate()
            for doc in docs:
                _note(self.name, doc)
            return DeleteResult(cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else len(ids))
        sql, params = where
        cur = self._run("DELETE FROM docs_v2 WHERE " + sql, params)
        self._invalidate()
        deleted = cur.rowcount if cur.rowcount is not None and cur.rowcount >= 0 else 0
        return DeleteResult(deleted)

    async def create_index(self, keys, unique: bool = False, **kwargs):
        if isinstance(keys, str):
            fields = [keys]
            name = keys
        else:
            fields = [item[0] if isinstance(item, (list, tuple)) else item for item in keys]
            name = "_".join(str(field) for field in fields)
        partial = kwargs.get("partialFilterExpression")
        if isinstance(partial, dict) and partial:
            partial = copy.deepcopy(partial)
        else:
            partial = None
        bucket = self.store.indexes.setdefault(self.name, [])
        spec = (tuple(fields), bool(unique), partial) if partial else (tuple(fields), bool(unique))
        if spec not in bucket:
            bucket.append(spec)
        return name

    async def _read(self, query, sort, skip, limit, length, projection):
        built, reason = self._read_plan(query, sort, skip, limit, length)
        if built is None:
            self._log_fallback(reason)
            docs = self._python_match(query)
            docs = sort_docs(docs, sort)
            docs = _slice_docs(docs, skip, limit, length)
        else:
            sql, params = built
            docs = self._fetch_docs(sql, params)
        out = []
        for doc in docs:
            out.append(project_doc(doc, projection) if projection else copy.deepcopy(doc))
        return out

    async def _match_docs(self, query):
        built, reason = self._read_plan(query, [("_id", 1)], 0, None, None)
        if built is None:
            self._log_fallback(reason)
            return self._python_match(query)
        sql, params = built
        return self._fetch_docs(sql, params)

    async def _first(self, query):
        """Güncelleme ve silme: PK sırasında ilk eşleşme. Tek satır okunur."""
        built, reason = self._read_plan(query, [("_id", 1)], 0, 1, 1)
        if built is None:
            self._log_fallback(reason)
            docs = self._python_match(query)
            return docs[0] if docs else None
        found = self._fetch_docs(*built)
        return found[0] if found else None

    def _where_plan(self, query):
        try:
            where, params, _fields = self._filter_sql(query or {})
        except _NoPush as exc:
            return None, exc.reason
        if not self._scalars(_fields):
            return None, "type"
        clause = "company_id=? AND collection=?"
        prefix = [self.company_id, self.name]
        if where:
            clause += " AND " + where
        return (clause, prefix + params), None

    def _read_plan(self, query, sort, skip, limit, length):
        try:
            where, params, fields = self._filter_sql(query or {})
            skip_n, cap = _bounds(skip, limit, length)
            if _id_point(query):
                order = "ORDER BY id ASC"
                sort_fields: tuple = ()
            else:
                order, sort_fields = self._sort_sql(sort)
            if not self._scalars(tuple(fields) + tuple(sort_fields)):
                return None, "type"
        except _NoPush as exc:
            return None, exc.reason
        sql = "SELECT doc FROM docs_v2 WHERE company_id=? AND collection=?"
        bind = [self.company_id, self.name]
        if where:
            sql += " AND " + where
            bind.extend(params)
        sql += " " + order
        if cap is not None:
            sql += " LIMIT ?"
            bind.append(int(cap))
            if skip_n:
                sql += " OFFSET ?"
                bind.append(int(skip_n))
        elif skip_n:
            if self.store.dialect == "sqlite":
                sql += " LIMIT -1 OFFSET ?"
            else:
                sql += f" LIMIT {_MAX_LIMIT} OFFSET ?"
            bind.append(int(skip_n))
        return (sql, bind), None

    def _filter_sql(self, query):
        if query is None:
            query = {}
        if not isinstance(query, dict):
            raise _NoPush("query")
        parts = []
        params = []
        fields = []
        for key, val in query.items():
            sql, bind, probed = self._entry_sql(key, val)
            if sql:
                parts.append(sql)
                params.extend(bind)
            fields.extend(probed)
        return " AND ".join(parts), params, tuple(dict.fromkeys(fields))

    def _entry_sql(self, key, val):
        if key == "$and":
            return self._group_sql(val, "AND")
        if key == "$or":
            return self._group_sql(val, "OR")
        if str(key).startswith("$"):
            raise _NoPush(f"operator:{key}")
        if key == "company_id":
            return self._company_sql(val)
        if key == "_id":
            return self._id_sql(val)
        if not isinstance(key, str) or not _SAFE_FIELD.match(key):
            raise _NoPush("field")
        return self._field_sql(key, val)

    def _group_sql(self, branches, joiner):
        reason = "operator:$or" if joiner == "OR" else "operator:$and"
        if not isinstance(branches, list):
            raise _NoPush(reason)
        if not branches:
            if joiner == "OR":
                return "0", [], []
            return "", [], []
        parts = []
        params = []
        fields = []
        for branch in branches:
            if not isinstance(branch, dict):
                raise _NoPush(reason)
            where, bind, probed = self._filter_sql(branch)
            if where == "0" or where == "(0)":
                if joiner == "AND":
                    return "0", [], []
                continue
            if not where:
                if joiner == "OR":
                    return "", [], []
                continue
            parts.append("(" + where + ")")
            params.extend(bind)
            fields.extend(probed)
        if not parts:
            if joiner == "OR":
                return "0", [], []
            return "", [], []
        return "(" + f" {joiner} ".join(parts) + ")", params, fields

    def _company_sql(self, val):
        cid = self.company_id
        if isinstance(val, str):
            return ("", [], []) if val == cid else ("0", [], [])
        if not isinstance(val, dict) or len(val) != 1:
            raise _NoPush("type:company_id" if not isinstance(val, dict) else "operator:multi")
        op, rhs = next(iter(val.items()))
        if op == "$eq":
            if not isinstance(rhs, str):
                raise _NoPush("type:company_id")
            return ("", [], []) if rhs == cid else ("0", [], [])
        if op == "$in":
            if not isinstance(rhs, list) or not all(isinstance(item, str) for item in rhs):
                raise _NoPush("operator:$in")
            return ("", [], []) if cid in rhs else ("0", [], [])
        if op == "$ne":
            if not isinstance(rhs, str):
                raise _NoPush("type:company_id")
            return ("0", [], []) if rhs == cid else ("", [], [])
        if op == "$exists":
            if rhs in (True, 1):
                return "", [], []
            if rhs in (False, 0):
                return "0", [], []
            raise _NoPush("operator:$exists")
        raise _NoPush(f"operator:{op}")

    def _id_sql(self, val):
        if isinstance(val, str):
            return "id = ?", [val], []
        if not isinstance(val, dict) or len(val) != 1:
            raise _NoPush("type:_id" if not isinstance(val, dict) else "operator:multi")
        op, rhs = next(iter(val.items()))
        if op == "$eq" and isinstance(rhs, str):
            return "id = ?", [rhs], []
        if op == "$in":
            if rhs == []:
                return "0", [], []
            if not isinstance(rhs, list) or not all(isinstance(item, str) for item in rhs):
                raise _NoPush("operator:$in")
            marks = ",".join(["?"] * len(rhs))
            return f"id IN ({marks})", list(rhs), []
        if op == "$nin":
            if rhs == []:
                return "", [], []
            if not isinstance(rhs, list) or not all(isinstance(item, str) for item in rhs):
                raise _NoPush("operator:$nin")
            marks = ",".join(["?"] * len(rhs))
            return f"id NOT IN ({marks})", list(rhs), []
        if op == "$ne" and isinstance(rhs, str):
            return "id <> ?", [rhs], []
        raise _NoPush(f"operator:{op}")

    def _field_sql(self, field, val):
        if not isinstance(val, dict):
            if isinstance(val, str):
                return self._eq_sql(field, val)
            if val is None:
                return self._null_sql(field), [], []
            raise _NoPush("type")
        ops = [op for op in val if str(op).startswith("$") and op != "$options"]
        if len(ops) != 1:
            raise _NoPush("operator:multi" if ops else "type")
        op = ops[0]
        if op == "$eq" and isinstance(val.get("$eq"), str):
            return self._eq_sql(field, val["$eq"])
        if op == "$in":
            return self._in_sql(field, val.get("$in"), negate=False)
        if op == "$nin":
            return self._in_sql(field, val.get("$nin"), negate=True)
        if op == "$ne" and isinstance(val.get("$ne"), str):
            eq, bind, fields = self._eq_sql(field, val["$ne"])
            return "NOT " + eq, bind, fields
        if op == "$regex":
            return self._regex_sql(field, val)
        if op in ("$gt", "$gte", "$lt", "$lte"):
            symbol = {"$gt": ">", "$gte": ">=", "$lt": "<", "$lte": "<="}[op]
            return self._cmp_sql(field, symbol, val.get(op))
        if op == "$exists":
            return self._exists_sql(field, val.get("$exists"))
        raise _NoPush(f"operator:{op}")

    def _eq_sql(self, field, value):
        return (
            f"({self._text_type_sql(field)} AND {self._eq_pred(field)})",
            [value],
            [field],
        )

    def _in_sql(self, field, values, negate: bool):
        if values == []:
            return ("", [], []) if negate else ("0", [], [])
        if not isinstance(values, list) or not all(isinstance(item, str) for item in values):
            raise _NoPush("operator:$nin" if negate else "operator:$in")
        pred = self._in_pred(field, len(values))
        sql = f"({self._text_type_sql(field)} AND {pred})"
        if negate:
            sql = "NOT " + sql
        return sql, list(values), [field]

    def _regex_sql(self, field, cond):
        if cond.get("$options"):
            raise _NoPush("operator:$regex")
        pattern = str(cond.get("$regex") or "")
        if not _PREFIX_RE.match(pattern):
            raise _NoPush("operator:$regex")
        prefix = pattern[1:]
        expr = self._text_expr(field)
        if self.store.dialect == "mysql":
            like = prefix.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            sql = (
                f"({self._text_type_sql(field)} AND {expr} LIKE ? ESCAPE '\\' "
                "COLLATE utf8mb4_bin)"
            )
            return sql, [like], [field]
        return f"({self._text_type_sql(field)} AND {expr} GLOB ?)", [prefix + "*"], [field]

    def _cmp_sql(self, field, symbol, value):
        if not isinstance(value, str):
            raise _NoPush("type")
        expr = self._text_expr(field)
        if self.store.dialect == "mysql":
            expr = f"{expr} COLLATE utf8mb4_bin"
        compared = f"({self._text_type_sql(field)} AND {expr} {symbol} ?)"
        if symbol in ("<", "<="):
            compared = f"({self._json_null_sql(field)} OR {compared})"
        return compared, [value], [field]

    def _exists_sql(self, field, flag):
        present = self._present_sql(field)
        if flag in (True, 1):
            return present, [], []
        if flag in (False, 0):
            return f"(NOT {present})", [], []
        raise _NoPush("operator:$exists")

    def _sort_sql(self, sort):
        if not sort:
            expr = self._order_expr("created_at", "")
            return f"ORDER BY {expr} DESC, id DESC", ("created_at",)
        pairs = _sort_pairs(sort)
        if not pairs:
            expr = self._order_expr("created_at", "")
            return f"ORDER BY {expr} DESC, id DESC", ("created_at",)
        direction = "DESC" if pairs[-1][1] == -1 else "ASC"
        bits = []
        fields = []
        for field, _direction in pairs:
            if field == "_id":
                bits.append(f"id {direction}")
                continue
            if not _SAFE_FIELD.match(field):
                raise _NoPush("sort")
            bits.append(f"{self._order_expr(field, 'None')} {direction}")
            fields.append(field)
        tie = "id ASC" if "_id" not in [field for field, _d in pairs] else ""
        if tie:
            bits.append(tie)
        return "ORDER BY " + ", ".join(bits), tuple(fields)

    def _eq_pred(self, field):
        column = _COLUMN_OF.get(field)
        if self.store.dialect == "mysql":
            if column:
                return f"{column} = JSON_QUOTE(?)"
            return f"JSON_EXTRACT(doc, '$.{field}') = JSON_QUOTE(?)"
        if column:
            return f"{column} = ?"
        return f"json_extract(doc, '$.{field}') = ?"

    def _in_pred(self, field, count):
        column = _COLUMN_OF.get(field)
        if self.store.dialect == "mysql":
            marks = ",".join(["JSON_QUOTE(?)"] * count)
            left = column or f"JSON_EXTRACT(doc, '$.{field}')"
            return f"{left} IN ({marks})"
        marks = ",".join(["?"] * count)
        left = column or f"json_extract(doc, '$.{field}')"
        return f"{left} IN ({marks})"

    def _text_expr(self, field):
        if field == "_id":
            return "id"
        column = _COLUMN_OF.get(field)
        if self.store.dialect == "mysql":
            if column:
                return f"JSON_UNQUOTE({column})"
            return f"JSON_UNQUOTE(JSON_EXTRACT(doc, '$.{field}'))"
        if column:
            return column
        return f"json_extract(doc, '$.{field}')"

    def _order_expr(self, field, token):
        expr = self._text_expr(field)
        coalesced = f"COALESCE({expr}, '{token}')"
        if self.store.dialect == "mysql":
            return f"{coalesced} COLLATE utf8mb4_bin"
        return coalesced

    def _text_type_sql(self, field):
        # Eksik alan json_type NULL döndürür. NULL = 'text' bilinmez kalır ve
        # NOT (...) satırı dışarıda bırakır. COALESCE eşitliği 0/1 yapar.
        if self.store.dialect == "mysql":
            return f"COALESCE(JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')), '') = 'STRING'"
        return f"COALESCE(json_type(doc, '$.{field}'), '') = 'text'"

    def _json_null_sql(self, field):
        if self.store.dialect == "mysql":
            return f"JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) = 'NULL'"
        return f"json_type(doc, '$.{field}') = 'null'"

    def _null_sql(self, field):
        if self.store.dialect == "mysql":
            return (
                f"(JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IS NULL "
                f"OR JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) = 'NULL')"
            )
        return (
            f"(json_type(doc, '$.{field}') IS NULL OR json_type(doc, '$.{field}') = 'null')"
        )

    def _present_sql(self, field):
        if self.store.dialect == "mysql":
            return f"JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IS NOT NULL"
        return f"json_type(doc, '$.{field}') IS NOT NULL"

    def _nonscalar_sql(self, field):
        column = _COLUMN_OF.get(field)
        if column:
            return f"{column}_bad IS NOT NULL"
        if self.store.dialect == "mysql":
            return (
                f"JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) IS NOT NULL "
                f"AND JSON_TYPE(JSON_EXTRACT(doc, '$.{field}')) NOT IN ('STRING', 'NULL')"
            )
        return (
            f"json_type(doc, '$.{field}') IS NOT NULL "
            f"AND json_type(doc, '$.{field}') NOT IN ('text', 'null')"
        )

    def _scalars(self, fields) -> bool:
        for field in fields:
            if not field or field == "_id":
                continue
            key = (self.company_id, self.name, field)
            if key in self.store.scalar_ok:
                continue
            if key in self.store.scalar_bad:
                return False
            row = self._run(
                "SELECT 1 FROM docs_v2 WHERE company_id=? AND collection=? AND "
                + self._nonscalar_sql(field)
                + " LIMIT 1",
                (self.company_id, self.name),
            ).fetchone()
            if row:
                self.store.scalar_bad.add(key)
                return False
            self.store.scalar_ok.add(key)
        return True

    def _python_match(self, query):
        self.store.python_scans += 1
        docs = self._fetch_docs(
            "SELECT doc FROM docs_v2 WHERE company_id=? AND collection=? ORDER BY id ASC",
            (self.company_id, self.name),
        )
        return [doc for doc in docs if match_query(doc, query or {})]

    def _prepare(self, doc) -> dict:
        if not isinstance(doc, dict):
            raise ValueError("belge nesne olmalı")
        body = copy.deepcopy(doc)
        if not body.get("_id"):
            from uuid import uuid4
            body["_id"] = str(uuid4())
        else:
            body["_id"] = str(body["_id"])
        current = body.get("company_id", MISSING)
        if current is MISSING or current is None or str(current).strip() == "":
            body["company_id"] = self.company_id
        elif str(current) != self.company_id:
            raise ValueError("company_id uyuşmuyor")
        return body

    def _check_unique(self, doc, exclude_id):
        indexes = self.store.indexes.get(self.name) or []
        if not has_unique_index(indexes):
            return
        own = str(exclude_id) if exclude_id is not None else None
        for item in indexes:
            spec, unique, partial = index_spec_parts(item)
            if not unique or not spec:
                continue
            if not unique_index_applies(doc, partial):
                continue
            values = []
            skipped = False
            for field in spec:
                value = scalar_at(doc, field)
                if value is MISSING:
                    skipped = True
                    break
                if not isinstance(field, str) or not _SAFE_FIELD.match(field) or not isinstance(value, str):
                    self._unique_scan(doc, own, indexes)
                    return
                values.append(value)
            if skipped:
                continue
            clauses = ["company_id=?", "collection=?"]
            params = [self.company_id, self.name]
            for field, value in zip(spec, values):
                clauses.append(self._eq_pred(field))
                params.append(value)
            if own is not None:
                clauses.append("id<>?")
                params.append(own)
            sql = f"SELECT id FROM docs_v2 WHERE {' AND '.join(clauses)} LIMIT 1"
            row = self._run(sql, params, unique=True).fetchone()
            if row:
                raise DuplicateKeyError("duplicate key")

    def _unique_scan(self, doc, exclude_id, indexes):
        others = []
        for other in self._fetch_docs(
            "SELECT doc FROM docs_v2 WHERE company_id=? AND collection=? ORDER BY id ASC",
            (self.company_id, self.name),
        ):
            if exclude_id is not None and str(other.get("_id")) == str(exclude_id):
                continue
            if str(other.get("_id")) == str(doc.get("_id")):
                continue
            others.append(other)
        try:
            unique_conflict(doc, others, indexes, self.name)
        except DuplicateKeyError:
            raise DuplicateKeyError("duplicate key") from None

    def _invalidate(self) -> None:
        cid, name = self.company_id, self.name
        self.store.scalar_ok = {key for key in self.store.scalar_ok if key[0] != cid or key[1] != name}
        self.store.scalar_bad = {key for key in self.store.scalar_bad if key[0] != cid or key[1] != name}

    def _log_fallback(self, reason: str) -> None:
        log.warning("shared_v2 pushdown yok collection=%s neden=%s", self.name, reason or "query")

    def _fetch_docs(self, sql, params):
        rows = self._run(sql, params, plan=True).fetchall()
        self.store.docs_loaded += len(rows)
        return [loads(row[0]) for row in rows]

    def _run(self, sql, params, plan: bool = False, unique: bool = False):
        conn = self.store.connection()
        adapted = sql.replace("?", "%s") if self.store.dialect == "mysql" else sql
        self.store.statements.append(sql)
        if self.store.dialect == "sqlite":
            if self.store.capture_plans and (plan or unique):
                detail = " | ".join(
                    str(row[-1]) for row in conn.execute("EXPLAIN QUERY PLAN " + adapted, tuple(params or ()))
                )
                if unique:
                    self.store.last_unique_plan = detail
                elif plan and sql.lstrip().upper().startswith("SELECT DOC"):
                    self.store.last_plan = detail
            return conn.execute(adapted, tuple(params or ()))
        cursor = conn.cursor()
        cursor.execute(adapted, tuple(params or ()))
        return cursor

    def _begin(self) -> None:
        conn = self.store.connection()
        if self.store.dialect == "sqlite":
            conn.execute("BEGIN IMMEDIATE")
        else:
            conn.begin()

    def _commit(self) -> None:
        self.store.connection().commit()

    def _rollback(self) -> None:
        try:
            self.store.connection().rollback()
        except Exception:
            return


def _id_point(query) -> bool:
    if not isinstance(query, dict) or "_id" not in query:
        return False
    value = query.get("_id")
    if isinstance(value, str):
        return True
    return isinstance(value, dict) and list(value.keys()) == ["$eq"] and isinstance(value.get("$eq"), str)


def _sort_pairs(sort):
    if isinstance(sort, str):
        return [(sort, 1)]
    if (
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
            raise _NoPush("sort") from None
    norm = []
    for item in pairs:
        if not isinstance(item, (list, tuple)) or len(item) != 2:
            raise _NoPush("sort")
        field, direction = item
        if not isinstance(field, str) or direction not in (1, -1):
            raise _NoPush("sort")
        norm.append((field, 1 if direction == 1 else -1))
    return norm


def _bounds(skip, limit, length):
    try:
        skip_n = int(skip or 0)
    except (TypeError, ValueError):
        raise _NoPush("limit") from None
    if skip_n < 0:
        raise _NoPush("limit")
    caps = []
    for raw in (limit, length):
        if raw is None:
            continue
        try:
            number = int(raw)
        except (TypeError, ValueError):
            raise _NoPush("limit") from None
        if number < 0:
            raise _NoPush("limit")
        caps.append(number)
    cap = min(caps) if caps else None
    return skip_n, cap


def _slice_docs(docs, skip, limit, length):
    try:
        skip_n, cap = _bounds(skip, limit, length)
    except _NoPush:
        skip_n, cap = 0, None
    if skip_n:
        docs = docs[skip_n:]
    if cap is not None:
        docs = docs[:cap]
    return docs


def _is_duplicate(exc: BaseException) -> bool:
    if isinstance(exc, sqlite3.IntegrityError):
        return True
    args = getattr(exc, "args", ())
    if args and args[0] == 1062:
        return True
    text = str(exc).lower()
    return "duplicate" in text or "unique constraint" in text


def _note(collection: str, doc) -> None:
    try:
        import company_events
        company_events.note_change(collection, doc)
    except Exception:
        return
