"""Kaynak kayıt (prim/bordro/kredi/taksit) ↔ kasa/banka/cari/ortak hareket bağları.

Silme / geri alma / geri getirme sırasında orphan hareket bırakmamak için
ortak link alanları, bulma, tersine çevirme ve bütünlük tarama araçları.
"""
from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any, Awaitable, Callable, Dict, List, Optional, Tuple

from fastapi import APIRouter, Depends, HTTPException, Query, Request

import account_balance
import contact_balance
import partner_pay
import rbac
import tenant_access
import trash

logger = logging.getLogger("linked_moves")

router = APIRouter(prefix="/api")

_db = None
_current_user = None
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

SOURCE_COLLECTION = {
    "personnel_bonus": "bonus_payments",
    "bonus": "bonus_payments",
    "payroll": "payrolls",
    "loan": "loans",
    "installment": "installments",
    "personnel_payment": "personnel_movements",
}

# Eski format: Personel Prim/Avans/... (Gayri Resmi)
_GAYRI_RESMI_CAT = re.compile(r"^Personel .+ \(Gayri Resmi\)$")


def init(db, reverse_tx_fn=None, get_current_user=None):
    global _db, _current_user, _reverse_tx_effects
    _db = db
    if reverse_tx_fn is not None:
        _reverse_tx_effects = reverse_tx_fn
    if get_current_user is not None:
        _current_user = get_current_user


