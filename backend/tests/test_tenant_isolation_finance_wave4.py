"""Finans / banka / cari yardımcıları kiracı dalgası 4. Bellek içi MemDB.

Canlı veritabanına ve 8021'deki sunucuya bağlanmaz.
Değer, filtre, şirket kimliği, e-posta, IBAN veya kayıt içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import account_balance  # noqa: E402
import bank_guard  # noqa: E402
import bank_match_target  # noqa: E402
import bank_rematch  # noqa: E402
import bank_tx_page  # noqa: E402
import contact_balance  # noqa: E402
import contact_list_page  # noqa: E402
import finance  # noqa: E402
import invoice_list_page  # noqa: E402
import stock_codes  # noqa: E402
import tenant_scope  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
ACC = "acc-shared"
ACC_A = "acc-a"
ACC_B = "acc-b"
CARD = "card-shared"
POOL = "pool-shared"
CONTACT = "contact-shared"
INV = "inv-shared"
PRODUCT = "prod-shared"
LOAN_A = "loan-a"
LOAN_B = "loan-b"
OPEN = "open-shared"
TX_MATCH = "tx-match"
TX_CLEAR = "tx-clear"
PARTNER = "partner-shared"
CONN = "conn-shared"

_REMOVED = (
    ("account_balance.py", "apply_balance_delta", "bank_accounts", "update_one"),
    ("account_balance.py", "ensure_opening_tx", "bank_transactions", "insert_one"),
    ("account_balance.py", "recalc_account_balance", "bank_accounts", "find_one"),
    ("account_balance.py", "rewrite_opening_tx", "bank_transactions", "delete_many"),
    ("account_balance.py", "rewrite_opening_tx", "bank_transactions", "insert_one"),
    ("account_balance.py", "sync_cash_box_balances", "bank_accounts", "update_one"),
    ("bank_guard.py", "apply_customer_card_owner_effect", "contacts", "update_one"),
    ("bank_guard.py", "get_connection_for_account", "bank_connections", "find_one"),
    ("bank_guard.py", "pin_customer_card_pool_balance", "bank_accounts", "update_one"),
    ("bank_match_target.py", "clear_bank_match_status", "bank_transactions", "find_one"),
    ("bank_match_target.py", "clear_bank_match_status", "bank_transactions", "update_one"),
    ("bank_match_target.py", "resolve_bank_tx_id_for_partner_tx", "bank_transactions", "find_one"),
    ("bank_rematch.py", "_clear_rematching", "bank_transactions", "update_one"),
    ("bank_rematch.py", "attach_month_totals", "bank_transactions", "aggregate"),
    ("bank_rematch.py", "replace_matched_transaction", "bank_transactions", "find_one"),
    ("bank_rematch.py", "replace_matched_transaction", "bank_transactions", "update_one"),
    ("bank_tx_page.py", "_load_leg", "bank_transactions", "find"),
    ("contact_balance.py", "sync_contact_balance", "bank_transactions", "find"),
    ("contact_balance.py", "sync_contact_balance", "contacts", "find_one"),
    ("contact_balance.py", "sync_contact_balance", "contacts", "update_one"),
    ("contact_balance.py", "sync_contact_balance", "invoices", "find"),
    ("contact_balance.py", "sync_contact_balance", "partner_transactions", "find"),
    ("contact_list_page.py", "fetch_contact_rows", "contacts", "find"),
    ("finance.py", "_apply_statement_account", "bank_accounts", "update_one"),
    ("finance.py", "_enrich_statement_lines", "bank_transactions", "find"),
    ("finance.py", "_existing_statement_keys", "bank_transactions", "find"),
    ("finance.py", "_insert_statement_line", "bank_accounts", "update_one"),
    ("finance.py", "_insert_statement_line", "bank_transactions", "update_one"),
    ("finance.py", "_insert_statement_line", "contacts", "find_one"),
    ("finance.py", "_insert_statement_line", "contacts", "update_one"),
    ("finance.py", "confirm_statement", "bank_accounts", "find_one"),
    ("finance.py", "create_loan", "bank_accounts", "find_one"),
    ("finance.py", "create_loan", "bank_accounts", "update_one"),
    ("finance.py", "import_statement", "bank_accounts", "find_one"),
    ("finance.py", "pay_installment", "bank_accounts", "find_one"),
    ("finance.py", "pay_installment", "bank_accounts", "update_one"),
    ("finance.py", "pay_installment", "loans", "find_one"),
    ("finance.py", "pay_installment", "loans", "update_one"),
    ("invoice_list_page.py", "fetch_invoice_rows", "invoices", "find"),
    ("stock_codes.py", "load_products_for_items", "products", "find"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_many(self, query=None):
        tenant_scope.check(self.name, "delete_many", query=query)
        query = _split_field_ops(query or {})
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Boom:
    def __getattr__(self, name):
        raise AssertionError("db")

    def __getitem__(self, name):
        raise AssertionError("db")


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
    return None


def _rows(db, coll, company_id):
    return [row for row in db[coll].docs if row.get("company_id") == company_id]


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _account(company_id, doc_id, *, kind="cash_box", balance=0.0, pool=False, name="Kasa"):
    doc = {
        "_id": doc_id,
        "company_id": company_id,
        "type": "credit_card" if kind == "card" or pool else kind,
        "account_name": name,
        "bank_name": name,
        "currency": "TRY",
        "current_balance": balance,
    }
    if pool:
        doc["is_customer_card_pool"] = True
        doc["card_owner"] = "customer"
    return doc


def _tx(company_id, doc_id, account_id, amount, *, kind="inflow", **extra):
    doc = {
        "_id": doc_id,
        "company_id": company_id,
        "account_id": account_id,
        "type": kind,
        "amount": amount,
        "currency": "TRY",
        "date": "2026-10-02",
        "description": extra.pop("description", "hareket"),
        "source": extra.pop("source", "manual"),
    }
    doc.update(extra)
    return doc


def _loan(company_id, doc_id, account_id, amount):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "name": "Kredi",
        "bank": "Banka",
        "principal": amount,
        "account_id": account_id,
        "start_date": "2026-10-01",
        "installments": [{
            "no": 1,
            "due_date": "2026-10-15",
            "amount": amount,
            "principal": amount,
            "interest": 0,
            "kkdf_bsmv": 0,
            "paid": False,
        }],
    }


def _seed_pair(db, *, other_first=False):
    """Aynı _id'li iki şirket. other_first=True ise şirketsiz ilk eşleşme B'dir."""
    order = (CO_B, CO_A) if other_first else (CO_A, CO_B)
    marks = {CO_A: ("A", 40.0, 11.0), CO_B: ("B", 9000.0, 99.0)}
    for company_id in order:
        mark, big, month_amt = marks[company_id]
        _add(db, "bank_accounts", _account(company_id, ACC, balance=big, name="Kasa " + mark))
        _add(db, "bank_accounts", _account(company_id, CARD, kind="card", balance=big, name="Kart " + mark))
        _add(db, "bank_accounts", _account(company_id, POOL, pool=True, balance=big, name="Havuz " + mark))
        _add(db, "bank_accounts", _account(company_id, OPEN, balance=big, name="Acilis " + mark))
        _add(db, "bank_transactions", _tx(
            company_id, "tx-" + mark, ACC, month_amt, description="ay " + mark, date=_month_day(),
        ))
        _add(db, "bank_transactions", _tx(
            company_id, "open-tx-" + mark, OPEN, big, source="opening", description="acilis " + mark,
            date="2020-01-01",
        ))
        if company_id == CO_B:
            _add(db, "bank_transactions", _tx(
                company_id, "stmt-" + mark, CARD, 10, source="card_statement",
                description="ACME TEDARIK odeme", date="2026-10-01",
            ))
        _add(db, "bank_transactions", _tx(
            company_id, TX_MATCH, "match-shared", 5, description="mark-" + mark, source="bank_sync",
            match_status="matched", date="2020-01-02",
        ))
        _add(db, "bank_transactions", _tx(
            company_id, TX_CLEAR, "match-shared", 5, description="clear-" + mark, source="bank_sync",
            match_status="matched", date="2020-01-02",
        ))
        _add(db, "bank_transactions", _tx(
            company_id, "btx-" + mark, "resolve-shared", 11,
            description="eslesme " + mark, match_status="matched",
            target_account_id="partner:" + PARTNER, date="2026-10-03",
        ))
        _add(db, "bank_connections", {
            "_id": "conn-" + mark,
            "company_id": company_id,
            "linked_account_id": CONN,
            "provider_name": "bag-" + mark,
            "linked_account_name": "Kasa " + mark,
        })
        _add(db, "contacts", {
            "_id": CONTACT,
            "company_id": company_id,
            "name": "ACME TEDARIK" if company_id == CO_B else "Cari A",
            "type": "customer",
            "is_active": True,
            "balance": 999.0 if company_id == CO_B else 1.0,
            "opening_balance": 0.0,
        })
        _add(db, "invoices", {
            "_id": INV,
            "company_id": company_id,
            "contact_id": CONTACT,
            "invoice_type": "sales",
            "status": "approved",
            "effects_applied": True,
            "grand_total": 999.0 if company_id == CO_B else 40.0,
            "invoice_number": "F-" + mark,
        })
        _add(db, "partner_transactions", {
            "_id": "ptx-" + mark,
            "company_id": company_id,
            "partner_id": PARTNER,
            "amount": 11.0,
            "date": "2026-10-03",
            "type": "capital_in",
        })
        _add(db, "products", {
            "_id": PRODUCT,
            "company_id": company_id,
            "sku": "SKU-" + mark,
            "name": "Urun " + mark,
        })
    _add(db, "bank_transactions", _tx(
        CO_B, "tx-b-contact", ACC, 50, kind="outflow", contact_id=CONTACT, description="cari b",
    ))


def _seed_routes(db):
    _seed_pair(db, other_first=False)
    _add(db, "bank_accounts", _account(CO_A, ACC_A, balance=100.0, name="Kasa A"))
    _add(db, "bank_transactions", _tx(CO_A, "tx-a-open", ACC_A, 100, description="acilis a", date="2026-10-01"))
    _add(db, "bank_accounts", _account(CO_B, ACC_B, balance=9000.0, name="Kasa B"))
    _add(db, "loans", _loan(CO_A, LOAN_A, ACC_A, 30))
    _add(db, "loans", _loan(CO_B, LOAN_B, ACC_B, 80))


def _month_day():
    start, _end = bank_rematch.istanbul_month_bounds()
    return start


async def _expect(coro, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == 404
    assert exc.value.detail == detail


def test_cross_tenant_finance_routes_leave_other_company(monkeypatch):
    db = _DB()
    _seed_routes(db)
    prev = finance._db
    finance._db = db
    user = _user(CO_A)
    before = _digest(db, CO_B)

    async def _text(_file):
        return "ekstre"

    async def _ask(_system, _text_value):
        return {"transactions": [{"date": "2026-10-01", "description": "ACME TEDARIK odeme", "amount": -10}], "total_debt": 10}

    monkeypatch.setattr(finance, "_statement_text", _text)
    monkeypatch.setattr(finance, "_ask_json", _ask)
    try:
        async def run():
            created = await finance.create_loan({
                "name": "Capraz",
                "principal": 25,
                "account_id": ACC_B,
                "credit_to_account": True,
                "installments": [{"no": 1, "due_date": "2026-11-01", "amount": 25}],
            }, user)
            await _expect(finance.pay_installment(LOAN_B, 1, {"account_id": ACC_B}, user), "Kredi bulunamadı.")
            await _expect(finance.pay_installment(LOAN_A, 1, {"account_id": ACC_B}, user), "Hesap bulunamadı.")
            await _expect(
                finance.import_statement(ACC_B, None, True, user),
                "Hesap bulunamadı.",
            )
            await _expect(
                finance.confirm_statement(ACC_B, {"statement": {}, "lines": []}, user),
                "Hesap bulunamadı.",
            )
            preview = await finance.import_statement(CARD, SimpleNamespace(filename="ekstre.csv"), True, user)
            return created, preview

        created, preview = _run(run())
        assert _digest(db, CO_B) == before
        assert _doc(db, "bank_accounts", ACC_B, CO_B)["current_balance"] == 9000.0
        assert _doc(db, "loans", LOAN_B, CO_B)["installments"][0]["paid"] is False
        assert _doc(db, "loans", LOAN_A, CO_A)["installments"][0]["paid"] is False
        assert created["company_id"] == CO_A
        assert created["principal"] == 25
        assert all(row.get("account_id") != ACC_B for row in db.bank_transactions.docs)
        line = preview["transactions"][0]
        assert line["duplicate"] is False
        assert line["suggested_contact_id"] is None
        assert _doc(db, "bank_accounts", CARD, CO_B)["current_balance"] == 9000.0
    finally:
        finance._db = prev


def test_helpers_do_not_read_or_write_other_company():
    db = _DB()
    _seed_pair(db, other_first=True)
    before = _digest(db, CO_B)
    month = _month_day()
    card = {
        "_id": "cust-card",
        "company_id": CO_A,
        "type": "credit_card",
        "card_owner": "customer",
        "linked_contact_id": CONTACT,
        "linked_contact_name": "Cari A",
        "is_customer_card_pool": False,
    }

    async def run():
        moved = await account_balance.recalc_account_balance(db, ACC, company_id=CO_A)
        opened = await account_balance.ensure_opening_tx(
            db, _doc(db, "bank_accounts", ACC, CO_A), on_date="2020-01-01",
        )
        posted = await account_balance.apply_balance_delta(db, ACC, 25, company_id=CO_A)
        rewritten = await account_balance.rewrite_opening_tx(db, _doc(db, "bank_accounts", OPEN, CO_A), 15)
        await account_balance.sync_cash_box_balances(db, [_doc(db, "bank_accounts", ACC, CO_A)])
        await bank_guard.pin_customer_card_pool_balance(db, POOL, company_id=CO_A)
        owner = await bank_guard.apply_customer_card_owner_effect(
            db, card, "outflow", 5, company_id=CO_A,
        )
        live, meta = await contact_balance.sync_contact_balance(db, CONTACT, company_id=CO_A)
        cleared = await bank_match_target.clear_bank_match_status(db, TX_CLEAR, company_id=CO_A)
        seen = {}

        async def unmatch(tx, actor):
            seen["desc"] = tx.get("description")

        async def apply_match(fresh, *_args, **_kwargs):
            seen["fresh"] = fresh.get("description")
            return {"status": "matched"}

        replaced = await bank_rematch.replace_matched_transaction(
            db, _doc(db, "bank_transactions", TX_MATCH, CO_A), {}, None,
            unmatch=unmatch, apply_match=apply_match,
        )
        conn = await bank_guard.get_connection_for_account(db, CONN, company_id=CO_A)
        bank_tx_id = await bank_match_target.resolve_bank_tx_id_for_partner_tx(db, {
            "_id": "ptx-a",
            "company_id": CO_A,
            "partner_id": PARTNER,
            "amount": 11,
            "date": "2026-10-03",
        })
        rows = [{"id": ACC}]
        await bank_rematch.attach_month_totals(db, CO_A, rows)
        contacts = await contact_list_page.fetch_contact_rows(db, CO_A)
        invoices = await invoice_list_page.fetch_invoice_rows(db, CO_A, {"_id": INV})
        legs = await bank_tx_page._load_leg(db, {"account_id": ACC}, company_id=CO_A)
        loaded = await bank_tx_page.load_account_txs(db, CO_A, ACC)
        products = await stock_codes.load_products_for_items(
            db, [{"product_id": PRODUCT}], company_id=CO_A,
        )
        return {
            "posted": posted,
            "moved": moved,
            "opened": opened,
            "rewritten": rewritten,
            "owner": owner,
            "live": live,
            "meta": meta,
            "cleared": cleared,
            "seen": seen,
            "replaced": replaced,
            "conn": conn,
            "bank_tx_id": bank_tx_id,
            "rows": rows,
            "contacts": contacts,
            "invoices": invoices,
            "legs": legs,
            "loaded": loaded,
            "products": products,
            "month": month,
        }

    out = _run(run())
    assert out["posted"] == "posted"
    assert _doc(db, "bank_accounts", ACC, CO_A)["current_balance"] == 51.0
    assert out["moved"] == 11.0
    assert out["opened"]["company_id"] == CO_A
    assert out["opened"]["account_id"] == ACC
    assert abs(float(out["opened"]["amount"]) - 40.0) < 0.001
    assert out["rewritten"]["company_id"] == CO_A
    assert abs(float(out["rewritten"]["amount"]) - 15.0) < 0.001
    assert _doc(db, "bank_accounts", POOL, CO_A)["current_balance"] == 0.0
    assert out["owner"]["owner_contact_id"] == CONTACT
    assert out["live"] == 40.0
    assert out["meta"]["ok"] is True
    assert _doc(db, "contacts", CONTACT, CO_A)["balance"] == 40.0
    assert out["cleared"] is True
    assert _doc(db, "bank_transactions", TX_CLEAR, CO_A)["match_status"] == "unmatched"
    assert _doc(db, "bank_transactions", TX_CLEAR, CO_B)["match_status"] == "matched"
    assert _doc(db, "bank_transactions", TX_MATCH, CO_A)["match_status"] == "rematching"
    assert out["seen"]["desc"] == "mark-A"
    assert out["seen"]["fresh"] == "mark-A"
    assert out["replaced"]["status"] == "matched"
    assert out["conn"]["provider_name"] == "bag-A"
    assert out["bank_tx_id"] == "btx-A"
    assert out["rows"][0]["month_in"] == 11.0
    assert out["rows"][0]["month_out"] == 0.0
    assert [row["name"] for row in out["contacts"]] == ["Cari A"]
    assert [row["invoice_number"] for row in out["invoices"]] == ["F-A"]
    assert {row["description"] for row in out["legs"]} == {row["description"] for row in out["loaded"]}
    assert "ay B" not in {row["description"] for row in out["loaded"]}
    assert "mark-B" not in {row["description"] for row in out["loaded"]}
    assert out["products"][PRODUCT]["sku"] == "SKU-A"
    assert _doc(db, "bank_accounts", ACC, CO_B)["current_balance"] == 9000.0
    assert _doc(db, "bank_accounts", POOL, CO_B)["current_balance"] == 9000.0
    assert _doc(db, "bank_accounts", OPEN, CO_B)["current_balance"] == 9000.0
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 999.0
    assert _doc(db, "bank_transactions", TX_MATCH, CO_B)["match_status"] == "matched"
    assert _doc(db, "bank_transactions", "open-tx-B", CO_B)["amount"] == 9000.0
    b_openings = [row for row in _rows(db, "bank_transactions", CO_B) if row.get("source") == "opening"]
    assert len(b_openings) == 1
    assert _digest(db, CO_B) == before


def test_blank_company_id_does_not_touch_db():
    boom = _Boom()
    prev = finance._db
    finance._db = boom

    async def run():
        posted = await account_balance.apply_balance_delta(boom, ACC, 5, company_id="")
        opened = await account_balance.ensure_opening_tx(boom, {"_id": ACC, "current_balance": 10})
        rewritten = await account_balance.rewrite_opening_tx(boom, {"_id": OPEN}, 10)
        await bank_guard.pin_customer_card_pool_balance(boom, POOL, company_id="")
        conn = await bank_guard.get_connection_for_account(boom, ACC, company_id="")
        owner = await bank_guard.apply_customer_card_owner_effect(
            boom, {"type": "credit_card", "card_owner": "customer", "linked_contact_id": CONTACT},
            "outflow", 5, company_id="",
        )
        await bank_rematch._clear_rematching(boom, TX_MATCH, company_id="")
        cleared = await bank_match_target.clear_bank_match_status(boom, TX_MATCH, company_id="")
        missing = await bank_match_target.resolve_bank_tx_id_for_partner_tx(
            boom, {"partner_id": PARTNER, "amount": 11},
        )
        live, meta = await contact_balance.sync_contact_balance(boom, CONTACT, company_id="")
        contacts = await contact_list_page.fetch_contact_rows(boom, "")
        invoices = await invoice_list_page.fetch_invoice_rows(boom, "", {"_id": INV})
        legs = await bank_tx_page._load_leg(boom, {"account_id": ACC}, company_id="")
        loaded = await bank_tx_page.load_account_txs(boom, "", ACC)
        products = await stock_codes.load_products_for_items(boom, [{"product_id": PRODUCT}], company_id="")
        keys = await finance._existing_statement_keys(ACC, company_id="")
        totals = [{"id": ACC, "month_in": 7}]
        await bank_rematch.attach_month_totals(boom, "", totals)
        return posted, opened, rewritten, conn, owner, cleared, missing, live, meta, contacts, invoices, legs, loaded, products, keys, totals

    try:
        posted, opened, rewritten, conn, owner, cleared, missing, live, meta, contacts, invoices, legs, loaded, products, keys, totals = _run(run())
    finally:
        finance._db = prev
    assert posted == "skipped"
    assert opened is None
    assert rewritten is None
    assert conn is None
    assert owner is None
    assert cleared is False
    assert missing is None
    assert live == 0.0
    assert meta == {"ok": False, "reason": "missing"}
    assert contacts == []
    assert invoices == []
    assert legs == []
    assert loaded == []
    assert products == {}
    assert keys == set()
    assert totals[0]["month_in"] == 0.0


def test_same_company_loan_and_statement(monkeypatch):
    db = _DB()
    _seed_routes(db)
    prev = finance._db
    finance._db = db
    user = _user(CO_A)
    before = _digest(db, CO_B)

    async def _text(_file):
        return "ekstre"

    async def _ask(_system, _text_value):
        return {
            "transactions": [{"date": "2026-10-04", "description": "yeni satir", "amount": 20}],
            "bank": "Banka",
        }

    monkeypatch.setattr(finance, "_statement_text", _text)
    monkeypatch.setattr(finance, "_ask_json", _ask)
    try:
        async def run():
            created = await finance.create_loan({
                "name": "A Kredi",
                "principal": 40,
                "account_id": ACC_A,
                "credit_to_account": True,
                "start_date": "2026-10-01",
                "installments": [{"no": 1, "due_date": "2026-11-01", "amount": 40, "paid": False}],
            }, user)
            paid = await finance.pay_installment(LOAN_A, 1, {"account_id": ACC_A, "date": "2026-10-15"}, user)
            preview = await finance.import_statement(ACC_A, SimpleNamespace(filename="ekstre.csv"), True, user)
            confirmed = await finance.confirm_statement(ACC_A, {
                "statement": {"bank": "Banka"},
                "lines": [{
                    "date": "2026-10-05",
                    "description": "gelen",
                    "amount": 20,
                    "kind": "islem",
                    "included": True,
                }],
            }, user)
            return created, paid, preview, confirmed

        created, paid, preview, confirmed = _run(run())
        assert created["company_id"] == CO_A
        assert created["principal"] == 40
        assert _doc(db, "bank_accounts", ACC_A, CO_A)["current_balance"] == 130.0
        assert paid["installments"][0]["paid"] is True
        assert paid["company_id"] == CO_A
        assert preview["mode"] == "bank"
        assert preview["transactions"][0]["duplicate"] is False
        assert confirmed["inserted"] == 1
        assert confirmed["mode"] == "bank"
        a_txs = _rows(db, "bank_transactions", CO_A)
        assert any(row.get("category") == "Kredi Kullanımı" and row.get("amount") == 40 for row in a_txs)
        assert any(row.get("category") == "Kredi Taksiti" and row.get("amount") == 30 for row in a_txs)
        assert sum(1 for row in a_txs if row.get("description") == "gelen") == 1
        assert _digest(db, CO_B) == before
        assert _doc(db, "loans", LOAN_B, CO_B)["installments"][0]["paid"] is False
        assert _doc(db, "bank_accounts", ACC_B, CO_B)["current_balance"] == 9000.0
    finally:
        finance._db = prev


def test_wave4_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 40
    assert not any(key[0] == "server.py" for key in _REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "temiz" in proc.stdout
