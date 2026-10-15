"""B2B iptal talebi onay/red: atomik claim, taslak çöp, faturalaşmış 409."""
from __future__ import annotations

import asyncio
from contextlib import ExitStack
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query
import trash as trash_mod


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

    def sort(self, *args, **kwargs):
        return self

    async def to_list(self, n=None):
        rows = self.rows if n is None else self.rows[:n]
        return [dict(r) for r in rows]


class FakeColl:
    def __init__(self, docs=None):
        self.docs = [dict(d) for d in (docs or [])]
        self._lock = asyncio.Lock()

    def _find(self, q=None):
        return [d for d in self.docs if match_query(d, q or {})]

    async def find_one(self, q=None, projection=None):
        found = self._find(q)
        return dict(found[0]) if found else None

    def find(self, q=None, projection=None):
        return _Cursor([dict(d) for d in self._find(q)])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id=doc.get("_id"))

    async def update_one(self, q, upd, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)

    async def update_one_atomic(self, q, upd):
        async with self._lock:
            result = await self.update_one(q, upd)
        # Gerçek DB I/O gibi yield: kaybeden istek claim sırasındayken 409 alsın.
        await asyncio.sleep(0)
        return result

    async def update_many(self, q, upd):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                n += 1
        return MagicMock(matched_count=n, modified_count=n)

    async def count_documents(self, q=None):
        return len(self._find(q))

    async def delete_one(self, q):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs.pop(i)
                return MagicMock(deleted_count=1)
        return MagicMock(deleted_count=0)

    async def delete_many(self, q):
        keep, n = [], 0
        for doc in self.docs:
            if match_query(doc, q or {}):
                n += 1
            else:
                keep.append(doc)
        self.docs = keep
        return MagicMock(deleted_count=n)


class FakeDB:
    def __init__(self):
        self.invoices = FakeColl()
        self.orders = FakeColl()
        self.products = FakeColl()
        self.contacts = FakeColl()
        self.stock_lots = FakeColl()
        self.installments = FakeColl()
        self.bank_transactions = FakeColl()
        self.partner_transactions = FakeColl()
        self.incoming_edocs = FakeColl()
        self.trash = FakeColl()
        self.company_audit_log = FakeColl()
        self.sync_tombstones = FakeColl()

    def __getitem__(self, name):
        return getattr(self, name)


ADMIN = {
    "id": "u1",
    "_id": "u1",
    "is_super_admin": True,
    "role": "admin",
    "active_company_id": "co",
    "company_ids": ["co"],
}
OTHER = {
    "id": "u-other",
    "is_super_admin": False,
    "role": "admin",
    "active_company_id": "other",
    "company_ids": ["other"],
}
VIEW_ONLY = {
    "id": "u-view",
    "is_super_admin": False,
    "role": "staff",
    "active_company_id": "co",
    "company_ids": ["co"],
    "permissions": {"/orders": "view", "/invoices": "view"},
}


def _order(**extra):
    doc = {
        "_id": "ord_1",
        "company_id": "co",
        "order_number": "B2B-2026-0001",
        "customer_name": "Bayi",
        "channel": "b2b",
        "order_status": "approved",
        "is_invoiced": False,
        "invoice_id": "inv_d1",
        "invoice_number": "TA2026000000001",
        "total_amount": 100,
        "grand_total": 100,
        "cancel_request": {"status": "pending", "reason": "yanlış sipariş", "at": "2026-10-01T00:00:00+00:00"},
    }
    doc.update(extra)
    return doc


def _draft_inv(**extra):
    doc = {
        "_id": "inv_d1",
        "company_id": "co",
        "status": "draft",
        "invoice_number": "TA2026000000001",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "order_id": "ord_1",
        "contact_id": "c1",
        "contact_name": "Bayi",
        "grand_total": 100,
        "effects_applied": False,
        "items": [{"product_id": "p1", "name": "Mal", "quantity": 1, "unit_price": 100}],
    }
    doc.update(extra)
    return doc


def _seed(db: FakeDB, order=None, inv=None, *, balance=50.0, stock=10.0):
    order = order or _order()
    inv = inv if inv is not None else _draft_inv()
    db.orders.docs = [dict(order)]
    db.invoices.docs = [dict(inv)] if inv else []
    db.contacts.docs = [{"_id": "c1", "company_id": "co", "name": "Bayi", "balance": balance}]
    db.products.docs = [{"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": stock}]
    return order, inv


def _stack(db, extra=()):
    ctxs = [
        patch.object(trash_mod, "_db", db),
        patch.object(trash_mod, "_hooks", {}),
        patch("server.db", db),
        patch("server._cancel_promissory_for_query", AsyncMock()),
        patch("server._notify_company", AsyncMock()),
        patch("contact_balance.sync_contact_balance", AsyncMock()),
    ]
    ctxs.extend(extra)
    stack = ExitStack()
    for c in ctxs:
        stack.enter_context(c)
    return stack