async def _user_dep(request: Request) -> dict:
    if _current_user is None:
        raise HTTPException(status_code=500, detail="linked_moves auth bağlanmadı.")
    return await _current_user(request)


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
    # Eski bonus hareketleri source=manual + bonus_id yok; integrity heuristik ile bulunur.
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

    company_id verilirse tüm sorgular şirket kapsamındadır (çapraz kiracı sızıntısı yok).
    """
    cid = str(company_id) if company_id else None
    q = _link_query(source_type, source_id, cid)
    bank = await db.bank_transactions.find(q).to_list(500)
    partner = await db.partner_transactions.find(q).to_list(500)
    # Cari satırları ayrı koleksiyon değil — contact_id taşıyan bank hareketleri
    cari = [t for t in bank if t.get("contact_id")]
    expenses = []
    st = _norm_source_type(source_type)
    if st == "loan":
        eq: Dict[str, Any] = {"loan_id": str(source_id)}
        if cid:
            eq["company_id"] = cid
        expenses = await db.expenses.find(eq).to_list(200)
    elif st == "installment":
        eq = {"installment_id": str(source_id)}
        if cid:
            eq["company_id"] = cid
        expenses = await db.expenses.find(eq).to_list(50)
    elif st == "personnel_payment":
        eq = {"$or": [
            {"source_type": "personnel_payment", "source_id": str(source_id)},
            {"personnel_movement_id": str(source_id)},
        ]}
        if cid:
            eq = {"$and": [eq, {"company_id": cid}]}
        expenses = await db.expenses.find(eq).to_list(200)
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
    contact_ids = set()
    for tx in txs:
        for k in ("account_id", "target_account_id"):
            if tx.get(k):
                cash_ids.add(tx[k])
        for k in ("contact_id", "owner_contact_id"):
            if tx.get(k):
                contact_ids.add(tx[k])
    cash_accs = []
    for aid in cash_ids:
        acc = await db.bank_accounts.find_one({"_id": aid})
        if acc and str(acc.get("type") or "") == "cash_box":
            cash_accs.append(acc)
        elif acc:
            # Banka kartı: hareket toplamına kilitlemek riskli; sadece kasa sync.
            pass
    if cash_accs:
        await account_balance.sync_cash_box_balances(db, cash_accs)
    for cid in contact_ids:
        try:
            await contact_balance.sync_contact_balance(db, cid)
        except Exception:
            logger.exception("sync_contact_balance %s", cid)


async def _soft_delete_move(collection: str, doc: dict, entity_type: str, note: str = "") -> Optional[str]:
    label = f"{doc.get('description') or doc.get('type') or entity_type} · {float(doc.get('amount') or 0):,.2f} ₺"
    try:
        return await trash.soft_delete(collection, doc, entity_type, label, note=note)
    except Exception:
        logger.exception("soft_delete %s %s", collection, doc.get("_id"))
        # Fallback: hard delete so orphan kalmasın
        await _db[collection].delete_one({"_id": doc["_id"]})
        return None


async def _write_reverse_bank_entry(db, tx: dict, reason: str) -> dict:
    """mode=reverse: karşı hareket yaz (orijinal kalır, bağ aynı source_id)."""
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
    await db.bank_transactions.insert_one(doc)
    if _reverse_tx_effects:
        # Orijinal etkisini geri al (= reverse entry'nin etkisi)
        await _reverse_tx_effects(tx, -1)
    else:
        # Fallback: reverse entry etkisini uygula
        change = amt if rev_type == "inflow" else -amt
        if doc.get("account_id"):
            import account_balance
            posted = await account_balance.apply_balance_delta(db, doc["account_id"], change)
            if posted == "integrated":
                doc["balance_posted"] = False
                doc["match_status"] = "expected"
                await db.bank_transactions.update_one(
                    {"_id": doc["_id"]},
                    {"$set": {"balance_posted": False, "match_status": "expected"}},
                )
        if doc.get("contact_id"):
            await db.contacts.update_one({"_id": doc["contact_id"]}, {"$inc": {"balance": -change}})
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
            if mode == "reverse":
                await _write_reverse_bank_entry(db, tx, reason or "kaynak silindi")
                # Mark original so find_linked / idempotency skips double-reverse
                await db.bank_transactions.update_one(
                    {"_id": tx["_id"]},
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
            amount = float(ptx.get("amount") or 0)
            t = ptx.get("type")
            if t in partner_pay.MUTABLE_TYPES:
                inc = {k: -v for k, v in partner_pay.balance_inc(t, amount).items()}
                await db.partners.update_one({"_id": ptx["partner_id"]}, {"$inc": inc})
            elif t == "profit_share":
                await db.partners.update_one(
                    {"_id": ptx["partner_id"]},
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
                    {"_id": ptx["_id"]},
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
                await db.expenses.update_one(
                    {"_id": exp["_id"]},
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
                if t in partner_pay.MUTABLE_TYPES:
                    await db.partners.update_one({"_id": doc["partner_id"]}, {"$inc": partner_pay.balance_inc(t, amount)})
                elif t == "profit_share":
                    await db.partners.update_one(
                        {"_id": doc["partner_id"]},
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
                if _reverse_tx_effects:
                    await _reverse_tx_effects(tx, -1)
        elif block.get("collection") == "partner_transactions":
            for ptx in block.get("docs") or []:
                amount = float(ptx.get("amount") or 0)
                t = ptx.get("type")
                if t in partner_pay.MUTABLE_TYPES:
                    inc = {k: -v for k, v in partner_pay.balance_inc(t, amount).items()}
                    await db.partners.update_one({"_id": ptx["partner_id"]}, {"$inc": inc})
                elif t == "profit_share":
                    await db.partners.update_one(
                        {"_id": ptx["partner_id"]},
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
    return None


def assert_not_source_linked(tx: dict):
    detail = source_guard_detail(tx)
    if detail:
        raise HTTPException(status_code=400, detail=detail)


# ---------------- Integrity scan / cleanup ----------------

def _heuristic_bonus_match(bonus: dict, tx: dict) -> Tuple[bool, float]:
    """Eski unlinked bonus hareketi: description+amount+account+category."""
    score = 0.0
    amt_b = round(float(bonus.get("amount") or 0), 2)
    amt_t = round(float(tx.get("amount") or 0), 2)
    if abs(amt_b - amt_t) > 0.01:
        return False, 0.0
    score += 0.4
    if bonus.get("account_id") and tx.get("account_id") == bonus.get("account_id"):
        score += 0.25
    desc = (tx.get("description") or "").lower()
    ename = (bonus.get("employee_name") or "").lower()
    period = (bonus.get("period") or "").lower()
    label = (bonus.get("type_label") or bonus.get("type") or "").lower()
    if ename and ename in desc:
        score += 0.2
    if period and period in desc:
        score += 0.1
    if label and label in desc:
        score += 0.05
    cat = (tx.get("category") or "").lower()
    if "personel" in cat or "prim" in cat or "avans" in cat or "yevmiye" in cat:
        score += 0.1
    return score >= 0.55, round(min(score, 1.0), 2)


def _is_gayri_resmi_personnel_category(cat: Optional[str]) -> bool:
    return bool(_GAYRI_RESMI_CAT.match(str(cat or "").strip()))


def _bonus_desc_amount_account_match(bonus: dict, tx: dict) -> bool:
    """Canlı/çöp bonus ↔ hareket: açıklama + tutar + hesap."""
    if abs(round(float(bonus.get("amount") or 0), 2) - round(float(tx.get("amount") or 0), 2)) > 0.01:
        return False
    b_acc = bonus.get("account_id")
    t_acc = tx.get("account_id")
    if b_acc and t_acc and str(b_acc) != str(t_acc):
        return False
    if b_acc and not t_acc:
        return False
    desc = (tx.get("description") or "").strip().lower()
    ename = (bonus.get("employee_name") or "").strip()
    period = (bonus.get("period") or "").strip()
    label = (bonus.get("type_label") or bonus.get("type") or "").strip()
    expected = f"{ename} - {period} {label}".strip().lower()
    if expected and expected == desc:
        return True
    if ename and ename.lower() in desc:
        if period and period.lower() not in desc:
            return False
        return True
    return False


def _index_linked_ids(rows: List[dict], field: str) -> Dict[str, List[dict]]:
    out: Dict[str, List[dict]] = {}
    for row in rows:
        sid = row.get(field)
        if not sid and row.get("source_id"):
            st = _norm_source_type(row.get("source_type") or row.get("source") or "")
            if specialty_field(st) == field:
                sid = row.get("source_id")
        if sid:
            out.setdefault(str(sid), []).append(row)
    return out


async def scan_orphans(db, company_id: str) -> Dict[str, Any]:
    """Şirket hareketlerini tek sorguda çekip bellekte eşler (kayıt başı find_linked yok)."""
    cid = str(company_id)
    orphan_bonus_moves: List[dict] = []
    orphan_payroll_moves: List[dict] = []
    orphan_loan_moves: List[dict] = []
    orphan_personnel_payment_moves: List[dict] = []
    legacy_bonus_orphans: List[dict] = []
    paid_bonus_missing: List[dict] = []
    paid_payroll_missing: List[dict] = []
    balance_drift: List[dict] = []
    heuristic_links: List[dict] = []

    bank_txs = await db.bank_transactions.find({"company_id": cid}).to_list(20000)
    partner_txs = await db.partner_transactions.find({"company_id": cid}).to_list(20000)
    bonuses = await db.bonus_payments.find({"company_id": cid}).to_list(5000)
    payrolls = await db.payrolls.find({"company_id": cid}).to_list(5000)
    loans = await db.loans.find({"company_id": cid}).to_list(5000)
    personnel_moves = await db.personnel_movements.find({"company_id": cid}).to_list(5000)
    trash_bonus = await db.trash.find({
        "company_id": cid,
        "$or": [
            {"collection": "bonus_payments"},
            {"entity_type": "bonus"},
        ],
    }).to_list(5000)

    bonus_ids = {str(b["_id"]) for b in bonuses}
    payroll_ids = {str(p["_id"]) for p in payrolls}
    loan_ids = {str(l["_id"]) for l in loans}
    live_pp_ids = {
        str(m["_id"]) for m in personnel_moves
        if str(m.get("status") or "") not in ("reversed", "cancelled")
    }

    def _orphan_row(doc: dict, field: str, sid: str, kind: str) -> dict:
        return {
            "tx_id": doc.get("_id"),
            "field": field,
            "source_id": sid,
            "amount": doc.get("amount"),
            "description": doc.get("description"),
            "account_id": doc.get("account_id"),
            "kind": kind,
        }

    for field, id_set, bucket in (
        ("bonus_id", bonus_ids, orphan_bonus_moves),
        ("payroll_id", payroll_ids, orphan_payroll_moves),
        ("loan_id", loan_ids, orphan_loan_moves),
        ("personnel_movement_id", live_pp_ids, orphan_personnel_payment_moves),
    ):
        for tx in bank_txs:
            sid = tx.get(field)
            if not sid and field == "personnel_movement_id":
                st = _norm_source_type(tx.get("source_type") or tx.get("source") or "")
                if st == "personnel_payment":
                    sid = tx.get("source_id")
            if sid and str(sid) not in id_set:
                bucket.append(_orphan_row(tx, field, sid, "bank"))
        for ptx in partner_txs:
            sid = ptx.get(field)
            if not sid and field == "personnel_movement_id":
                st = _norm_source_type(ptx.get("source_type") or ptx.get("source") or "")
                if st == "personnel_payment":
                    sid = ptx.get("source_id")
            if sid and str(sid) not in id_set:
                bucket.append(_orphan_row(ptx, field, sid, "partner"))

    bank_by_bonus = _index_linked_ids(bank_txs, "bonus_id")
    partner_by_bonus = _index_linked_ids(partner_txs, "bonus_id")
    bank_by_payroll = _index_linked_ids(bank_txs, "payroll_id")
    partner_by_payroll = _index_linked_ids(partner_txs, "payroll_id")

    paid_bonuses = [b for b in bonuses if b.get("status") == "paid"]
    for b in paid_bonuses:
        bid = str(b["_id"])
        if bank_by_bonus.get(bid) or partner_by_bonus.get(bid):
            continue
        candidates = []
        for tx in bank_txs:
            if tx.get("type") != "outflow":
                continue
            if tx.get("bonus_id"):
                continue
            if b.get("account_id") and tx.get("account_id") != b.get("account_id"):
                continue
            ok, conf = _heuristic_bonus_match(b, tx)
            if ok:
                candidates.append({"tx_id": tx["_id"], "confidence": conf, "description": tx.get("description")})
                heuristic_links.append({
                    "bonus_id": bid,
                    "tx_id": tx["_id"],
                    "confidence": conf,
                    "amount": b.get("amount"),
                    "description": tx.get("description"),
                })
        paid_bonus_missing.append({
            "id": bid,
            "employee_name": b.get("employee_name"),
            "amount": b.get("amount"),
            "account_id": b.get("account_id"),
            "partner_id": b.get("partner_id"),
            "heuristic_candidates": candidates,
        })

    for p in payrolls:
        if p.get("status") != "paid":
            continue
        pid = str(p["_id"])
        if not bank_by_payroll.get(pid) and not partner_by_payroll.get(pid):
            paid_payroll_missing.append({
                "id": pid,
                "employee_name": p.get("employee_name"),
                "amount": p.get("final_payable") or p.get("net_salary"),
                "account_id": p.get("account_id"),
                "partner_id": p.get("partner_id"),
            })

    # Eski format: Gayri Resmi kategori, bonus_id yok, canlı bonus ile eşleşmez
    for tx in bank_txs:
        if tx.get("type") != "outflow":
            continue
        if not _is_gayri_resmi_personnel_category(tx.get("category")):
            continue
        if tx.get("bonus_id"):
            continue
        if any(_bonus_desc_amount_account_match(b, tx) for b in bonuses):
            continue
        trash_id = None
        for tr in trash_bonus:
            doc = tr.get("doc") or {}
            if _bonus_desc_amount_account_match(doc, tx):
                trash_id = tr.get("_id")
                break
        legacy_bonus_orphans.append({
            "tx_id": tx.get("_id"),
            "amount": tx.get("amount"),
            "description": tx.get("description"),
            "account_id": tx.get("account_id"),
            "category": tx.get("category"),
            "trash_id": trash_id,
            "kind": "bank",
        })

    cash_accs = await db.bank_accounts.find({"company_id": cid, "type": "cash_box"}).to_list(500)
    for acc in cash_accs:
        aid = acc["_id"]
        moved = await account_balance.recalc_account_balance(db, aid)
        stored = round(float(acc.get("current_balance") or 0), 2)
        if abs(moved - stored) >= 0.01:
            balance_drift.append({
                "account_id": aid,
                "account_name": acc.get("account_name"),
                "stored": stored,
                "from_movements": moved,
                "drift": round(moved - stored, 2),
            })

    orphan_specialty = (
        len(orphan_bonus_moves) + len(orphan_payroll_moves) + len(orphan_loan_moves)
        + len(orphan_personnel_payment_moves)
    )
    return {
        "company_id": cid,
        "orphan_bonus_moves": orphan_bonus_moves,
        "orphan_payroll_moves": orphan_payroll_moves,
        "orphan_loan_moves": orphan_loan_moves,
        "orphan_personnel_payment_moves": orphan_personnel_payment_moves,
        "legacy_bonus_orphans": legacy_bonus_orphans,
        "paid_bonus_without_moves": paid_bonus_missing,
        "paid_payroll_without_moves": paid_payroll_missing,
        "cash_balance_drift": balance_drift,
        "heuristic_bonus_links": heuristic_links,
        "summary": {
            "orphan_moves": orphan_specialty + len(legacy_bonus_orphans),
            "legacy_bonus_orphans": len(legacy_bonus_orphans),
            "paid_missing_moves": len(paid_bonus_missing) + len(paid_payroll_missing),
            "drift_accounts": len(balance_drift),
            "heuristic_links": len(heuristic_links),
        },
    }


async def _validate_cleanup_target(db, cid: str, t: dict) -> Optional[str]:
    """Kaynak doküman veya tx_id şirket dışıysa 'foreign_company' / 'tx_not_found'."""
    tx_id = t.get("tx_id")
    source_id = t.get("source_id")
    source_type = t.get("source_type")

    if tx_id and not source_id:
        tx = await db.bank_transactions.find_one({"_id": tx_id})
        if tx:
            if str(tx.get("company_id") or "") != cid:
                return "foreign_company"
            return None
        ptx = await db.partner_transactions.find_one({"_id": tx_id})
        if ptx:
            if str(ptx.get("company_id") or "") != cid:
                return "foreign_company"
            return None
        return "tx_not_found"

    if source_type and source_id:
        coll = SOURCE_COLLECTION.get(_norm_source_type(source_type))
        if coll:
            src = await db[coll].find_one({"_id": source_id})
            if src and str(src.get("company_id") or "") != cid:
                return "foreign_company"
            # Orphan kaynak yoksa: yalnızca bu şirketin hareketleri reverse edilir (find_linked company_id).
            # Çapraz şirket specialty id'si taşıyan yabancı hareketlere dokunulmaz.
        return None
    return "invalid_target"


async def cleanup_orphans(
    db,
    company_id: str,
    *,
    dry_run: bool = True,
    items: Optional[List[dict]] = None,
    actor: Optional[dict] = None,
) -> Dict[str, Any]:
    """Seçili orphan / kaynakları reverse_linked ile temizle. dry_run varsayılan True."""
    cid = str(company_id)
    report = await scan_orphans(db, cid)
    selected = items or []
    actions: List[dict] = []
    touched_bank: List[dict] = []

    def _default_targets():
        out = []
        for row in report["orphan_bonus_moves"]:
            out.append({"source_type": "personnel_bonus", "source_id": row["source_id"], "via": "orphan_move"})
        for row in report["orphan_payroll_moves"]:
            out.append({"source_type": "payroll", "source_id": row["source_id"], "via": "orphan_move"})
        for row in report["orphan_loan_moves"]:
            out.append({"source_type": "loan", "source_id": row["source_id"], "via": "orphan_move"})
        for row in report.get("orphan_personnel_payment_moves") or []:
            out.append({"source_type": "personnel_payment", "source_id": row["source_id"], "via": "orphan_move"})
        for row in report.get("legacy_bonus_orphans") or []:
            out.append({"tx_id": row["tx_id"], "via": "legacy_bonus_orphan"})
        return out

    targets = selected if selected else _default_targets()
    seen = set()
    uniq = []
    for t in targets:
        key = (t.get("source_type"), t.get("source_id"), t.get("tx_id"))
        if key in seen:
            continue
        seen.add(key)
        uniq.append(t)

    for t in uniq:
        entry = {"target": t, "dry_run": dry_run}
        skip_reason = await _validate_cleanup_target(db, cid, t)
        if skip_reason:
            entry["result"] = {"status": "skip", "reason": skip_reason}
            actions.append(entry)
            continue

        if t.get("tx_id") and not t.get("source_id"):
            tx = await db.bank_transactions.find_one({"_id": t["tx_id"], "company_id": cid})
            kind = "bank"
            if not tx:
                tx = await db.partner_transactions.find_one({"_id": t["tx_id"], "company_id": cid})
                kind = "partner"
            if not tx:
                entry["result"] = {"status": "skip", "reason": "tx_not_found"}
            elif dry_run:
                entry["result"] = {"status": "would_reverse", "amount": tx.get("amount"), "kind": kind}
            else:
                if kind == "bank":
                    if _reverse_tx_effects:
                        await _reverse_tx_effects(tx, -1)
                    await _soft_delete_move("bank_transactions", tx, "bank_transaction", note="integrity_cleanup")
                    touched_bank.append(tx)
                else:
                    amount = float(tx.get("amount") or 0)
                    ptype = tx.get("type")
                    if ptype in partner_pay.MUTABLE_TYPES:
                        inc = {k: -v for k, v in partner_pay.balance_inc(ptype, amount).items()}
                        await db.partners.update_one({"_id": tx["partner_id"]}, {"$inc": inc})
                    await _soft_delete_move("partner_transactions", tx, "partner_transaction", note="integrity_cleanup")
                entry["result"] = {"status": "reversed", "tx_id": t["tx_id"], "kind": kind}
        elif t.get("source_type") and t.get("source_id"):
            if dry_run:
                found = await find_linked(db, t["source_type"], t["source_id"], company_id=cid)
                entry["result"] = {
                    "status": "would_reverse",
                    "bank": len(found["bank_transactions"]),
                    "partner": len(found["partner_transactions"]),
                    "expenses": len(found["expenses"]),
                }
            else:
                entry["result"] = await reverse_linked(
                    db,
                    t["source_type"],
                    t["source_id"],
                    mode="delete",
                    actor=actor,
                    reason="integrity_cleanup",
                    company_id=cid,
                )
        else:
            entry["result"] = {"status": "skip", "reason": "invalid_target"}
        actions.append(entry)

    if touched_bank and not dry_run:
        await _recalc_touched_accounts(db, touched_bank)

    drift_fixes = []
    for d in report["cash_balance_drift"]:
        if dry_run:
            drift_fixes.append({**d, "action": "would_sync"})
        else:
            acc = await db.bank_accounts.find_one({"_id": d["account_id"], "company_id": cid})
            if acc:
                await account_balance.sync_cash_box_balances(db, [acc])
                drift_fixes.append({**d, "action": "synced", "new_balance": d["from_movements"]})

    await _audit(
        db,
        company_id=cid,
        actor=actor,
        action="integrity_cleanup",
        detail=f"dry_run={dry_run} actions={len(actions)} drift={len(drift_fixes)}",
        extra={"dry_run": dry_run, "action_count": len(actions)},
    )
    return {
        "company_id": cid,
        "dry_run": dry_run,
        "scan_summary": report["summary"],
        "actions": actions,
        "drift_fixes": drift_fixes,
    }


def _require_integrity_access(user: dict, company_id: str):
    """SA tüm şirketler; şirket admin yalnızca kendi şirketi."""
    if user.get("is_super_admin"):
        return
    if not tenant_access.user_may_access_company(user, company_id):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    role = rbac.normalize_role_code(user.get("role"))
    if role != "admin":
        raise HTTPException(status_code=403, detail="Bu işlem için şirket yöneticisi olmalısınız.")


@router.get("/admin/integrity/orphans")
async def api_integrity_orphans(
    company_id: str = Query(...),
    user: dict = Depends(_user_dep),
):
    _require_integrity_access(user, company_id)
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return await scan_orphans(_db, company_id)


@router.post("/admin/integrity/cleanup")
async def api_integrity_cleanup(req: Dict[str, Any], user: dict = Depends(_user_dep)):
    company_id = str(req.get("company_id") or "").strip()
    if not company_id:
        raise HTTPException(status_code=400, detail="company_id gerekli.")
    _require_integrity_access(user, company_id)
    if not await _db.companies.find_one({"_id": company_id}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    dry_run = req.get("dry_run", True)
    if dry_run is None:
        dry_run = True
    return await cleanup_orphans(
        _db,
        company_id,
        dry_run=bool(dry_run),
        items=req.get("items") or req.get("targets"),
        actor=user,
    )


async def _require_system_integrity_admin(request: Request) -> dict:
    """Platform paneli: yalnızca süper admin. /api/system zaten ynt allowlist'inde."""
    import saas
    return await saas.require_super_admin(request)


