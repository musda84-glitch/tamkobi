"""Kiracıya bağlı veritabanı sarmalayıcısı.

Rotalar bu PR'da TenantDB'ye taşınmaz. Katman hazır durur; hiçbir istek
henüz get_tenant_db / for_company / from_b2b_contact kullanmaz.
"""
from __future__ import annotations

import copy
import inspect
from contextlib import asynccontextmanager
from typing import Any, Optional

from fastapi import HTTPException, Request

import storage_router
import tenant_access
from tenant_scope import (
    TenantScope,
    TenantScopeViolation,
    bind,
    collection_kind,
    reset,
    unscoped as log_unscoped,
)

_db = None
_get_current_user = None
_MISSING = object()


def init(db, get_current_user=None):
    global _db, _get_current_user
    _db = db
    if get_current_user is not None:
        _get_current_user = get_current_user


def _accepts(fn, name: str) -> bool:
    try:
        params = inspect.signature(fn).parameters
    except (TypeError, ValueError):
        return False
    if name in params:
        return True
    return any(
        p.kind in (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
        for p in params.values()
    )


def _classify_company(val, cid: str, allowed: set) -> None:
    """Eşitlik kapsamla aynı olmalı. $in yalnız allowed alt kümesi."""
    if isinstance(val, dict):
        has_in = "$in" in val
        has_eq = "$eq" in val
        if not has_in and not has_eq:
            raise TenantScopeViolation()
        if has_eq and str(val.get("$eq") or "") != cid:
            raise TenantScopeViolation()
        if has_in:
            requested = val.get("$in")
            if not isinstance(requested, (list, tuple, set, frozenset)):
                raise TenantScopeViolation()
            wanted = {str(item) for item in requested}
            if not wanted <= allowed:
                raise TenantScopeViolation()
        return
    if val is None or str(val).strip() == "" or str(val) != cid:
        raise TenantScopeViolation()


def _walk_company(node, cid: str, allowed: set) -> None:
    if isinstance(node, list):
        for item in node:
            _walk_company(item, cid, allowed)
        return
    if not isinstance(node, dict):
        return
    if "company_id" in node:
        _classify_company(node["company_id"], cid, allowed)
    for key, val in node.items():
        if key == "company_id":
            continue
        if key in ("$and", "$or", "$nor") and isinstance(val, list):
            for item in val:
                _walk_company(item, cid, allowed)
        elif isinstance(val, dict) and str(key).startswith("$"):
            _walk_company(val, cid, allowed)


def _clause_constrains(clause) -> bool:
    if not isinstance(clause, dict):
        return False
    if "company_id" in clause:
        return True
    nested = clause.get("$and")
    if isinstance(nested, list):
        return any(_clause_constrains(item) for item in nested)
    return False


def merge_company_filter(query, scope: TenantScope) -> dict:
    """Mevcut filtreyi bozmadan company_id sınırı ekle. Çağıranın dict'i değişmez."""
    if query is None:
        src: dict = {}
    elif isinstance(query, dict):
        src = query
    else:
        raise TenantScopeViolation()
    cid = str(scope.company_id)
    allowed = {str(item) for item in scope.allowed}
    q = copy.deepcopy(src)
    _walk_company(q, cid, allowed)
    if "company_id" in q:
        return q
    clauses = q.get("$and")
    if isinstance(clauses, list):
        if any(_clause_constrains(item) for item in clauses):
            return q
        q["$and"] = list(clauses) + [{"company_id": cid}]
        return q
    if clauses is not None:
        raise TenantScopeViolation()
    q["company_id"] = cid
    return q


def _reject_company_ops(update: dict, cid: str) -> None:
    for op in ("$set", "$setOnInsert"):
        body = update.get(op)
        if isinstance(body, dict) and "company_id" in body and str(body.get("company_id") or "") != cid:
            raise TenantScopeViolation()
    unset = update.get("$unset")
    if isinstance(unset, dict) and "company_id" in unset:
        raise TenantScopeViolation()
    if isinstance(unset, (list, tuple)) and "company_id" in list(unset):
        raise TenantScopeViolation()
    rename = update.get("$rename")
    if isinstance(rename, dict) and ("company_id" in rename or "company_id" in list(rename.values())):
        raise TenantScopeViolation()


def guard_update(update, scope: TenantScope, *, upsert: bool = False) -> Any:
    """$set / $setOnInsert / $unset company_id'yi taşıyamaz veya silemez."""
    cid = str(scope.company_id)
    if isinstance(update, list):
        stages = copy.deepcopy(update)
        for stage in stages:
            if isinstance(stage, dict):
                _reject_company_ops(stage, cid)
        return stages
    if not isinstance(update, dict):
        raise TenantScopeViolation()
    upd = copy.deepcopy(update)
    if not any(str(key).startswith("$") for key in upd):
        return stamp_company(upd, scope)
    _reject_company_ops(upd, cid)
    if upsert and not _update_sets_company(upd, cid):
        soi = upd.get("$setOnInsert")
        if soi is None:
            upd["$setOnInsert"] = {"company_id": cid}
        elif isinstance(soi, dict):
            soi["company_id"] = cid
        else:
            raise TenantScopeViolation()
    return upd


def _update_sets_company(update: dict, cid: str) -> bool:
    for op in ("$set", "$setOnInsert"):
        body = update.get(op)
        if isinstance(body, dict) and "company_id" in body and str(body.get("company_id") or "") == cid:
            return True
    return False


def stamp_company(doc, scope: TenantScope) -> dict:
    if not isinstance(doc, dict):
        raise TenantScopeViolation()
    body = copy.deepcopy(doc)
    cid = str(scope.company_id)
    existing = body.get("company_id", _MISSING)
    if existing is _MISSING or existing is None or str(existing).strip() == "":
        body["company_id"] = cid
        return body
    if str(existing) != cid:
        raise TenantScopeViolation()
    return body


def merge_required_eq(query, field: str, value: str) -> dict:
    """Alan yoksa ekle, $and varsa ona ekle. Çağıranın dict'i değişmez."""
    if query is None:
        src: dict = {}
    elif isinstance(query, dict):
        src = query
    else:
        raise TenantScopeViolation()
    q = copy.deepcopy(src)
    if field not in q:
        clauses = q.get("$and")
        if isinstance(clauses, list):
            q["$and"] = list(clauses) + [{field: value}]
            return q
        q[field] = value
        return q
    if q.get(field) == value:
        return q
    existing = {field: q.pop(field)}
    parts = []
    if q:
        parts.append(q)
    parts.append(existing)
    parts.append({field: value})
    return {"$and": parts}


class ScopedCollection:
    """Kiracı koleksiyonu. MySQLCollection imzalarını aynen taşır."""

    def __init__(self, raw, scope: TenantScope):
        self._raw = raw
        self.scope = scope
        self.name = getattr(raw, "name", None)

    def _filter(self, query):
        return merge_company_filter(query, self.scope)

    def find(self, query=None, projection=None):
        return self._raw.find(self._filter(query), projection)

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        fn = self._raw.find_one
        q = self._filter(query)
        if _accepts(fn, "skip"):
            return await fn(q, projection, sort, skip)
        return await fn(q, projection, sort)

    async def count_documents(self, query=None):
        return await self._raw.count_documents(self._filter(query))

    async def distinct(self, key, query=None):
        return await self._raw.distinct(key, self._filter(query))

    def aggregate(self, pipeline):
        stages = []
        for stage in pipeline or []:
            if isinstance(stage, dict) and "$match" in stage:
                merge_company_filter(stage.get("$match") or {}, self.scope)
            stages.append(stage)
        scoped = [{"$match": {"company_id": str(self.scope.company_id)}}] + stages
        return self._raw.aggregate(scoped)

    async def insert_one(self, doc):
        return await self._raw.insert_one(stamp_company(doc, self.scope))

    async def insert_many(self, docs, ordered: bool = True):
        prepared = [stamp_company(doc, self.scope) for doc in list(docs or [])]
        fn = self._raw.insert_many
        if _accepts(fn, "ordered"):
            return await fn(prepared, ordered=ordered)
        return await fn(prepared)

    async def update_one(self, query, update, upsert: bool = False):
        return await self._raw.update_one(
            self._filter(query),
            guard_update(update, self.scope, upsert=upsert),
            upsert=upsert,
        )

    async def update_one_atomic(self, query, update):
        return await self._raw.update_one_atomic(
            self._filter(query),
            guard_update(update, self.scope, upsert=False),
        )

    async def update_many(self, query, update, upsert: bool = False):
        return await self._raw.update_many(
            self._filter(query),
            guard_update(update, self.scope, upsert=upsert),
            upsert=upsert,
        )

    async def replace_one(self, query, replacement, upsert: bool = False):
        return await self._raw.replace_one(
            self._filter(query),
            stamp_company(replacement, self.scope),
            upsert=upsert,
        )

    async def find_one_and_update(self, query, update, upsert: bool = False, return_document=True, projection=None):
        return await self._raw.find_one_and_update(
            self._filter(query),
            guard_update(update, self.scope, upsert=upsert),
            upsert=upsert,
            return_document=return_document,
            projection=projection,
        )

    async def delete_one(self, query):
        return await self._raw.delete_one(self._filter(query))

    async def delete_many(self, query):
        return await self._raw.delete_many(self._filter(query))


class _ReadScoped:
    """users / companies için ince filtre. Yazma ham db'den yapılır."""

    def __init__(self, raw, scope: TenantScope, field: str):
        self._raw = raw
        self.scope = scope
        self._field = field
        self.name = getattr(raw, "name", None)

    def _filter(self, query):
        return merge_required_eq(query, self._field, str(self.scope.company_id))

    def find(self, query=None, projection=None):
        return self._raw.find(self._filter(query), projection)

    async def find_one(self, query=None, projection=None, sort=None, skip=0):
        fn = self._raw.find_one
        q = self._filter(query)
        if _accepts(fn, "skip"):
            return await fn(q, projection, sort, skip)
        return await fn(q, projection, sort)

    async def count_documents(self, query=None):
        return await self._raw.count_documents(self._filter(query))

    async def distinct(self, key, query=None):
        return await self._raw.distinct(key, self._filter(query))

    def aggregate(self, pipeline):
        match = {"$match": {self._field: str(self.scope.company_id)}}
        return self._raw.aggregate([match] + list(pipeline or []))

    async def insert_one(self, doc):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def insert_many(self, docs, ordered: bool = True):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def update_one(self, query, update, upsert: bool = False):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def update_one_atomic(self, query, update):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def update_many(self, query, update, upsert: bool = False):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def replace_one(self, query, replacement, upsert: bool = False):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def find_one_and_update(self, query, update, upsert: bool = False, return_document=True, projection=None):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def delete_one(self, query):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")

    async def delete_many(self, query):
        raise NotImplementedError("bu koleksiyonun yazması TenantDB üzerinden yapılmaz")


class TenantDB:
    """Kapsama göre koleksiyon seçer. Platform ve token ham geçer.

    Bayrak açıksa depolama kipi kuruluşta sabitlenir. Koleksiyon erişimi
    önbelleğe dönmez; TTL istek sürerken dolsa da kip değişmez.
    """

    def __init__(self, db, scope: TenantScope, storage_mode=storage_router.UNSET):
        self._db = db
        self.scope = scope
        if storage_mode is not storage_router.UNSET:
            self._storage_mode = storage_mode
        elif storage_router.enabled():
            self._storage_mode = storage_router.mode_for_handle(db, scope.company_id)
        else:
            self._storage_mode = None

    def _collection(self, name: str):
        # Bayrak kapalıyken (varsayılan) bugünkü yol: doğrudan self._db[name].
        if self._storage_mode is None:
            raw = self._db[name]
        else:
            raw = storage_router.collection_for_mode(
                self._db, self._storage_mode, self.scope.company_id, name,
            )
        kind = collection_kind(name)
        if kind in ("tenant", "unknown"):
            return ScopedCollection(raw, self.scope)
        if kind == "membership":
            return _ReadScoped(raw, self.scope, "company_ids")
        if kind == "company":
            return _ReadScoped(raw, self.scope, "_id")
        return raw

    def __getattr__(self, name: str):
        if name.startswith("_"):
            raise AttributeError(name)
        return self._collection(name)

    def __getitem__(self, name: str):
        return self._collection(name)

    def unscoped(self, reason: str):
        """Ham db. Çağrı tenant_scope.unscoped ile loglanır."""
        with log_unscoped(reason):
            return self._db


async def _load_user(request: Request) -> dict:
    if _db is None or _get_current_user is None:
        raise HTTPException(status_code=500, detail="Kiracı veritabanı bağlanmadı.")
    user = _get_current_user(request)
    if inspect.isawaitable(user):
        user = await user
    return user


def _scope_for_user(user: dict, requested: Optional[str]) -> TenantScope:
    cid = str(tenant_access.resolve_company_id(user, requested) or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="Şirket seçilmedi.")
    if user.get("is_super_admin"):
        allowed = frozenset({cid})
    else:
        allowed = frozenset(tenant_access.user_allowed_company_ids(user))
    return TenantScope(
        company_id=cid,
        allowed=allowed,
        kind="user",
        actor_id=str(user.get("_id") or user.get("id") or ""),
        reason="request",
    )


async def get_tenant_db(request: Request):
    """İstek dependency'si. Kapsamı yanıt sonunda bırakır. Rotalar henüz kullanmaz."""
    user = await _load_user(request)
    requested = request.query_params.get("company_id") if request is not None else None
    scope = _scope_for_user(user, requested)
    pinned = storage_router.UNSET
    if storage_router.enabled():
        pinned = await storage_router.load_mode(_db, scope.company_id)
    token = bind(scope)
    try:
        yield TenantDB(_db, scope, storage_mode=pinned)
    finally:
        reset(token)


@asynccontextmanager
async def for_company(cid: str, reason: str):
    """Arka plan işi. kind=system. company_id boşsa ValueError."""
    text = str(cid or "").strip()
    why = str(reason or "").strip()
    if not text:
        raise ValueError("company_id boş")
    if not why:
        raise ValueError("reason boş")
    scope = TenantScope(
        company_id=text,
        allowed=frozenset({text}),
        kind="system",
        actor_id="",
        reason=why,
    )
    pinned = storage_router.UNSET
    if storage_router.enabled():
        pinned = await storage_router.load_mode(_db, text)
    token = bind(scope)
    try:
        yield TenantDB(_db, scope, storage_mode=pinned)
    finally:
        reset(token)


@asynccontextmanager
async def from_b2b_contact(contact: Optional[dict]):
    """B2B carisi. company_id boşsa 404."""
    cid = str((contact or {}).get("company_id") or "").strip()
    if not cid:
        raise HTTPException(status_code=404, detail="Kayıt bulunamadı.")
    contact_id = str((contact or {}).get("_id") or (contact or {}).get("id") or "").strip() or None
    scope = TenantScope(
        company_id=cid,
        allowed=frozenset({cid}),
        kind="b2b",
        actor_id=contact_id or "",
        reason="b2b",
        contact_id=contact_id,
    )
    pinned = storage_router.UNSET
    if storage_router.enabled():
        pinned = await storage_router.load_mode(_db, cid)
    token = bind(scope)
    try:
        yield TenantDB(_db, scope, storage_mode=pinned)
    finally:
        reset(token)

