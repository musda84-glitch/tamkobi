"""Kasa / banka bakiyesini hareketlerden hesaplar (açılış + kayma onarımı)."""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _is_pool_account(account: Optional[dict]) -> bool:
    return bool(account and account.get("type") == "credit_card" and account.get("is_customer_card_pool"))


def card_statement_signed_amount(tx: dict) -> Optional[float]:
    """Kredi kartı ekstre satırı (source=card_statement) bakiye kuralı.

    Ekstre satırı hesaba $inc yazılmaz; görünen borç ekstre kapanışıdır
    (current_balance = −total_debt). Bu satırlar hareket toplamına girmez (0).
    Banka ekstresi (bank_statement) bu kurala girmez; normal giriş/çıkış sayılır.
    Fark salt-okuma mutabakat raporunda görünür, otomatik düzeltilmez.
    """
    if not isinstance(tx, dict):
        return None
    if str(tx.get("source") or "") != "card_statement":
        return None
    return 0.0


def skips_account_balance(tx: dict, account: Optional[dict] = None, account_id: str = "") -> bool:
    """Hesap $inc yazılmayan satır. tx_signed_amount ve _reverse_tx_effects aynı kapıyı kullanır."""
    if not isinstance(tx, dict):
        return True
    if _is_pool_account(account):
        return True
    status = str(tx.get("status") or "").lower()
    if status in ("cancelled", "canceled", "void"):
        return True
    source = str(tx.get("source") or "")
    if source in ("ledger", "marketplace_settlement_expected", "card_statement"):
        return True
    if tx.get("balance_posted") is False:
        return True
    aid = str(account_id or "")
    if tx.get("customer_card_pool_ledger") and (
        str(tx.get("account_id") or "") == aid or str(tx.get("customer_card_account_id") or "") == aid
    ):
        return True
    if (
        tx.get("via_customer_card")
        and tx.get("account_id")
        and str(tx.get("account_id")) == str(tx.get("customer_card_account_id") or "")
        and str(tx.get("account_id")) == aid
    ):
        return True
    return False


def tx_signed_amount(tx: dict, account_id: str, account: Optional[dict] = None) -> float:
    """Hesaba etki: giriş +, çıkış −.

    `_reverse_tx_effects` (sign=+1) ile aynı hesap: source==ledger,
    customer_card_pool_ledger, via_customer_card + customer_card_account_id
    ve müşteri kart havuzu → 0. Transfer kaynak − / hedef +.
    İptal (status=cancelled) ve bakiyeye yazılmayan pazaryeri beklenen-eşleşme
    satırı da 0'dır. Kredi kartı ekstre satırı (card_statement) 0'dır.
    POS iptali karşı outflow (source=pos_cancel) normal çıkıştır.
    """
    if skips_account_balance(tx, account, account_id):
        return 0.0
    aid = str(account_id or "")
    amt = _num(tx.get("amount"))
    kind = str(tx.get("type") or "")
    if kind == "transfer":
        if str(tx.get("account_id") or "") == aid:
            return -amt
        if str(tx.get("target_account_id") or "") == aid:
            return amt
        return 0.0
    if str(tx.get("account_id") or "") != aid:
        return 0.0
    if kind == "inflow":
        return amt
    if kind == "outflow":
        return -amt
    return 0.0


def movement_balance(txs: Iterable[dict], account_id: str, account: Optional[dict] = None) -> float:
    if _is_pool_account(account):
        return 0.0
    return round(sum(tx_signed_amount(t, account_id, account) for t in txs or []), 2)


def annotate_bank_tx(tx: dict, account_id: Optional[str] = None, account: Optional[dict] = None) -> dict:
    """Liste satırına bakiyenin bu hesaptaki işaretini ekler."""
    row = dict(tx or {})
    aid = str(account_id or row.get("account_id") or "")
    delta = tx_signed_amount(row, aid, account)
    row["balance_delta"] = delta
    if delta > 0:
        row["side"] = "in"
    elif delta < 0:
        row["side"] = "out"
    else:
        row["side"] = "zero"
    return row