async def _system_company_or_404(company_id: str) -> str:
    cid = str(company_id or "").strip()
    if not cid:
        raise HTTPException(status_code=400, detail="company_id gerekli.")
    if _db is None:
        raise HTTPException(status_code=500, detail="linked_moves bağlanmadı.")
    if not await _db.companies.find_one({"_id": cid}):
        raise HTTPException(status_code=404, detail="Şirket bulunamadı.")
    return cid


def _cleanup_dry_run(req: Dict[str, Any]) -> bool:
    dry_run = req.get("dry_run", True)
    if dry_run is None:
        dry_run = True
    return bool(dry_run)


@router.get("/system/integrity/orphans")
async def api_system_integrity_orphans(
    company_id: str = Query(...),
    _admin: dict = Depends(_require_system_integrity_admin),
):
    cid = await _system_company_or_404(company_id)
    return await scan_orphans(_db, cid)


@router.post("/system/integrity/cleanup")
async def api_system_integrity_cleanup(
    req: Dict[str, Any],
    admin: dict = Depends(_require_system_integrity_admin),
):
    cid = await _system_company_or_404(str(req.get("company_id") or ""))
    return await cleanup_orphans(
        _db,
        cid,
        dry_run=_cleanup_dry_run(req),
        items=req.get("items") or req.get("targets"),
        actor=admin,
    )


