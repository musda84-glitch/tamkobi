"""GİB e-fatura/e-arşiv kontör cüzdanı — lisans bazında, platform paket satışına bağlı."""
import hashlib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import saas
import tenant_access

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


def _ledger_row_id(transfer_id: str, side: str) -> str:
    raw = f"{transfer_id}:{side}"
    if len(raw) <= 180:
        return raw
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _attach_transfer_token(company_id: str, old_wid: str, new_wid: str, seq: int) -> str:
    raw = f"gib-wallet-attach:{company_id}:{old_wid}:{new_wid}:{seq}"
    if len(raw) <= 160:
        return raw
    return "gib-wallet-attach:" + hashlib.sha256(raw.encode("utf-8")).hexdigest()


async def ensure_wallet(wallet_id: str) -> dict:
    """Cüzdan yoksa bakiye 0 ile açar. Hoş geldin kontörü ve ledger yazmaz."""
    wid = str(wallet_id or "").strip()
    if not wid:
        raise HTTPException(status_code=400, detail="Cüzdan anahtarı gerekli.")
    found = await _db.gib_wallets.find_one({"_id": wid})
    if found:
        return found
    now = _now()
    doc = {"_id": wid, "balance": 0, "created_at": now, "updated_at": now}
    try:
        await _db.gib_wallets.insert_one(doc)
    except Exception as exc:
        from mysql_store import DuplicateKeyError
        if not isinstance(exc, DuplicateKeyError):
            raise
        found = await _db.gib_wallets.find_one({"_id": wid})
        if found:
            return found
        raise
    return await _db.gib_wallets.find_one({"_id": wid}) or doc


async def _next_attach_transfer_id(company_id: str, old_wid: str, new_wid: str) -> str:
    route = f"{old_wid}->{new_wid}"
    rows = await _db.gib_credit_ledger.find({
        "company_id": company_id,
        "wallet_id": old_wid,
        "type": "transfer_out",
    }).to_list(2000)
    seq = 1 + sum(1 for row in rows if row.get("route") == route)
    return _attach_transfer_token(company_id, old_wid, new_wid, seq)


async def transfer_wallet_balance(old_wid: str, new_wid: str, *, company_id: str, transfer_id: str) -> dict:
    """Eski bakiyeyi yeni cüzdana ekler, eskiyi 0'lar. Aynı transfer_id ikinci kez uygulanmaz.

    Eski cüzdan yoksa sessizce döner. Yeni cüzdan yoksa hoş geldin kontörü olmadan açılır.
    Ledger'da çıkış ve giriş aynı transfer_id, company_id ve amount ile durur.
    credits işareti mevcut defterle aynıdır: çıkış eksi, giriş artı.
    """
    old_wid = str(old_wid or "").strip()
    new_wid = str(new_wid or "").strip()
    company_id = str(company_id or "").strip()
    transfer_id = str(transfer_id or "").strip()
    if not old_wid or not new_wid or not company_id or not transfer_id or old_wid == new_wid:
        return {"transferred": 0, "applied": False}

    out_id = _ledger_row_id(transfer_id, "out")
    existing_out = await _db.gib_credit_ledger.find_one({"_id": out_id, "company_id": company_id})
    if existing_out:
        return {"transferred": 0, "applied": False, "duplicate": True}

    old = await _db.gib_wallets.find_one({"_id": old_wid})
    if not old:
        return {"transferred": 0, "applied": False, "missing": True}

    amount = int(old.get("balance") or 0)
    if amount < 0:
        amount = 0
    now = _now()
    await ensure_wallet(new_wid)
    if amount <= 0:
        await _db.gib_wallets.update_one({"_id": old_wid}, {"$set": {"balance": 0, "updated_at": now}})
        return {"transferred": 0, "applied": True}

    await _db.gib_wallets.update_one(
        {"_id": new_wid},
        {"$inc": {"balance": amount}, "$set": {"updated_at": now}},
    )
    await _db.gib_wallets.update_one(
        {"_id": old_wid},
        {"$set": {"balance": 0, "updated_at": now}},
    )
    route = f"{old_wid}->{new_wid}"
    note_out = "Lisans birleştirme — kontör çıkışı"
    note_in = "Lisans birleştirme — kontör girişi"
    await _db.gib_credit_ledger.insert_one({
        "_id": out_id,
        "wallet_id": old_wid,
        "company_id": company_id,
        "type": "transfer_out",
        "credits": -amount,
        "amount": amount,
        "transfer_id": transfer_id,
        "route": route,
        "note": note_out,
        "created_at": now,
    })
    await _db.gib_credit_ledger.insert_one({
        "_id": _ledger_row_id(transfer_id, "in"),
        "wallet_id": new_wid,
        "company_id": company_id,
        "type": "transfer_in",
        "credits": amount,
        "amount": amount,
        "transfer_id": transfer_id,
        "route": route,
        "note": note_in,
        "created_at": now,
    })
    return {"transferred": amount, "applied": True, "transfer_id": transfer_id}


async def move_wallet_on_license_change(company_id: str, old_license_id: str, new_license_id: str) -> dict:
    """Lisans anahtarı değişince eski cüzdanı (license_id veya company_id) yeni anahtara taşır.

    Eski cüzdan yoksa hata vermez ve hoş geldin kontörü açmaz.
    """
    company_id = str(company_id or "").strip()
    new_wid = str(new_license_id or "").strip()
    old_lid = str(old_license_id or "").strip()
    if not company_id or not new_wid:
        return {"transferred": 0, "applied": False}
    source = ""
    seen = set()
    for key in (old_lid, company_id):
        if not key or key == new_wid or key in seen:
            continue
        seen.add(key)
        wallet = await _db.gib_wallets.find_one({"_id": key})
        if wallet:
            source = key
            break
    if not source:
        return {"transferred": 0, "applied": False, "missing": True}
    old = await _db.gib_wallets.find_one({"_id": source})
    amount = int((old or {}).get("balance") or 0)
    if amount <= 0:
        await ensure_wallet(new_wid)
        await _db.gib_wallets.update_one(
            {"_id": source},
            {"$set": {"balance": 0, "updated_at": _now()}},
        )
        return {"transferred": 0, "applied": True}
    transfer_id = await _next_attach_transfer_id(company_id, source, new_wid)
    return await transfer_wallet_balance(source, new_wid, company_id=company_id, transfer_id=transfer_id)


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
    return {
        "company_id": cid,
        "wallet_id": w["_id"],
        "balance": int(w.get("balance") or 0),
        "sales_enabled": selling,
        "packs": await packs() if selling else [],
        "ledger": led,
        "integrator_provider": raw_provider if raw_provider else None,
        "enforced": not configured_real_integrator(settings),
    }


@router.post("/system/gib-credits/gift")
async def system_gift(req: Dict[str, Any], _: dict = Depends(saas.require_super_admin)):
    cid = req.get("company_id")
    if not cid or not await _db.companies.find_one({"_id": cid}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    bal = await gift(cid, int(req.get("credits") or 0), (req.get("note") or "Platform yüklemesi")[:200])
    return {"company_id": cid, "balance": bal}
