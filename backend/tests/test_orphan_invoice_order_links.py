"""Fatura silinince sipariş bağı sıfırlanır; yetim bağ onarımı dry-run / apply."""
from __future__ import annotations

import asyncio
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "repair_orphan_order_invoice_links.py"


def _run(coro):
    return asyncio.run(coro)


def _load_script():
    spec = importlib.util.spec_from_file_location("repair_orphan_order_invoice_links", SCRIPT)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction=-1):
        self._docs.sort(key=lambda d: str(d.get(key) or ""), reverse=direction < 0)
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

    async def find_one(self, query):
        if set(query or {}) == {"_id"}:
            doc = self.docs.get(query["_id"])
            return copy.deepcopy(doc) if doc else None
        for doc in self.docs.values():
            if match_query(doc, query):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None, projection=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def update_one(self, query, update, upsert=False):
        for doc_id, old in list(self.docs.items()):
            if match_query(old, query):
                self.docs[doc_id] = apply_update(old, update, query)
                return SimpleNamespace(modified_count=1)
        return SimpleNamespace(modified_count=0)

    async def update_many(self, query, update, upsert=False):
        n = 0
        for doc_id, old in list(self.docs.items()):
            if match_query(old, query):
                self.docs[doc_id] = apply_update(old, update, query)
                n += 1
        return SimpleNamespace(modified_count=n)

    async def count_documents(self, query):
        return sum(1 for doc in self.docs.values() if match_query(doc, query or {}))


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


def _order(**extra):
    base = {
        "company_id": "co_a",
        "order_number": extra.get("_id", "ord"),
        "channel": "b2b",
        "cargo_tracking_number": "TRK-1",
        "cargo_carrier": "yurtici",
        "order_status": "approved",
        "is_invoiced": False,
    }
    base.update(extra)
    return base


def _invoice_fields():
    return {
        "invoice_id": "inv_draft",
        "invoice_number": "TA2026000000001",
        "invoice_e_type": "e_archive",
        "invoice_gib_status": "Taslak",
        "invoice_gib_uuid": "uuid-1",
        "gib_uuid": "uuid-1",
        "gib_invoice_id": "GIB1",
        "einvoice_state": "draft",
        "is_invoiced": True,
    }


CLEARED = (
    "invoice_id",
    "invoice_number",
    "invoice_e_type",
    "invoice_gib_status",
    "invoice_gib_uuid",
    "gib_uuid",
    "gib_invoice_id",
    "einvoice_state",
)


def _assert_cleared(order):
    for key in CLEARED:
        assert key not in order, key
    assert order["is_invoiced"] is False
    assert order["cargo_tracking_number"] == "TRK-1"
    assert order["cargo_carrier"] == "yurtici"
    assert order["channel"] == "b2b"
    assert order.get("updated_at")


@pytest.fixture
def db():
    return MemoryDB()


