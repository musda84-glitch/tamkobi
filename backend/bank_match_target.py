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


async def repair_legacy_bank_match_directions(db, partner_id: Optional[str] = None, company_id: Optional[str] = None) -> int:
    """#1089 tersine çevirmesi: banka çıkışı capital_in yazılmışsa withdrawal yap.

    Eski (doğru) kural banka yönüyle aynı yazıyordu. #1089 outflow→capital_in yaptı;
    Alacaklı şişti. Doğrusu: outflow→withdrawal, inflow→capital_in.
    Tip düzeltilince sync_partner_from_ledger bakiyeyi hareketlerden yeniden kurar.

    partner_transactions company_id ile tek sorgu. Banka satırı find_one N+1 yerine
    related_bank_tx_id $in.
    """
    if partner_id and not company_id:
        try:
            company_id = await partner_pay._partner_company_id(db, partner_id)
        except Exception:
            company_id = None
    cid = str(company_id or "").strip()
    if not cid:
        return 0
    q: Dict[str, Any] = {
        "company_id": cid,
        "$or": [
            {"source": "bank_match"},
            {"related_bank_tx_id": {"$exists": True, "$nin": [None, ""]}},
        ],
    }
    if partner_id:
        q["partner_id"] = partner_id
    txs = await db.partner_transactions.find(q).to_list(20000)
    need_bank_ids = []
    for tx in txs:
        if tx.get("type") not in ("withdrawal", "capital_in"):
            continue
        if _norm_bank_tx_type(tx.get("bank_tx_type")):
            continue
        bid = tx.get("related_bank_tx_id")
        if bid:
            need_bank_ids.append(bid)
    bank_by_id: Dict[str, dict] = {}
    if need_bank_ids:
        uniq = list(dict.fromkeys(need_bank_ids))
        brows = await db.bank_transactions.find(
            {"company_id": cid, "_id": {"$in": uniq}},
            {"_id": 1, "type": 1},
        ).to_list(len(uniq))
        for row in brows or []:
            if row.get("_id"):
                bank_by_id[row["_id"]] = row
    fixed = 0
    now = datetime.now(timezone.utc).isoformat()
    for tx in txs:
        if tx.get("type") not in ("withdrawal", "capital_in"):
            continue
        bank_type = _norm_bank_tx_type(tx.get("bank_tx_type"))
        if not bank_type and tx.get("related_bank_tx_id"):
            btx = bank_by_id.get(tx["related_bank_tx_id"])
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
        await db.partner_transactions.update_one(
            {"_id": tx["_id"], "company_id": cid},
            {"$set": patch},
        )
        if "type" in patch:
            fixed += 1
    return fixed


async def _bank_ids_for_external(db, tx: dict) -> list:
    """Aynı external_id'ye bağlı banka hareketlerinin kimlikleri."""
    ids = []
    own = tx.get("_id")
    if own:
        ids.append(own)
    ext = str(tx.get("external_id") or "").strip()
    cid = str(tx.get("company_id") or "").strip()
    if not ext or not cid:
        return ids
    rows = await db.bank_transactions.find(
        {"company_id": cid, "external_id": ext},
        {"_id": 1},
    ).to_list(200)
    for row in rows or []:
        ident = row.get("_id")
        if ident and ident not in ids:
            ids.append(ident)
    return ids


async def _existing_partner_name(db, tx: dict):
    """Aynı external_id için ortak kaydı varsa adı. Yoksa None."""
    ext = str(tx.get("external_id") or "").strip()
    if not ext:
        return None
    cid = str(tx.get("company_id") or "").strip()
    if not cid:
        return None
    found = await db.partner_transactions.find_one({
        "company_id": cid,
        "external_id": ext,
        "source": "bank_match",
    })
    if not found:
        ids = await _bank_ids_for_external(db, tx)
        if ids:
            found = await db.partner_transactions.find_one({
                "company_id": cid,
                "related_bank_tx_id": {"$in": ids},
            })
    if not found:
        return None
    return str(found.get("partner_name") or "")


async def apply_partner_match(db, tx: dict, partner_id: str, amount, is_inflow: bool) -> str:
    """Banka hareketi bakiyede; ortak hesabı nakit-siz sermaye / çekiş ile güncelle.

    Aynı external_id için ikinci ortak hareketi açılmaz.
    """
    existing = await _existing_partner_name(db, tx)
    if existing is not None:
        return existing
    desc = f"{tx.get('account_name') or 'Hesap'}: {tx.get('description') or 'Banka eşleşmesi'}"
    bank_tx_type = "inflow" if is_inflow else "outflow"
    ext = str(tx.get("external_id") or "").strip()
    extra = {
        "related_bank_tx_id": tx.get("_id"),
        "source": "bank_match",
        "bank_tx_type": bank_tx_type,
    }
    if ext:
        extra["external_id"] = ext
    return await partner_pay.move(
        db,
        tx["company_id"],
        partner_id,
        float(amount or 0),
        partner_tx_type_for_bank_match(is_inflow),
        desc,
        date=tx.get("date"),
        extra=extra,
    )


async def reverse_partner_match(db, tx: dict) -> bool:
    """Banka eşleşme iptalinde ortak hareketini sil (bakiye geri alınır)."""
    ok = await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"], "source": "bank_match"})
    if ok:
        return True
    return await partner_pay.reverse_one(db, {"related_bank_tx_id": tx["_id"]})


async def clear_bank_match_status(db, bank_tx_id: Optional[str], *, company_id: str) -> bool:
    """Ortak/cari tarafı silinince banka satırını eşleşmemiş yap (bakiyeye dokunma).

    Partner tx zaten `_reverse_partner_tx` ile geri alındı; burada yalnızca
    match_status / hedef alanları temizlenir — `_unmatch` gibi tekrar reverse yok.
    """
    if not bank_tx_id or not str(company_id or "").strip():
        return False
    tx = await db.bank_transactions.find_one({"_id": bank_tx_id, "company_id": company_id})
    if not tx or tx.get("match_status") != "matched":
        return False
    is_inflow = tx.get("type") == "inflow"
    await db.bank_transactions.update_one(
        {"_id": bank_tx_id, "company_id": company_id},
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
    cid = str(partner_tx.get("company_id") or "").strip()
    if not cid:
        return None
    try:
        amount = float(partner_tx.get("amount") or 0)
    except (TypeError, ValueError):
        amount = 0.0
    q: Dict[str, Any] = {
        "company_id": cid,
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
            "company_id": cid,
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
    return await clear_bank_match_status(
        db, bank_tx_id, company_id=str((partner_tx or {}).get("company_id") or ""),
    )
