"""Banka eşleşmesinde kasa/hesap veya Ortaklar Hesabı hedefi."""
from datetime import datetime, timezone
from typing import Any, Dict, Optional, Tuple

import partner_pay


def parse_match_target(value: Optional[str]) -> Tuple[str, str]:
    raw = str(value or "").strip()
    if raw.startswith("partner:"):
        return "partner", raw[8:]
    return "account", raw


def stored_match_target(kind: str, eid: str) -> str:
    return f"partner:{eid}" if kind == "partner" else eid


def partner_tx_type_for_bank_match(is_inflow: bool) -> str:
    """Bakiye etkisi (artı = şirket ortağa borçlu / Alacaklı):
    banka girişi → ortak sermaye (capital_in, Alacaklı ↑);
    banka çıkışı → ortak çekiş (withdrawal, Alacaklı ↓).

    İşlem sütunu Giriş/Çıkış etiketi bundan ayrı olabilir (UI: banka çıkışı → Giriş).
    """
    return "capital_in" if is_inflow else "withdrawal"


def _norm_bank_tx_type(raw: Any) -> str:
    t = str(raw or "").strip().lower()
    if t in ("outflow", "debit"):
        return "outflow"
    if t in ("inflow", "credit"):
        return "inflow"
    return ""


async def repair_legacy_bank_match_directions(db, partner_id: Optional[str] = None) -> int:
    """#1089 tersine çevirmesi: banka çıkışı capital_in yazılmışsa withdrawal yap.

    Eski (doğru) kural banka yönüyle aynı yazıyordu. #1089 outflow→capital_in yaptı;
    Alacaklı şişti. Doğrusu: outflow→withdrawal, inflow→capital_in.
    Tip düzeltilince sync_partner_from_ledger bakiyeyi hareketlerden yeniden kurar.
    """
    q: Dict[str, Any] = {
        "$or": [
            {"source": "bank_match"},
            {"related_bank_tx_id": {"$exists": True, "$nin": [None, ""]}},
        ]
    }
    if partner_id:
        q = {"$and": [q, {"partner_id": partner_id}]}
    txs = await db.partner_transactions.find(q).to_list(20000)
    fixed = 0
    now = datetime.now(timezone.utc).isoformat()
    for tx in txs:
        if tx.get("type") not in ("withdrawal", "capital_in"):
            continue
        bank_type = _norm_bank_tx_type(tx.get("bank_tx_type"))
        if not bank_type and tx.get("related_bank_tx_id"):
            btx = await db.bank_transactions.find_one({"_id": tx["related_bank_tx_id"]})
            bank_type = _norm_bank_tx_type((btx or {}).get("type"))
        if not bank_type:
            continue
        want = partner_tx_type_for_bank_match(bank_type == "inflow")
        patch: Dict[str, Any] = {}
        if tx.get("bank_tx_type") != bank_type:
            patch["bank_tx_type"] = bank_type
        if tx.get("source") != "bank_match":
            patch["source"] = "bank_match"
        if tx.get("type") != want:
            patch["type"] = want
            patch["legacy_bank_match_repaired_at"] = now
            # #1089 yanlış onarımını işaretle (tekrar ters çevrilmesin diye tip zaten want)
            if tx.get("type") == "capital_in" and want == "withdrawal":
                patch["legacy_bank_match_outflow_credit_undone_at"] = now
        if not patch:
            continue
        await db.partner_transactions.update_one({"_id": tx["_id"]}, {"$set": patch})
        if "type" in patch:
            fixed += 1
    return fixed


async def apply_partner_match(db, tx: dict, partner_id: str, amount, is_inflow: bool) -> str:
    """Banka hareketi bakiyede; ortak hesabı nakit-siz sermaye / çekiş ile güncelle."""
    desc = f"{tx.get('account_name') or 'Hesap'}: {tx.get('description') or 'Banka eşleşmesi'}"
    bank_tx_type = "inflow" if is_inflow else "outflow"
    return await partner_pay.move(
        db,
        tx["company_id"],
        partner_id,
        float(amount or 0),
        partner_tx_type_for_bank_match(is_inflow),
        desc,
        date=tx.get("date"),
        extra={
            "related_bank_tx_id": tx.get("_id"),
            "source": "bank_match",
            "bank_tx_type": bank_tx_type,
        },
    )


async def reverse_partner_match(db, tx: dict) -> bool:
    """Banka eşleşme iptalinde ortak hareketini sil (bakiye geri alınır)."""
    ok = await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"], "source": "bank_match"})
    if ok:
        return True
    return await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"]})


async def clear_bank_match_status(db, bank_tx_id: Optional[str]) -> bool:
    """Ortak/cari tarafı silinince banka satırını eşleşmemiş yap (bakiyeye dokunma).

    Partner tx zaten `_reverse_partner_tx` ile geri alındı; burada yalnızca
    match_status / hedef alanları temizlenir — `_unmatch` gibi tekrar reverse yok.
    """
    if not bank_tx_id:
        return False
    tx = await db.bank_transactions.find_one({"_id": bank_tx_id})
    if not tx or tx.get("match_status") != "matched":
        return False
    is_inflow = tx.get("type") == "inflow"
    await db.bank_transactions.update_one(
        {"_id": bank_tx_id},
        {
            "$set": {
                "match_status": "unmatched",
                "category": "Banka Gelen Havale/EFT" if is_inflow else "Banka Giden Ödeme",
            },
            "$unset": {
                "contact_id": "",
                "contact_name": "",
                "related_invoice_id": "",
                "related_invoice_number": "",
                "target_account_id": "",
                "target_account_name": "",
                "matched_via": "",
                "matched_at": "",
                "matched_by_id": "",
                "matched_by_name": "",
            },
        },
    )
    return True


async def resolve_bank_tx_id_for_partner_tx(db, partner_tx: dict) -> Optional[str]:
    """Ortak hareketinden bağlı banka eşleşme satırının id'sini bul."""
    if not partner_tx:
        return None
    bank_tx_id = partner_tx.get("related_bank_tx_id")
    if bank_tx_id:
        return str(bank_tx_id)
    partner_id = partner_tx.get("partner_id")
    if not partner_id:
        return None
    try:
        amount = float(partner_tx.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    q: Dict[str, Any] = {
        "match_status": "matched",
        "target_account_id": stored_match_target("partner", partner_id),
    }
    if amount:
        q["amount"] = amount
    if partner_tx.get("date"):
        q["date"] = partner_tx["date"]
    btx = await db.bank_transactions.find_one(q)
    if btx:
        return btx.get("_id")
    # Son çare: tutar+hedef (tarih farklı yazılmış olabilir)
    if amount:
        btx = await db.bank_transactions.find_one({
            "match_status": "matched",
            "target_account_id": stored_match_target("partner", partner_id),
            "amount": amount,
        })
        if btx:
            return btx.get("_id")
    return None


async def clear_bank_match_for_partner_tx(db, partner_tx: dict) -> bool:
    """Ortak hareketi silinirken banka eşleşmesini iptal et (satır bekleyenlere düşer)."""
    bank_tx_id = await resolve_bank_tx_id_for_partner_tx(db, partner_tx)
    if not bank_tx_id:
        return False
    return await clear_bank_match_status(db, bank_tx_id)