def test_draft_delete_clears_order_link_and_restores_status(db):
    import server

    db.orders.docs["ord_prev"] = _order(
        _id="ord_prev",
        order_number="B2B-1",
        order_status="invoiced",
        previous_order_status="approved",
        **_invoice_fields(),
    )
    db.orders.docs["ord_pending"] = _order(
        _id="ord_pending",
        order_number="B2B-2",
        order_status="invoiced",
        **_invoice_fields(),
    )
    db.orders.docs["ord_keep_status"] = _order(
        _id="ord_keep_status",
        order_number="B2B-3",
        order_status="approved",
        **_invoice_fields(),
    )
    db.orders.docs["ord_reverse"] = _order(
        _id="ord_reverse",
        order_number="B2B-REV",
        invoice_number="TA-REV",
        invoice_e_type="paper",
    )
    db.orders.docs["ord_other_inv"] = _order(
        _id="ord_other_inv",
        order_number="B2B-OTHER",
        invoice_id="inv_live",
        invoice_number="LIVE-1",
        is_invoiced=True,
        order_status="approved",
    )
    db.orders.docs["ord_other_co"] = _order(
        _id="ord_other_co",
        company_id="co_b",
        order_number="B2B-B",
        **_invoice_fields(),
    )
    db.invoices.docs["inv_live"] = {"_id": "inv_live", "company_id": "co_a", "status": "draft", "invoice_number": "LIVE-1"}
    inv = {
        "_id": "inv_draft",
        "company_id": "co_a",
        "status": "draft",
        "invoice_number": "TA2026000000001",
        "grand_total": 10,
        "contact_name": "Cari",
        "order_id": "ord_other_inv",
        "source_order_id": "ord_reverse",
        "effects_applied": False,
    }

    async def _go():
        with patch.object(server, "db", db), patch.object(
            server, "_cancel_promissory_for_query", AsyncMock()
        ), patch.object(server.trash, "soft_delete", AsyncMock(return_value="trash_1")):
            return await server._soft_delete_invoice_doc(inv, note="Taslak fatura")

    tid = _run(_go())
    assert tid == "trash_1"
    prev = db.orders.docs["ord_prev"]
    pending = db.orders.docs["ord_pending"]
    kept_status = db.orders.docs["ord_keep_status"]
    _assert_cleared(prev)
    assert prev["order_status"] == "approved"
    _assert_cleared(pending)
    assert pending["order_status"] == "pending"
    _assert_cleared(kept_status)
    assert kept_status["order_status"] == "approved"
    reverse = db.orders.docs["ord_reverse"]
    _assert_cleared(reverse)
    assert reverse["order_status"] == "approved"
    other = db.orders.docs["ord_other_inv"]
    assert other["invoice_id"] == "inv_live"
    assert other["invoice_number"] == "LIVE-1"
    assert other["is_invoiced"] is True
    foreign = db.orders.docs["ord_other_co"]
    assert foreign["invoice_id"] == "inv_draft"
    assert foreign["is_invoiced"] is True
    assert "ord_prev" in db.orders.docs


def test_paid_installment_and_gib_invoice_are_not_deleted(db):
    import server

    db.orders.docs["ord_prev"] = _order(_id="ord_prev", **_invoice_fields())
    draft = {
        "_id": "inv_draft",
        "company_id": "co_a",
        "status": "draft",
        "invoice_number": "TA1",
        "grand_total": 1,
        "contact_name": "Cari",
        "order_id": "ord_prev",
    }
    db.installments.docs["inst1"] = {"_id": "inst1", "invoice_id": "inv_draft", "status": "paid"}

    async def _paid():
        with patch.object(server, "db", db):
            await server._soft_delete_invoice_doc(draft)

    with pytest.raises(HTTPException) as ei:
        _run(_paid())
    assert ei.value.status_code == 400
    assert "taksit" in ei.value.detail.lower()
    assert db.orders.docs["ord_prev"]["invoice_id"] == "inv_draft"

    issued = {
        "_id": "inv_gib",
        "company_id": "co_a",
        "status": "approved",
        "e_type": "e_invoice",
        "invoice_number": "GIB1",
        "grand_total": 1,
        "contact_name": "Cari",
        "order_id": "ord_prev",
    }

    async def _gib():
        with patch.object(server, "db", db):
            await server._soft_delete_invoice_doc(issued)

    with pytest.raises(HTTPException) as ei2:
        _run(_gib())
    assert ei2.value.status_code == 400
    assert db.orders.docs["ord_prev"]["invoice_id"] == "inv_draft"


def test_restore_relinks_only_free_orders(db):
    import server

    db.orders.docs["ord_free"] = _order(_id="ord_free", order_number="B2B-FREE", order_status="pending")
    db.orders.docs["ord_taken"] = _order(
        _id="ord_taken",
        order_number="B2B-TAKEN",
        invoice_id="inv_other",
        invoice_number="OTHER",
        is_invoiced=True,
    )
    db.orders.docs["ord_b"] = _order(_id="ord_b", company_id="co_b", order_number="B-1")
    inv = {
        "_id": "inv_draft",
        "company_id": "co_a",
        "status": "draft",
        "invoice_number": "TA-BACK",
        "order_id": "ord_free",
        "source_order_id": "ord_taken",
        "effects_applied": False,
    }

    async def _go():
        with patch.object(server, "db", db):
            await server._restore_invoice(inv, None)

    _run(_go())
    free = db.orders.docs["ord_free"]
    assert free["invoice_id"] == "inv_draft"
    assert free["invoice_number"] == "TA-BACK"
    assert free["is_invoiced"] is False
    assert free["cargo_tracking_number"] == "TRK-1"
    taken = db.orders.docs["ord_taken"]
    assert taken["invoice_id"] == "inv_other"
    assert taken["invoice_number"] == "OTHER"
    assert taken["is_invoiced"] is True
    assert "invoice_id" not in db.orders.docs["ord_b"]


