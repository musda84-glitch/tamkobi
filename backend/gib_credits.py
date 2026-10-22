"""GİB e-fatura/e-arşiv kontör cüzdanı — lisans bazında, platform paket satışına bağlı."""
import hashlib
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
WELCOME_INDEX_KEYS = [("wallet_id", 1), ("type", 1)]
WELCOME_INDEX_FILTER = {"type": "welcome"}
GIFT_REQUEST_INDEX_KEYS = [("company_id", 1), ("wallet_id", 1), ("request_id", 1)]
GIFT_REQUEST_INDEX_FILTER = {"type": "gift", "request_id": {"$gt": ""}}
_consume_index_state = "pending"
_welcome_index_state = "pending"
_gift_index_state = "pending"

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


def _bounded_id(prefix: str, material: str) -> str:
    raw = f"{prefix}:{material}"
    if len(raw) <= 180:
        return raw
    digest = hashlib.sha256(material.encode()).hexdigest()[:32]
    return f"{prefix}:{digest}"


async def get_wallet(company_id: str) -> dict:
    wid = await wallet_id_for(company_id)
    w = await _db.gib_wallets.find_one({"_id": wid})
    if w:
        return w
    await ensure_welcome_index()
    now = _now()
    try:
        await _db.gib_wallets.update_one(
            {"_id": wid},
            {"$setOnInsert": {
                "balance": WELCOME_CREDITS,
                "created_at": now,
                "updated_at": now,
            }},
            upsert=True,
        )
    except _DUP_ERRORS:
        pass
    await _insert_welcome(company_id, wid)
    found = await _db.gib_wallets.find_one({"_id": wid})
    if isinstance(found, dict):
        return found
    return {"_id": wid, "balance": WELCOME_CREDITS, "created_at": now, "updated_at": now}


async def _insert_welcome(company_id: str, wallet_id: str) -> None:
    try:
        # tenant-ok: hoş geldin satırı cüzdan (lisans) başına tektir, şirket filtresi yok
        existing = await _db.gib_credit_ledger.find_one({"wallet_id": wallet_id, "type": "welcome"})
    except Exception:
        existing = None
    if isinstance(existing, dict):
        return
    try:
        await _db.gib_credit_ledger.insert_one({
            "_id": _bounded_id("welcome", wallet_id),
            "wallet_id": wallet_id,
            "company_id": company_id,
            "type": "welcome",
            "credits": WELCOME_CREDITS,
            "note": "Hoş geldin kontörü",
            "created_at": _now(),
        })
    except _DUP_ERRORS:
        return


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
    # tenant-ok: kurulum indeksi; consume grupları tüm şirketlerde sayılır
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


async def count_duplicate_welcome_groups(db) -> int:
    # tenant-ok: kurulum indeksi; hoş geldin grupları tüm cüzdanlarda sayılır
    cursor = db.gib_credit_ledger.find({"type": "welcome"}, {"wallet_id": 1})
    groups: Dict[str, int] = {}
    for row in await _cursor_rows(cursor):
        if not isinstance(row, dict):
            continue
        wallet_id = str(row.get("wallet_id") or "").strip()
        if not wallet_id:
            continue
        groups[wallet_id] = groups.get(wallet_id, 0) + 1
    return sum(1 for count in groups.values() if count > 1)


async def ensure_welcome_index(db=None) -> None:
    """Hoş geldin satırı cüzdan başına tek. Mükerrer varsa yalnız sayıyı logla."""
    global _welcome_index_state
    if _welcome_index_state != "pending":
        return
    database = db if db is not None else _db
    if database is None:
        return
    try:
        duplicates = await count_duplicate_welcome_groups(database)
        if duplicates:
            logger.warning(
                "gib_credit_ledger welcome unique index skipped duplicate_groups=%s",
                duplicates,
            )
            _welcome_index_state = "skipped"
            return
        await database.gib_credit_ledger.create_index(
            WELCOME_INDEX_KEYS,
            unique=True,
            name="uniq_gib_welcome_wallet",
            partialFilterExpression=dict(WELCOME_INDEX_FILTER),
        )
        _welcome_index_state = "ready"
    except AttributeError:
        return
    except Exception as exc:
        duplicates = 0
        if _is_dup_error(exc):
            try:
                duplicates = await count_duplicate_welcome_groups(database)
            except Exception:
                duplicates = 0
        logger.warning(
            "gib_credit_ledger welcome unique index skipped duplicate_groups=%s",
            duplicates,
        )
        _welcome_index_state = "skipped"


