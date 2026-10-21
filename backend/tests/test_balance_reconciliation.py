"""Bakiye mutabakatı: hesap türleri, çift kayıt, Ali BAL, salt okuma."""
from __future__ import annotations

import asyncio
import copy
import importlib.util
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import match_query
import account_balance
import balance_reconciliation
import duplicate_guard
import finance
import partner_pay


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[:length]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = copy.deepcopy(doc)
        return doc

    async def find_one(self, query, projection=None):
        if isinstance(query, dict) and set(query) == {"_id"}:
            doc = self.docs.get(query["_id"])
            return copy.deepcopy(doc) if doc else None
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        found = None
        for doc in self.docs.values():
            if match_query(doc, query or {}):
                found = doc
                break
        if not found:
            return SimpleNamespace(modified_count=0)
        for key, value in (update.get("$set") or {}).items():
            found[key] = value
        for key, value in (update.get("$inc") or {}).items():
            found[key] = round(float(found.get(key) or 0) + float(value), 2)
        for key in (update.get("$unset") or {}):
            found.pop(key, None)
        return SimpleNamespace(modified_count=1)

    async def delete_one(self, query):
        for doc_id, doc in list(self.docs.items()):
            if match_query(doc, query or {}):
                del self.docs[doc_id]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


def _acc(aid, kind, **extra):
    doc = {
        "_id": aid,
        "company_id": "co",
        "type": kind,
        "account_name": aid,
        "bank_name": aid,
        "current_balance": 0.0,
        "currency": "TRY",
    }
    doc.update(extra)
    return doc


ALI_BAL_TXS = [
    {"type": "capital_in", "amount": 100000, "description": "para koy"},
    {"type": "capital_in", "amount": 25000, "contact_id": "c-pay", "description": "cari ödeme"},
    {"type": "withdrawal", "amount": 78400, "contact_id": "c-col", "description": "cari tahsilat"},
    {"type": "withdrawal", "amount": 12000, "description": "Virman → ortak"},
    {"type": "withdrawal", "amount": 8000, "description": "hesap→ortak"},
    {"type": "credit", "amount": 705389.78, "description": "Ortak Alacak Fişi"},
    {"type": "salary", "amount": 150000, "description": "Eylül maaşı"},
    {"type": "credit", "amount": 39200, "expense_id": "msr", "source": "expense", "description": "MSR masraf"},
    {"type": "debit", "amount": 15000, "description": "borç fişi"},
    {"type": "withdrawal", "amount": 80000, "source": "bank_match", "bank_tx_type": "outflow", "description": "banka çıkış"},
    {"type": "capital_in", "amount": 40000, "source": "bank_match", "bank_tx_type": "inflow", "description": "banka giriş"},
    {"type": "profit_share", "amount": 20000, "is_paid": False, "description": "tahakkuk kâr payı"},
    {"type": "profit_share", "amount": 9000, "is_paid": True, "description": "ödenmiş kâr payı"},
]


def test_ali_bal_card_equals_list_delta():
    annotated = [partner_pay.annotate_partner_tx(tx) for tx in ALI_BAL_TXS]
    assert annotated[2]["balance_delta"] == 78400
    assert annotated[2]["side"] == "giris"
    assert annotated[5]["balance_delta"] == pytest.approx(-705389.78)
    assert annotated[5]["side"] == "cikis"
    assert annotated[12]["balance_delta"] == 0
    assert annotated[12]["side"] == "zero"
    cash = partner_pay.cash_card_totals(ALI_BAL_TXS)
    ledger = partner_pay.ledger_totals(ALI_BAL_TXS)
    assert cash["cash_in"] == pytest.approx(278400)
    assert cash["cash_out"] == pytest.approx(994589.78)
    assert cash["cash_net"] == pytest.approx(-716189.78)
    assert ledger["balance"] == pytest.approx(cash["cash_net"])
    view = partner_pay.company_partner_balances(
        [{"_id": "ali", "name": "Ali BAL", "balance": 0, "share_percent": 50}],
        [{**tx, "partner_id": "ali"} for tx in ALI_BAL_TXS],
    )
    assert view["total_balance"] == pytest.approx(-716189.78)
    assert view["partners"][0]["balance_display"] == pytest.approx(716189.78)
    assert view["partners"][0]["balance_label"] == "Ortak alacaklı"
    payload = partner_pay.summary_payload({**view, "cash": cash, "source_partners": view["partners"]})
    assert payload["total_cash_in"] == pytest.approx(cash["cash_in"])
    assert payload["total_cash_out"] == pytest.approx(cash["cash_out"])
    assert payload["total_card_pocket"] == pytest.approx(view["total_balance"])