def test_orders_list_and_detail_flag_missing_invoice_without_writing(db):
    import server

    db.orders.docs["ord_miss"] = _order(
        _id="ord_miss",
        order_number="B2B-MISS",
        invoice_id="inv_gone",
        invoice_number="TA-GONE",
    )
    db.orders.docs["ord_ok"] = _order(
        _id="ord_ok",
        order_number="B2B-OK",
        invoice_id="inv_live",
        is_invoiced=False,
    )
    db.orders.docs["ord_foreign_inv"] = _order(
        _id="ord_foreign_inv",
        order_number="B2B-X",
        invoice_id="inv_other_co",
    )
    db.invoices.docs["inv_live"] = {
        "_id": "inv_live",
        "company_id": "co_a",
        "status": "draft",
        "e_type": "e_archive",
        "einvoice_state": "draft",
    }
    db.invoices.docs["inv_other_co"] = {"_id": "inv_other_co", "company_id": "co_b", "status": "draft"}
    db.trash.docs["t1"] = {
        "_id": "t1",
        "company_id": "co_a",
        "entity_type": "invoice",
        "collection": "invoices",
        "doc": {"_id": "inv_gone", "company_id": "co_a", "order_id": "ord_miss"},
    }

    async def _go():
        with patch.object(server, "db", db):
            listed = await server._enrich_orders_invoice_ebelge([
                copy.deepcopy(db.orders.docs["ord_miss"]),
                copy.deepcopy(db.orders.docs["ord_ok"]),
                copy.deepcopy(db.orders.docs["ord_foreign_inv"]),
            ])
            detail = await server._annotate_orders_invoice_missing([
                copy.deepcopy(db.orders.docs["ord_miss"]),
            ])
        return listed, detail

    listed, detail = _run(_go())
    by_id = {row["_id"]: row for row in listed}
    assert by_id["ord_miss"]["invoice_missing"] is True
    assert "invoice_missing" not in by_id["ord_ok"]
    assert by_id["ord_foreign_inv"]["invoice_missing"] is True
    assert detail[0]["invoice_missing"] is True
    assert "invoice_missing" not in db.orders.docs["ord_miss"]
    assert db.orders.docs["ord_miss"]["invoice_id"] == "inv_gone"


def test_contact_overview_flags_missing_invoice(db):
    import server

    contact = {"_id": "cnt_1", "company_id": "co_a", "name": "Cari A", "balance": 0, "opening_balance": 0, "cheque_bond_balance": 0}
    db.contacts.docs["cnt_1"] = copy.deepcopy(contact)
    db.orders.docs["ord_miss"] = _order(
        _id="ord_miss",
        contact_id="cnt_1",
        customer_name="Cari A",
        invoice_id="inv_gone",
    )

    async def _go():
        with patch.object(server, "db", db), patch(
            "tenant_access.get_tenant_doc", AsyncMock(return_value=copy.deepcopy(contact))
        ):
            return await server.get_contact_overview("cnt_1", user={"is_super_admin": True})

    out = _run(_go())
    orders = out["orders"]
    assert len(orders) == 1
    assert orders[0]["invoice_missing"] is True
    assert "invoice_missing" not in db.orders.docs["ord_miss"]


def test_dead_invoice_link_can_create_a_new_draft(db):
    import server

    order = {
        "_id": "ord_dead",
        "company_id": "co_a",
        "order_number": "B2B-DEAD",
        "customer_name": "Cari",
        "channel": "b2b",
        "currency": "TRY",
        "is_invoiced": True,
        "invoice_id": "inv_gone",
        "items": [{
            "product_id": "p1",
            "product_name": "Kalem",
            "name": "Kalem",
            "quantity": 1,
            "unit_price": 10,
            "vat_rate": 20,
            "unit": "Adet",
        }],
    }
    contact = {"_id": "cnt_1", "name": "Cari", "tax_number_or_id": "11111111111", "payment_term_days": 14}
    db.orders.docs["ord_dead"] = copy.deepcopy(order)

    async def _go():
        with patch.object(server, "db", db), patch.object(
            server, "_ensure_order_contact", AsyncMock(return_value=contact)
        ), patch.object(server, "_fill_stock_codes", AsyncMock()):
            return await server._create_draft_invoice_for_order(order, source="convert")

    doc = _run(_go())
    assert doc is not None
    assert doc["status"] == "draft"
    assert doc["order_id"] == "ord_dead"
    assert db.orders.docs["ord_dead"]["is_invoiced"] is False
    assert db.orders.docs["ord_dead"]["invoice_id"] == doc["_id"]


