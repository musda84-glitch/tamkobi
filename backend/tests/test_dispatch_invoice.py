"""İrsaliyede fatura varsa önce bağla; yeni satış faturası açma."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

import dispatch_invoice


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _match(doc, q):
    for k, v in (q or {}).items():
        if isinstance(v, dict) and "$ne" in v:
            if doc.get(k) == v["$ne"]:
                return False
        elif doc.get(k) != v:
            return False
    return True


class FakeColl:
    def __init__(self, rows):
        self.rows = [dict(r) for r in rows]
        self.updates = []

    async def find_one(self, q):
        for row in self.rows:
            if _match(row, q):
                return dict(row)
        return None

    async def update_one(self, q, upd):
        self.updates.append((q, upd))
        for row in self.rows:
            if not _match(row, q):
                continue
            for k, v in (upd.get("$set") or {}).items():
                row[k] = v
            return MagicMock(modified_count=1)
        return MagicMock(modified_count=0)


def test_find_invoice_on_dispatch_invoice_id():
    inv = {"_id": "inv1", "invoice_type": "sales", "invoice_number": "TA1", "status": "approved"}
    disp = {"_id": "d1", "invoice_type": "dispatch", "invoice_id": "inv1", "invoice_number": "IRS-1"}
    db = MagicMock()
    db.invoices = FakeColl([inv, disp])
    db.orders = FakeColl([])
    found = _run(dispatch_invoice.find_existing_invoice_for_dispatch(db, disp))
    assert found["_id"] == "inv1"


def test_find_invoice_from_order():
    order = {"_id": "o1", "invoice_id": "inv2", "invoice_number": "TA2"}
    inv = {"_id": "inv2", "invoice_type": "sales", "invoice_number": "TA2", "status": "draft"}
    disp = {"_id": "d2", "invoice_type": "dispatch", "order_id": "o1", "invoice_number": "IRS-2"}
    db = MagicMock()
    db.invoices = FakeColl([inv, disp])
    db.orders = FakeColl([order])
    found = _run(dispatch_invoice.find_existing_invoice_for_dispatch(db, disp))
    assert found["_id"] == "inv2"


def test_find_skips_cancelled_and_dispatch():
    inv = {"_id": "inv3", "invoice_type": "sales", "status": "cancelled"}
    disp = {"_id": "d3", "invoice_id": "inv3"}
    db = MagicMock()
    db.invoices = FakeColl([inv])
    db.orders = FakeColl([])
    assert _run(dispatch_invoice.find_existing_invoice_for_dispatch(db, disp)) is None


def test_link_dispatch_sets_both_sides():
    inv = {"_id": "inv4", "invoice_type": "sales", "invoice_number": "TA4"}
    disp = {"_id": "d4", "invoice_number": "IRS-4", "order_id": "o4"}
    db = MagicMock()
    db.invoices = FakeColl([inv, disp])
    db.orders = FakeColl([{"_id": "o4", "invoice_id": None}])
    linked = _run(dispatch_invoice.link_dispatch_to_invoice(db, disp, inv))
    assert linked["dispatch_id"] == "d4"
    assert linked["dispatch_number"] == "IRS-4"
    drow = next(r for r in db.invoices.rows if r["_id"] == "d4")
    assert drow["converted_invoice_id"] == "inv4"
    assert drow["invoice_ref_number"] == "TA4"
    orow = db.orders.rows[0]
    assert orow["invoice_id"] == "inv4"


def test_standalone_dispatch_has_no_invoice():
    disp = {"_id": "d5", "invoice_type": "dispatch", "invoice_number": "IRS-5", "company_id": "c1"}
    db = MagicMock()
    db.invoices = FakeColl([disp])
    db.orders = FakeColl([])
    assert _run(dispatch_invoice.find_existing_invoice_for_dispatch(db, disp)) is None