def test_partner_row_uses_posting_inc_card_and_shows_stale_cache_drift():
    """Eski işaretle kaydedilmiş partners.balance kartı sapıtmaz; fark önbelleği gösterir.

    Kart bakiyesi = Toplam Giriş − Toplam Çıkış (posting_inc ile aynı kasa yönü).
    kayitli_bakiye = partners.balance; fark = kayitli − liste_net. Yazma yok.
    """
    cash = partner_pay.cash_card_totals(ALI_BAL_TXS)
    giris, cikis = cash["cash_in"], cash["cash_out"]
    live = round(sum(float(partner_pay.posting_inc(tx)["balance"]) for tx in ALI_BAL_TXS), 2)
    assert live == pytest.approx(giris - cikis)
    assert live == pytest.approx(cash["cash_net"])
    assert live == pytest.approx(-716189.78)
    stale = round(-live, 2)  # eski işaret: kasa yönünün tersi kaydedilmiş
    partner = {"_id": "ali", "company_id": "co", "name": "Ali BAL", "balance": stale}
    txs = [{**tx, "partner_id": "ali", "company_id": "co", "_id": f"pt{i}"} for i, tx in enumerate(ALI_BAL_TXS)]

    row = balance_reconciliation._partner_row(partner, txs)
    assert row["kart_bakiyesi"] == pytest.approx(giris - cikis)
    assert row["kart_bakiyesi"] == pytest.approx(live)
    assert row["kart_bakiyesi"] != pytest.approx(stale)
    assert row["kayitli_bakiye"] == pytest.approx(stale)
    assert row["liste_giris"] == pytest.approx(giris)
    assert row["liste_cikis"] == pytest.approx(cikis)
    assert row["liste_net"] == pytest.approx(live)
    assert row["fark"] == pytest.approx(stale - live)
    assert "liste_lehine" not in row
    assert "liste_aleyhine" not in row
    assert partner_pay.present_partner_balance(row["kart_bakiyesi"])["label"] == "Ortak alacaklı"
    credit = balance_reconciliation._partner_row(
        {"_id": "m", "name": "Mustafa", "balance": 0},
        [{"type": "capital_in", "amount": 5000}],
    )
    assert credit["kart_bakiyesi"] == pytest.approx(5000)
    assert partner_pay.present_partner_balance(credit["kart_bakiyesi"])["label"] == "Ortak borçlu"

    db = MemoryDB()
    db.partners.docs["ali"] = copy.deepcopy(partner)
    for tx in txs:
        db.partner_transactions.docs[tx["_id"]] = copy.deepcopy(tx)

    async def scenario():
        before = {k: copy.deepcopy(v.docs) for k, v in db._cols.items()}
        report = await balance_reconciliation.build_reconciliation(db, "co")
        after = {k: copy.deepcopy(v.docs) for k, v in db._cols.items()}
        for key, docs in before.items():
            assert after.get(key) == docs
        for key, docs in after.items():
            if key not in before:
                assert docs == {}
        assert report["read_only"] is True
        found = {r["id"]: r for r in report["partners"]}["ali"]
        assert found["kart_bakiyesi"] == pytest.approx(giris - cikis)
        assert found["kayitli_bakiye"] == pytest.approx(stale)
        assert found["liste_giris"] == pytest.approx(giris)
        assert found["liste_cikis"] == pytest.approx(cikis)
        assert found["fark"] == pytest.approx(stale - found["liste_net"])
        csv = balance_reconciliation.render_csv(report)
        assert "liste_giris" in csv
        assert "liste_cikis" in csv
        assert "kayitli_bakiye" in csv
        assert "liste_lehine" not in csv
        assert "liste_aleyhine" not in csv
        lines = balance_reconciliation.report_lines(report)
        assert all(len(line) == len(lines[0]) for line in lines)
        partner_line = next(line for line in lines if line[0] == "ortak")
        header = lines[0]
        assert header.index("liste_giris") > 0
        assert partner_line[header.index("kart_bakiyesi")] == f"{giris - cikis:.2f}"
        assert partner_line[header.index("kayitli_bakiye")] == f"{stale:.2f}"
        assert partner_line[header.index("liste_giris")] == f"{giris:.2f}"
        assert partner_line[header.index("liste_cikis")] == f"{cikis:.2f}"
        assert partner_line[header.index("fark")] == f"{stale - live:.2f}"
        return report

    _run(scenario())


