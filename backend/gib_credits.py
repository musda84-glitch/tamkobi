"""GİB e-fatura/e-arşiv kontör cüzdanı — lisans bazında, platform paket satışına bağlı."""
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import saas

router = APIRouter(prefix="/api")
logger = logging.getLogger("NexusERP")
_db = None

DEFAULT_PACKS = [
    {"id": "gib_100", "name": "100 Kontör", "credits": 100, "price": 250, "tagline": "Küçük işletme"},
    {"id": "gib_500", "name": "500 Kontör", "credits": 500, "price": 1000, "tagline": "En çok tercih edilen", "popular": True},
    {"id": "gib_1000", "name": "1.000 Kontör", "credits": 1000, "price": 1800, "tagline": "Yoğun fatura"},
    {"id": "gib_5000", "name": "5.000 Kontör", "credits": 5000, "price": 7500, "tagline": "Kurumsal hacim"},
]
WELCOME_CREDITS = 50
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


def init(db):
    global _db
    _db = db


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
    await _db.notifications.insert_one({
        "_id": str(uuid.uuid4()), "company_id": cid, "type": "gib", "title": f"{credits} GİB kontörü yüklendi",
        "message": f"Ödemeniz alındı. Hesabınıza {credits} e-fatura/e-arşiv kontörü eklendi.",
        "ref_type": "gib_credits", "ref_id": tx.get("_id"), "is_read": False, "created_at": _now(),
    })
    return credits


async def consume(company_id: str, credits: int = 1, *, invoice_id: Optional[str] = None, note: str = "") -> int:
    if credits <= 0:
        return 0
    w = await get_wallet(company_id)
    bal = int(w.get("balance") or 0)
    if bal < credits:
        if await sales_enabled():
            hint = "Hesap → GİB Kontör ekranından paket satın alın."
        else:
            hint = "Platform yöneticinizden kontör yüklemesi isteyin."
        raise HTTPException(
            status_code=402,
            detail=f"GİB kontörünüz yetersiz ({bal} kalan, {credits} gerekli). {hint}",
        )
    await _db.gib_wallets.update_one({"_id": w["_id"]}, {"$inc": {"balance": -credits}, "$set": {"updated_at": _now()}})
    await _db.gib_credit_ledger.insert_one({
        "_id": str(uuid.uuid4()), "wallet_id": w["_id"], "company_id": company_id, "type": "consume",
        "credits": -credits, "invoice_id": invoice_id, "note": note or "e-Belge gönderimi", "created_at": _now(),
    })
    return bal - credits


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
async def account_credits(request: Request, company_id: str = "comp_nexus_main_01"):
    user = await saas._request_user(request)
    saas._require_company_access(user, company_id)
    w = await get_wallet(company_id)
    led = [_clean(x) for x in await _db.gib_credit_ledger.find({"wallet_id": w["_id"]}).sort("created_at", -1).to_list(40)]
    selling = await sales_enabled()
    return {
        "company_id": company_id,
        "wallet_id": w["_id"],
        "balance": int(w.get("balance") or 0),
        "sales_enabled": selling,
        "packs": await packs() if selling else [],
        "ledger": led,
    }


@router.post("/system/gib-credits/gift")
async def system_gift(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cid = req.get("company_id")
    if not cid or not await _db.companies.find_one({"_id": cid}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    bal = await gift(cid, int(req.get("credits") or 0), (req.get("note") or "Platform yüklemesi")[:200])
    return {"company_id": cid, "balance": bal}
