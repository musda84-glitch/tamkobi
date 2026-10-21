"""GİB e-fatura/e-arşiv kontör cüzdanı — lisans bazında, platform paket satışına bağlı."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import saas
import tenant_access
from mysql_store import DuplicateKeyError as MysqlDuplicateKeyError

try:
    from pymongo.errors import DuplicateKeyError as PyMongoDuplicateKeyError
except Exception:
    PyMongoDuplicateKeyError = None

_DUP_ERRORS = (MysqlDuplicateKeyError,)
if PyMongoDuplicateKeyError is not None:
    _DUP_ERRORS = (MysqlDuplicateKeyError, PyMongoDuplicateKeyError)

CONSUME_INDEX_KEYS = [("company_id", 1), ("invoice_id", 1), ("type", 1)]
CONSUME_INDEX_FILTER = {"type": "consume", "invoice_id": {"$gt": ""}}
_consume_index_state = "pending"

router = APIRouter(prefix="/api")
logger = logging.getLogger("TamKobiERP")
_db = None
_current_user = None

DEFAULT_PACKS = [
    {"id": "gib_100", "name": "100 Kontör", "credits": 100, "price": 250, "tagline": "Küçük işletme"},
    {"id": "gib_500", "name": "500 Kontör", "credits": 500, "price": 1000, "tagline": "En çok tercih edilen", "popular": True},
    {"id": "gib_1000", "name": "1.000 Kontör", "credits": 1000, "price": 1800, "tagline": "Yoğun fatura"},
    {"id": "gib_5000", "name": "5.000 Kontör", "credits": 5000, "price": 7500, "tagline": "Kurumsal hacim"},
]
WELCOME_CREDITS = 50
# Bu tutarın üstü admin-v1'de danger prepare/confirm ister. Altı doğrudan yazılır.
GIFT_DIRECT_MAX = 1000
SALES_CLOSED_DETAIL = "GİB kontör satışı şu an kapalı. Entegratör anlaşması tamamlanınca platform yöneticisi satışları açacaktır."


def sales_from_settings(st: Optional[dict]) -> bool:
    """Missing / unset key means sales are off — no GİB agreement yet."""
    return bool((st or {}).get("gib_credits_sales"))


async def sales_enabled() -> bool:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    return sales_from_settings(st)


async def require_sales():
    if not await sales_enabled():
        raise HTTPException(status_code=403, detail=SALES_CLOSED_DETAIL)


def init(db, get_current_user=None):
    global _db, _current_user
    _db = db
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="GIB credits auth bağlanmadı.")
    return await _current_user(request)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _clean(d: dict) -> dict:
    d = dict(d)
    d["id"] = d.pop("_id", d.get("id"))
    return d


async def packs() -> List[dict]:
    st = await _db.platform_settings.find_one({"_id": "platform"}) or {}
    rows = st.get("gib_packs")
    if not isinstance(rows, list) or not rows:
        await _db.platform_settings.update_one({"_id": "platform"}, {"$set": {"gib_packs": DEFAULT_PACKS}}, upsert=True)
        return list(DEFAULT_PACKS)
    out = []
    for p in rows:
        if not p or not p.get("id"):
            continue
        out.append({
            "id": p["id"],
            "name": p.get("name") or p["id"],
            "credits": int(p.get("credits") or 0),
            "price": float(p.get("price") or 0),
            "tagline": p.get("tagline") or "",
            "popular": bool(p.get("popular")),
        })
    return out or list(DEFAULT_PACKS)


async def get_pack(pack_id: str) -> dict:
    for p in await packs():
        if p["id"] == pack_id and p["credits"] > 0 and p["price"] >= 0:
            return p
    raise HTTPException(status_code=400, detail="Kontör paketi bulunamadı.")


async def wallet_id_for(company_id: str) -> str:
    return await saas.license_id_of(company_id)


async def get_wallet(company_id: str) -> dict:
    wid = await wallet_id_for(company_id)
    w = await _db.gib_wallets.find_one({"_id": wid})
    if not w:
        w = {"_id": wid, "balance": WELCOME_CREDITS, "created_at": _now(), "updated_at": _now()}
        await _db.gib_wallets.insert_one(w)
        await _db.gib_credit_ledger.insert_one({
            "_id": str(uuid.uuid4()), "wallet_id": wid, "company_id": company_id, "type": "welcome",
            "credits": WELCOME_CREDITS, "note": "Hoş geldin kontörü", "created_at": _now(),
        })
    return w


async def apply_purchase(tx: dict) -> int:
    credits = int(tx.get("credits") or 0)
    if credits <= 0:
        return 0
    cid = tx.get("company_id")
    wid = await wallet_id_for(cid)
    await get_wallet(cid)
    await _db.gib_wallets.update_one({"_id": wid}, {"$inc": {"balance": credits}, "$set": {"updated_at": _now()}})
    await _db.gib_credit_ledger.insert_one({
        "_id": str(uuid.uuid4()), "wallet_id": wid, "company_id": cid, "type": "purchase",
        "credits": credits, "pack_id": tx.get("pack_id") or tx.get("plan_id"),
        "payment_id": tx.get("_id"), "amount": tx.get("amount"), "created_at": _now(),
    })
    import notify as _notify
    await _notify.insert_notification(_db, {
        "_id": str(uuid.uuid4()), "company_id": cid, "type": "gib", "title": f"{credits} GİB kontörü yüklendi",
        "message": f"Ödemeniz alındı. Hesabınıza {credits} e-fatura/e-arşiv kontörü eklendi.",
        "ref_type": "gib_credits", "ref_id": tx.get("_id"), "is_read": False, "created_at": _now(),
    })
    return credits


def _is_dup_error(exc: BaseException) -> bool:
    if isinstance(exc, _DUP_ERRORS):
        return True
    if type(exc).__name__ == "DuplicateKeyError":
        return True
    text = str(exc).lower()
    return "duplicate" in text or "e11000" in text


async def _cursor_rows(cursor, limit: int = 100000) -> list:
    if cursor is None:
        return []
    to_list = getattr(cursor, "to_list", None)
    if to_list is None:
        return []
    rows = to_list(limit)
    if hasattr(rows, "__await__"):
        rows = await rows
    return list(rows or [])


async def count_duplicate_consume_groups(db) -> int:
    """type=consume ve dolu invoice_id gruplarından birden fazla kaydı olanların sayısı."""
    cursor = db.gib_credit_ledger.find(
        {"type": "consume"},
        {"company_id": 1, "invoice_id": 1},
    )
    groups: Dict[tuple, int] = {}
    for row in await _cursor_rows(cursor):
        if not isinstance(row, dict):
            continue
        invoice_id = str(row.get("invoice_id") or "").strip()
        company_id = str(row.get("company_id") or "").strip()
        if not invoice_id or not company_id:
            continue
        key = (company_id, invoice_id)
        groups[key] = groups.get(key, 0) + 1
    return sum(1 for count in groups.values() if count > 1)


async def ensure_consume_index(db=None) -> None:
    """Kısmi unique index. Mükerrer varsa yalnız sayıyı logla, index kurma."""
    global _consume_index_state
    if _consume_index_state != "pending":
        return
    database = db if db is not None else _db
    if database is None:
        return
    try:
        duplicates = await count_duplicate_consume_groups(database)
        if duplicates:
            logger.warning(
                "gib_credit_ledger consume unique index skipped duplicate_groups=%s",
                duplicates,
            )
            _consume_index_state = "skipped"
            return
        await database.gib_credit_ledger.create_index(
            CONSUME_INDEX_KEYS,
            unique=True,
            name="uniq_gib_consume_company_invoice",
            partialFilterExpression=dict(CONSUME_INDEX_FILTER),
        )
        _consume_index_state = "ready"
    except Exception as exc:
        duplicates = 0
        if _is_dup_error(exc):
            try:
                duplicates = await count_duplicate_consume_groups(database)
            except Exception:
                duplicates = 0
        logger.warning(
            "gib_credit_ledger consume unique index skipped duplicate_groups=%s",
            duplicates,
        )
        _consume_index_state = "skipped"


async def _existing_consume(company_id: str, invoice_id: str):
    try:
        row = await _db.gib_credit_ledger.find_one({
            "company_id": company_id,
            "invoice_id": invoice_id,
            "type": "consume",
        })
    except Exception:
        return None
    return row if isinstance(row, dict) else None


async def consume(company_id: str, credits: int = 1, *, invoice_id: Optional[str] = None, note: str = "") -> int:
    if credits <= 0:
        return 0
    await ensure_consume_index()
    w = await get_wallet(company_id)
    bal = int(w.get("balance") or 0)
    invoice_key = str(invoice_id or "").strip()
    if invoice_key and await _existing_consume(company_id, invoice_key):
        return bal
    if bal < credits:
        if await sales_enabled():
            hint = "Hesap → GİB Kontör ekranından paket satın alın."
        else:
            hint = "Platform yöneticinizden kontör yüklemesi isteyin."
        raise HTTPException(
            status_code=402,
            detail=f"GİB kontörünüz yetersiz ({bal} kalan, {credits} gerekli). {hint}",
        )
    ledger = {
        "_id": str(uuid.uuid4()),
        "wallet_id": w["_id"],
        "company_id": company_id,
        "type": "consume",
        "credits": -credits,
        "note": note or "e-Belge gönderimi",
        "created_at": _now(),
    }
    if invoice_key:
        ledger["invoice_id"] = invoice_key
    try:
        await _db.gib_credit_ledger.insert_one(ledger)
    except _DUP_ERRORS:
        fresh = await get_wallet(company_id)
        return int(fresh.get("balance") or 0)
    await _db.gib_wallets.update_one(
        {"_id": w["_id"]},
        {"$inc": {"balance": -credits}, "$set": {"updated_at": _now()}},
    )
    remaining = bal - credits
    try:
        import event_notify
        await event_notify.maybe_gib_credits_low(company_id, remaining)
    except Exception:
        logger.exception("gib_credits_low notify failed")
    return remaining


async def gift(company_id: str, credits: int, note: str = "Platform yüklemesi") -> int:
    if credits <= 0:
        raise HTTPException(status_code=400, detail="Kontör adedi pozitif olmalı.")
    w = await get_wallet(company_id)
    await _db.gib_wallets.update_one({"_id": w["_id"]}, {"$inc": {"balance": credits}, "$set": {"updated_at": _now()}})
    await _db.gib_credit_ledger.insert_one({
        "_id": str(uuid.uuid4()), "wallet_id": w["_id"], "company_id": company_id, "type": "gift",
        "credits": credits, "note": note, "created_at": _now(),
    })
    return int((await get_wallet(company_id)).get("balance") or 0)


@router.get("/account/gib-credits")
async def account_credits(company_id: Optional[str] = None, user: dict = Depends(_user_dep)):
    cid = tenant_access.resolve_company_id(user, company_id)
    w = await get_wallet(cid)
    led = [_clean(x) for x in await _db.gib_credit_ledger.find({"wallet_id": w["_id"]}).sort("created_at", -1).to_list(40)]
    selling = await sales_enabled()
    settings = await _db.einvoice_settings.find_one({"company_id": cid}) or {}
    # issue_invoice ile aynı karar: yapılandırılmış gerçek entegratör cüzdanı düşürmez.
    from e_invoice import configured_real_integrator
    raw_provider = settings.get("provider")
    integrator_configured = configured_real_integrator(settings)
    return {
        "company_id": cid,
        "wallet_id": w["_id"],
        "balance": int(w.get("balance") or 0),
        "sales_enabled": selling,
        "packs": await packs() if selling else [],
        "ledger": led,
        "integrator_provider": raw_provider if raw_provider else None,
        "integrator_configured": integrator_configured,
        "enforced": not integrator_configured,
    }


@router.post("/system/gib-credits/gift")
async def system_gift(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cid = req.get("company_id")
    if not cid or not await _db.companies.find_one({"_id": cid}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    bal = await gift(cid, int(req.get("credits") or 0), (req.get("note") or "Platform yüklemesi")[:200])
    return {"company_id": cid, "balance": bal}