def test_signed_amount_zero_rules():
    aid = "acc"
    pool = _acc("pool", "credit_card", is_customer_card_pool=True)
    assert account_balance.tx_signed_amount({"account_id": aid, "type": "inflow", "amount": 10, "source": "ledger"}, aid) == 0
    assert account_balance.tx_signed_amount(
        {"account_id": "pool", "type": "inflow", "amount": 10, "customer_card_pool_ledger": True},
        "pool",
    ) == 0
    assert account_balance.tx_signed_amount(
        {
            "account_id": "card",
            "customer_card_account_id": "card",
            "via_customer_card": True,
            "type": "inflow",
            "amount": 10,
        },
        "card",
    ) == 0
    assert account_balance.tx_signed_amount({"account_id": "pool", "type": "inflow", "amount": 40}, "pool", pool) == 0
    assert account_balance.tx_signed_amount(
        {"account_id": aid, "type": "outflow", "amount": 15, "source": "card_statement"},
        aid,
    ) == 0
    assert account_balance.card_statement_signed_amount({"source": "card_statement", "amount": 15}) == 0
    assert account_balance.tx_signed_amount(
        {"account_id": aid, "type": "inflow", "amount": 80, "source": "marketplace_settlement_expected", "balance_posted": False},
        aid,
    ) == 0
    assert account_balance.tx_signed_amount(
        {"account_id": aid, "type": "inflow", "amount": 20, "status": "cancelled"},
        aid,
    ) == 0
    assert account_balance.tx_signed_amount(
        {"account_id": aid, "type": "outflow", "amount": 12, "source": "pos_cancel"},
        aid,
    ) == -12


