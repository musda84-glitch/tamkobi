"""Kaynak kayıt (prim/bordro/kredi/taksit) ↔ kasa/banka/cari/ortak hareket bağları.

Silme / geri alma / geri getirme sırasında bağlı kasa, banka ve ortak
hareketlerini birlikte geri almak için ortak link alanları.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request

import account_balance
import contact_balance
import partner_pay
import trash

logger = logging.getLogger("linked_moves")

router = APIRouter(prefix="/api")

_db = None
_reverse_tx_effects: Optional[Callable[..., Awaitable[None]]] = None

# source_type → specialty field on bank/partner txs
SPECIALTY: Dict[str, str] = {
    "personnel_bonus": "bonus_id",
    "bonus": "bonus_id",
    "payroll": "payroll_id",
    "loan": "loan_id",
    "installment": "installment_id",
    "personnel_payment": "personnel_movement_id",
}

SOURCE_LABELS = {
    "personnel_bonus": "Personel prim/avans",
    "bonus": "Personel prim/avans",
    "payroll": "Bordro / maaş",
    "loan": "Kredi",
    "installment": "Taksit",
    "personnel_payment": "Personel ödeme",
}


def init(db, reverse_tx_fn=None):
    global _db, _reverse_tx_effects
    _db = db
    if reverse_tx_fn is not None:
        _reverse_tx_effects = reverse_tx_fn


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _norm_source_type(source_type: str) -> str:
    st = (source_type or "").strip().lower()
    if st in ("bonus", "personnel_bonus", "prim", "avans"):
        return "personnel_bonus"
    if st in ("payroll", "maas", "bordro"):
        return "payroll"
    if st in ("loan", "kredi"):
        return "loan"
    if st in ("installment", "taksit"):
        return "installment"
    if st in ("personnel_payment", "personnel_movement", "personel_odeme", "personel_ödeme"):
        return "personnel_payment"
    return st


def specialty_field(source_type: str) -> Optional[str]:
    return SPECIALTY.get(_norm_source_type(source_type))


def link_fields(source_type: str, source_id: str) -> Dict[str, Any]:
    """Hareket oluştururken yazılacak ortak + specialty alanlar."""
    st = _norm_source_type(source_type)
    sid = str(source_id or "").strip()
    out: Dict[str, Any] = {"source_type": st, "source_id": sid}
    field = specialty_field(st)
    if field and sid:
        out[field] = sid
    # bank_transactions.source kısa etiketi
    if st == "personnel_bonus":
        out.setdefault("source", "personnel_bonus")
    elif st == "payroll":
        out.setdefault("source", "payroll")
    elif st == "loan":
        out.setdefault("source", "loan")
    elif st == "installment":
        out.setdefault("source", "installment")
    elif st == "personnel_payment":
        out.setdefault("source", "personnel_payment")
    return out


def _link_query(source_type: str, source_id: str, company_id: Optional[str] = None) -> Dict[str, Any]:
    st = _norm_source_type(source_type)
    sid = str(source_id)
    field = specialty_field(st)
    clauses: List[Dict[str, Any]] = [
        {"source_type": st, "source_id": sid},
        {"source_id": sid, "source": st},
    ]
    if field:
        clauses.append({field: sid})
    # bonus_id veya source_id taşımayan eski hareketler bu sorguya girmez.
    q: Dict[str, Any] = {"$or": clauses}
    if company_id:
        q["company_id"] = str(company_id)
    return q


async def find_linked(
    db,
    source_type: str,
    source_id: str,
    company_id: Optional[str] = None,
) -> Dict[str, List[dict]]:
    """Bağlı banka + ortak + cari (contact_id'li banka) + masraf satırları.

    company_id boş veya None ise sorgu açılmaz; boş sonuç döner.
    """
    empty = {
        "bank_transactions": [],
        "partner_transactions": [],
        "cari_lines": [],
        "expenses": [],
    }
    cid = str(company_id or "").strip()
    if not cid:
        return empty
    q = _link_query(source_type, source_id, cid)
    q["company_id"] = cid
    bank = await db.bank_transactions.find(q).to_list(500)
    partner = await db.partner_transactions.find(q).to_list(500)
    # Cari satırları ayrı koleksiyon değil — contact_id taşıyan bank hareketleri
    cari = [t for t in bank if t.get("contact_id")]
    expenses = []
    st = _norm_source_type(source_type)
    if st == "loan":
        loan_eq = {"loan_id": str(source_id), "company_id": cid}
        expenses = await db.expenses.find(loan_eq).to_list(200)
    elif st == "installment":
        inst_eq = {"installment_id": str(source_id), "company_id": cid}
        expenses = await db.expenses.find(inst_eq).to_list(50)
    elif st == "personnel_payment":
        pay_eq = {"$and": [
            {"$or": [
                {"source_type": "personnel_payment", "source_id": str(source_id)},
                {"personnel_movement_id": str(source_id)},
            ]},
            {"company_id": cid},
        ]}
        expenses = await db.expenses.find(pay_eq).to_list(200)
    return {
        "bank_transactions": bank,
        "partner_transactions": partner,
        "cari_lines": cari,
        "expenses": expenses,
    }


async def _audit(db, *, company_id: Optional[str], actor: Optional[dict], action: str, detail: str, extra: Optional[dict] = None):
    uid = None
    uname = None
    if actor:
        uid = actor.get("id") or actor.get("_id")
        uname = actor.get("name") or actor.get("email")
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": company_id,
        "user_id": uid,
        "user_name": uname,
        "method": "LINKED_MOVES",
        "path": f"/linked_moves/{action}",
        "module": "/banking",
        "status": 200,
        "detail": detail,
        "created_at": _now(),
    }
    if extra:
        doc["extra"] = extra
    try:
        await db.activity_logs.insert_one(doc)
    except Exception:
        logger.exception("activity_logs write failed")


async def _recalc_touched_accounts(db, txs: List[dict]):
    cash_ids = set()
    cash_company: Dict[str, str] = {}
    contact_ids = set()
    contact_company = {}
    for tx in txs:
        company = str(tx.get("company_id") or "")
        for k in ("account_id", "target_account_id"):
            if tx.get(k):
                cash_ids.add(tx[k])
                if company and tx[k] not in cash_company:
                    cash_company[tx[k]] = company
        for k in ("contact_id", "owner_contact_id"):
            if tx.get(k):
                contact_ids.add(tx[k])
                if company:
                    contact_company[tx[k]] = company
    cash_accs = []
    for aid in cash_ids:
        acc_cid = cash_company.get(aid) or ""
        if not acc_cid:
            continue
        acc = await db.bank_accounts.find_one({"_id": aid, "company_id": acc_cid})
        if acc and str(acc.get("type") or "") == "cash_box":
            cash_accs.append(acc)
        elif acc:
            # Banka kartı: hareket toplamına kilitlemek riskli; sadece kasa sync.
            pass
    if cash_accs:
        await account_balance.sync_cash_box_balances(db, cash_accs)
    for cid in contact_ids:
        try:
            await contact_balance.sync_contact_balance(db, cid, company_id=contact_company.get(cid) or "")
        except Exception:
            logger.exception("sync_contact_balance %s", cid)


async def _soft_delete_move(collection: str, doc: dict, entity_type: str, note: str = "") -> Optional[str]:
    label = f"{doc.get('description') or doc.get('type') or entity_type} · {float(doc.get('amount') or 0):,.2f} ₺"
    try:
        return await trash.soft_delete(collection, doc, entity_type, label, note=note)
    except Exception:
        logger.exception("soft_delete %s %s", collection, doc.get("_id"))
        # Fallback: hard delete so orphan kalmasın. Dedicated satır company_id ister.
        q = {"_id": doc["_id"]}
        cid = str((doc or {}).get("company_id") or "").strip()
        if cid:
            q["company_id"] = cid
        await _db[collection].delete_one(q)
        return None


async def _write_reverse_bank_entry(db, tx: dict, reason: str) -> dict:
    """mode=reverse: karşı hareket yaz (orijinal kalır, bağ aynı source_id)."""
    cid = str(tx.get("company_id") or "")
    amt = float(tx.get("amount") or 0)
    t = tx.get("type")
    if t == "inflow":
        rev_type = "outflow"
    elif t == "outflow":
        rev_type = "inflow"
    else:
        rev_type = t
    doc = {
        "_id": str(uuid.uuid4()),
        "company_id": tx.get("company_id"),
        "account_id": tx.get("account_id"),
        "account_name": tx.get("account_name"),
        "type": rev_type,
        "category": tx.get("category") or "Geri alma",
        "amount": amt,
        "currency": tx.get("currency") or "TRY",
        "description": f"Geri alma: {tx.get('description') or ''}".strip() + (f" ({reason})" if reason else ""),
        "source": "linked_reverse",
        "reverses_tx_id": tx.get("_id"),
        "contact_id": tx.get("contact_id"),
        "contact_name": tx.get("contact_name"),
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "created_at": _now(),
    }
    for k in ("source_type", "source_id", "bonus_id", "payroll_id", "loan_id", "installment_id"):
        if tx.get(k) is not None:
            doc[k] = tx[k]
    if not cid:
        return doc
    doc["company_id"] = cid
    await db.bank_transactions.insert_one(doc)
    if _reverse_tx_effects:
        # Orijinal etkisini geri al (= reverse entry'nin etkisi)
        await _reverse_tx_effects(tx, -1)
    else:
        # Fallback: reverse entry etkisini uygula
        change = amt if rev_type == "inflow" else -amt
        if doc.get("account_id"):
            import account_balance
            posted = await account_balance.apply_balance_delta(
                db, doc["account_id"], change, company_id=doc.get("company_id") or "",
            )
            if posted == "integrated":
                doc["balance_posted"] = False
                doc["match_status"] = "expected"
                await db.bank_transactions.update_one(
                    {"_id": doc["_id"], "company_id": cid},
                    {"$set": {"balance_posted": False, "match_status": "expected"}},
                )
        if doc.get("contact_id"):
            await db.contacts.update_one(
                {"_id": doc["contact_id"], "company_id": cid},
                {"$inc": {"balance": -change}},
            )
    return doc


async def reverse_linked(
    db,
    source_type: str,
    source_id: str,
    mode: str = "delete",
    actor: Optional[dict] = None,
    reason: str = "",
    *,
    also_expenses: bool = True,
    company_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Bağlı hareketleri geri al. mode=delete → soft_delete; mode=reverse → karşı kayıt.

    Idempotent: bağlı hareket yoksa reversed=0 döner.
    Hata durumunda mümkün olduğunca yarım bırakmaz (önce bakiye, sonra soft_delete).
    company_id verilirse yalnızca o şirketin hareketleri hedeflenir.
    """
    st = _norm_source_type(source_type)
    sid = str(source_id)
    mode = (mode or "delete").strip().lower()
    if mode not in ("delete", "reverse"):
        raise HTTPException(status_code=400, detail="mode delete veya reverse olmalı.")

    found = await find_linked(db, st, sid, company_id=company_id)
    bank = list(found["bank_transactions"] or [])
    partner = list(found["partner_transactions"] or [])
    expenses = list(found["expenses"] or []) if also_expenses else []

    if not bank and not partner and not expenses:
        await _audit(
            db,
            company_id=company_id,
            actor=actor,
            action="reverse_noop",
            detail=f"{st}/{sid} bağlı hareket yok (idempotent)",
            extra={"reason": reason, "mode": mode},
        )
        return {
            "status": "success",
            "idempotent": True,
            "reversed": 0,
            "bank": 0,
            "partner": 0,
            "expenses": 0,
            "mode": mode,
        }

    resolved_cid = str(company_id) if company_id else None
    if not resolved_cid:
        for row in bank + partner + expenses:
            if row.get("company_id"):
                resolved_cid = str(row["company_id"])
                break
    company_id = resolved_cid

    reversed_bank: List[str] = []
    reversed_partner: List[str] = []
    reversed_exp: List[str] = []
    errors: List[str] = []

    # 1) Bank effects + soft/reverse
    for tx in bank:
        try:
            if await trash.original_in_trash("bank_transactions", tx):
                if mode != "reverse":
                    await _soft_delete_move(
                        "bank_transactions",
                        tx,
                        "bank_transaction",
                        note=f"linked:{st}/{sid}" + (f" · {reason}" if reason else ""),
                    )
                continue
            if mode == "reverse":
                await _write_reverse_bank_entry(db, tx, reason or "kaynak silindi")
                # Mark original so find_linked / idempotency skips double-reverse
                tx_cid = str(tx.get("company_id") or "")
                await db.bank_transactions.update_one(
                    {"_id": tx["_id"], "company_id": tx_cid},
                    {"$set": {"linked_reversed_at": _now(), "linked_reverse_reason": reason or "reverse"}},
                )
            else:
                if _reverse_tx_effects:
                    await _reverse_tx_effects(tx, -1)
                await _soft_delete_move(
                    "bank_transactions",
                    tx,
                    "bank_transaction",
                    note=f"linked:{st}/{sid}" + (f" · {reason}" if reason else ""),
                )
            reversed_bank.append(str(tx["_id"]))
        except Exception as e:
            errors.append(f"bank:{tx.get('_id')}:{e}")
            logger.exception("reverse bank %s", tx.get("_id"))

    # 2) Partner — balance undo + soft_delete (delete mode) or compensating move
    for ptx in partner:
        try:
            if await trash.original_in_trash("partner_transactions", ptx):
                if mode != "reverse":
                    await _soft_delete_move(
                        "partner_transactions",
                        ptx,
                        "partner_transaction",
                        note=f"linked:{st}/{sid}",
                    )
                continue
            amount = float(ptx.get("amount") or 0)
            t = ptx.get("type")
            ptx_cid = str(ptx.get("company_id") or "")
            if t in partner_pay.MUTABLE_TYPES:
                inc = {k: -v for k, v in partner_pay.posting_inc(ptx).items()}
                await db.partners.update_one({"_id": ptx["partner_id"], "company_id": ptx_cid}, {"$inc": inc})
            elif t == "profit_share":
                await db.partners.update_one(
                    {"_id": ptx["partner_id"], "company_id": ptx_cid},
                    {"$inc": partner_pay.profit_share_inc(amount, bool(ptx.get("is_paid")), applying=False)},
                )
            if mode == "reverse":
                # Compensating partner entry
                opp = "capital_in" if t == "withdrawal" else ("withdrawal" if t == "capital_in" else t)
                if opp in partner_pay.MUTABLE_TYPES and opp != t:
                    await partner_pay.move(
                        db,
                        ptx.get("company_id"),
                        ptx["partner_id"],
                        amount,
                        opp,
                        f"Geri alma: {ptx.get('description') or ''}",
                        extra={**link_fields(st, sid), "reverses_ptx_id": ptx["_id"], "source": "linked_reverse"},
                    )
                await db.partner_transactions.update_one(
                    {"_id": ptx["_id"], "company_id": ptx_cid},
                    {"$set": {"linked_reversed_at": _now()}},
                )
            else:
                await _soft_delete_move(
                    "partner_transactions",
                    ptx,
                    "partner_transaction",
                    note=f"linked:{st}/{sid}",
                )
            reversed_partner.append(str(ptx["_id"]))
        except Exception as e:
            errors.append(f"partner:{ptx.get('_id')}:{e}")
            logger.exception("reverse partner %s", ptx.get("_id"))

    # 3) Loan interest expenses
    for exp in expenses:
        try:
            if mode == "delete":
                await _soft_delete_move("expenses", exp, "expense", note=f"linked:{st}/{sid}")
            else:
                exp_cid = str(exp.get("company_id") or "")
                await db.expenses.update_one(
                    {"_id": exp["_id"], "company_id": exp_cid},
                    {"$set": {"payment_status": "cancelled", "linked_reversed_at": _now()}},
                )
            reversed_exp.append(str(exp["_id"]))
        except Exception as e:
            errors.append(f"expense:{exp.get('_id')}:{e}")

    await _recalc_touched_accounts(db, bank)

    result = {
        "status": "error" if errors else "success",
        "idempotent": False,
        "reversed": len(reversed_bank) + len(reversed_partner) + len(reversed_exp),
        "bank": len(reversed_bank),
        "partner": len(reversed_partner),
        "expenses": len(reversed_exp),
        "bank_ids": reversed_bank,
        "partner_ids": reversed_partner,
        "expense_ids": reversed_exp,
        "mode": mode,
        "errors": errors,
    }
    await _audit(
        db,
        company_id=company_id,
        actor=actor,
        action="reverse",
        detail=f"{st}/{sid} → bank={result['bank']} partner={result['partner']} exp={result['expenses']}",
        extra={"reason": reason, **{k: result[k] for k in ("mode", "reversed", "errors")}},
    )
    if errors:
        # Partial apply reported; caller may decide. Prefer not raising mid-flight.
        logger.warning("reverse_linked partial errors: %s", errors)
    return result


async def restore_linked_from_related(db, related: Optional[List[dict]], actor: Optional[dict] = None) -> Dict[str, Any]:
    """Trash restore sonrası related bank/partner hareketlerinin bakiye etkisini uygula."""
    applied = 0
    bank_docs: List[dict] = []
    for block in related or []:
        coll = block.get("collection")
        for d in block.get("docs") or []:
            doc = dict(d)
            if coll == "bank_transactions":
                bank_docs.append(doc)
                if _reverse_tx_effects:
                    await _reverse_tx_effects(doc, +1)
                applied += 1
            elif coll == "partner_transactions":
                amount = float(doc.get("amount") or 0)
                t = doc.get("type")
                doc_cid = str(doc.get("company_id") or "")
                if t in partner_pay.MUTABLE_TYPES:
                    await db.partners.update_one(
                        {"_id": doc["partner_id"], "company_id": doc_cid},
                        {"$inc": partner_pay.posting_inc(doc)},
                    )
                elif t == "profit_share":
                    await db.partners.update_one(
                        {"_id": doc["partner_id"], "company_id": doc_cid},
                        {"$inc": partner_pay.profit_share_inc(amount, bool(doc.get("is_paid")), applying=True)},
                    )
                applied += 1
    if bank_docs:
        await _recalc_touched_accounts(db, bank_docs)
    await _audit(db, company_id=(bank_docs[0].get("company_id") if bank_docs else None), actor=actor, action="restore_related", detail=f"applied={applied}")
    return {"status": "success", "applied": applied}


async def collect_related_for_trash(
    db,
    source_type: str,
    source_id: str,
    company_id: Optional[str] = None,
) -> List[dict]:
    """soft_delete(..., related=) için bağlı doküman blokları."""
    found = await find_linked(db, source_type, source_id, company_id=company_id)
    related: List[dict] = []
    if found["bank_transactions"]:
        related.append({"collection": "bank_transactions", "docs": found["bank_transactions"]})
    if found["partner_transactions"]:
        related.append({"collection": "partner_transactions", "docs": found["partner_transactions"]})
    if found["expenses"]:
        related.append({"collection": "expenses", "docs": found["expenses"]})
    return related


async def undo_effects_keep_docs(db, related: List[dict]) -> None:
    """Bakiyeleri geri al; dokümanları silme (soft_delete related= ile taşınacak).

    Not: kasa sync burada YAPILMAZ — hareketler hâlâ koleksiyonda; soft_delete sonrası
    `recalc_after_trash(related)` çağırın.
    """
    for block in related or []:
        if block.get("collection") == "bank_transactions":
            for tx in block.get("docs") or []:
                if await trash.original_in_trash("bank_transactions", tx):
                    continue
                if _reverse_tx_effects:
                    await _reverse_tx_effects(tx, -1)
        elif block.get("collection") == "partner_transactions":
            for ptx in block.get("docs") or []:
                if await trash.original_in_trash("partner_transactions", ptx):
                    continue
                amount = float(ptx.get("amount") or 0)
                t = ptx.get("type")
                ptx_cid = str(ptx.get("company_id") or "")
                if t in partner_pay.MUTABLE_TYPES:
                    inc = {k: -v for k, v in partner_pay.posting_inc(ptx).items()}
                    await db.partners.update_one({"_id": ptx["partner_id"], "company_id": ptx_cid}, {"$inc": inc})
                elif t == "profit_share":
                    await db.partners.update_one(
                        {"_id": ptx["partner_id"], "company_id": ptx_cid},
                        {"$inc": partner_pay.profit_share_inc(amount, bool(ptx.get("is_paid")), applying=False)},
                    )


async def recalc_after_trash(db, related: List[dict]) -> None:
    """soft_delete sonrası kasa/cari bakiyelerini hareket toplamına kilitle."""
    bank_docs = [t for b in (related or []) if b.get("collection") == "bank_transactions" for t in (b.get("docs") or [])]
    if bank_docs:
        await _recalc_touched_accounts(db, bank_docs)


async def prepare_source_trash(
    db,
    source_type: str,
    source_id: str,
    company_id: Optional[str] = None,
) -> List[dict]:
    """Kaynak silmeden önce: bakiyeleri geri al + related listesi (soft_delete'e ver).

    Caller: soft_delete(..., related=...) sonrası `recalc_after_trash(db, related)` çağırmalı.
    """
    related = await collect_related_for_trash(db, source_type, source_id, company_id=company_id)
    if related:
        await undo_effects_keep_docs(db, related)
    return related


def source_guard_detail(tx: dict) -> Optional[str]:
    """Bağlı kaynaktan gelen hareket doğrudan silinemez/düzenlenemez."""
    if not tx:
        return None
    for field, label, path in (
        ("bonus_id", "personel prim/avans", "/personnel"),
        ("payroll_id", "bordro/maaş", "/personnel"),
        ("loan_id", "kredi", "/loans"),
        ("installment_id", "taksit", "/installments"),
        ("personnel_movement_id", "personel ödeme", "/personnel"),
    ):
        sid = tx.get(field)
        if sid:
            return f"Kaynak kayıttan geri alın ({label}). Kaynak: {path} · id={sid}"
    st = tx.get("source_type") or ""
    if st in SPECIALTY and tx.get("source_id"):
        return f"Kaynak kayıttan geri alın ({SOURCE_LABELS.get(st, st)}). id={tx.get('source_id')}"
    import cheques
    locked = cheques.cheque_ledger_lock_detail(tx)
    if locked:
        return locked
    return None


def assert_not_source_linked(tx: dict):
    detail = source_guard_detail(tx)
    if detail:
        raise HTTPException(status_code=400, detail=detail)


# Stock helpers used by delete paths
async def reverse_stock_movements_for(
    db,
    *,
    order_id: Optional[str] = None,
    work_order_id: Optional[str] = None,
    reason_prefix: str = "Geri alma",
    company_id: Optional[str] = None,
) -> int:
    """Üretim/sayım kaynaklı stok hareketlerini tersine çevir (ürün bakiyesi + karşı hareket)."""
    cid = str(company_id or "").strip()
    if not cid or not (order_id or work_order_id):
        return 0
    q: Dict[str, Any] = {"company_id": cid}
    if order_id:
        q["order_id"] = order_id
    if work_order_id:
        q["work_order_id"] = work_order_id
    moves = await db.stock_movements.find(q).to_list(5000)
    n = 0
    for m in moves:
        change = float(m.get("change") or 0)
        pid = m.get("product_id")
        mcid = str(m.get("company_id") or "")
        if not pid or not mcid or abs(change) < 1e-9:
            continue
        await db.products.update_one({"_id": pid, "company_id": mcid}, {"$inc": {"stock_quantity": -change}})
        rev = {
            "_id": str(uuid.uuid4()),
            "product_id": pid,
            "product_name": m.get("product_name"),
            "variant_id": m.get("variant_id"),
            "change": -change,
            "reason": f"{reason_prefix}: {m.get('reason') or ''}".strip(),
            "date": _now(),
            "reverses_movement_id": m.get("_id"),
            "order_id": m.get("order_id"),
            "work_order_id": m.get("work_order_id"),
        }
        rev["company_id"] = mcid
        await db.stock_movements.insert_one(rev)
        n += 1
    return n


async def reverse_applied_stock_count(db, sc: dict) -> int:
    """Tamamlanmış/uygulanmış stok sayımının etkisini geri al."""
    if not sc or not sc.get("applied"):
        return 0
    if sc.get("status") not in ("completed", "done", "closed"):
        return 0
    cid = str(sc.get("company_id") or "").strip()
    if not cid:
        return 0
    n = 0
    for i in sc.get("items") or []:
        diff = float(i.get("counted") or 0) - float(i.get("expected") or 0)
        if abs(diff) < 1e-9:
            continue
        pid = i.get("product_id")
        if not pid:
            continue
        # Applied set stock to counted; reverse → back toward expected (= -diff)
        if i.get("variant_id"):
            p = await db.products.find_one({"_id": pid, "company_id": cid})
            if p:
                variants = list(p.get("variants") or [])
                for v in variants:
                    if v.get("variant_id") == i.get("variant_id"):
                        v["stock"] = float(v.get("stock") or 0) - diff
                await db.products.update_one(
                    {"_id": pid, "company_id": cid},
                    {"$set": {"variants": variants, "stock_quantity": sum(float(v.get("stock") or 0) for v in variants)}},
                )
        else:
            await db.products.update_one(
                {"_id": pid, "company_id": cid},
                {"$inc": {"stock_quantity": -diff}},
            )
        movement = {
            "_id": str(uuid.uuid4()),
            "product_id": pid,
            "product_name": i.get("product_name"),
            "variant_id": i.get("variant_id"),
            "change": -diff,
            "reason": f"Sayım geri alma: {sc.get('name') or sc.get('_id')}",
            "date": _now(),
            "stock_count_id": sc.get("_id"),
        }
        movement["company_id"] = cid
        await db.stock_movements.insert_one(movement)
        n += 1
    return n


async def list_isnet_missing_mode(db) -> Dict[str, Any]:
    """Ortamı seçilmemiş İşNet e-fatura kayıtları. Yalnızca okur."""
    import isnet

    # tenant-ok değil: platform geneli salt okunur bakım raporu, şirketler arası tanımı gereği.
    rows = await db.einvoice_settings.find(
        {"provider": {"$in": ["isnet", "isnet_portal"]}}
    ).to_list(500)
    ids = [str(r.get("company_id") or "") for r in rows if r.get("company_id")]
    names: Dict[str, str] = {}
    if ids:
        companies = await db.companies.find({"_id": {"$in": ids}}).to_list(500)
        for company in companies:
            names[str(company.get("_id") or "")] = str(company.get("name") or "")
    items = isnet.missing_mode_settings(rows, names)
    return {
        "readonly": True,
        "count": len(items),
        "detail": isnet.MODE_REQUIRED_DETAIL,
        "items": items,
    }


async def _require_system_integrity_admin(request: Request) -> dict:
    """Platform paneli: yalnızca süper admin. /api/system zaten ynt allowlist'inde."""
    import saas
    return await saas.require_super_admin(request)


@router.get("/system/integrity/isnet-mode")
async def api_system_isnet_mode_missing(
    _admin: dict = Depends(_require_system_integrity_admin),
):
    """Süper admin: mode'u boş İşNet kayıtları. Yazma yok."""
    if _db is None:
        raise HTTPException(status_code=500, detail="linked_moves bağlanmadı.")
    return await list_isnet_missing_mode(_db)
