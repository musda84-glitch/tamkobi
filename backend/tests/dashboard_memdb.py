"""Dashboard testleri için bellek içi koleksiyon.

Sorgu semantiği mysql_store.match_query / aggregate_rows / sort_docs ile gider.
Motor veya mongod gerekmez. Canlı veritabanına bağlanmaz.
"""
from __future__ import annotations

import copy
from types import SimpleNamespace

import tenant_scope
from mysql_store import aggregate_rows, apply_update, match_query, new_upsert_doc, project_doc, sort_docs


def _split_field_ops(query):
    """Aynı alandaki birden fazla operatörü $and yap.

    match_query bir alan koşulunda ilk operatörde döner. Mongo ve
    mysql_store SQL pushdown ise $gt/$lt gibi çiftleri birlikte AND eder.
    """
    if not isinstance(query, dict):
        return query
    if any(str(key).startswith("$") for key in query):
        out = {}
        for key, value in query.items():
            if key in ("$and", "$or", "$nor") and isinstance(value, list):
                out[key] = [_split_field_ops(item) for item in value]
            else:
                out[key] = value
        return out
    pieces = []
    flat = {}
    for key, cond in query.items():
        if isinstance(cond, dict):
            ops = [op for op in cond if str(op).startswith("$") and op != "$options"]
            if len(ops) > 1:
                for op in ops:
                    piece = {op: cond[op]}
                    if op == "$regex" and "$options" in cond:
                        piece["$options"] = cond["$options"]
                    pieces.append({key: piece})
                continue
        flat[key] = cond
    if not pieces:
        return query
    if flat:
        pieces.insert(0, flat)
    return {"$and": pieces}


def _split_pipeline(pipeline):
    out = []
    for stage in pipeline or []:
        if isinstance(stage, dict) and list(stage) == ["$match"]:
            out.append({"$match": _split_field_ops(stage.get("$match") or {})})
        else:
            out.append(stage)
    return out


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None
        self._limit = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def find(self, query=None, projection=None):
        tenant_scope.check(self.name, "find", query=query)
        query = _split_field_ops(query or {})
        matched = []
        for doc in self.docs:
            if match_query(doc, query):
                matched.append(project_doc(doc, projection) if projection else copy.deepcopy(doc))
        return MemCursor(matched)

    def aggregate(self, pipeline):
        tenant_scope.check(self.name, "aggregate", pipeline=pipeline)
        return MemCursor(aggregate_rows(self.docs, _split_pipeline(pipeline)))

    async def find_one(self, query=None, projection=None, sort=None):
        tenant_scope.check(self.name, "find_one", query=query)
        query = _split_field_ops(query or {})
        rows = [doc for doc in self.docs if match_query(doc, query)]
        if sort:
            rows = sort_docs(rows, sort)
        for doc in rows:
            return project_doc(doc, projection) if projection else copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        tenant_scope.check(self.name, "count_documents", query=query)
        query = _split_field_ops(query or {})
        return sum(1 for doc in self.docs if match_query(doc, query))

    async def insert_one(self, doc):
        tenant_scope.check(self.name, "insert_one", doc=doc)
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        tenant_scope.check(self.name, "insert_many", doc=docs)
        copied = [copy.deepcopy(doc) for doc in docs]
        self.docs.extend(copied)
        return SimpleNamespace(inserted_ids=[doc.get("_id") for doc in copied])

    async def update_one_atomic(self, query, update):
        """update_one_atomic: eşitlik _id zorunlu, koşullu güncelleme tek kaydı tüketir."""
        tenant_scope.check(self.name, "update_one_atomic", query=query, update=update)
        query = _split_field_ops(query or {})
        doc_id = query.get("_id")
        if doc_id is None or isinstance(doc_id, dict):
            raise ValueError("update_one_atomic requires equality _id in query")
        for i, doc in enumerate(self.docs):
            if str(doc.get("_id")) != str(doc_id):
                continue
            if not match_query(doc, query):
                return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)
            new_doc = apply_update(doc, update, query)
            changed = new_doc != doc
            if changed:
                self.docs[i] = new_doc
            return SimpleNamespace(modified_count=1 if changed else 0, matched_count=1, upserted_id=None)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)

    async def update_one(self, query, update, upsert=False):
        tenant_scope.check(self.name, "update_one", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        """Eşleşen belgeyi günceller. upsert yoksa ve kayıt yoksa None.

        Gövde bekletmez; aynı olay döngüsünde $inc kesilmez.
        """
        tenant_scope.check(self.name, "find_one_and_update", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query):
                continue
            before = copy.deepcopy(doc)
            self.docs[i] = apply_update(doc, update, query)
            found = self.docs[i] if return_document else before
            return project_doc(found, projection) if projection else copy.deepcopy(found)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        if not return_document:
            return None
        return project_doc(created, projection) if projection else copy.deepcopy(created)

    async def update_many(self, query, update, upsert=False):
        """mysql_store.update_many: eşleşenler matched, içeriği değişenler modified."""
        tenant_scope.check(self.name, "update_many", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        matched = 0
        modified = 0
        for i, doc in enumerate(self.docs):
            if not match_query(doc, query):
                continue
            matched += 1
            new_doc = apply_update(doc, update, query)
            if new_doc != doc:
                self.docs[i] = new_doc
                modified += 1
        return SimpleNamespace(matched_count=matched, modified_count=modified, upserted_id=None)


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)

    async def list_collection_names(self):
        return [name for name, coll in self._cols.items() if coll.docs]
