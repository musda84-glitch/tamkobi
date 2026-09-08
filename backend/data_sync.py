"""Artımlı tarayıcı senkronu: yalnızca değişen / silinen kayıtları döner."""
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Query

from mysql_store import iso_ts, parse_ts

router = APIRouter(prefix="/api")
_db = None

ALLOWED = (
    "invoices", "contacts", "products", "orders",
    "bank_transactions", "bank_accounts", "quotes", "projects", "expenses", "surveys",
)
FULL_AFTER_DAYS = 30
DEFAULT_LIMIT = 3000


def init(db):
    global _db
    _db = db


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


@router.get("/sync")
async def incremental_sync(
    company_id: str = Query("comp_nexus_main_01"),
    since: Optional[str] = Query(None),
    collections: str = Query("invoices,contacts,products,orders,bank_transactions"),
    limit: int = Query(DEFAULT_LIMIT, ge=1, le=5000),
):
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
        changed, cursor, more = await _db[name].changed_since(None if full else since, company_id=company_id, limit=limit)
        deleted: List[str] = []
        if not full and since:
            tombs = await _db.sync_tombstones.find({
                "collection": name,
                "company_id": company_id,
                "deleted_at": {"$gte": since},
            }).to_list(limit)
            deleted = list({str(t.get("doc_id")) for t in tombs if t.get("doc_id")})
        out[name] = {
            "changed": [_clean(d) for d in changed],
            "deleted": deleted,
            "cursor": cursor or iso_ts(_now()),
            "more": more,
            "complete": full,
        }
    return {
        "company_id": company_id,
        "since": None if full else since,
        "server_time": iso_ts(_now()),
        "full": full,
        "collections": out,
    }
