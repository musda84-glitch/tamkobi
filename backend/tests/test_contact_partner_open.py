"""Ortak cari ödemesi: ad görünür, vade mahsubu okuma anında FIFO.

paid_amount, contacts.balance ve partner bakiyesi yazılmaz.
Bellek içi veritabanı. Canlı sunucu ve port kullanılmaz.
"""
from __future__ import annotations

import asyncio
import copy
import sys
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import contact_balance  # noqa: E402
import contact_list_page as page  # noqa: E402
import invoice_list_page  # noqa: E402
import statement_share  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO = "co-tekbir"
OTHER = "co-diger"
CT = "ct-tekbir"
TODAY = "2026-10-21"


def _run(coro):
    return asyncio.run(coro)


def _user():
    return {
        "company_ids": [CO],
        "active_company_id": CO,
        "is_super_admin": False,
        "role": "admin",
    }


def _purchase(iid, total, due, *, paid=0, contact=CT, company=CO):
    return {
        "_id": iid,
        "company_id": company,
        "contact_id": contact,
        "invoice_number": iid,
        "invoice_type": "purchase",
        "status": "approved",
        "payment_status": "partially_paid" if paid else "unpaid",
        "grand_total": total,
        "paid_amount": paid,
        "due_date": due,
        "issue_date": due,
        "effects_applied": True,
    }


def _sales(iid, total, due, *, contact=CT, company=CO):
    doc = _purchase(iid, total, due, contact=contact, company=company)
    doc["invoice_type"] = "sales"
    doc["payment_status"] = "unpaid"
    doc["paid_amount"] = 0
    return doc


def _sales_return(iid, total, due, *, contact=CT, company=CO):
    """Açık satış iadesi. POS kasa iadesi değil: paid_amount 0, bakiye düşer."""
    doc = _purchase(iid, total, due, contact=contact, company=company)
    doc["invoice_type"] = "sales_return"
    doc["payment_status"] = "unpaid"
    doc["paid_amount"] = 0
    return doc


def _partner(iid, amount, ptype, name, *, contact=CT, company=CO):
    return {
        "_id": iid,
        "company_id": company,
        "contact_id": contact,
        "partner_id": "p1",
        "partner_name": name,
        "type": ptype,
        "amount": amount,
        "account_name": "Ortaklar Hesabı",
        "date": "2026-10-10",
        "description": "Cari ödeme",
    }


def _contact(balance, *, cid=CT, company=CO):
    return {
        "_id": cid,
        "company_id": company,
        "name": "TEKBİR ORMAN",
        "balance": balance,
        "opening_balance": 0,
        "cheque_bond_balance": 0,
        "type": "supplier",
    }


def test_fifo_offset_covers_oldest_and_skips_linked_payment():
    old = _purchase("old", 50000, "2020-01-01")
    new = _purchase("new", 20000, "2020-06-01")
    opened = page.effective_open_map([old, new], -20000, balance_known=True)
    assert opened["old"] == 0
    assert opened["new"] == 20000
    amount, count = page.overdue_totals([old, new], -20000, balance_known=True, today=TODAY)
    assert amount == 20000 and count == 1

    linked = _purchase("linked", 70000, "2020-01-01", paid=20000)
    # Faturaya bağlı 20.000 zaten paid_amount içinde; cari ödeme 30.000 bakiyeyi -20.000 bırakır.
    opened = page.effective_open_map([linked], -20000, balance_known=True)
    assert opened["linked"] == 20000
    assert linked["paid_amount"] == 20000

    amount, count = page.overdue_totals([_purchase("full", 70000, "2020-01-01")], 0, balance_known=True, today=TODAY)
    assert amount == 0 and count == 0
    amount, count = page.overdue_totals([_purchase("part", 70000, "2020-01-01")], -40000, balance_known=True, today=TODAY)
    assert amount == 40000 and count == 1

    sale = _sales("sale", 70000, "2020-01-01")
    assert page.overdue_totals([sale], 70000, balance_known=True, today=TODAY) == (70000, 1)
    assert page.overdue_totals([sale], 0, balance_known=True, today=TODAY) == (0, 0)
    assert page.overdue_totals([sale], 40000, balance_known=True, today=TODAY) == (40000, 1)
    # Cari kaydı yoksa eski kalan durur.
    assert page.overdue_totals([sale], 0, balance_known=False, today=TODAY) == (70000, 1)


