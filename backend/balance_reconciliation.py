"""Salt-okuma bakiye mutabakatı. Hiçbir koleksiyona yazmaz."""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

import account_balance
import account_label
import contact_balance
import partner_pay


def _num(v: Any) -> float:
    try:
        return float(v or 0)
    except (TypeError, ValueError):
        return 0.0


def _rid(doc: dict) -> str:
    return str((doc or {}).get("_id") or (doc or {}).get("id") or "")


def _unmatched_bank_sync(txs: List[dict], aid: str) -> List[dict]:
    rows = []
    for tx in txs or []:
        if str(tx.get("source") or "") != "bank_sync":
            continue
        if str(tx.get("match_status") or "") != "unmatched":
            continue
        if str(tx.get("account_id") or "") != aid:
            continue
        rows.append(tx)
    return rows


def _has_opening(txs: List[dict], aid: str) -> bool:
    return any(
        str(tx.get("source") or "") == "opening" and str(tx.get("account_id") or "") == aid
        for tx in txs or []
    )


def _account_row(acc: dict, txs: List[dict], *, integrated: bool) -> Dict[str, Any]:
    aid = _rid(acc)
    moved = account_balance.movement_balance(txs, aid, acc)
    shown = round(_num(acc.get("current_balance")), 2)
    if acc.get("is_customer_card_pool"):
        shown = 0.0
        moved = 0.0
    reported = acc.get("bank_reported_balance")
    reported_n = None if reported is None else round(_num(reported), 2)
    unmatched = _unmatched_bank_sync(txs, aid)
    unmatched_sum = round(sum(account_balance.tx_signed_amount(tx, aid, acc) for tx in unmatched), 2)
    return {
        "id": aid,
        "ad": acc.get("account_name") or acc.get("bank_name") or aid,
        "tur": acc.get("type") or "",
        "bank_name": str(acc.get("bank_name") or "").strip(),
        "masked_ref": account_label.account_masked_ref(acc),
        "entegre_mi": bool(integrated),
        "gosterilen": shown,
        "hareket_toplami": moved,
        "banka_bildirdigi": reported_n,
        "fark": round(shown - moved, 2),
        "eslesmemis_adet": len(unmatched),
        "eslesmemis_tutar": unmatched_sum,
        "banka_farki": None if reported_n is None else round(reported_n - moved, 2),
        "acilis_var": _has_opening(txs, aid),
    }


def norm_ref(value: Any) -> str:
    return account_label.norm_ref(value)


def is_iban(value: Any) -> bool:
    return account_label.is_iban(value)


def masked_ref(value: Any) -> str:
    return account_label.masked_ref(value)


def connection_refs(conn: Optional[dict], acc: Optional[dict] = None) -> Dict[str, Set[str]]:
    """Bağlantının IBAN ve hesap no kimlikleri (bağlı hesap + bank_account_number)."""
    ibans: Set[str] = set()
    numbers: Set[str] = set()

    def add(raw: Any) -> None:
        token = norm_ref(raw)
        if not token or token == "-":
            return
        if is_iban(token):
            ibans.add(token)
        else:
            numbers.add(token)

    acc = acc or {}
    add(acc.get("iban"))
    add(acc.get("account_number"))
    add((conn or {}).get("bank_account_number"))
    return {"ibans": ibans, "numbers": numbers}


def _ref_warning(tur: str, noun: str, key: str, ids: Set[str], by_id: Dict[str, dict]) -> Dict[str, Any]:
    ordered = sorted(ids, key=lambda aid: (str((by_id.get(aid) or {}).get("bank_name") or ""), aid))
    rows = [by_id.get(aid) or {} for aid in ordered]
    mask = account_label.masked_ref(key)
    return {
        "tur": tur,
        "anahtar": f"{mask}:{','.join(sorted(ids))}",
        "adet": len(ids),
        "mesaj": account_label.duplicate_ref_message(noun, rows, mask),
    }


def link_warnings(accounts: List[dict], connections: List[dict]) -> List[Dict[str, Any]]:
    """Aynı IBAN veya hesap no birden fazla hesaba bağlıysa uyar. İsim tek başına uyarı değildir."""
    by_id: Dict[str, dict] = {}
    for acc in accounts or []:
        aid = _rid(acc)
        if aid:
            by_id[aid] = acc
    iban_groups: Dict[str, Set[str]] = {}
    number_groups: Dict[str, Set[str]] = {}
    for conn in connections or []:
        aid = str((conn or {}).get("linked_account_id") or "")
        if not aid:
            continue
        refs = connection_refs(conn, by_id.get(aid))
        for iban in refs["ibans"]:
            iban_groups.setdefault(iban, set()).add(aid)
        for number in refs["numbers"]:
            number_groups.setdefault(number, set()).add(aid)
    warnings: List[Dict[str, Any]] = []
    for iban, ids in iban_groups.items():
        if len(ids) > 1:
            warnings.append(_ref_warning("cift_iban", "IBAN", iban, ids, by_id))
    for number, ids in number_groups.items():
        if len(ids) > 1:
            warnings.append(_ref_warning("cift_hesap_no", "hesap no", number, ids, by_id))
    return warnings