def pos_cancel_outflow_doc(tx: dict, *, now_iso: str, today: str) -> Optional[Dict[str, Any]]:
    """POS satış inflow'unun karşı çıkışı. Orijinal kalır; kasa senkronu iptali geri almaz."""
    if not isinstance(tx, dict):
        return None
    if str(tx.get("type") or "") != "inflow":
        return None
    if not tx.get("account_id") or not tx.get("_id"):
        return None
    amt = round(abs(_num(tx.get("amount"))), 2)
    if amt < 0.009:
        return None
    return {
        "_id": str(uuid.uuid4()),
        "company_id": tx.get("company_id"),
        "account_id": tx.get("account_id"),
        "account_name": tx.get("account_name"),
        "type": "outflow",
        "category": "POS satış iptali",
        "amount": amt,
        "currency": tx.get("currency") or "TRY",
        "description": f"POS satış iptali: {tx.get('description') or ''}".strip(),
        "source": "pos_cancel",
        "related_bank_tx_id": tx.get("_id"),
        "invoice_id": tx.get("invoice_id"),
        "date": today,
        "created_at": now_iso,
    }


async def account_is_integrated(db, account_id: str) -> bool:
    """Bağlantı kaydı gerçek bir dict ise entegre. Eksik koleksiyon / sahte mock → değil."""
    if not account_id or db is None:
        return False
    try:
        import bank_guard
        conn = await bank_guard.get_connection_for_account(db, account_id)
    except Exception:
        return False
    return isinstance(conn, dict) and bool(conn.get("linked_account_id") or conn.get("_id"))


async def apply_balance_delta(db, account_id: str, delta: float) -> str:
    """Entegre hesapta bakiye yazılmaz ('integrated'). Diğerlerinde $inc ('posted')."""
    if not account_id or abs(_num(delta)) < 0.0000001:
        return "skipped"
    if await account_is_integrated(db, account_id):
        return "integrated"
    await db.bank_accounts.update_one({"_id": account_id}, {"$inc": {"current_balance": float(delta)}})
    return "posted"


# Bakiye işareti için yeterli alanlar. Tam belge (ekstre metni vb.) çekilmez.
# _id kasa→kasa virmanın iki sorguda tekilleştirilmesi için durur.
BANK_TX_BALANCE_PROJECTION = {
    "_id": 1,
    "company_id": 1,
    "account_id": 1,
    "target_account_id": 1,
    "amount": 1,
    "type": 1,
    "status": 1,
    "source": 1,
    "balance_posted": 1,
    "customer_card_pool_ledger": 1,
    "customer_card_account_id": 1,
    "via_customer_card": 1,
}
# Sorgu başına tavan (eski hesap başına 20_000). company_id başka şirketi okumaz.
COMPANY_TX_LIMIT = 20000


def group_txs_by_account(txs: Iterable[dict]) -> Dict[str, List[dict]]:
    """account_id ve target_account_id kovaları. Aynı hareket iki hesaba birer kez girer."""
    grouped: Dict[str, List[dict]] = {}
    for tx in txs or []:
        if not isinstance(tx, dict):
            continue
        seen = set()
        for key in ("account_id", "target_account_id"):
            aid = tx.get(key)
            if not aid:
                continue
            sid = str(aid)
            if sid in seen:
                continue
            seen.add(sid)
            grouped.setdefault(sid, []).append(tx)
    return grouped


async def fetch_company_bank_txs(db, company_id: str) -> List[dict]:
    """Şirketin banka hareketleri, tek company_id sorgusu (indeks). $or yok.

    Mutabakat (?with_drift=1) tüm hesapların defterini bu yolla okur.
    Kasa bakiyesi bunu kullanmaz; fetch_cash_box_txs yeter.
    """
    if not company_id:
        return []
    cursor = db.bank_transactions.find({"company_id": company_id}, BANK_TX_BALANCE_PROJECTION)
    return await cursor.to_list(COMPANY_TX_LIMIT)