async def count_duplicate_gift_requests(db) -> int:
    # tenant-ok: kurulum indeksi; hediye istek grupları tüm şirketlerde sayılır
    cursor = db.gib_credit_ledger.find({"type": "gift"}, {"company_id": 1, "wallet_id": 1, "request_id": 1})
    groups: Dict[tuple, int] = {}
    for row in await _cursor_rows(cursor):
        if not isinstance(row, dict):
            continue
        request_id = str(row.get("request_id") or "").strip()
        company_id = str(row.get("company_id") or "").strip()
        wallet_id = str(row.get("wallet_id") or "").strip()
        if not request_id or not company_id or not wallet_id:
            continue
        key = (company_id, wallet_id, request_id)
        groups[key] = groups.get(key, 0) + 1
    return sum(1 for count in groups.values() if count > 1)


async def ensure_gift_request_index(db=None) -> None:
    """Dolu request_id hediye satırı tekil. Mükerrer varsa yalnız sayıyı logla."""
    global _gift_index_state
    if _gift_index_state != "pending":
        return
    database = db if db is not None else _db
    if database is None:
        return
    try:
        duplicates = await count_duplicate_gift_requests(database)
        if duplicates:
            logger.warning(
                "gib_credit_ledger gift request unique index skipped duplicate_groups=%s",
                duplicates,
            )
            _gift_index_state = "skipped"
            return
        await database.gib_credit_ledger.create_index(
            GIFT_REQUEST_INDEX_KEYS,
            unique=True,
            name="uniq_gib_gift_request",
            partialFilterExpression=dict(GIFT_REQUEST_INDEX_FILTER),
        )
        _gift_index_state = "ready"
    except AttributeError:
        return
    except Exception as exc:
        duplicates = 0
        if _is_dup_error(exc):
            try:
                duplicates = await count_duplicate_gift_requests(database)
            except Exception:
                duplicates = 0
        logger.warning(
            "gib_credit_ledger gift request unique index skipped duplicate_groups=%s",
            duplicates,
        )
        _gift_index_state = "skipped"


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


async def _insufficient_credits(bal: int, credits: int) -> HTTPException:
    if await sales_enabled():
        hint = "Hesap → GİB Kontör ekranından paket satın alın."
    else:
        hint = "Platform yöneticinizden kontör yüklemesi isteyin."
    return HTTPException(
        status_code=402,
        detail=f"GİB kontörünüz yetersiz ({bal} kalan, {credits} gerekli). {hint}",
    )


