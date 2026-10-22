"""Mongo benzeri depolama sözleşmesi.

shared_v2 (PR2) ve dedicated aynı çağrıları kullanır: find, find_one,
insert, update, replace, delete, aggregate. PR2 gelince bu taban
sınıfta birleşir. Sorgu motoru ve şema burada yoktur.
"""
from __future__ import annotations

from typing import Optional


class InsertOneResult:
    def __init__(self, inserted_id):
        self.inserted_id = inserted_id


class InsertManyResult:
    def __init__(self, inserted_ids):
        self.inserted_ids = list(inserted_ids or [])


class UpdateResult:
    def __init__(self, matched_count=0, modified_count=0, upserted_id=None):
        self.matched_count = matched_count
        self.modified_count = modified_count
        self.upserted_id = upserted_id


class DeleteResult:
    def __init__(self, deleted_count=0):
        self.deleted_count = deleted_count


class StorageCursor:
    """find() dönüşü. sort, skip ve limit to_list sırasında uygulanır."""

    def __init__(self, loader, projection=None):
        self._loader = loader
        self._projection = projection
        self._sort = None
        self._limit = None
        self._skip = 0

    def sort(self, key, direction=1):
        if isinstance(key, str):
            self._sort = [(key, direction)]
        else:
            self._sort = list(key or [])
        return self

    def limit(self, n: int):
        self._limit = int(n)
        return self

    def skip(self, n: int):
        self._skip = int(n)
        return self

    async def to_list(self, length=None):
        from mysql_store import project_doc, sort_docs

        docs = list(await self._loader())
        docs = sort_docs(docs, self._sort)
        if self._skip:
            docs = docs[self._skip:]
        cap = self._limit
        if length is not None:
            wanted = int(length)
            cap = wanted if cap is None else min(cap, wanted)
        if cap is not None:
            docs = docs[:cap]
        if self._projection:
            return [project_doc(doc, self._projection) for doc in docs]
        return docs

    def __aiter__(self):
        async def _gen():
            for doc in await self.to_list(None):
                yield doc

        return _gen()


class ListCursor:
    """aggregate() dönüşü. Satırlar hazırdır; yalnız uzunluk kesilir."""

    def __init__(self, loader):
        self._loader = loader

    async def to_list(self, length=None):
        rows = list(await self._loader())
        if length is None:
            return rows
        return rows[: int(length)]


class StorageCollection:
    """Alt sınıflar bu imzaları doldurur. Varsayılan yol yazmaz."""

    def __init__(self, name: str):
        self.name = str(name or "")

    def find(self, query: Optional[dict] = None, projection: Optional[dict] = None):
        raise NotImplementedError("find")

    async def find_one(self, query: Optional[dict] = None, projection: Optional[dict] = None, sort=None, skip=0):
        raise NotImplementedError("find_one")

    async def count_documents(self, query: Optional[dict] = None):
        raise NotImplementedError("count_documents")

    async def distinct(self, key: str, query: Optional[dict] = None):
        raise NotImplementedError("distinct")

    def aggregate(self, pipeline):
        raise NotImplementedError("aggregate")

    async def insert_one(self, doc: dict):
        raise NotImplementedError("insert_one")

    async def insert_many(self, docs, ordered: bool = True):
        raise NotImplementedError("insert_many")

    async def update_one(self, query: dict, update: dict, upsert: bool = False):
        raise NotImplementedError("update_one")

    async def update_one_atomic(self, query: dict, update: dict):
        raise NotImplementedError("update_one_atomic")

    async def update_many(self, query: dict, update: dict, upsert: bool = False):
        raise NotImplementedError("update_many")

    async def replace_one(self, query: dict, replacement: dict, upsert: bool = False):
        raise NotImplementedError("replace_one")

    async def find_one_and_update(
        self,
        query: dict,
        update: dict,
        upsert: bool = False,
        return_document=True,
        projection=None,
    ):
        raise NotImplementedError("find_one_and_update")

    async def delete_one(self, query: dict):
        raise NotImplementedError("delete_one")

    async def delete_many(self, query: dict):
        raise NotImplementedError("delete_many")
