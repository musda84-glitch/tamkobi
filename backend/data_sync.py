"""Artımlı tarayıcı senkronu: yalnızca değişen / silinen kayıtları döner."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import json_offload
import tenant_access
from mysql_store import iso_ts, parse_ts

router = APIRouter(prefix="/api")
_db = None
_current_user = None

ALLOWED = (
    "invoices", "contacts", "products", "orders",
    "bank_transactions", "bank_accounts", "quotes", "projects", "expenses", "surveys",
)
FULL_AFTER_DAYS = 30
DEFAULT_LIMIT = 3000


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="Sync auth bağlanmadı.")
    return await _current_user(request)


def _clean(doc: dict) -> dict:
    d = dict(doc)
    d.pop("_row_updated_at", None)
    if "_id" in d:
        d["id"] = str(d.pop("_id"))
    d.pop("password_hash", None)
    if "b2b_password_hash" in d:
        d["has_b2b_password"] = bool(d.pop("b2b_password_hash"))
    return d


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _earlier(left: Optional[str], right: Optional[str]) -> Optional[str]:
    """İki ISO imleçten erken olanı. Biçim bozulmaz."""
    if not left:
        return right
    if not right:
        return left
    a, b = parse_ts(left), parse_ts(right)
    if a is None or b is None:
        return left if str(left) <= str(right) else right
    return left if a <= b else right


async def _deleted_since(name: str, company_id: str, since: str, limit: int):
    """Dedicated sayfa. Diğer depolar eski to_list(limit) davranışında kalır."""
    coll = _db.sync_tombstones
    reader = getattr(coll, "deleted_since", None)
    if reader is None:
        import storage_router

        if storage_router.enabled():
            routed = await storage_router.route_legacy_read(coll, {"company_id": company_id})
            if routed is not None:
                reader = getattr(routed, "deleted_since", None)
    if reader is not None:
        return await reader(name, company_id, since, limit)
    tombs = await coll.find({
        "collection": name,
        "company_id": company_id,
        "deleted_at": {"$gte": since},
    }).to_list(limit)
    deleted = list({str(t.get("doc_id")) for t in tombs if t.get("doc_id")})
    return deleted, False, None


@router.get("/sync")
async def incremental_sync(
    company_id: Optional[str] = Query(None),
    since: Optional[str] = Query(None),
    collections: str = Query("invoices,contacts,products,orders,bank_transactions"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=5000),
    user: dict = Depends(_user_dep),
):
    cid = tenant_access.resolve_company_id(user, company_id)
    names = [n.strip() for n in (collections or "").split(",") if n.strip() in ALLOWED]
    if not names:
        names = list(ALLOWED[:5])
    parsed = parse_ts(since)
    full = parsed is None
    if parsed is not None and (_now().replace(tzinfo=None) - parsed).days >= FULL_AFTER_DAYS:
        full = True
        parsed = None
        since = None
    out: Dict[str, Any] = {}
    for name in names:
        changed, cursor, changed_more = await _db[name].changed_since(None if full else since, company_id=cid, limit=limit)
        deleted: List[str] = []
        more = changed_more
        if not full and since:
            deleted, tomb_more, tomb_cursor = await _deleted_since(name, cid, since, limit)
            if tomb_more and tomb_cursor:
                more = True
                # Değişen kayıt ilerlemediyse imleci mezar taşının devamına al.
                # İlerlediyse erken olanı kullan; atlanan silme kalmasın.
                if changed_more or (cursor and cursor != since):
                    cursor = _earlier(cursor, tomb_cursor)
                else:
                    cursor = tomb_cursor
        out[name] = {
            "changed": [_clean(d) for d in changed],
            "deleted": deleted,
            "cursor": cursor or iso_ts(_now()),
            "more": more,
            "complete": full,
        }
    return await json_offload.maybe_offload({
        "company_id": cid,
        "since": None if full else since,
        "server_time": iso_ts(_now()),
        "full": full,
        "collections": out,
    })