async def _rollback_consume_ledger(ledger_id: str, company_id: str) -> None:
    try:
        await _db.gib_credit_ledger.delete_one({"_id": ledger_id, "company_id": company_id})
    except Exception:
        logger.exception("consume ledger rollback failed")


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
        raise await _insufficient_credits(bal, credits)
    ledger = {
        "_id": _bounded_id("consume", f"{company_id}|{invoice_key}") if invoice_key else str(uuid.uuid4()),
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
    wrote = await _db.gib_wallets.update_one(
        {"_id": w["_id"], "balance": {"$gte": credits}},
        {"$inc": {"balance": -credits}, "$set": {"updated_at": _now()}},
    )
    if int(getattr(wrote, "matched_count", 0) or 0) < 1:
        await _rollback_consume_ledger(ledger["_id"], company_id)
        fresh = await get_wallet(company_id)
        raise await _insufficient_credits(int((fresh or {}).get("balance") or 0), credits)
    fresh = await _db.gib_wallets.find_one({"_id": w["_id"]}) or {}
    remaining = int(fresh.get("balance") or 0)
    try:
        import event_notify
        await event_notify.maybe_gib_credits_low(company_id, remaining)
    except Exception:
        logger.exception("gib_credits_low notify failed")
    return remaining


def _request_key(request_id: str) -> str:
    return str(request_id or "").strip()[:200]


async def _existing_gift(company_id: str, wallet_id: str, request_id: str):
    try:
        row = await _db.gib_credit_ledger.find_one({
            "company_id": company_id,
            "wallet_id": wallet_id,
            "type": "gift",
            "request_id": request_id,
        })
    except Exception:
        return None
    return row if isinstance(row, dict) else None


async def gift(company_id: str, credits: int, note: str = "Platform yüklemesi", *, request_id: str = "") -> int:
    if credits <= 0:
        raise HTTPException(status_code=400, detail="Kontör adedi pozitif olmalı.")
    request_key = _request_key(request_id)
    if request_key:
        await ensure_gift_request_index()
    w = await get_wallet(company_id)
    wid = w["_id"]
    if request_key and await _existing_gift(company_id, wid, request_key):
        fresh = await _db.gib_wallets.find_one({"_id": wid}) or w
        return int((fresh or {}).get("balance") or 0)
    ledger = {
        "_id": _bounded_id("gift", f"{company_id}|{wid}|{request_key}") if request_key else str(uuid.uuid4()),
        "wallet_id": wid,
        "company_id": company_id,
        "type": "gift",
        "credits": credits,
        "note": note,
        "created_at": _now(),
    }
    if request_key:
        ledger["request_id"] = request_key
    try:
        await _db.gib_credit_ledger.insert_one(ledger)
    except _DUP_ERRORS:
        fresh = await _db.gib_wallets.find_one({"_id": wid}) or w
        return int((fresh or {}).get("balance") or 0)
    await _db.gib_wallets.update_one(
        {"_id": wid},
        {"$inc": {"balance": credits}, "$set": {"updated_at": _now()}},
    )
    fresh = await _db.gib_wallets.find_one({"_id": wid}) or {}
    return int(fresh.get("balance") or 0)


# Cüzdan belgesinde aynı transferin düşüm / ekleme hakkı. Bakiye ile aynı yazıda durur.
TRANSFER_DEBIT_FIELD = "transfer_debit_id"
TRANSFER_CREDIT_FIELD = "transfer_credit_id"
_ATTACH_EVENT = "license-attach"


def _transfer_out_id(transfer_id: str) -> str:
    return _bounded_id("transfer_out", transfer_id)


def _transfer_in_id(transfer_id: str) -> str:
    return _bounded_id("transfer_in", transfer_id)


def _attach_transfer_id(company_id: str, old_wid: str, new_wid: str, event_id: str) -> str:
    """Şirket, kaynak, hedef ve bağlama olayı kimliğinden deterministik anahtar."""
    return _bounded_id("gib-wallet-attach", f"{company_id}|{old_wid}|{new_wid}|{event_id}")


def _claimed(result) -> bool:
    if result is None:
        return False
    if isinstance(result, dict):
        return bool(result.get("_id"))
    matched = getattr(result, "matched_count", None)
    if matched is not None:
        return int(matched) > 0
    return False


async def _ledger_by_id(row_id: str, company_id: str):
    try:
        row = await _db.gib_credit_ledger.find_one({"_id": row_id, "company_id": company_id})
    except Exception:
        return None
    return row if isinstance(row, dict) else None


async def _insert_ledger(doc: dict) -> bool:
    try:
        await _db.gib_credit_ledger.insert_one(doc)
        return True
    except Exception as exc:
        if _is_dup_error(exc):
            return False
        raise


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
        if not _is_dup_error(exc):
            raise
        found = await _db.gib_wallets.find_one({"_id": wid})
        if found:
            return found
        raise
    return await _db.gib_wallets.find_one({"_id": wid}) or doc


async def _resolve_attach_transfer_id(company_id: str, old_wid: str, new_wid: str) -> str:
    """Bağlama olayı kimliği. Önceki defter satırları sayılmaz.

    Yarım kalmış olay aynı kimliği döndürür. Tamamlanmış olayın kimliği,
    bir sonraki bağlamanın olay anahtarı olur; aynı deneme ikinci kez
    bakiye eklemez, sonraki gerçek bağlama yeni bir kimlik alır.
    """
    event_id = _ATTACH_EVENT
    seen = set()
    transfer_id = _attach_transfer_id(company_id, old_wid, new_wid, event_id)
    for _ in range(32):
        if transfer_id in seen:
            return transfer_id
        seen.add(transfer_id)
        out_row = await _ledger_by_id(_transfer_out_id(transfer_id), company_id)
        in_row = await _ledger_by_id(_transfer_in_id(transfer_id), company_id)
        if out_row and not in_row:
            return transfer_id
        if not in_row:
            return transfer_id
        event_id = transfer_id
        transfer_id = _attach_transfer_id(company_id, old_wid, new_wid, event_id)
    return transfer_id


def _ledger_doc(
    *,
    row_id: str,
    wallet_id: str,
    company_id: str,
    row_type: str,
    credits: int,
    amount: int,
    transfer_id: str,
    route: str,
    note: str,
    created_at: str,
) -> dict:
    return {
        "_id": row_id,
        "wallet_id": wallet_id,
        "company_id": company_id,
        "type": row_type,
        "credits": credits,
        "amount": amount,
        "transfer_id": transfer_id,
        "route": route,
        "note": note,
        "created_at": created_at,
    }


async def _drop_open_out(out_id: str, company_id: str) -> None:
    """Düşüm tutmadıysa ve hedefe yazılmadıysa işaret satırını geri al."""
    try:
        await _db.gib_credit_ledger.delete_one({"_id": out_id, "company_id": company_id})
    except Exception:
        logger.exception("transfer out rollback failed")


async def _finish_transfer(
    out_row: dict,
    *,
    old_wid: str,
    new_wid: str,
    company_id: str,
    transfer_id: str,
) -> dict:
    """İşaret satırı dururken kaldığı yerden bitir. Tamamlanmış aktarımı yazmaz."""
    in_id = _transfer_in_id(transfer_id)
    if await _ledger_by_id(in_id, company_id):
        return {"transferred": 0, "applied": False, "duplicate": True}

    amount = int(out_row.get("amount") or 0)
    if amount <= 0:
        return {"transferred": 0, "applied": False, "duplicate": True}

    now = _now()
    route = str(out_row.get("route") or f"{old_wid}->{new_wid}")
    source = await _db.gib_wallets.find_one({"_id": old_wid}) or {}
    dest = await ensure_wallet(new_wid)
    source_done = (source or {}).get(TRANSFER_DEBIT_FIELD) == transfer_id
    dest_done = (dest or {}).get(TRANSFER_CREDIT_FIELD) == transfer_id

    if not source_done:
        # #1504 ile aynı koşullu düşüm: bakiye yetmiyorsa eşleşme yok, hedefe yazılmaz.
        claimed = await _db.gib_wallets.find_one_and_update(
            {
                "_id": old_wid,
                "balance": {"$gte": amount},
                TRANSFER_DEBIT_FIELD: {"$ne": transfer_id},
            },
            {
                "$inc": {"balance": -amount},
                "$set": {"updated_at": now, TRANSFER_DEBIT_FIELD: transfer_id},
            },
        )
        if _claimed(claimed):
            source_done = True
        else:
            fresh = await _db.gib_wallets.find_one({"_id": old_wid}) or {}
            source_done = fresh.get(TRANSFER_DEBIT_FIELD) == transfer_id
            if not source_done:
                if not dest_done:
                    await _drop_open_out(str(out_row.get("_id") or ""), company_id)
                return {"transferred": 0, "applied": False, "transfer_id": transfer_id}

    if source_done and not dest_done:
        credited = await _db.gib_wallets.find_one_and_update(
            {
                "_id": new_wid,
                TRANSFER_CREDIT_FIELD: {"$ne": transfer_id},
            },
            {
                "$inc": {"balance": amount},
                "$set": {"updated_at": now, TRANSFER_CREDIT_FIELD: transfer_id},
            },
        )
        if _claimed(credited):
            dest_done = True
        else:
            fresh = await _db.gib_wallets.find_one({"_id": new_wid}) or {}
            dest_done = fresh.get(TRANSFER_CREDIT_FIELD) == transfer_id
            if not dest_done:
                return {"transferred": 0, "applied": False, "transfer_id": transfer_id}

    if not (source_done and dest_done):
        return {"transferred": 0, "applied": False, "transfer_id": transfer_id}

    await _insert_ledger(_ledger_doc(
        row_id=in_id,
        wallet_id=new_wid,
        company_id=company_id,
        row_type="transfer_in",
        credits=amount,
        amount=amount,
        transfer_id=transfer_id,
        route=route,
        note="Lisans birleştirme — kontör girişi",
        created_at=now,
    ))
    return {"transferred": amount, "applied": True, "transfer_id": transfer_id}


async def transfer_wallet_balance(old_wid: str, new_wid: str, *, company_id: str, transfer_id: str) -> dict:
    """Eski bakiyeyi yeni cüzdana taşır. Aynı transfer_id ikinci kez bakiye eklemez.

    Sıra: çıkış defter satırı (idempotency) → kaynakta koşullu düşüm → hedefe ekleme
    → giriş satırı. Kaynak düşümü tutmazsa hedefe yazılmaz. Satır zaten varsa
    işlem bitmiş ya da yarımdır; kaldığı yerden sürer, bakiyeyi ikinci kez eklemez.

    Eski cüzdan yoksa sessizce döner. Yeni cüzdan yoksa hoş geldin kontörü olmadan açılır.
    credits işareti mevcut defterle aynıdır: çıkış eksi, giriş artı.
    """
    old_wid = str(old_wid or "").strip()
    new_wid = str(new_wid or "").strip()
    company_id = str(company_id or "").strip()
    transfer_id = str(transfer_id or "").strip()
    if not old_wid or not new_wid or not company_id or not transfer_id or old_wid == new_wid:
        return {"transferred": 0, "applied": False}

    out_id = _transfer_out_id(transfer_id)
    in_id = _transfer_in_id(transfer_id)
    existing_out = await _ledger_by_id(out_id, company_id)
    if existing_out and await _ledger_by_id(in_id, company_id):
        return {"transferred": 0, "applied": False, "duplicate": True}
    if existing_out:
        return await _finish_transfer(
            existing_out, old_wid=old_wid, new_wid=new_wid, company_id=company_id, transfer_id=transfer_id,
        )

    old = await _db.gib_wallets.find_one({"_id": old_wid})
    if not old:
        return {"transferred": 0, "applied": False, "missing": True}

    amount = int(old.get("balance") or 0)
    now = _now()
    if amount <= 0:
        await ensure_wallet(new_wid)
        await _db.gib_wallets.update_one({"_id": old_wid}, {"$set": {"balance": 0, "updated_at": now}})
        return {"transferred": 0, "applied": True}

    await ensure_wallet(new_wid)
    route = f"{old_wid}->{new_wid}"
    out_row = _ledger_doc(
        row_id=out_id,
        wallet_id=old_wid,
        company_id=company_id,
        row_type="transfer_out",
        credits=-amount,
        amount=amount,
        transfer_id=transfer_id,
        route=route,
        note="Lisans birleştirme — kontör çıkışı",
        created_at=now,
    )
    inserted = await _insert_ledger(out_row)
    if not inserted:
        existing_out = await _ledger_by_id(out_id, company_id)
        if existing_out and await _ledger_by_id(in_id, company_id):
            return {"transferred": 0, "applied": False, "duplicate": True}
        if not existing_out:
            return {"transferred": 0, "applied": False, "duplicate": True}
        return await _finish_transfer(
            existing_out, old_wid=old_wid, new_wid=new_wid, company_id=company_id, transfer_id=transfer_id,
        )
    return await _finish_transfer(
        out_row, old_wid=old_wid, new_wid=new_wid, company_id=company_id, transfer_id=transfer_id,
    )


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
    transfer_id = await _resolve_attach_transfer_id(company_id, source, new_wid)
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
