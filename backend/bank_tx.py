"""Kasa/banka hareketlerinde işlem yapan kullanıcı (created_by_*)."""
from __future__ import annotations

import re
from contextvars import ContextVar, Token
from typing import Any, Dict, List, Optional

_actor: ContextVar[Optional[Dict[str, Any]]] = ContextVar("bank_tx_actor", default=None)

# Marka / site alanı (tamkobi.com) kullanıcı adı sanılmasın.
_BARE_DOMAIN = re.compile(
    r"^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+(?:com|net|org|io|app|dev|co|tr|com\.tr)$",
    re.I,
)
_BRAND_ALIASES = frozenset({"tamkobi", "tamkobi.com", "nexus", "nexus.com"})
# Platform / CRM e-postaları şirket hareketine yazılmasın (Matek'te görünmemeli).
_PLATFORM_EMAIL_DOMAINS = frozenset({"tamkobi.com", "tamkobi.com.tr"})
_PLATFORM_EMAIL_LOCAL = re.compile(r"^tamkobi([.+_-]|$)", re.I)


def _looks_like_site_brand(value: str) -> bool:
    s = (value or "").strip()
    if not s:
        return True
    low = s.lower()
    if low in _BRAND_ALIASES:
        return True
    if _BARE_DOMAIN.match(s):
        return True
    return False


def _is_platform_actor_email(value: str) -> bool:
    """Platform destek / CRM e-postası mı? (şirket kullanıcısı değil)."""
    s = (value or "").strip().lower()
    if not s or "@" not in s:
        return False
    local, _, domain = s.partition("@")
    if domain in _PLATFORM_EMAIL_DOMAINS:
        return True
    # tamkobi.crm@gmail.com, tamkobi.support@...
    if _PLATFORM_EMAIL_LOCAL.match(local):
        return True
    return False


def _is_forbidden_actor_label(value: str) -> bool:
    """Marka, domain veya platform e-postası — şirket aktörü olarak gösterilmez."""
    s = (value or "").strip()
    if not s:
        return True
    if _looks_like_site_brand(s):
        return True
    if _is_platform_actor_email(s):
        return True
    return False


def display_actor_name(user: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Görünen aktör adı: marka/platform e-postası değil, şirket kullanıcı adı."""
    if user is None:
        return None
    # Platform personeli şirket hareketine kendi CRM kimliğini yazmasın.
    if user.get("is_super_admin") or user.get("is_platform_staff"):
        return None
    name = str(user.get("name") or "").strip()
    email = str(user.get("email") or "").strip()
    if name and not _is_forbidden_actor_label(name):
        return name[:120]
    if email and not _is_platform_actor_email(email):
        return email[:120]
    return "Kullanıcı"


def actor_fields(user: Optional[Dict[str, Any]] = None) -> Dict[str, Optional[str]]:
    """İşlemi yapan kullanıcı alanları."""
    if user is None:
        return {"created_by_id": None, "created_by_name": None}
    name = display_actor_name(user)
    if not name:
        return {"created_by_id": None, "created_by_name": None}
    uid = user.get("id") or user.get("_id")
    return {"created_by_id": str(uid) if uid else None, "created_by_name": name[:120]}


def set_current_actor(user: Optional[Dict[str, Any]]) -> Token:
    return _actor.set(user)


def reset_current_actor(token: Token) -> None:
    _actor.reset(token)


def current_actor() -> Optional[Dict[str, Any]]:
    return _actor.get()


def stamp(doc: Optional[Dict[str, Any]], user: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """created_by_* yoksa veya yasaklı (marka/platform e-posta) ise mevcut aktör ile doldur."""
    if not isinstance(doc, dict):
        return doc
    existing = (doc.get("created_by_name") or "").strip()
    if existing and not _is_forbidden_actor_label(existing):
        return doc
    # Banka senkron hareketinde platform personeli «oluşturan» olmasın → UI «Banka» gösterir.
    src = str(doc.get("source") or "")
    actor = user if user is not None else _actor.get()
    if src == "bank_sync" and actor and (
        actor.get("is_super_admin") or actor.get("is_platform_staff")
        or _is_platform_actor_email(str(actor.get("email") or ""))
    ):
        doc.pop("user_name", None)
        doc.pop("actor_name", None)
        if existing and _is_forbidden_actor_label(existing):
            doc["created_by_name"] = None
            doc["created_by_id"] = None
        return doc
    # İstek gövdesinden gelen açık alanlar
    explicit = (doc.get("user_name") or doc.get("actor_name") or "").strip()
    if explicit and not _is_forbidden_actor_label(explicit):
        doc["created_by_name"] = explicit[:120]
        if doc.get("user_id") or doc.get("actor_id"):
            doc["created_by_id"] = str(doc.get("user_id") or doc.get("actor_id"))
        doc.pop("user_name", None)
        doc.pop("actor_name", None)
        return doc
    doc.pop("user_name", None)
    doc.pop("actor_name", None)
    fields = actor_fields(actor)
    if fields.get("created_by_name"):
        doc["created_by_name"] = fields["created_by_name"]
        doc["created_by_id"] = fields.get("created_by_id")
    elif existing and _is_forbidden_actor_label(existing):
        # Yasaklı değeri temizle — bank_sync'te boş kalsın (UI: Banka).
        if src == "bank_sync":
            doc["created_by_name"] = None
            doc["created_by_id"] = None
        else:
            doc["created_by_name"] = "Kullanıcı"
            doc["created_by_id"] = None
    return doc


async def scrub_platform_actors(db, company_id: Optional[str] = None) -> int:
    """Kayıtlı platform/CRM e-posta aktörlerini banka hareketlerinden temizle."""
    q: Dict[str, Any] = {
        "$or": [
            {"created_by_name": {"$regex": r"tamkobi", "$options": "i"}},
            {"matched_by_name": {"$regex": r"tamkobi", "$options": "i"}},
        ]
    }
    if company_id:
        q = {"$and": [{"company_id": company_id}, q]}
    fixed = 0
    rows = await db.bank_transactions.find(q).to_list(20000)
    for tx in rows:
        patch: Dict[str, Any] = {}
        unset: Dict[str, str] = {}
        cname = (tx.get("created_by_name") or "").strip()
        if cname and _is_forbidden_actor_label(cname):
            unset["created_by_name"] = ""
            unset["created_by_id"] = ""
        mname = (tx.get("matched_by_name") or "").strip()
        if mname and _is_forbidden_actor_label(mname):
            unset["matched_by_name"] = ""
            unset["matched_by_id"] = ""
        if not unset:
            continue
        op: Dict[str, Any] = {}
        if unset:
            op["$unset"] = unset
        if patch:
            op["$set"] = patch
        await db.bank_transactions.update_one({"_id": tx["_id"]}, op)
        fixed += 1
    return fixed


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