# Stock helpers used by delete paths
async def reverse_stock_movements_for(db, *, order_id: Optional[str] = None, work_order_id: Optional[str] = None, reason_prefix: str = "Geri alma") -> int:
    """Üretim/sayım kaynaklı stok hareketlerini tersine çevir (ürün bakiyesi + karşı hareket)."""
    q: Dict[str, Any] = {}
    if order_id:
        q["order_id"] = order_id
    if work_order_id:
        q["work_order_id"] = work_order_id
    if not q:
        return 0
    moves = await db.stock_movements.find(q).to_list(5000)
    n = 0
    for m in moves:
        change = float(m.get("change") or 0)
        pid = m.get("product_id")
        if not pid or abs(change) < 1e-9:
            continue
        await db.products.update_one({"_id": pid}, {"$inc": {"stock_quantity": -change}})
        await db.stock_movements.insert_one({
            "_id": str(uuid.uuid4()),
            "company_id": m.get("company_id"),
            "product_id": pid,
            "product_name": m.get("product_name"),
            "variant_id": m.get("variant_id"),
            "change": -change,
            "reason": f"{reason_prefix}: {m.get('reason') or ''}".strip(),
            "date": _now(),
            "reverses_movement_id": m.get("_id"),
            "order_id": m.get("order_id"),
            "work_order_id": m.get("work_order_id"),
        })
        n += 1
    return n


async def reverse_applied_stock_count(db, sc: dict) -> int:
    """Tamamlanmış/uygulanmış stok sayımının etkisini geri al."""
    if not sc or not sc.get("applied"):
        return 0
    if sc.get("status") not in ("completed", "done", "closed"):
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
            p = await db.products.find_one({"_id": pid})
            if p:
                variants = list(p.get("variants") or [])
                for v in variants:
                    if v.get("variant_id") == i.get("variant_id"):
                        v["stock"] = float(v.get("stock") or 0) - diff
                await db.products.update_one(
                    {"_id": pid},
                    {"$set": {"variants": variants, "stock_quantity": sum(float(v.get("stock") or 0) for v in variants)}},
                )
        else:
            await db.products.update_one({"_id": pid}, {"$inc": {"stock_quantity": -diff}})
        await db.stock_movements.insert_one({
            "_id": str(uuid.uuid4()),
            "product_id": pid,
            "product_name": i.get("product_name"),
            "variant_id": i.get("variant_id"),
            "change": -diff,
            "reason": f"Sayım geri alma: {sc.get('name') or sc.get('_id')}",
            "date": _now(),
            "stock_count_id": sc.get("_id"),
        })
        n += 1
    return n