def test_reverse_matches_signed_amount_for_each_account_kind():
    import server

    db = MemoryDB()
    kinds = {
        "cash": _acc("cash", "cash_box"),
        "bank": _acc("bank", "bank"),
        "integrated": _acc("integrated", "bank", bank_reported_balance=500),
        "pos": _acc("pos", "pos"),
        "company_card": _acc("company_card", "credit_card"),
        "customer_card": _acc("customer_card", "credit_card", card_owner="customer", linked_contact_id="ct"),
        "pool": _acc("pool", "credit_card", is_customer_card_pool=True),
    }
    for acc in kinds.values():
        db.bank_accounts.docs[acc["_id"]] = copy.deepcopy(acc)

    async def scenario():
        server.db = db
        # Açılış, tahsilat, ödeme
        opening = {"_id": "op", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 1000, "source": "opening"}
        collect = {"_id": "col", "company_id": "co", "account_id": "bank", "type": "inflow", "amount": 250, "source": "manual", "contact_id": "ct"}
        pay = {"_id": "pay", "company_id": "co", "account_id": "bank", "type": "outflow", "amount": 40, "source": "manual", "contact_id": "ct"}
        transfer = {"_id": "tr", "company_id": "co", "account_id": "cash", "target_account_id": "pos", "type": "transfer", "amount": 70, "source": "manual"}
        back = {"_id": "tr2", "company_id": "co", "account_id": "pos", "target_account_id": "cash", "type": "transfer", "amount": 15, "source": "manual"}
        # Banka eşleşmesi karşı hesap
        match_acc = {"_id": "macc", "company_id": "co", "account_id": "integrated", "type": "outflow", "amount": 30, "source": "bank_sync"}
        counter = {"_id": "mcnt", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 30, "source": "bank_match", "related_bank_tx_id": "macc"}
        expense_row = {"_id": "mexp", "company_id": "co", "account_id": "company_card", "type": "outflow", "amount": 18, "source": "expense"}
        partner_row = {"_id": "mpar", "company_id": "co", "account_id": "bank", "type": "outflow", "amount": 22, "source": "bank_match"}
        invoice_row = {"_id": "minv", "company_id": "co", "account_id": "bank", "type": "inflow", "amount": 90, "source": "bank_match", "related_invoice_id": "inv1", "contact_id": "ct"}
        contact_row = {"_id": "mcon", "company_id": "co", "account_id": "pos", "type": "inflow", "amount": 11, "source": "bank_match", "contact_id": "ct"}
        card_line = {"_id": "cst", "company_id": "co", "account_id": "company_card", "type": "outflow", "amount": 500, "source": "card_statement"}
        expected = {"_id": "expset", "company_id": "co", "account_id": "integrated", "type": "inflow", "amount": 400, "source": "marketplace_settlement_expected", "balance_posted": False}
        posted_settle = {"_id": "set", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 55, "source": "marketplace_settlement"}
        pool_row = {"_id": "pooltx", "company_id": "co", "account_id": "pool", "type": "inflow", "amount": 77, "customer_card_pool_ledger": True}
        via_card = {
            "_id": "via",
            "company_id": "co",
            "account_id": "customer_card",
            "customer_card_account_id": "customer_card",
            "via_customer_card": True,
            "type": "inflow",
            "amount": 33,
        }
        ledger = {"_id": "led", "company_id": "co", "account_id": "cash", "type": "inflow", "amount": 999, "source": "ledger"}
        sale = {"_id": "sale", "company_id": "co", "account_id": "pos", "type": "inflow", "amount": 120, "source": "pos_quick", "invoice_id": "fiş"}
        rows = [opening, collect, pay, transfer, back, match_acc, counter, expense_row, partner_row, invoice_row, contact_row, card_line, expected, posted_settle, pool_row, via_card, ledger, sale]
        db.invoices.docs["inv1"] = {"_id": "inv1", "company_id": "co", "paid_amount": 0, "grand_total": 90, "contact_id": "ct"}
        db.contacts.docs["ct"] = {"_id": "ct", "company_id": "co", "balance": 0, "name": "Cari"}
        for row in rows:
            await db.bank_transactions.insert_one(row)
            await server._reverse_tx_effects(row, +1)
        cancel = account_balance.pos_cancel_outflow_doc(sale, now_iso="2026-10-14T00:00:00+00:00", today="2026-10-14")
        await db.bank_transactions.insert_one(cancel)
        await db.bank_accounts.update_one({"_id": cancel["account_id"]}, {"$inc": {"current_balance": -float(cancel["amount"])}})
        # Çöpe at + geri getir (tahsilat)
        await server._reverse_tx_effects(collect, -1)
        await db.bank_transactions.delete_one({"_id": collect["_id"]})
        await db.bank_transactions.insert_one(collect)
        await server._restore_bank_tx(collect, [])
        for acc in kinds.values():
            stored = (await db.bank_accounts.find_one({"_id": acc["_id"]}))["current_balance"]
            live_acc = await db.bank_accounts.find_one({"_id": acc["_id"]})
            txs = await account_balance.fetch_account_txs(db, acc["_id"])
            moved = account_balance.movement_balance(txs, acc["_id"], live_acc)
            assert stored == pytest.approx(moved), acc["_id"]
            if acc["_id"] != "cash":
                # Kasa dışı otomatik düzeltme yok: annotate yalnız işaretler.
                before = stored
                await account_balance.annotate_listed_accounts(db, "co", [live_acc])
                after = (await db.bank_accounts.find_one({"_id": acc["_id"]}))["current_balance"]
                assert after == pytest.approx(before)
        cash = await db.bank_accounts.find_one({"_id": "cash"})
        await account_balance.sync_cash_box_balances(db, [cash])
        cash = await db.bank_accounts.find_one({"_id": "cash"})
        txs = await account_balance.fetch_account_txs(db, "cash")
        assert cash["current_balance"] == pytest.approx(account_balance.movement_balance(txs, "cash", cash))
        # POS iptal karşı hareket durur; senkron satışı tek başına geri açmaz.
        pos = await db.bank_accounts.find_one({"_id": "pos"})
        pos_txs = await account_balance.fetch_account_txs(db, "pos")
        assert any(t.get("source") == "pos_cancel" for t in pos_txs)
        assert pos["current_balance"] == pytest.approx(account_balance.movement_balance(pos_txs, "pos", pos))
        # Havuz 0, beklenen hakediş bakiyeye yazılmadı
        pool = await db.bank_accounts.find_one({"_id": "pool"})
        assert pool["current_balance"] == 0
        integrated = await db.bank_accounts.find_one({"_id": "integrated"})
        assert integrated.get("bank_reported_balance") == 500
        listed = await account_balance.annotate_listed_accounts(db, "co", [copy.deepcopy(integrated)])
        assert listed[0]["ledger_balance"] == pytest.approx(integrated["current_balance"])
        assert listed[0]["bank_balance_drift"] is True
        report_before = {k: copy.deepcopy(v.docs) for k, v in db._cols.items()}
        report = await balance_reconciliation.build_reconciliation(db, "co")
        report_after = {k: copy.deepcopy(v.docs) for k, v in db._cols.items()}
        for key, docs in report_before.items():
            assert report_after.get(key) == docs
        for key, docs in report_after.items():
            if key not in report_before:
                assert docs == {}
        by_id = {row["id"]: row for row in report["accounts"]}
        for aid, acc in kinds.items():
            row = by_id[acc["_id"]]
            assert row["fark"] == pytest.approx(0), aid
        assert report["read_only"] is True
        assert "hesap" in balance_reconciliation.render_csv(report)

    _run(scenario())