def _cash_box_ids(accounts: Iterable[dict]) -> List[str]:
    ids: List[str] = []
    seen = set()
    for acc in accounts or []:
        if str((acc or {}).get("type") or "") != "cash_box":
            continue
        aid = str((acc or {}).get("_id") or (acc or {}).get("id") or "")
        if not aid or aid in seen:
            continue
        seen.add(aid)
        ids.append(aid)
    return ids


def _dedupe_txs(rows: Iterable[dict], merged: Dict[str, dict], order: List[str], anon: List[int]) -> None:
    """Aynı _id iki sorguda (kasa→kasa virman) bir kez kalır."""
    for tx in rows or []:
        if not isinstance(tx, dict):
            continue
        raw = tx.get("_id")
        if raw is None or raw == "":
            anon[0] += 1
            key = f"__anon_{anon[0]}"
        else:
            key = str(raw)
        if key in merged:
            continue
        merged[key] = tx
        order.append(key)


async def fetch_cash_box_txs(db, company_id: str, cash_ids: Iterable[str]) -> List[dict]:
    """Kasa bakiyesi: yalnız kasa hesaplarına değen hareketler.

    İki sorgu, $or yok: account_id IN (kasa id'leri) ve target_account_id IN (kasa id'leri).
    company_id her iki sorgudadır; başka şirketin hareketi okunmaz.
    Sonuç _id ile tekilleştirilir. skips_account_balance burada uygulanmaz;
    movement_balance aynı kurallarla işaretler (iptal, havuz, ekstre, ledger).
    """
    ids = []
    seen = set()
    for raw in cash_ids or []:
        sid = str(raw or "")
        if not sid or sid in seen:
            continue
        seen.add(sid)
        ids.append(sid)
    cid = str(company_id or "")
    if not cid or not ids:
        return []
    merged: Dict[str, dict] = {}
    order: List[str] = []
    anon = [0]
    for field in ("account_id", "target_account_id"):
        cursor = db.bank_transactions.find(
            {"company_id": cid, field: {"$in": ids}},
            BANK_TX_BALANCE_PROJECTION,
        )
        rows = await cursor.to_list(COMPANY_TX_LIMIT)
        _dedupe_txs(rows, merged, order, anon)
    return [merged[key] for key in order]


async def _lookup_company_id(db, account_id: str) -> str:
    if not account_id:
        return ""
    try:
        doc = await db.bank_accounts.find_one({"_id": account_id}, {"company_id": 1})
    except TypeError:
        try:
            doc = await db.bank_accounts.find_one({"_id": account_id})
        except Exception:
            return ""
    except Exception:
        return ""
    if isinstance(doc, dict) and doc.get("company_id"):
        return str(doc["company_id"])
    return ""


async def fetch_account_txs(db, account_id: str, company_id: Optional[str] = None) -> List[dict]:
    """Hesabın hareketleri. Sorgu company_id ile tek sefer; gruplama Python'da.

    $or (account_id | target_account_id) tüm şirketleri tarardı. company_id
    verilmezse hesaptan bir kez okunur; kasa senkronu bu yolu kullanmaz.
    """
    cid = str(company_id or "")
    if not cid:
        cid = await _lookup_company_id(db, account_id)
    if not cid:
        return []
    grouped = group_txs_by_account(await fetch_company_bank_txs(db, cid))
    return list(grouped.get(str(account_id), []))


async def recalc_account_balance(db, account_id: str, account: Optional[dict] = None) -> float:
    acc = account if isinstance(account, dict) else None
    if acc is None:
        try:
            found = await db.bank_accounts.find_one({"_id": account_id})
        except Exception:
            found = None
        acc = found if isinstance(found, dict) else None
    if _is_pool_account(acc):
        return 0.0
    txs = await fetch_account_txs(db, account_id, company_id=(acc or {}).get("company_id"))
    return movement_balance(txs, account_id, acc)