def test_fifo_sales_return_stays_on_payable_side():
    """Satış iadesi bakiyeyi düşürür; FIFO'da alış ile aynı borç yönündedir.

    Alacak havuzuna yazılırsa en eski satışın kalanı şişer ve iade ayrıca açık kalır.
    """
    sale = _sales("sale", 70000, "2020-01-01")
    ret = _sales_return("iade", 20000, "2020-03-01")
    assert contact_balance.invoice_balance_delta(sale) == 70000
    assert contact_balance.invoice_balance_delta(ret) == -20000

    # Satış 70.000 − iade 20.000 = bakiye +50.000. İade kapanır, satışta 50.000 kalır.
    opened = page.effective_open_map([sale, ret], 50000, balance_known=True)
    assert opened["sale"] == 50000
    assert opened["iade"] == 0
    assert page.overdue_totals([sale, ret], 50000, balance_known=True, today=TODAY) == (50000, 1)

    # İade satışı aşınca borç iade belgesinde kalır, satış kapanır.
    big = _sales_return("iade-buyuk", 70000, "2020-03-01")
    small = _sales("sale-kucuk", 20000, "2020-01-01")
    opened = page.effective_open_map([small, big], -50000, balance_known=True)
    assert opened["sale-kucuk"] == 0
    assert opened["iade-buyuk"] == 50000
    assert page.overdue_totals([small, big], -50000, balance_known=True, today=TODAY) == (50000, 1)

    # Borç yönünde en eski vade önce kapanır: alış, sonraki satış iadesinden önce.
    purchase = _purchase("alis", 40000, "2020-01-01")
    later = _sales_return("iade-yeni", 30000, "2020-06-01")
    assert contact_balance.invoice_balance_delta(purchase) == -40000
    opened = page.effective_open_map([later, purchase], -30000, balance_known=True)
    assert opened["alis"] == 0
    assert opened["iade-yeni"] == 30000
    assert page.overdue_totals([later, purchase], -30000, balance_known=True, today=TODAY) == (30000, 1)

    old_ret = _sales_return("iade-eski", 40000, "2020-01-01")
    new_ret = _sales_return("iade-sonra", 30000, "2020-06-01")
    opened = page.effective_open_map([new_ret, old_ret], -30000, balance_known=True)
    assert opened["iade-eski"] == 0
    assert opened["iade-sonra"] == 30000

    # Bakiye kapalıysa her iki yön de 0. Kasa iadesi (paid_amount dolu) havuza girmez.
    assert page.effective_open_map([sale, ret], 0, balance_known=True) == {"sale": 0.0, "iade": 0.0}
    settled = _sales_return("pos", 20000, "2020-02-01")
    settled["payment_status"] = "refunded"
    settled["paid_amount"] = 20000
    opened = page.effective_open_map([purchase, settled], -40000, balance_known=True)
    assert opened == {"alis": 40000}
    assert page.overdue_totals([purchase, settled], -40000, balance_known=True, today=TODAY) == (40000, 1)