async def conflicting_connection_iban(db, company_id: str, conn: dict, acc: Optional[dict], *, ignore_id: str = "") -> Optional[str]:
    """Aynı şirkette bu IBAN'a bağlı başka bağlantı varsa IBAN'ı döndür."""
    refs = connection_refs(conn, acc)
    if not refs["ibans"]:
        return None
    existing = await db.bank_connections.find({"company_id": str(company_id or "")}).to_list(500)
    acc_ids = list({str(c.get("linked_account_id")) for c in existing or [] if c.get("linked_account_id")})
    accs: Dict[str, dict] = {}
    if acc_ids:
        rows = await db.bank_accounts.find({"_id": {"$in": acc_ids}}).to_list(500)
        for row in rows or []:
            accs[str(row.get("_id") or row.get("id") or "")] = row
    for other in existing or []:
        oid = str(other.get("_id") or other.get("id") or "")
        if ignore_id and oid == str(ignore_id):
            continue
        other_acc = accs.get(str(other.get("linked_account_id") or ""))
        hit = refs["ibans"] & connection_refs(other, other_acc)["ibans"]
        if hit:
            return next(iter(hit))
    return None


def _partner_row(partner: dict, txs: List[dict]) -> Dict[str, Any]:
    """Kart = liste Toplam Giriş − Toplam Çıkış (posting_inc ile aynı kasa yönü)."""
    totals = partner_pay.cash_card_totals(txs)
    kayitli = round(_num(partner.get("balance")), 2)
    liste = round(sum(float(partner_pay.posting_inc(tx)["balance"]) for tx in (txs or [])), 2)
    return {
        "id": _rid(partner),
        "ad": partner.get("name") or "",
        "kart_bakiyesi": liste,
        "kayitli_bakiye": kayitli,
        "liste_giris": totals["cash_in"],
        "liste_cikis": totals["cash_out"],
        "liste_net": liste,
        "fark": round(kayitli - liste, 2),
    }


def _contact_row(contact: dict, *, calculated: float) -> Dict[str, Any]:
    stored = round(_num(contact.get("balance")), 2)
    live = round(_num(calculated), 2)
    return {
        "id": _rid(contact),
        "ad": contact.get("name") or contact.get("company_title") or "",
        "kayitli": stored,
        "hesaplanan": live,
        "fark": round(stored - live, 2),
    }


def preview_contact_amount(contact: dict, invoices, bank_txs, partner_txs) -> float:
    """contact_balance.sync ile aynı formül; yazmaz."""
    movement = contact_balance.compute_contact_balance(
        opening_balance=0.0,
        invoices=invoices,
        bank_txs=bank_txs,
        partner_txs=partner_txs,
    )
    opening = contact.get("opening_balance")
    if opening is None and contact.get("opening_balance_source"):
        opening = contact_balance.infer_opening_balance(_num(contact.get("balance")), movement)
    return contact_balance.compute_contact_balance(
        opening_balance=_num(opening),
        invoices=invoices,
        bank_txs=bank_txs,
        partner_txs=partner_txs,
    )


async def build_reconciliation(db, company_id: str) -> Dict[str, Any]:
    """Her hesap, ortak ve cari için fark. Yazma yok."""
    cid = str(company_id or "")
    accounts = await db.bank_accounts.find({"company_id": cid}).to_list(2000)
    txs = await db.bank_transactions.find({"company_id": cid}).to_list(50000)
    conns = await db.bank_connections.find({"company_id": cid}).to_list(500)
    integrated_ids = {str(c.get("linked_account_id")) for c in conns or [] if c.get("linked_account_id")}
    by_acc: Dict[str, List[dict]] = {}
    for tx in txs or []:
        for key in ("account_id", "target_account_id"):
            aid = tx.get(key)
            if aid:
                by_acc.setdefault(str(aid), []).append(tx)
    account_rows = [
        _account_row(acc, by_acc.get(_rid(acc), []), integrated=_rid(acc) in integrated_ids)
        for acc in accounts or []
    ]

    partners = await db.partners.find({"company_id": cid}).to_list(500)
    ptxs = await db.partner_transactions.find({"company_id": cid}).to_list(20000)
    by_partner: Dict[str, List[dict]] = {}
    for tx in ptxs or []:
        pid = str(tx.get("partner_id") or "")
        if pid:
            by_partner.setdefault(pid, []).append(tx)
    partner_rows = [_partner_row(p, by_partner.get(_rid(p), [])) for p in partners or []]

    contacts = await db.contacts.find({"company_id": cid}).to_list(5000)
    invoices = await db.invoices.find({"company_id": cid}).to_list(20000)
    partner_all = ptxs
    inv_by: Dict[str, List[dict]] = {}
    bank_by: Dict[str, List[dict]] = {}
    ptx_by: Dict[str, List[dict]] = {}
    for inv in invoices or []:
        key = str(inv.get("contact_id") or "")
        if key:
            inv_by.setdefault(key, []).append(inv)
    for tx in txs or []:
        key = str(tx.get("contact_id") or "")
        if key:
            bank_by.setdefault(key, []).append(tx)
    for tx in partner_all or []:
        key = str(tx.get("contact_id") or "")
        if key:
            ptx_by.setdefault(key, []).append(tx)
    contact_rows = []
    for contact in contacts or []:
        key = _rid(contact)
        calculated = preview_contact_amount(
            contact,
            inv_by.get(key, []),
            bank_by.get(key, []),
            ptx_by.get(key, []),
        )
        contact_rows.append(_contact_row(contact, calculated=calculated))

    def _drift(rows: List[dict]) -> int:
        return sum(1 for r in rows if abs(_num(r.get("fark"))) >= 0.01)

    return {
        "company_id": cid,
        "read_only": True,
        "accounts": account_rows,
        "partners": partner_rows,
        "contacts": contact_rows,
        "summary": {
            "account_count": len(account_rows),
            "account_drift": _drift(account_rows),
            "partner_count": len(partner_rows),
            "partner_drift": _drift(partner_rows),
            "contact_count": len(contact_rows),
            "contact_drift": _drift(contact_rows),
        },
        "uyarilar": link_warnings(accounts or [], conns or []),
    }


