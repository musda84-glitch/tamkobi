"""Ortak hareket sayfası, eski defterle aynı küme, sıra ve yön.

period_in / period_out / ledger filtrelenmiş tüm kümenin partner_tx_effect
toplamıdır (Giriş − Çıkış). Sayfa dilimi toplamı değiştirmez. İptal satırı
listede kalır; inline kaynak alanları (source, source_id, expense_id) düşmez.

MySQL karşılaştırması yalnız TAMKOBI_TEST_MYSQL_URL (yoksa yerel
tamkobi_pushdown). Ulaşılamazsa skip. MYSQL_URL / canlı veritabanı okunmaz.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
import uuid
from pathlib import Path
from unittest.mock import MagicMock
from urllib.parse import unquote, urlparse

import pytest
from fastapi import HTTPException
from fastapi.routing import APIRoute

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import partner_pay  # noqa: E402
import partner_tx_page  # noqa: E402
from mysql_store import match_query  # noqa: E402

CID = "c-ppage-1"
OTHER = "c-ppage-2"
PID = "p-ali"
P2 = "p-veli"

EXPECTED_ORDER = [
    "ist-next", "z-new", "ist-day", "ist-late", "dmy",
    "tie-b", "tie-a", "salary", "profit-acc", "profit-paid",
    "virman-out", "virman-in", "cancel", "src-line",
    "bank-in", "bank-out", "contact-col", "contact-pay",
]
EXPECTED_IN = 1191.0
EXPECTED_OUT = 238.0
EXPECTED_NET = 953.0


def _tx(**kwargs):
    doc = {
        "company_id": CID,
        "partner_id": PID,
        "partner_name": "Ali",
        "type": "capital_in",
        "amount": 0,
        "created_at": "2026-10-01T00:00:00Z",
        "date": "2026-10-01",
        "description": kwargs.get("type") or "hareket",
    }
    doc.update(kwargs)
    doc["_id"] = kwargs["_id"]
    return doc


def _seed_docs():
    partners = [
        {"_id": PID, "company_id": CID, "name": "Ali", "balance": 1.0, "created_at": "2026-01-01T00:00:00Z"},
        {"_id": P2, "company_id": CID, "name": "Veli", "balance": 0.0, "created_at": "2026-01-02T00:00:00Z"},
        {"_id": "p-foreign", "company_id": OTHER, "name": "Yabanci", "balance": 9.0, "created_at": "2026-01-03T00:00:00Z"},
    ]
    txs = [
        _tx(_id="ist-next", date="2026-10-16T21:30:00Z", created_at="2026-10-16T21:30:00Z", amount=8, description="ertesi gün"),
        _tx(_id="z-new", date="2026-10-16", created_at="2026-10-16T12:00:00Z", amount=1000, description="Sermaye girişi özel damga"),
        _tx(_id="ist-day", date="2026-10-16", created_at="2026-10-16T08:00:00Z", type="withdrawal", amount=10, description="çekim"),
        _tx(_id="ist-late", date="2026-10-15T21:30:00Z", created_at="2026-10-15T21:30:00Z", amount=4, description="istanbul gecesi"),
        _tx(_id="dmy", date="15.10.2026", created_at="2026-10-15T01:00:00Z", type="withdrawal", amount=6, description="dmy"),
        _tx(_id="tie-b", date="2026-10-12", created_at="2026-10-12T10:00:00Z", type="credit", amount=20, description="alacak"),
        _tx(_id="tie-a", date="2026-10-12", created_at="2026-10-12T10:00:00Z", type="debit", amount=15, description="borç"),
        _tx(_id="salary", date="2026-10-11", created_at="2026-10-11T10:00:00Z", type="salary", amount=100, description="Ekim maaşı"),
        _tx(_id="profit-acc", date="2026-10-10", created_at="2026-10-10T12:00:00Z", type="profit_share", amount=50, is_paid=False, description="kâr tahakkuku"),
        _tx(_id="profit-paid", date="2026-10-10", created_at="2026-10-10T11:00:00Z", type="profit_share", amount=30, is_paid=True, description="kâr ödemesi"),
        _tx(_id="virman-out", date="2026-10-09", created_at="2026-10-09T12:00:00Z", type="withdrawal", amount=25, description="Virman → ortak"),
        _tx(_id="virman-in", date="2026-10-09", created_at="2026-10-09T11:00:00Z", type="capital_in", amount=40, description="Virman ← ortak"),
        _tx(_id="cancel", date="2026-10-08", created_at="2026-10-08T10:00:00Z", type="withdrawal", amount=7, status="cancelled", description="iptal"),
        _tx(
            _id="src-line", date="2026-10-07", created_at="2026-10-07T10:00:00Z", type="credit", amount=40,
            source="expense", expense_id="exp-1", source_type="expense", source_id="exp-1",
            description="MSR kaynak satırı",
        ),
        _tx(
            _id="bank-in", date="2026-10-06", created_at="2026-10-06T10:00:00Z", type="withdrawal", amount=80,
            source="bank_match", bank_tx_type="outflow", description="banka çıkış",
        ),
        _tx(
            _id="bank-out", date="2026-10-05", created_at="2026-10-05T10:00:00Z", type="capital_in", amount=12,
            source="bank_match", bank_tx_type="inflow", related_bank_tx_id="btx-1", description="banka giriş",
        ),
        _tx(_id="contact-col", date="2026-10-04", created_at="2026-10-04T10:00:00Z", type="withdrawal", amount=9, contact_id="c1", description="cari tahsilat"),
        _tx(_id="contact-pay", date="2026-10-03", created_at="2026-10-03T10:00:00Z", type="capital_in", amount=3, contact_id="c1", description="cari ödeme"),
        _tx(_id="other-partner", partner_id=P2, date="2026-10-20", created_at="2026-10-20T00:00:00Z", amount=5, description="baska ortak"),
        _tx(_id="foreign", company_id=OTHER, partner_id=PID, date="2026-10-20", created_at="2026-10-20T23:00:00Z", amount=10000, description="baska firma"),
    ]
    return partners, txs


def _legacy_sort(rows):
    def key(tx):
        created = str(tx.get("created_at") or tx.get("matched_at") or "")
        ident = str(tx.get("_id") or tx.get("id") or "")
        return (partner_tx_page.bank_tx_page.date_sort_key(tx.get("date")), created, ident)
    return sorted(rows, key=key, reverse=True)


def _legacy_rows(all_txs, partner_id, *, date_from="", date_to="", q="", tx_type=""):
    rows = [
        tx for tx in all_txs
        if tx.get("company_id") == CID and tx.get("partner_id") == partner_id
    ]
    kept = [
        tx for tx in rows
        if partner_tx_page.tx_matches_filters(tx, date_from=date_from, date_to=date_to, q=q, tx_type=tx_type)
    ]
    return _legacy_sort(kept)


def _legacy_flows(rows):
    """Eski yön: partner_tx_effect. Giriş pozitif delta, Çıkış mutlak negatif."""
    giris = 0.0
    cikis = 0.0
    for tx in rows:
        delta = float(partner_pay.partner_tx_effect(tx)["delta"])
        if delta > 0:
            giris += delta
        elif delta < 0:
            cikis += -delta
    return round(giris, 2), round(cikis, 2)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else key
        return self

    async def to_list(self, length=None):
        from mysql_store import sort_docs
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, db, name, docs):
        self.db = db
        self.name = name
        self.docs = docs

    def _match(self, query):
        return [d for d in self.docs if match_query(d, query or {})]

    def find(self, query=None, projection=None):
        self.db.log.append(("find", self.name, copy.deepcopy(query)))
        return MemCursor(self._match(query))

    async def find_one(self, query=None, projection=None):
        self.db.log.append(("find_one", self.name, copy.deepcopy(query)))
        rows = self._match(query)
        return copy.deepcopy(rows[0]) if rows else None

    async def update_one(self, *args, **kwargs):
        self.db.writes.append(("update", self.name))

    async def insert_one(self, *args, **kwargs):
        self.db.writes.append(("insert", self.name))

    async def delete_one(self, *args, **kwargs):
        self.db.writes.append(("delete", self.name))


class MemDB:
    def __init__(self, partners, txs):
        self.log = []
        self.writes = []
        self.partners = MemColl(self, "partners", partners)
        self.partner_transactions = MemColl(self, "partner_transactions", txs)

    def __getitem__(self, name):
        return getattr(self, name)


def _partner(db, pid):
    return next(p for p in db.partners.docs if p["_id"] == pid)


def _run(coro):
    return asyncio.run(coro)


async def _collect(db, partner, page_size=2, **filters):
    page = 1
    ids = []
    bodies = []
    while page < 50:
        body = await partner_tx_page.list_partner_transactions(
            db, partner, page=page, page_size=page_size, **filters,
        )
        bodies.append(body)
        ids.extend(item["id"] for item in body["items"])
        if not body["has_more"]:
            return ids, bodies
        page += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


def test_query_is_equality_and_old_list_limit_stays():
    from mysql_store import plan_exact_page

    src = Path(__file__).resolve().parents[1].joinpath("partner_tx_page.py").read_text(encoding="utf-8")
    assert '"$or"' not in src and "'$or'" not in src
    server = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    assert 'db.partner_transactions.find(query).sort([("date", -1), ("created_at", -1)]).to_list(20000)' in server
    assert '"/banking/partners/ledgers"' in server
    assert '"/banking/partners/{partner_id}/transactions"' in server
    partners_at = server.index("# ----------------- ORTAKLAR HESABI -----------------")
    bank_at = server.index('"/banking/accounts/{account_id}/transactions"')
    assert partners_at > bank_at
    assert server.index('"/banking/partners/ledgers"') > partners_at
    query = {"company_id": CID, "partner_id": PID}
    plan = plan_exact_page(
        "partner_transactions", query, partner_tx_page.TX_SORT, 0, None, partner_tx_page.FETCH_CAP, None,
    )
    assert plan is not None
    assert "ORDER BY" in plan["sql"] and "LIMIT %s" in plan["sql"]
    assert plan["params"][-1] == partner_tx_page.FETCH_CAP
    where = plan["sql"].split("ORDER BY", 1)[0]
    assert " OR " not in where
    assert "company_id" in where and "partner_id" in where


def test_page_matches_legacy_set_order_and_direction():
    partners, txs = _seed_docs()
    db = MemDB(copy.deepcopy(partners), copy.deepcopy(txs))
    partner = _partner(db, PID)
    before_partners = copy.deepcopy(partners)
    before_txs = copy.deepcopy(txs)

    async def _go():
        ids, bodies = await _collect(db, partner, page_size=2)
        tail = await partner_tx_page.list_partner_transactions(db, partner, page=99, page_size=2)
        wide = await partner_tx_page.list_partner_transactions(db, partner, page=1, page_size=999)
        day = await partner_tx_page.list_partner_transactions(
            db, partner, page=1, page_size=50, date_from="2026-10-16", date_to="2026-10-16",
        )
        searched = await partner_tx_page.list_partner_transactions(
            db, partner, page=1, page_size=50, q="özel damga",
        )
        salaries = await partner_tx_page.list_partner_transactions(
            db, partner, page=1, page_size=50, tx_type="salary",
        )
        ledgers = await partner_tx_page.list_company_ledgers(db, CID)
        return ids, bodies, tail, wide, day, searched, salaries, ledgers

    ids, bodies, tail, wide, day, searched, salaries, ledgers = _run(_go())
    legacy = _legacy_rows(txs, PID)
    assert [tx["_id"] for tx in legacy] == EXPECTED_ORDER
    assert ids == EXPECTED_ORDER
    flows = _legacy_flows(legacy)
    assert flows == (EXPECTED_IN, EXPECTED_OUT)
    assert round(EXPECTED_IN - EXPECTED_OUT, 2) == EXPECTED_NET
    for body in bodies:
        assert body["period_in"] == EXPECTED_IN
        assert body["period_out"] == EXPECTED_OUT
        assert body["total"] == len(EXPECTED_ORDER)
        assert body["ledger"]["ledger"] == EXPECTED_NET
        assert body["ledger"]["girisDisplay"] == EXPECTED_IN
        assert body["ledger"]["cikisDisplay"] == EXPECTED_OUT
        assert round(body["period_in"] - body["period_out"], 2) == body["ledger"]["ledger"]
        assert body["ledger"]["netMatchesCard"] is True
    assert tail["items"] == []
    assert tail["period_in"] == EXPECTED_IN and tail["period_out"] == EXPECTED_OUT
    assert tail["ledger"]["ledger"] == EXPECTED_NET
    assert wide["page_size"] == 200
    assert [item["id"] for item in wide["items"]] == EXPECTED_ORDER
    assert wide["ledger"]["stored"] == 1.0
    assert wide["ledger"]["drift"] is True
    cancel = next(item for item in wide["items"] if item["id"] == "cancel")
    assert cancel["status"] == "cancelled"
    assert cancel["balance_delta"] == partner_pay.partner_tx_effect(
        next(tx for tx in txs if tx["_id"] == "cancel")
    )["delta"]
    assert cancel["side"] == "cikis"
    src = next(item for item in wide["items"] if item["id"] == "src-line")
    assert src["source"] == "expense"
    assert src["expense_id"] == "exp-1"
    assert src["source_type"] == "expense"
    assert src["source_id"] == "exp-1"
    assert src["balance_delta"] == -40.0
    paid = next(item for item in wide["items"] if item["id"] == "profit-paid")
    assert paid["balance_delta"] == 0.0 and paid["side"] == "zero"
    assert [item["id"] for item in day["items"]] == ["z-new", "ist-day", "ist-late"]
    assert "ist-next" not in {item["id"] for item in day["items"]}
    day_rows = _legacy_rows(txs, PID, date_from="2026-10-16", date_to="2026-10-16")
    assert _legacy_flows(day_rows) == (day["period_in"], day["period_out"]) == (1004.0, 10.0)
    assert day["ledger"]["ledger"] == round(day["period_in"] - day["period_out"], 2)
    assert [item["id"] for item in searched["items"]] == ["z-new"]
    assert searched["period_in"] == 1000.0 and searched["period_out"] == 0.0
    assert [item["id"] for item in salaries["items"]] == ["salary"]
    assert salaries["period_in"] == 0.0 and salaries["period_out"] == 100.0
    assert salaries["ledger"]["ledger"] == -100.0
    assert set(ledgers) == {PID, P2}
    assert ledgers[PID]["ledger"] == EXPECTED_NET
    assert ledgers[PID]["girisDisplay"] == EXPECTED_IN
    assert ledgers[PID]["cikisDisplay"] == EXPECTED_OUT
    assert ledgers[PID]["stored"] == EXPECTED_NET
    assert ledgers[PID]["drift"] is False
    assert ledgers[P2]["ledger"] == 5.0
    assert ledgers[P2]["girisDisplay"] == 5.0
    assert ledgers[P2]["cikisDisplay"] == 0.0
    assert db.writes == []
    assert partners == before_partners
    assert txs == before_txs
    wide["items"][0]["amount"] = -1
    assert txs[0]["amount"] == before_txs[0]["amount"]


def test_find_is_one_equality_and_ledgers_reads_once():
    partners, txs = _seed_docs()
    db = MemDB(partners, txs)

    async def _go():
        db.log.clear()
        await partner_tx_page.list_partner_transactions(db, _partner(db, PID), page=1, page_size=50)
        page_finds = [entry for entry in db.log if entry[0] == "find"]
        db.log.clear()
        await partner_tx_page.list_company_ledgers(db, CID)
        ledger_finds = [entry for entry in db.log if entry[0] == "find"]
        return page_finds, ledger_finds

    page_finds, ledger_finds = _run(_go())
    assert page_finds == [("find", "partner_transactions", {"company_id": CID, "partner_id": PID})]
    assert all("$or" not in (q or {}) for _, _, q in page_finds)
    assert [name for _, name, _ in ledger_finds] == ["partners", "partner_transactions"]
    assert ledger_finds[1][2]["company_id"] == CID
    assert "$in" in ledger_finds[1][2]["partner_id"]
    assert "$or" not in ledger_finds[1][2]
    assert db.writes == []


def test_other_company_is_404_and_page_size_caps():
    partners, txs = _seed_docs()
    db = MemDB(partners, txs)
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}

    async def _go():
        own = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, PID, page=1, page_size=500,
        )
        foreign = missing = bad = None
        try:
            await partner_tx_page.list_partner_transactions_for_user(db, user_c2, PID, page=1, page_size=50)
        except HTTPException as exc:
            foreign = exc.status_code
        try:
            await partner_tx_page.list_partner_transactions_for_user(db, user_c1, "yok", page=1, page_size=50)
        except HTTPException as exc:
            missing = exc.status_code
        try:
            await partner_tx_page.list_partner_transactions(db, _partner(db, PID), tx_type="maybe")
        except HTTPException as exc:
            bad = exc.status_code
        return own, foreign, missing, bad

    own, foreign, missing, bad = _run(_go())
    assert own["page_size"] == 200
    assert own["total"] == len(EXPECTED_ORDER)
    assert foreign == 404
    assert missing == 404
    assert bad == 400
    assert db.writes == []
    assert next(p for p in partners if p["_id"] == PID)["balance"] == 1.0


def _route_gets(path):
    import server
    from starlette.routing import Match

    scope = {
        "type": "http",
        "path": path,
        "method": "GET",
        "headers": [],
        "query_string": b"",
        "scheme": "http",
        "root_path": "",
        "server": ("test", 80),
        "client": ("test", 5000),
    }
    hits = []

    def walk(routes):
        for route in routes or []:
            nested = getattr(route, "routes", None)
            if isinstance(route, APIRoute) and "GET" in (route.methods or set()):
                match, _child = route.matches(scope)
                if match == Match.FULL:
                    hits.append(route.endpoint.__name__)
            if nested and not isinstance(route, APIRoute):
                walk(nested)

    walk(server.app.routes)
    return hits


async def _collect_company(db, user, page_size=2, company_id=CID, **filters):
    page = 1
    ids = []
    bodies = []
    while page < 50:
        body = await partner_tx_page.list_partner_transactions_for_user(
            db, user, None, page=page, page_size=page_size, company_id=company_id, **filters,
        )
        bodies.append(body)
        ids.extend(item["id"] for item in body["items"])
        if not body["has_more"]:
            return ids, bodies
        page += 1
    raise AssertionError("sayfa döngüsü kapanmadı")


def test_all_partners_page_matches_legacy_list_and_does_not_write():
    import server
    from mysql_store import plan_exact_page

    partners, txs = _seed_docs()
    txs = copy.deepcopy(txs)
    txs.append(_tx(
        _id="orphan", partner_id="p-gone", date="2026-10-21",
        created_at="2026-10-21T00:00:00Z", amount=99, description="silinmis ortak",
    ))
    txs.append(_tx(
        _id="foreign-own", company_id=OTHER, partner_id="p-foreign", date="2026-10-21",
        created_at="2026-10-21T00:00:00Z", amount=7, description="yabanci ortak",
    ))
    db = MemDB(copy.deepcopy(partners), copy.deepcopy(txs))
    user_c1 = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    user_c2 = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}
    before_partners = copy.deepcopy(db.partners.docs)
    before_txs = copy.deepcopy(db.partner_transactions.docs)
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    old_at = text.index('@api_router.get("/banking/partners/transactions")\nasync def list_partner_transactions')
    old_body = text[old_at:text.index("PARTNER_TX_LABELS", old_at)]
    assert 'query["partner_id"] = {"$in": live_ids or ["__none__"]}' in old_body
    assert ".to_list(20000)" in old_body
    single_at = text.index('async def list_partner_transactions_page')
    single_body = text[single_at:text.index("@api_router.get(\"/banking/partners\")", single_at)]
    assert "partner_id," in single_body
    assert "company_id=company_id" not in single_body
    page_src = inspect.getsource(partner_tx_page.list_company_partner_transactions)
    route_src = inspect.getsource(server.list_company_partner_transactions_page)
    for src in (page_src, route_src):
        assert "insert" not in src and "update" not in src and "accrue" not in src
    plan = plan_exact_page(
        "partner_transactions", {"company_id": CID}, partner_tx_page.TX_SORT, 0, None, partner_tx_page.FETCH_CAP, None,
    )
    assert plan is not None
    where = plan["sql"].split("ORDER BY", 1)[0]
    assert "company_id" in where and "partner_id" not in where and " OR " not in where
    assert _route_gets("/api/banking/partners/transactions/page") == ["list_company_partner_transactions_page"]
    assert _route_gets("/api/banking/partners/p1/transactions") == ["list_partner_transactions_page"]
    assert _route_gets("/api/banking/partners/transactions") == ["list_partner_transactions"]

    async def _go():
        db.log.clear()
        ids, bodies = await _collect_company(db, user_c1, page_size=2)
        tx_finds = [entry for entry in db.log if entry[0] == "find" and entry[1] == "partner_transactions"]
        partner_finds = [entry for entry in db.log if entry[0] == "find" and entry[1] == "partners"]
        tail = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, None, page=99, page_size=2, company_id=CID,
        )
        wide = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, None, page=1, page_size=999, company_id=CID,
        )
        searched = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, None, page=1, page_size=50, company_id=CID, q="baska ortak",
        )
        one = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, PID, page=1, page_size=50,
        )
        foreign_page = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c2, None, page=1, page_size=50,
        )
        denied = None
        try:
            await partner_tx_page.list_partner_transactions_for_user(
                db, user_c2, None, page=1, page_size=50, company_id=CID,
            )
        except HTTPException as exc:
            denied = exc.status_code
        active = await partner_tx_page.list_partner_transactions_for_user(
            db, user_c1, None, page=1, page_size=50,
        )
        prev = server.db
        server.db = db
        try:
            via_route = await server.list_company_partner_transactions_page(
                page=1, page_size=2, date_from=None, date_to=None, q=None, type=None,
                company_id=CID, user=user_c1,
            )
            legacy = await server.list_partner_transactions(company_id=CID, user=user_c1)
        finally:
            server.db = prev
        return ids, bodies, tx_finds, partner_finds, tail, wide, searched, one, foreign_page, denied, active, via_route, legacy

    (
        ids, bodies, tx_finds, partner_finds, tail, wide, searched, one,
        foreign_page, denied, active, via_route, legacy,
    ) = _run(_go())
    legacy_ids = [tx["id"] for tx in partner_tx_page.sort_partner_txs(legacy)]
    assert {tx["id"] for tx in legacy} == set(legacy_ids)
    assert ids == legacy_ids
    assert ids[0] == "other-partner"
    assert ids[1:] == EXPECTED_ORDER
    assert "orphan" not in ids and "foreign" not in ids and "foreign-own" not in ids
    flows = _legacy_flows(legacy)
    assert flows == (EXPECTED_IN + 5.0, EXPECTED_OUT)
    for body in bodies:
        assert (body["period_in"], body["period_out"]) == flows
        assert body["total"] == len(legacy_ids)
        assert body["ledger"]["girisDisplay"] == flows[0]
        assert body["ledger"]["cikisDisplay"] == flows[1]
        assert body["ledger"]["ledger"] == round(flows[0] - flows[1], 2)
        assert body["ledger"]["netMatchesCard"] is True
        assert len(body["items"]) <= 2
    assert tail["items"] == []
    assert (tail["period_in"], tail["period_out"]) == flows
    assert wide["page_size"] == 200
    assert [item["id"] for item in wide["items"]] == legacy_ids
    by_legacy = {tx["id"]: tx for tx in legacy}
    for item in wide["items"]:
        src = by_legacy[item["id"]]
        assert item["balance_delta"] == src["balance_delta"]
        assert item["side"] == src["side"]
        assert item.get("partner_id") == src.get("partner_id")
        assert item.get("source") == src.get("source")
        assert item.get("source_id") == src.get("source_id")
        assert item.get("expense_id") == src.get("expense_id")
        assert item.get("source_type") == src.get("source_type")
    src_line = next(item for item in wide["items"] if item["id"] == "src-line")
    assert src_line["source"] == "expense" and src_line["balance_delta"] == -40.0 and src_line["side"] == "cikis"
    assert [item["id"] for item in searched["items"]] == ["other-partner"]
    assert searched["period_in"] == 5.0 and searched["period_out"] == 0.0
    assert [item["id"] for item in one["items"]] == EXPECTED_ORDER
    assert one["period_in"] == EXPECTED_IN and one["period_out"] == EXPECTED_OUT
    assert "other-partner" not in {item["id"] for item in one["items"]}
    assert [item["id"] for item in foreign_page["items"]] == ["foreign-own"]
    assert denied == 403
    assert [item["id"] for item in active["items"]] == legacy_ids
    assert [item["id"] for item in via_route["items"]] == legacy_ids[:2]
    assert via_route["period_in"] == flows[0] and via_route["total"] == len(legacy_ids)
    assert tx_finds
    assert all(entry[2] == {"company_id": CID} for entry in tx_finds)
    assert all("partner_id" not in entry[2] and "$or" not in entry[2] and "$in" not in entry[2] for entry in tx_finds)
    assert partner_finds and all(entry[2] == {"company_id": CID} for entry in partner_finds)
    assert db.writes == []
    assert db.partners.docs == before_partners
    assert db.partner_transactions.docs == before_txs


class _Req:
    def __init__(self, path, method="GET"):
        self.url = MagicMock(path=path)
        self.method = method
        self.headers = {}
        self.cookies = {}
        self.query_params = {}
        self.scope = {"query_string": b""}


class _AccrueColl:
    def __init__(self):
        self.docs = []

    def _match(self, d, q):
        return all(d.get(k) == v for k, v in (q or {}).items() if not isinstance(v, dict))

    async def find_one(self, q=None, projection=None):
        return next((d for d in self.docs if self._match(d, q)), None)

    def find(self, q=None, projection=None):
        rows = [d for d in self.docs if self._match(d, q)]
        return _AccrueCursor(rows)

    async def insert_one(self, doc):
        self.docs.append(doc)

    async def update_one(self, q, update):
        d = await self.find_one(q)
        if not d:
            return
        for k, v in (update.get("$inc") or {}).items():
            d[k] = float(d.get(k) or 0) + float(v)
        d.update(update.get("$set") or {})

    async def delete_one(self, q):
        self.docs = [d for d in self.docs if not self._match(d, q)]


class _AccrueCursor:
    def __init__(self, rows):
        self.rows = rows

    async def to_list(self, n):
        return list(self.rows[:n])


class _AccrueDb:
    def __init__(self):
        self.partners = _AccrueColl()
        self.partner_transactions = _AccrueColl()


def test_accrue_salary_requires_login_and_tenant():
    import rbac
    import server

    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    start = text.index("async def accrue_partner_salary")
    body = text[start:text.index("\nCASH_APPROVAL_EXECUTORS", start)]
    assert "Depends(get_current_user)" in body
    assert "resolve_company_id" in body
    assert "comp_nexus_main_01" not in body
    sig = inspect.signature(server.accrue_partner_salary)
    assert sig.parameters["user"].default.dependency is server.get_current_user

    seen = False
    for route in server.app.routes:
        if not isinstance(route, APIRoute):
            continue
        if route.path != "/api/banking/partners/accrue-salary" or "POST" not in (route.methods or ()):
            continue
        calls = []

        def walk(dep):
            if getattr(dep, "call", None):
                calls.append(dep.call)
            for sub in dep.dependencies:
                walk(sub)

        walk(route.dependant)
        assert server.get_current_user in calls
        seen = True
    assert seen

    prev = rbac._db
    rbac._db = MagicMock()
    mw = rbac.PermissionAndAuditMiddleware(app=MagicMock())

    async def call_next(_req):
        raise AssertionError("tokensız istek uç noktaya ulaşmamalı")

    try:
        resp = _run(mw.dispatch(_Req("/api/banking/partners/accrue-salary", "POST"), call_next))
    finally:
        rbac._db = prev
    assert resp.status_code in (401, 403)

    class Req:
        headers = {}
        cookies = {}
        url = MagicMock(path="/api/banking/partners/accrue-salary")
        method = "POST"

    status, _detail = _run(_capture(server.get_current_user(Req())))
    assert status in (401, 403)


def _capture(coro):
    async def _wrap():
        try:
            await coro
        except HTTPException as exc:
            return exc.status_code, exc.detail
        return 200, None
    return _wrap()


def test_accrue_salary_other_company_403_and_same_month_once(monkeypatch):
    import server

    user = {"id": "u1", "company_ids": [CID], "active_company_id": CID}
    other = {"id": "u2", "company_ids": [OTHER], "active_company_id": OTHER}
    db = _AccrueDb()
    db.partners.docs.append({
        "_id": PID,
        "company_id": CID,
        "name": "Ali",
        "monthly_salary": 10000,
        "is_active": True,
        "balance": 0,
        "total_capital_in": 0,
        "total_withdrawn": 0,
    })
    monkeypatch.setattr(server, "db", db)

    async def _go():
        denied = None
        try:
            await server.accrue_partner_salary({"company_id": CID, "period": "2026-10"}, other)
        except HTTPException as exc:
            denied = exc.status_code
        first = await server.accrue_partner_salary({"company_id": CID, "period": "2026-10"}, user)
        second = await server.accrue_partner_salary({"company_id": CID, "period": "2026-10"}, user)
        return denied, first, second

    denied, first, second = _run(_go())
    assert denied == 403
    assert first["posted_count"] == 1
    assert second["posted_count"] == 0
    assert len(db.partner_transactions.docs) == 1
    assert db.partner_transactions.docs[0]["salary_period"] == "2026-10"
    assert db.partners.docs[0]["balance"] == -10000


# --- MySQL: iki pushdown modu. Canlı DSN okunmaz. -------------------------

_LOCAL = {
    "host": "127.0.0.1",
    "port": 3306,
    "user": "tamkobi",
    "password": "tamkobi",
    "db": "tamkobi_pushdown",
}


def _mysql_settings():
    url = (os.environ.get("TAMKOBI_TEST_MYSQL_URL") or "").strip()
    if not url:
        return dict(_LOCAL)
    if url.startswith("mysql+"):
        url = "mysql://" + url.split("://", 1)[1]
    if not url.startswith("mysql://"):
        blocked = dict(_LOCAL)
        blocked["db"] = url
        return blocked
    parsed = urlparse(url)
    return {
        "host": parsed.hostname or "127.0.0.1",
        "port": parsed.port or 3306,
        "user": unquote(parsed.username or "tamkobi"),
        "password": unquote(parsed.password or ""),
        "db": (parsed.path or "").lstrip("/").split("?")[0],
        "charset": "utf8mb4",
        "autocommit": True,
    }


def _require_mysql():
    settings = _mysql_settings()
    name = str(settings.get("db") or "").lower()
    if "test" not in name and "pushdown" not in name:
        pytest.skip("hedef veritabanı adı test veya pushdown içermiyor")
    import pymysql
    try:
        conn = pymysql.connect(
            host=settings["host"],
            port=int(settings["port"]),
            user=settings["user"],
            password=settings["password"],
            database=settings["db"],
            charset="utf8mb4",
            connect_timeout=3,
        )
    except (pymysql.err.OperationalError, ConnectionRefusedError, ConnectionError, OSError):
        pytest.skip("MySQL test sunucusu yok")
    else:
        conn.close()
    return settings


def test_mysql_pushdown_on_and_off_match_legacy():
    settings = _require_mysql()
    from mysql_store import MySQLDatabase

    partners, txs = _seed_docs()
    cid = "c-ppage-" + uuid.uuid4().hex[:10]
    pid = "p-" + uuid.uuid4().hex[:8]
    p2 = "p2-" + uuid.uuid4().hex[:8]
    id_map = {PID: pid, P2: p2}

    def _rewrite(doc):
        row = copy.deepcopy(doc)
        if row.get("company_id") == CID:
            row["company_id"] = cid
        for key in ("_id", "partner_id"):
            if row.get(key) in id_map:
                row[key] = id_map[row[key]]
        return row

    partners = [_rewrite(p) for p in partners if p["company_id"] == CID]
    txs = [_rewrite(t) for t in txs if t["company_id"] == CID]
    partner = next(p for p in partners if p["_id"] == pid)
    legacy = _legacy_rows(
        [{**t, "company_id": CID, "partner_id": PID if t["partner_id"] == pid else t["partner_id"]} for t in txs],
        PID,
    )
    # legacy_rows filters company CID; rewritten rows use cid. Compare on rewritten set.
    own = [t for t in txs if t["partner_id"] == pid]
    legacy_ids = [tx["_id"] for tx in _legacy_sort(own)]
    flows = _legacy_flows(own)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
        try:
            for doc in partners:
                await db.partners.insert_one(doc)
            for doc in txs:
                await db.partner_transactions.insert_one(doc)
            before_p = await db.partners.find_one({"_id": pid})
            before_tx = await db.partner_transactions.find_one({"_id": txs[0]["_id"]})
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                sqls = []
                orig = db.partner_transactions._fetch_rows

                async def _wrap(sql, params, _orig=orig, _sqls=sqls):
                    _sqls.append(" ".join(sql.split()))
                    return await _orig(sql, params)

                db.partner_transactions._fetch_rows = _wrap
                try:
                    ids, bodies = await _collect(db, partner, page_size=2)
                finally:
                    db.partner_transactions._fetch_rows = orig
                results.append((flag, ids, bodies[0], sqls))
            after_p = await db.partners.find_one({"_id": pid})
            after_tx = await db.partner_transactions.find_one({"_id": txs[0]["_id"]})
            return results, before_p, after_p, before_tx, after_tx
        finally:
            if previous is None:
                os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
            else:
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous
            await db.partners.delete_many({"company_id": cid})
            await db.partner_transactions.delete_many({"company_id": cid})
            await db.close()

    results, before_p, after_p, before_tx, after_tx = _run(_go())
    assert legacy_ids
    assert [tx["_id"] for tx in legacy] == legacy_ids
    seen = {}
    for flag, ids, first, sqls in results:
        assert ids == legacy_ids
        assert first["period_in"] == flows[0]
        assert first["period_out"] == flows[1]
        assert first["ledger"]["ledger"] == round(flows[0] - flows[1], 2)
        seen[flag] = (ids, first["period_in"], first["period_out"])
        if flag == "1":
            pages = [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
            assert pages, sqls
            for statement in pages:
                where = statement.split("ORDER BY", 1)[0]
                assert "partner_id" in where and "company_id" in where
                assert " OR " not in where
        else:
            assert not [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
    assert seen["0"] == seen["1"]
    assert before_p["balance"] == after_p["balance"] == 1.0
    assert before_tx["amount"] == after_tx["amount"]


def test_mysql_all_partners_pushdown_on_and_off_match_legacy():
    settings = _require_mysql()
    import server
    from mysql_store import MySQLDatabase

    partners, txs = _seed_docs()
    cid = "c-ppage-all-" + uuid.uuid4().hex[:10]
    pid = "p-" + uuid.uuid4().hex[:8]
    p2 = "p2-" + uuid.uuid4().hex[:8]
    id_map = {PID: pid, P2: p2}

    def _rewrite(doc):
        row = copy.deepcopy(doc)
        if row.get("company_id") == CID:
            row["company_id"] = cid
        for key in ("_id", "partner_id"):
            if row.get(key) in id_map:
                row[key] = id_map[row[key]]
        return row

    partners = [_rewrite(p) for p in partners if p["company_id"] == CID]
    txs = [_rewrite(t) for t in txs if t["company_id"] == CID]
    txs.append(_rewrite(_tx(
        _id="orphan", partner_id="p-gone", date="2026-10-21",
        created_at="2026-10-21T00:00:00Z", amount=99, description="silinmis ortak",
    )))
    user = {"id": "u-all", "company_ids": [cid], "active_company_id": cid}
    live = {p["_id"] for p in partners}
    own = [t for t in txs if t.get("partner_id") in live]
    legacy_ids = [tx["_id"] for tx in partner_tx_page.sort_partner_txs(own)]
    flows = _legacy_flows(own)

    async def _go():
        db = MySQLDatabase({**settings, "charset": "utf8mb4", "autocommit": True})
        await db._ensure()
        previous = os.environ.get("MYSQL_STORE_SQL_PUSHDOWN")
        prev_db = server.db
        try:
            for doc in partners:
                await db.partners.insert_one(doc)
            for doc in txs:
                await db.partner_transactions.insert_one(doc)
            before_p = await db.partners.find_one({"_id": pid})
            before_tx = await db.partner_transactions.find_one({"_id": txs[0]["_id"]})
            server.db = db
            os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = "0"
            legacy = await server.list_partner_transactions(company_id=cid, user=user)
            results = []
            for flag in ("0", "1"):
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = flag
                sqls = []
                orig = db.partner_transactions._fetch_rows

                async def _wrap(sql, params, _orig=orig, _sqls=sqls):
                    _sqls.append(" ".join(sql.split()))
                    return await _orig(sql, params)

                db.partner_transactions._fetch_rows = _wrap
                try:
                    ids, bodies = await _collect_company(db, user, page_size=2, company_id=cid)
                finally:
                    db.partner_transactions._fetch_rows = orig
                results.append((flag, ids, bodies[0], sqls))
            after_p = await db.partners.find_one({"_id": pid})
            after_tx = await db.partner_transactions.find_one({"_id": txs[0]["_id"]})
            return results, legacy, before_p, after_p, before_tx, after_tx
        finally:
            server.db = prev_db
            if previous is None:
                os.environ.pop("MYSQL_STORE_SQL_PUSHDOWN", None)
            else:
                os.environ["MYSQL_STORE_SQL_PUSHDOWN"] = previous
            await db.partners.delete_many({"company_id": cid})
            await db.partner_transactions.delete_many({"company_id": cid})
            await db.close()

    results, legacy, before_p, after_p, before_tx, after_tx = _run(_go())
    assert [tx["id"] for tx in partner_tx_page.sort_partner_txs(legacy)] == legacy_ids
    assert "orphan" not in {tx["id"] for tx in legacy}
    seen = {}
    for flag, ids, first, sqls in results:
        assert ids == legacy_ids
        assert ids == [tx["id"] for tx in partner_tx_page.sort_partner_txs(legacy)]
        assert first["period_in"] == flows[0] == _legacy_flows(legacy)[0]
        assert first["period_out"] == flows[1] == _legacy_flows(legacy)[1]
        assert first["ledger"]["ledger"] == round(flows[0] - flows[1], 2)
        seen[flag] = (ids, first["period_in"], first["period_out"])
        if flag == "1":
            pages = [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
            assert pages, sqls
            for statement in pages:
                where = statement.split("ORDER BY", 1)[0]
                assert "company_id" in where
                assert "partner_id" not in where
                assert " OR " not in where
        else:
            assert not [s for s in sqls if "ORDER BY" in s and "LIMIT" in s]
    assert seen["0"] == seen["1"]
    assert before_p["balance"] == after_p["balance"] == 1.0
    assert before_tx["amount"] == after_tx["amount"]
