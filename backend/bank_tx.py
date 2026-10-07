"""Kasa/banka hareketlerinde işlem yapan kullanıcı (created_by_*)."""
from __future__ import annotations

from contextvars import ContextVar, Token
from typing import Any, Dict, List, Optional

_actor: ContextVar[Optional[Dict[str, Any]]] = ContextVar("bank_tx_actor", default=None)


def actor_fields(user: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """İşlemi yapan kullanıcı alanları."""
    if user is None:
        return {"created_by_id": None, "created_by_name": None}
    uid = user.get("id") or user.get("_id")
    name = (user.get("name") or user.get("email") or "").strip() or "Kullanıcı"
    return {"created_by_id": str(uid) if uid else None, "created_by_name": name[:120]}


def set_current_actor(user: Optional[Dict[str, Any]]) -> Token:
    return _actor.set(user)


def reset_current_actor(token: Token) -> None:
    _actor.reset(token)


def current_actor() -> Optional[Dict[str, Any]]:
    return _actor.get()


def stamp(doc: Optional[Dict[str, Any]], user: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """created_by_* yoksa mevcut aktör / verilen user ile doldur. Zaten varsa dokunma."""
    if not isinstance(doc, dict):
        return doc
    if (doc.get("created_by_name") or "").strip():
        return doc
    # İstek gövdesinden gelen açık alanlar
    explicit = (doc.get("user_name") or doc.get("actor_name") or "").strip()
    if explicit:
        doc["created_by_name"] = explicit[:120]
        if doc.get("user_id") or doc.get("actor_id"):
            doc["created_by_id"] = str(doc.get("user_id") or doc.get("actor_id"))
        doc.pop("user_name", None)
        doc.pop("actor_name", None)
        return doc
    fields = actor_fields(user if user is not None else _actor.get())
    if fields.get("created_by_name"):
        doc["created_by_name"] = fields["created_by_name"]
        doc["created_by_id"] = fields.get("created_by_id")
    return doc


def _wrap_collection(coll) -> None:
    # MagicMock'ta getattr truthy döner; yalnızca gerçek True ise atla.
    if getattr(coll, "_tamkobi_actor_wrapped", None) is True:
        return
    orig_one = coll.insert_one
    orig_many = coll.insert_many

    async def insert_one(document, *args, **kwargs):
        if isinstance(document, dict):
            stamp(document)
        return await orig_one(document, *args, **kwargs)

    async def insert_many(documents, *args, **kwargs):
        docs: List[Any] = list(documents or [])
        for d in docs:
            if isinstance(d, dict):
                stamp(d)
        return await orig_many(docs, *args, **kwargs)

    coll.insert_one = insert_one  # type: ignore[method-assign]
    coll.insert_many = insert_many  # type: ignore[method-assign]
    coll._tamkobi_actor_wrapped = True


def install(db) -> None:
    """bank_transactions + partner_transactions insert'lerine otomatik aktör damgası."""
    _wrap_collection(db.bank_transactions)
    if hasattr(db, "partner_transactions"):
        _wrap_collection(db.partner_transactions)