def test_repair_script_dry_run_apply_and_second_pass(db):
    mod = _load_script()
    db.companies.docs["co_a"] = {"_id": "co_a"}
    db.companies.docs["co_b"] = {"_id": "co_b"}
    db.orders.docs["ord_miss"] = _order(
        _id="ord_miss",
        order_number="B2B-MISS",
        invoice_id="inv_gone",
        invoice_number="TA-GONE",
        order_status="pending",
    )
    db.orders.docs["ord_rev"] = _order(
        _id="ord_rev",
        order_number="B2B-REV",
        invoice_number="TA-REV",
        order_status="pending",
    )
    db.orders.docs["ord_live"] = _order(
        _id="ord_live",
        order_number="B2B-LIVE",
        invoice_id="inv_live",
        invoice_number="LIVE",
        is_invoiced=True,
    )
    db.orders.docs["ord_inv"] = _order(
        _id="ord_inv",
        order_number="B2B-INV",
        is_invoiced=True,
        order_status="invoiced",
    )
    db.orders.docs["ord_b"] = _order(
        _id="ord_b",
        company_id="co_b",
        order_number="B-MISS",
        invoice_id="inv_b",
        invoice_number="TB",
    )
    db.invoices.docs["inv_live"] = {"_id": "inv_live", "company_id": "co_a", "status": "approved"}
    db.trash.docs["t_gone"] = {
        "_id": "t_gone",
        "company_id": "co_a",
        "entity_type": "invoice",
        "collection": "invoices",
        "doc": {
            "_id": "inv_gone",
            "company_id": "co_a",
            "order_id": "ord_rev",
            "invoice_number": "TA-GONE",
        },
    }
    before = copy.deepcopy(db.orders.docs)

    async def _dry():
        return await mod.collect_orphan_order_invoice_links(db, "co_a")

    report = _run(_dry())
    assert db.orders.docs == before
    reasons = {row["order_number"]: row["reason"] for row in report["orphans"]}
    assert reasons["B2B-MISS"] == "trashed_invoice"
    assert reasons["B2B-REV"] == "reverse_link"
    assert "B2B-LIVE" not in reasons
    assert [row["order_number"] for row in report["invoiced_orphans"]] == ["B2B-INV"]
    assert report["applied"] == 0
    text = mod.format_report(report, dry_run=True, include_invoiced=False)
    assert "B2B-MISS" in text and "inv_gone" in text and "dry_run=true" in text

    async def _apply():
        return await mod.apply_orphan_order_invoice_links(db, "co_a", include_invoiced=False)

    applied = _run(_apply())
    assert applied["applied"] >= 2
    assert "invoice_id" not in db.orders.docs["ord_miss"]
    assert db.orders.docs["ord_miss"]["is_invoiced"] is False
    assert "invoice_number" not in db.orders.docs["ord_rev"]
    assert db.orders.docs["ord_live"]["invoice_id"] == "inv_live"
    assert db.orders.docs["ord_live"]["is_invoiced"] is True
    assert db.orders.docs["ord_inv"]["is_invoiced"] is True
    assert db.orders.docs["ord_b"]["invoice_id"] == "inv_b"

    async def _again():
        return await mod.apply_orphan_order_invoice_links(db, "co_a", include_invoiced=False)

    second = _run(_again())
    assert second["applied"] == 0
    assert second["orphans"] == []

    async def _include():
        return await mod.apply_orphan_order_invoice_links(db, "co_a", include_invoiced=True)

    included = _run(_include())
    assert included["applied"] == 1
    assert db.orders.docs["ord_inv"]["is_invoiced"] is False
    assert db.orders.docs["ord_inv"]["order_status"] == "pending"
    assert db.orders.docs["ord_b"]["invoice_id"] == "inv_b"

    async def _zero():
        return await mod.apply_orphan_order_invoice_links(db, "co_a", include_invoiced=True)

    assert _run(_zero())["applied"] == 0