def test_accept_trashes_order_and_draft_same_restore_group_stock_unchanged():
    import server

    db = FakeDB()
    _seed(db)
    with _stack(db):
        out = _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert out["status"] == "success"
    assert db.orders.docs == []
    assert db.invoices.docs == []
    trash_rows = db.trash.docs
    kinds = {r["entity_type"]: r for r in trash_rows}
    assert set(kinds) == {"order", "invoice"}
    assert kinds["order"]["restore_group"] == kinds["invoice"]["restore_group"]
    assert kinds["order"]["doc"]["cancel_request"]["status"] == "accepted"
    assert kinds["order"]["doc"]["cancel_request"]["resolved_by"] == "u1"
    assert db.contacts.docs[0]["balance"] == pytest.approx(50.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)
    assert db.company_audit_log.docs
    assert "onaylandı" in (db.company_audit_log.docs[0].get("summary") or "")

    with _stack(db):
        restored = _run(trash_mod.restore_trash_item(kinds["order"]["_id"], ADMIN))
    assert "ortak grup" in restored["message"]
    assert any(o["_id"] == "ord_1" for o in db.orders.docs)
    assert any(i["_id"] == "inv_d1" for i in db.invoices.docs)
    assert db.trash.docs == []


def test_accept_faturalastirilmis_409_keeps_pending_nothing_deleted():
    import server

    db = FakeDB()
    order, inv = _seed(db, _order(is_invoiced=True), _draft_inv(status="approved", effects_applied=True))
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert ei.value.status_code == 409
    assert ei.value.detail == server.CANCEL_REQUEST_INVOICED_MSG
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert db.orders.docs[0]["_id"] == order["_id"]
    assert db.invoices.docs[0]["_id"] == inv["_id"]
    assert db.trash.docs == []


def test_accept_approved_invoice_409():
    import server

    db = FakeDB()
    _seed(db, _order(is_invoiced=False), _draft_inv(status="approved", effects_applied=True))
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert ei.value.status_code == 409
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert db.trash.docs == []


def test_accept_gib_issued_409():
    import server

    db = FakeDB()
    _seed(
        db,
        inv=_draft_inv(einvoice_state="sent", gib_uuid="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"),
    )
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert ei.value.status_code == 409
    assert ei.value.detail == server.CANCEL_REQUEST_INVOICED_MSG
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert db.trash.docs == []


def test_accept_sent_dispatch_409():
    import server

    db = FakeDB()
    disp = _draft_inv(
        _id="disp_1",
        invoice_type="dispatch",
        e_type="e_dispatch",
        einvoice_state="sent",
        gib_uuid="bbbbbbbb-cccc-dddd-eeee-ffffffffffff",
        order_id=None,
    )
    order = _order(dispatch_id="disp_1")
    _seed(db, order, _draft_inv())
    db.invoices.docs.append(disp)
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert ei.value.status_code == 409
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert any(i["_id"] == "inv_d1" for i in db.invoices.docs)
    assert db.trash.docs == []


def test_reject_keeps_order_and_sets_rejected():
    import server

    db = FakeDB()
    _seed(db)
    with _stack(db):
        out = _run(server.resolve_cancel_request("ord_1", {"action": "reject", "note": "stok yok"}, ADMIN))
    assert out["status"] == "success"
    row = db.orders.docs[0]
    assert row["order_status"] == "approved"
    assert row["cancel_request"]["status"] == "rejected"
    assert row["cancel_request"]["resolve_note"] == "stok yok"
    assert row["invoice_id"] == "inv_d1"
    assert db.invoices.docs[0]["status"] == "draft"
    assert db.trash.docs == []
    assert db.company_audit_log.docs
    assert "reddedildi" in (db.company_audit_log.docs[0].get("summary") or "")


def test_no_pending_400():
    import server

    db = FakeDB()
    _seed(db, _order(cancel_request={"status": "rejected"}))
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN))
    assert ei.value.status_code == 400
    assert "Bekleyen iptal talebi yok" in str(ei.value.detail)


def test_concurrent_accept_one_wins():
    import server

    db = FakeDB()
    _seed(db)
    results = []

    async def _go():
        try:
            out = await server.resolve_cancel_request("ord_1", {"action": "accept"}, ADMIN)
            results.append(("ok", out))
        except HTTPException as exc:
            results.append(("err", exc.status_code, exc.detail))

    async def _both():
        await asyncio.gather(_go(), _go())

    with _stack(db):
        _run(_both())
    oks = [r for r in results if r[0] == "ok"]
    errs = [r for r in results if r[0] == "err"]
    assert len(oks) == 1
    assert len(errs) == 1
    assert errs[0][1] == 409
    assert errs[0][2] == server.CANCEL_REQUEST_BUSY_MSG
    assert db.orders.docs == []
    assert {r["entity_type"] for r in db.trash.docs} == {"order", "invoice"}


def test_other_tenant_404():
    import server

    db = FakeDB()
    _seed(db)
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, OTHER))
    assert ei.value.status_code == 404
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert db.trash.docs == []


def test_unauthorized_403():
    import server

    db = FakeDB()
    _seed(db)
    with _stack(db):
        with pytest.raises(HTTPException) as ei:
            _run(server.resolve_cancel_request("ord_1", {"action": "accept"}, VIEW_ONLY))
    assert ei.value.status_code == 403
    assert db.orders.docs[0]["cancel_request"]["status"] == "pending"
    assert db.trash.docs == []


def test_list_orders_cancel_request_pending_filter():
    from order_list_filter import OrderListFilter, query_orders

    rows = [
        _order(_id="a", order_number="A", cancel_request={"status": "pending"}),
        _order(_id="b", order_number="B", cancel_request={"status": "rejected"}),
        _order(_id="c", order_number="C", cancel_request=None, invoice_id=None),
    ]
    out = query_orders(rows, OrderListFilter(cancel_request="pending"))
    assert [o["order_number"] for o in out["items"]] == ["A"]
    summary = query_orders(rows, OrderListFilter())
    assert summary["counts"].get("cancel_request") == 1