def _account_csv_label(row: dict) -> str:
    return account_label.account_display_label(
        {
            "bank_name": row.get("bank_name"),
            "account_name": row.get("ad"),
            "masked_ref": row.get("masked_ref"),
            "entegre_mi": row.get("entegre_mi"),
        },
        integrated=bool(row.get("entegre_mi")),
    )


def report_lines(report: Dict[str, Any]) -> List[List[str]]:
    """CSV/tablo satırları (başlık dahil). Hesap türü ve ad Türkçe etikettir."""
    rows: List[List[str]] = [[
        "grup", "id", "ad", "tur", "bank_name", "masked_ref", "entegre_mi",
        "gosterilen", "hareket_toplami", "banka_bildirdigi",
        "kart_bakiyesi", "kayitli_bakiye", "liste_giris", "liste_cikis",
        "kayitli", "hesaplanan", "fark",
        "eslesmemis_adet", "eslesmemis_tutar", "banka_farki",
    ]]
    for a in report.get("accounts") or []:
        rows.append([
            "hesap", a.get("id") or "", _account_csv_label(a),
            account_label.account_type_label(a.get("tur")),
            a.get("bank_name") or "", a.get("masked_ref") or "",
            "evet" if a.get("entegre_mi") else "hayir",
            _fmt(a.get("gosterilen")), _fmt(a.get("hareket_toplami")),
            "" if a.get("banka_bildirdigi") is None else _fmt(a.get("banka_bildirdigi")),
            "", "", "", "", "", "", _fmt(a.get("fark")),
            str(int(a.get("eslesmemis_adet") or 0)),
            _fmt(a.get("eslesmemis_tutar")),
            "" if a.get("banka_farki") is None else _fmt(a.get("banka_farki")),
        ])
    for p in report.get("partners") or []:
        rows.append([
            "ortak", p.get("id") or "", p.get("ad") or "", "partner", "", "", "",
            "", "", "",
            _fmt(p.get("kart_bakiyesi")), _fmt(p.get("kayitli_bakiye")),
            _fmt(p.get("liste_giris")), _fmt(p.get("liste_cikis")),
            "", "", _fmt(p.get("fark")),
            "", "", "",
        ])
    for c in report.get("contacts") or []:
        rows.append([
            "cari", c.get("id") or "", c.get("ad") or "", "contact", "", "", "",
            "", "", "", "", "", "", "",
            _fmt(c.get("kayitli")), _fmt(c.get("hesaplanan")), _fmt(c.get("fark")),
            "", "", "",
        ])
    return rows


def _fmt(v: Any) -> str:
    if v is None or v == "":
        return ""
    return f"{_num(v):.2f}"


def render_table(report: Dict[str, Any]) -> str:
    lines = report_lines(report)
    widths = [max(len(str(row[i])) for row in lines) for i in range(len(lines[0]))]
    out = []
    for idx, row in enumerate(lines):
        out.append("  ".join(str(cell).ljust(widths[i]) for i, cell in enumerate(row)))
        if idx == 0:
            out.append("  ".join("-" * widths[i] for i in range(len(widths))))
    summary = report.get("summary") or {}
    out.append("")
    out.append(
        "Hesap fark: {account_drift}/{account_count}  Ortak fark: {partner_drift}/{partner_count}  "
        "Cari fark: {contact_drift}/{contact_count}".format(**{
            "account_drift": summary.get("account_drift", 0),
            "account_count": summary.get("account_count", 0),
            "partner_drift": summary.get("partner_drift", 0),
            "partner_count": summary.get("partner_count", 0),
            "contact_drift": summary.get("contact_drift", 0),
            "contact_count": summary.get("contact_count", 0),
        })
    )
    return "\n".join(out)


def render_csv(report: Dict[str, Any]) -> str:
    import csv
    import io
    buf = io.StringIO()
    writer = csv.writer(buf)
    for row in report_lines(report):
        writer.writerow(row)
    return buf.getvalue()