def test_partner_name_statement_and_flags_match(monkeypatch):
    import server

    db = MemDB()
    monkeypatch.setattr(server, "db", db)
    before_paid = []

    async def seed():
        await db.contacts.insert_one(_contact(0))
        await db.invoices.insert_one(_purchase("FYS2026000002251", 70000, "2020-01-01"))
        await db.invoices.insert_one(_purchase("diger-fatura", 70000, "2020-01-01", company=OTHER))
        await db.partner_transactions.insert_one(_partner("pt-1", 70000, "capital_in", "Ali Veli"))
        await db.partner_transactions.insert_one(_partner("pt-yabanci", 70000, "capital_in", "Baska Ortak", company=OTHER))

    _run(seed())
    before_paid = copy.deepcopy(db.invoices.docs)
    before_balance = copy.deepcopy(db.contacts.docs)
    before_partner = copy.deepcopy(db.partner_transactions.docs)

    async def read():
        overview = await server.get_contact_overview(CT, _user())
        statement = await server.get_contact_statement(CT, _user())
        _contact_doc, view = await server._statement_bundle(CT)
        flags = await page.compute_flags(db, CO, today=TODAY)
        route = await server.contact_flags(company_id=CO, days=7, user=_user())
        aging = await server.contact_aging(CT, _user())
        pdf = statement_share.statement_pdf_bytes(view)
        return overview, statement, view, flags, route, aging, pdf

    overview, statement, view, flags, route, aging, pdf = _run(read())
    partner_rows = [p for p in overview["payments"] if p.get("source") == "partner"]
    assert len(partner_rows) == 1
    assert partner_rows[0]["partner_name"] == "Ali Veli"
    assert partner_rows[0]["account_name"] == "Ortaklar Hesabı"
    assert "pt-yabanci" not in {p.get("id") for p in overview["payments"]}

    closed = next(i for i in overview["invoices"] if i["invoice_number"] == "FYS2026000002251")
    assert closed["effective_open"] == 0
    assert closed["paid_amount"] == 0
    assert "diger-fatura" not in {i["id"] for i in overview["invoices"]}

    labels = [p.get("account_name") for p in statement["payments"]]
    assert "Ortaklar Hesabı · Ali Veli" in labels
    assert "Baska Ortak" not in " ".join(labels)
    assert {p["id"] for p in statement["invoices"]} == {"FYS2026000002251"}
    assert any("Ortaklar Hesabı · Ali Veli" in (row.get("doc") or "") for row in view["rows"])
    assert pdf.startswith(b"%PDF")
    assert flags.get(CT, {}).get("overdue_amount", 0) == 0
    assert route.get(CT, {}).get("overdue_amount", 0) == 0
    assert route == flags
    assert aging["total_overdue"] == 0
    assert db.invoices.docs == before_paid
    assert db.contacts.docs == before_balance
    assert db.partner_transactions.docs == before_partner


def test_partial_fifo_and_invoice_list_effective_open(monkeypatch):
    import server

    db = MemDB()
    monkeypatch.setattr(server, "db", db)

    async def seed_partial():
        await db.contacts.insert_one(_contact(-40000))
        await db.invoices.insert_one(_purchase("part", 70000, "2020-01-01"))
        await db.partner_transactions.insert_one(_partner("pt-part", 30000, "capital_in", "Ali Veli"))

    _run(seed_partial())

    async def read_partial():
        flags = await page.compute_flags(db, CO, today=TODAY)
        route = await server.contact_flags(company_id=CO, days=7, user=_user())
        aging = await server.contact_aging(CT, _user())
        return flags, route, aging

    flags, route, aging = _run(read_partial())
    assert flags[CT]["overdue_amount"] == 40000
    assert flags[CT]["overdue_count"] == 1
    assert route == flags
    assert aging["total_overdue"] == 40000
    assert aging["rows"][0]["remaining"] == 40000

    listed = MemDB()

    async def seed_list():
        await listed.contacts.insert_one(_contact(0, cid="ct-list"))
        await listed.invoices.insert_one(_purchase("list-1", 70000, "2020-01-01", contact="ct-list"))
        await listed.invoices.insert_one(_purchase("list-yabanci", 90000, "2020-01-01", contact="ct-list", company=OTHER))

    _run(seed_list())
    body = _run(invoice_list_page.list_invoices_paged(listed, CO, page=1, page_size=20, tab="all", today=TODAY))
    row = next(item for item in body["items"] if item["id"] == "list-1")
    assert row["effective_open"] == 0
    assert row["paid_amount"] == 0
    assert all(item["id"] != "list-yabanci" for item in body["items"])