def test_statement_duplicate_suspect_and_match_conflict():
    import server

    db = MemoryDB()
    manual = {
        "_id": "man1",
        "company_id": "co",
        "account_id": "bank",
        "contact_id": "ct1",
        "type": "inflow",
        "amount": 150,
        "date": "2026-10-02",
        "source": "manual",
    }
    db.bank_transactions.docs["man1"] = copy.deepcopy(manual)
    db.contacts.docs["ct1"] = {"_id": "ct1", "company_id": "co", "name": "Ferhat", "balance": 10}

    async def enrich():
        finance.init(db)
        rows = await finance._enrich_statement_lines(
            "co",
            [{
                "date": "2026-10-04",
                "description": "havale",
                "amount": 150,
                "contact_id": "ct1",
            }],
            is_card=False,
            account_id="bank",
        )
        far = await finance._enrich_statement_lines(
            "co",
            [{
                "date": "2026-10-20",
                "description": "havale",
                "amount": 150,
                "contact_id": "ct1",
            }],
            is_card=False,
            account_id="bank",
        )
        return rows, far

    near, far = _run(enrich())
    assert near[0]["duplicate_suspect"] is True
    assert near[0]["included"] is False
    assert near[0]["duplicate_of"] == "man1"
    assert far[0]["duplicate_suspect"] is False

    bank_line = {
        "_id": "sync1",
        "company_id": "co",
        "account_id": "bank",
        "type": "inflow",
        "amount": 150,
        "date": "2026-10-03",
        "source": "bank_sync",
        "description": "havale",
        "match_status": "unmatched",
    }
    db.bank_transactions.docs["sync1"] = copy.deepcopy(bank_line)

    async def conflict():
        server.db = db
        with pytest.raises(HTTPException) as ei:
            await server._apply_match(bank_line, "ct1", None, "Cari Tahsilat", learn=False)
        assert ei.value.status_code == 409
        assert ei.value.detail["action"] == "mevcut kayda bağla"
        assert ei.value.detail["existing_tx_id"] == "man1"
        linked = await server._apply_match(
            bank_line, "ct1", None, "Cari Tahsilat", learn=False, link_existing_id="man1",
        )
        return linked

    linked = _run(conflict())
    assert linked["linked_existing"] is True
    assert linked["related_manual_tx_id"] == "man1"
    assert db.contacts.docs["ct1"]["balance"] == 10

    async def overpay():
        server.db = db
        db.invoices.docs["inv"] = {"_id": "inv", "company_id": "co", "grand_total": 100, "paid_amount": 80, "contact_id": "ct1"}
        fresh = {**bank_line, "_id": "sync2", "amount": 30, "date": "2026-11-01"}
        db.bank_transactions.docs["sync2"] = copy.deepcopy(fresh)
        with pytest.raises(HTTPException) as ei:
            await server._apply_match(fresh, "ct1", "inv", None, learn=False)
        assert ei.value.status_code == 400

    _run(overpay())


def _role_doc(company_id, code):
    return {
        "_id": f"role_{company_id}_{code}",
        "company_id": company_id,
        "code": code,
        "name": code,
        "is_system": True,
        "permissions": {},
    }


def _bind_company_roles(monkeypatch, docs):
    import rbac

    class Col:
        async def find_one(self, query):
            for doc in docs:
                if all(doc.get(k) == v for k, v in (query or {}).items()):
                    return copy.deepcopy(doc)
            return None

    class DB:
        roles = Col()

    async def _noop(_cid):
        return None

    monkeypatch.setattr(rbac, "_db", DB())
    monkeypatch.setattr(rbac, "ensure_roles", _noop)