def apply_drift_fields(accounts: List[dict], grouped: Dict[str, List[dict]]) -> List[dict]:
    """ledger_balance / balance_drift / bank_balance_drift. Yazma yok."""
    for acc in accounts or []:
        aid = str(acc.get("id") or acc.get("_id") or "")
        if not aid:
            continue
        moved = movement_balance(grouped.get(aid, []), aid, acc)
        shown = round(_num(acc.get("current_balance")), 2)
        acc["ledger_balance"] = moved
        acc["balance_drift"] = (not _is_pool_account(acc)) and abs(shown - moved) >= 0.01
        reported = acc.get("bank_reported_balance")
        if reported is None:
            acc["bank_balance_drift"] = False
        else:
            acc["bank_balance_drift"] = abs(round(_num(reported), 2) - moved) >= 0.01
    return accounts


async def annotate_listed_accounts(db, company_id: str, accounts: List[dict], txs: Optional[List[dict]] = None) -> List[dict]:
    """Drift alanları. txs verilirse ikinci bank_transactions sorgusu açılmaz."""
    if txs is None:
        try:
            txs = await fetch_company_bank_txs(db, company_id)
        except Exception:
            return accounts
    return apply_drift_fields(accounts, group_txs_by_account(txs))


OPENING_ACCOUNT_TYPES = frozenset({"cash_box", "bank", "pos", "okc_pos", "credit_card"})


def opening_eligible(acc: Optional[dict]) -> bool:
    """Kasa, banka, POS, ÖKC ve şirket kredi kartı. Müşteri kart havuzu hariç."""
    if not isinstance(acc, dict):
        return False
    if _is_pool_account(acc):
        return False
    return str(acc.get("type") or "") in OPENING_ACCOUNT_TYPES