def test_reconciliation_endpoint_is_read_only_for_admin(monkeypatch):
    import server

    _bind_company_roles(monkeypatch, [
        _role_doc("co", "admin"),
        _role_doc("co", "accountant"),
        _role_doc("co", "advisor"),
        _role_doc("co", "sales"),
        _role_doc("co", "personel"),
        _role_doc("co", "manager"),
        _role_doc("other", "admin"),
        _role_doc("here", "sales"),
        _role_doc("here", "personel"),
    ])
    db = MemoryDB()
    db.bank_accounts.docs["a"] = _acc("a", "bank", current_balance=10)
    db.bank_transactions.docs["t"] = {
        "_id": "t", "company_id": "co", "account_id": "a", "type": "inflow", "amount": 10, "source": "manual",
    }

    async def call(user, company_id="co"):
        server.db = db
        return await server.banking_reconciliation(company_id, user)

    out = _run(call({"role": "accountant", "company_ids": ["co"], "active_company_id": "co"}))
    assert out["accounts"][0]["fark"] == 0
    out = _run(call({"role": "advisor", "company_ids": ["co"], "active_company_id": "co"}))
    assert out["accounts"][0]["fark"] == 0
    out = _run(call({"role": "owner", "company_ids": ["co"], "active_company_id": "co"}))
    assert out["accounts"][0]["fark"] == 0
    out = _run(call({
        "role": "sales", "is_super_admin": True, "company_ids": ["co"], "active_company_id": "co",
    }))
    assert out["summary"]["account_count"] == 1
    for denied in ("sales", "personel", "manager"):
        with pytest.raises(HTTPException) as ei:
            _run(call({"role": denied, "company_ids": ["co"], "active_company_id": "co"}))
        assert ei.value.status_code == 403
    # Aynı kullanıcının global rolü admin; diğer şirkette admin belgesi var, burada yok → personel.
    cross = {
        "role": "admin",
        "company_ids": ["other", "here"],
        "active_company_id": "other",
    }
    out = _run(call(cross, "other"))
    assert out["accounts"] == []
    with pytest.raises(HTTPException) as ei:
        _run(call(cross, "here"))
    assert ei.value.status_code == 403


def test_reconciliation_denies_admin_of_another_company(monkeypatch):
    """Global rol admin olsa da istenen şirkette sales/personel ise 403."""
    import rbac
    import server

    db = MemoryDB()

    async def call(user, company_id):
        server.db = db
        return await server.banking_reconciliation(company_id, user)

    seen = []

    async def role_for(user, company_id=None):
        seen.append(company_id)
        code = (user.get("company_roles") or {}).get(company_id) or user.get("role")
        return {"code": code, "company_id": company_id, "permissions": {}}

    monkeypatch.setattr(rbac, "role_for", role_for)
    user = {
        "role": "admin",
        "company_ids": ["other", "here"],
        "active_company_id": "other",
        "company_roles": {"other": "admin", "here": "sales"},
    }
    out = _run(call(user, "other"))
    assert out["accounts"] == []
    assert seen == ["other"]
    for here_role in ("sales", "personel"):
        seen.clear()
        user["company_roles"]["here"] = here_role
        with pytest.raises(HTTPException) as ei:
            _run(call(user, "here"))
        assert ei.value.status_code == 403
        assert seen == ["here"]
    seen.clear()
    user["company_roles"]["here"] = "owner"
    out = _run(call(user, "here"))
    assert "accounts" in out
    user["company_roles"]["here"] = "advisor"
    out = _run(call(user, "here"))
    assert "accounts" in out
    seen.clear()
    outsider = {"role": "admin", "company_ids": ["other"], "active_company_id": "other"}
    with pytest.raises(HTTPException) as ei:
        _run(call(outsider, "here"))
    assert ei.value.status_code == 403
    assert seen == []