def opening_tx_doc(
    acc: dict,
    amount: float,
    *,
    on_date: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    amt = round(_num(amount), 2)
    if abs(amt) < 0.009:
        return None
    day = str(on_date or "")[:10]
    if len(day) != 10 or day[4] != "-" or day[7] != "-":
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    text = str(description or "").strip()
    return {
        "_id": str(uuid.uuid4()),
        "company_id": acc.get("company_id"),
        "account_id": acc.get("_id") or acc.get("id"),
        "account_name": acc.get("account_name") or acc.get("bank_name"),
        "type": "inflow" if amt > 0 else "outflow",
        "category": "Açılış bakiyesi",
        "amount": abs(amt),
        "currency": acc.get("currency") or "TRY",
        "description": text[:240] if text else "Hesap açılış bakiyesi",
        "source": "opening",
        "date": day,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def earliest_tx_day(txs: Iterable[dict]) -> Optional[str]:
    days: List[str] = []
    for tx in txs or []:
        raw = str((tx or {}).get("date") or "")[:10]
        if len(raw) == 10 and raw[4] == "-" and raw[7] == "-":
            days.append(raw)
    return min(days) if days else None


def day_before(iso_day: str) -> str:
    raw = str(iso_day or "")[:10]
    try:
        day = datetime.strptime(raw, "%Y-%m-%d").date()
    except ValueError:
        return datetime.now(timezone.utc).strftime("%Y-%m-%d")
    return (day - timedelta(days=1)).isoformat()


async def ensure_opening_tx(db, acc: dict, *, on_date: Optional[str] = None) -> Optional[dict]:
    """Yeni hesapta current_balance varsa deftere açılış hareketi yaz (bakiye zaten set, $inc yok)."""
    doc = opening_tx_doc(acc, acc.get("current_balance"), on_date=on_date)
    if not doc:
        return None
    await db.bank_transactions.insert_one(doc)
    return doc


async def rewrite_opening_tx(
    db,
    acc: dict,
    amount: float,
    *,
    on_date: Optional[str] = None,
    description: Optional[str] = None,
) -> Optional[dict]:
    """Eski source=opening satırlarını siler; tutar ≠ 0 ise yenisini yazar. Bakiye $inc yok."""
    aid = str((acc or {}).get("_id") or (acc or {}).get("id") or "")
    if aid:
        await db.bank_transactions.delete_many({"account_id": aid, "source": "opening"})
    stamped = dict(acc or {})
    if aid:
        stamped["_id"] = aid
    doc = opening_tx_doc(stamped, amount, on_date=on_date, description=description)
    if not doc:
        return None
    await db.bank_transactions.insert_one(doc)
    return doc


async def _company_id_for_accounts(db, accounts: List[dict]) -> str:
    for acc in accounts or []:
        if acc.get("company_id"):
            return str(acc["company_id"])
    for acc in accounts or []:
        aid = acc.get("_id") or acc.get("id")
        cid = await _lookup_company_id(db, str(aid or ""))
        if cid:
            return cid
    return ""


async def sync_cash_box_balances(
    db,
    accounts: List[dict],
    txs: Optional[List[dict]] = None,
    *,
    persist: bool = True,
) -> List[dict]:
    """Kasa kartı bakiyesi = hareket toplamı.

    txs yoksa yalnız kasa id'leri: account_id IN + target_account_id IN.
    txs verilirse (with_drift liste ucu) paylaşılan şirket yüklemesi kullanılır;
    ikinci bank_transactions sorgusu açılmaz. persist=False salt okur.
    """
    cash = []
    for acc in accounts or []:
        if str(acc.get("type") or "") != "cash_box":
            continue
        if not (acc.get("_id") or acc.get("id")):
            continue
        cash.append(acc)
    if not cash:
        return accounts
    if txs is None:
        company_id = await _company_id_for_accounts(db, accounts)
        txs = await fetch_cash_box_txs(db, company_id, _cash_box_ids(cash)) if company_id else []
    grouped = group_txs_by_account(txs)
    for acc in cash:
        aid = str(acc.get("_id") or acc.get("id"))
        moved = movement_balance(grouped.get(aid, []), aid, acc)
        stored = round(_num(acc.get("current_balance")), 2)
        if abs(moved - stored) >= 0.01:
            acc["current_balance"] = moved
            if persist:
                await db.bank_accounts.update_one({"_id": aid}, {"$set": {"current_balance": moved}})
    return accounts


# Kayıtlı bakiye onarımı. Kredi kartı opening_eligible içinde kalır; bu küme onu içermez.
RECALC_BALANCE_TYPES = frozenset({"bank", "pos", "okc_pos", "cash_box"})


def recalc_balance_eligible(account: Optional[dict]) -> bool:
    """bank / pos / okc_pos / cash_box. Müşteri kartı havuzu ve kredi kartı hariç."""
    if not isinstance(account, dict):
        return False
    if _is_pool_account(account) or account.get("is_customer_card_pool"):
        return False
    return str(account.get("type") or "") in RECALC_BALANCE_TYPES


async def fetch_balance_txs(db, company_id: str, account_ids: Iterable[str]) -> List[dict]:
    """Seçilen hesaplara değen hareketler. Formül değildir; movement_balance işaretler.

    Sorgu fetch_cash_box_txs ile aynıdır (company_id + account_id/target IN, tekilleştirme).
    """
    return await fetch_cash_box_txs(db, company_id, account_ids)


def recalc_balance_row(account: dict, txs: Iterable[dict], *, integrated: bool = False) -> dict:
    """stored = current_balance, ledger = movement_balance, diff = ledger − stored."""
    aid = str((account or {}).get("_id") or (account or {}).get("id") or "")
    stored = round(_num((account or {}).get("current_balance")), 2)
    rows = [tx for tx in (txs or []) if isinstance(tx, dict)]
    ledger = movement_balance(rows, aid, account)
    row = {
        "id": aid,
        "name": (account or {}).get("account_name") or (account or {}).get("bank_name") or aid,
        "type": str((account or {}).get("type") or ""),
        "stored": stored,
        "ledger": ledger,
        "diff": round(ledger - stored, 2),
        "movement_count": len(rows),
        "integrated": bool(integrated),
    }
    reported = (account or {}).get("bank_reported_balance")
    if integrated and reported is not None:
        row["bank_reported_balance"] = round(_num(reported), 2)
    return row