def test_script_uses_named_db_and_reads_only(capsys, monkeypatch):
    script_path = Path(__file__).resolve().parents[1] / "scripts" / "balance_reconciliation.py"
    spec = importlib.util.spec_from_file_location("balance_recon_script", script_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)

    monkeypatch.setattr(sys, "argv", ["balance_reconciliation.py", "--company", "co"])
    monkeypatch.setattr("mysql_store.mysql_settings_from_env", lambda: {"db": ""})
    with pytest.raises(SystemExit) as ei:
        mod.main()
    assert ei.value.code == 2

    holder = {}

    class Client:
        def __getitem__(self, name):
            holder["name"] = name
            db = MemoryDB()
            db.bank_accounts.docs["a"] = _acc("a", "cash_box", current_balance=0)
            holder["db"] = db
            return db

        def close(self):
            holder["closed"] = True

    monkeypatch.setattr(sys, "argv", ["balance_reconciliation.py", "--company", "co", "--db", "tamkobi_x", "--format", "csv"])
    import mysql_store
    monkeypatch.setattr(mysql_store, "MySQLClient", Client)
    monkeypatch.setattr(mysql_store, "mysql_settings_from_env", lambda: {"db": "ignored"})
    with pytest.raises(SystemExit) as ei:
        mod.main()
    assert ei.value.code == 0
    assert holder["name"] == "tamkobi_x"
    assert holder["closed"] is True
    out = capsys.readouterr().out
    assert "hesap" in out
    assert holder["db"].bank_accounts.docs["a"]["current_balance"] == 0


IBAN_A = "TR110006200000000000000001"
IBAN_B = "TR330006100519786457841326"
IBAN_SHARED = "TR330006200519786457841234"


def test_same_name_different_banks_do_not_warn():
    accounts = [
        _acc("a1", "bank", bank_name="Kuveyt Türk", account_name="Vadesiz TL Hesabı", iban=IBAN_A),
        _acc("a2", "bank", bank_name="Enpara", account_name="Vadesiz TL Hesabı", iban=IBAN_B),
    ]
    conns = [
        {"_id": "c1", "linked_account_id": "a1"},
        {"_id": "c2", "linked_account_id": "a2"},
    ]
    assert balance_reconciliation.link_warnings(accounts, conns) == []


def test_same_iban_warns_with_bank_name_and_last4():
    accounts = [
        _acc("a1", "bank", bank_name="Kuveyt Türk", account_name="Vadesiz TL Hesabı", iban=IBAN_SHARED),
        _acc("a2", "bank", bank_name="Enpara", account_name="Vadesiz TL Hesabı", iban=IBAN_SHARED),
    ]
    conns = [
        {"_id": "c1", "linked_account_id": "a1", "bank_account_number": IBAN_SHARED},
        {"_id": "c2", "linked_account_id": "a2", "bank_account_number": "TR33 0006 2005 1978 6457 8412 34"},
    ]
    warnings = balance_reconciliation.link_warnings(accounts, conns)
    assert [w["tur"] for w in warnings] == ["cift_iban"]
    msg = warnings[0]["mesaj"]
    assert "Kuveyt Türk" in msg and "Enpara" in msg
    assert "…1234" in msg
    assert IBAN_SHARED not in msg
    assert "cift_hesap_adi" not in {w["tur"] for w in warnings}
    assert "Aynı adlı" not in msg


def test_reconciliation_row_and_csv_use_turkish_labels():
    import account_label

    assert account_label.account_type_label("bank") == "Banka hesabı"
    assert account_label.account_type_label("cash_box") == "Kasa"
    assert account_label.account_type_label("pos") == "POS"
    assert account_label.account_type_label("okc_pos") == "ÖKC"
    assert account_label.account_type_label("credit_card") == "Kredi kartı"
    acc = _acc(
        "kt",
        "bank",
        bank_name="Kuveyt Türk",
        account_name="Vadesiz TL Hesabı",
        iban=IBAN_SHARED,
        current_balance=10,
    )
    row = balance_reconciliation._account_row(acc, [], integrated=True)
    assert row["bank_name"] == "Kuveyt Türk"
    assert row["masked_ref"] == "…1234"
    assert row["tur"] == "bank"
    assert IBAN_SHARED not in row["masked_ref"]
    csv = balance_reconciliation.render_csv({
        "accounts": [row],
        "partners": [],
        "contacts": [],
        "summary": {},
    })
    assert "Kuveyt Türk · Vadesiz TL Hesabı · …1234 · entegre" in csv
    assert "Banka hesabı" in csv
    assert "bank_name" in csv.splitlines()[0]
    assert "masked_ref" in csv.splitlines()[0]
    assert IBAN_SHARED not in csv
