"""Otomatik taslak fatura (varsayılan kapalı) + sipariş/fatura iki yönlü soft-delete."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


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

    async def find_one(self, q=None, projection=None):
        for doc in self.docs:
            if match_query(doc, q or {}):
                return dict(doc)
        return None

    def find(self, q=None, projection=None):
        return _Cursor([d for d in self.docs if match_query(d, q or {})])

    async def insert_one(self, doc):
        self.docs.append(dict(doc))
        return MagicMock(inserted_id=doc.get("_id"))

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

    async def count_documents(self, q=None):
        return sum(1 for doc in self.docs if match_query(doc, q or {}))

    async def update_one(self, q, upd, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                return MagicMock(matched_count=1, modified_count=1)
        return MagicMock(matched_count=0, modified_count=0)

    async def update_many(self, q, upd):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                n += 1
        return MagicMock(matched_count=n, modified_count=n)


class FakeDB:
    def __init__(self):
        self.companies = FakeColl()
        self.orders = FakeColl()
        self.invoices = FakeColl()
        self.trash = FakeColl()
        self.installments = FakeColl()
        self.bank_transactions = FakeColl()
        self.partner_transactions = FakeColl()
        self.company_audit_log = FakeColl()
        self.sync_tombstones = FakeColl()
        self.roles = FakeColl()

    def __getitem__(self, name):
        if not hasattr(self, name):
            setattr(self, name, FakeColl())
        return getattr(self, name)


USER = {"_id": "u1", "id": "u1", "is_super_admin": True, "role": "admin", "company_ids": ["c1"], "active_company_id": "c1", "name": "Admin"}
OTHER = {"_id": "u2", "id": "u2", "is_super_admin": False, "role": "admin", "company_ids": ["c2"], "active_company_id": "c2", "name": "B"}


def _order(**extra):
    doc = {
        "_id": "ord_1",
        "company_id": "c1",
        "order_number": "B2B-2026-0014",
        "customer_name": "Cari",
        "channel": "b2b",
        "is_invoiced": False,
        "total_amount": 120,
        "items": [{"product_name": "A", "quantity": 1, "unit_price": 100, "vat_rate": 20}],
    }
    doc.update(extra)
    return doc


def _draft_inv(**extra):
    doc = {
        "_id": "inv_1",
        "company_id": "c1",
        "invoice_number": "TA20260001",
        "status": "draft",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "contact_name": "Cari",
        "grand_total": 120,
        "order_id": "ord_1",
        "order_number": "B2B-2026-0014",
        "paid_amount": 0,
        "payment_status": "unpaid",
    }
    doc.update(extra)
    return doc


def _ctx(server, db, create=None):
    create = create or AsyncMock(return_value=_draft_inv())
    return patch.multiple(
        server,
        db=db,
        _reverse_invoice_effects=AsyncMock(),
        _cancel_promissory_for_query=AsyncMock(),
        _create_draft_invoice_for_order=create,
    ), create


def test_auto_draft_default_false_and_existing_company():
    import server

    assert server.order_auto_draft_invoice_enabled(None) is False
    assert server.order_auto_draft_invoice_enabled({}) is False
    assert server.order_auto_draft_invoice_enabled({"settings": {}}) is False
    assert server.order_auto_draft_invoice_enabled({"settings": {"order_auto_draft_invoice": False}}) is False
    assert server.order_auto_draft_invoice_enabled({"settings": {"order_auto_draft_invoice": True}}) is True


def test_attach_does_nothing_when_setting_off():
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1", "settings": {}})
    order = _order()
    ctx, create = _ctx(server, db)
    with ctx:
        out = _run(server._attach_draft_invoice_on_intake(order, source="b2b"))
    assert out is None
    create.assert_not_awaited()


@pytest.mark.parametrize("source", ["b2b", "intake", "marketplace", "import"])
def test_attach_creates_when_setting_on(source):
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1", "settings": {"order_auto_draft_invoice": True}})
    ctx, create = _ctx(server, db)
    with ctx:
        out = _run(server._attach_draft_invoice_on_intake(_order(), source=source))
    assert out["_id"] == "inv_1"
    create.assert_awaited_once()


def test_approve_order_respects_setting_off():
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1"})
    db.orders.docs.append(_order())
    ctx, create = _ctx(server, db)
    with ctx, patch.object(server, "_push_order_to_marketplace", AsyncMock(return_value=None)):
        _run(server.approve_order("ord_1", {}, USER))
    create.assert_not_awaited()


def test_approve_order_creates_when_on():
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1", "settings": {"order_auto_draft_invoice": True}})
    db.orders.docs.append(_order())
    ctx, create = _ctx(server, db)
    with ctx, patch.object(server, "_push_order_to_marketplace", AsyncMock(return_value=None)):
        out = _run(server.approve_order("ord_1", {}, USER))
    create.assert_awaited_once()
    assert out.get("draft_invoice_id") == "inv_1"


def test_put_order_settings_admin_only():
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1", "settings": {}})
    sales = {**USER, "is_super_admin": False, "role": "sales"}
    with patch.object(server, "db", db):
        with pytest.raises(HTTPException) as ei:
            _run(server.put_order_settings("c1", {"order_auto_draft_invoice": True}, sales))
        assert ei.value.status_code == 403
        out = _run(server.put_order_settings("c1", {"order_auto_draft_invoice": True}, USER))
    assert out["order_auto_draft_invoice"] is True
    assert db.companies.docs[0]["settings"]["order_auto_draft_invoice"] is True


def test_get_company_defaults_auto_draft_false():
    import server

    db = FakeDB()
    db.companies.docs.append({"_id": "c1", "name": "A"})
    with patch.object(server, "db", db), patch.object(server, "clean_doc", lambda c: {k: v for k, v in c.items() if k != "_id"} | {"id": c["_id"]}):
        out = _run(server.get_company("c1"))
    assert out["order_auto_draft_invoice"] is False
    assert out["settings"]["order_auto_draft_invoice"] is False


def _delete_patches(server, db):
    import dispatch_invoice
    import trash

    trash.init(db)
    return patch.multiple(
        server,
        db=db,
        _reverse_invoice_effects=AsyncMock(),
        _cancel_promissory_for_query=AsyncMock(),
    ), patch.object(dispatch_invoice, "release_invoice_dispatches", AsyncMock()), patch.object(
        dispatch_invoice, "find_existing_invoice_for_dispatch", AsyncMock(return_value=None)
    )


def test_delete_order_with_draft_invoice_trashes_both_and_restore_relinks():
    import server
    import trash

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_1", invoice_number="TA20260001"))
    db.invoices.docs.append(_draft_inv())
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        out = _run(server._delete_order_core("ord_1", USER))
    assert out["status"] == "success"
    assert not db.orders.docs
    assert not db.invoices.docs
    assert len(db.trash.docs) == 2
    gids = {t.get("restore_group_id") for t in db.trash.docs}
    assert len(gids) == 1 and None not in gids
    tid = next(t["_id"] for t in db.trash.docs if t["entity_type"] == "order")
    with ctx, p1, p2:
        restored = _run(trash.restore_trash_item(tid, USER))
    assert restored["status"] == "success"
    assert {o["_id"] for o in db.orders.docs} == {"ord_1"}
    assert {i["_id"] for i in db.invoices.docs} == {"inv_1"}
    assert db.orders.docs[0]["invoice_id"] == "inv_1"
    assert db.invoices.docs[0]["order_id"] == "ord_1"


def test_delete_draft_invoice_trashes_linked_order_and_restore():
    import server
    import trash

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_1", invoice_number="TA20260001"))
    db.invoices.docs.append(_draft_inv())
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        tid = _run(server._soft_delete_invoice_doc(_draft_inv(), note="Taslak fatura", user=USER))
    assert not db.orders.docs
    assert not db.invoices.docs
    assert tid
    with ctx, p1, p2:
        _run(trash.restore_trash_item(tid, USER))
    assert db.orders.docs[0]["_id"] == "ord_1"
    assert db.invoices.docs[0]["_id"] == "inv_1"
    assert db.orders.docs[0]["invoice_id"] == "inv_1"


def test_delete_order_blocks_gib_invoice():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_g", invoice_number="TA-G"))
    db.invoices.docs.append(_draft_inv(_id="inv_g", invoice_number="TA-G", status="approved", einvoice_state="sent", gib_uuid="u-1"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", USER))
    assert ei.value.status_code == 409
    assert "TA-G" in str(ei.value.detail)
    assert db.orders.docs and db.invoices.docs


def test_delete_order_blocks_paid_and_effects():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_p"))
    db.invoices.docs.append(_draft_inv(_id="inv_p", status="approved", e_type="paper", effects_applied=True, invoice_number="KA1"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", USER))
    assert ei.value.status_code == 409
    assert "KA1" in str(ei.value.detail)


def test_delete_order_blocks_sent_dispatch():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(dispatch_id="d1"))
    db.invoices.docs.append({
        "_id": "d1", "company_id": "c1", "invoice_type": "dispatch", "e_type": "e_dispatch",
        "invoice_number": "IRS-9", "einvoice_state": "sent", "gib_uuid": "g1",
    })
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", USER))
    assert ei.value.status_code == 409
    assert "IRS-9" in str(ei.value.detail)


def test_delete_order_trashes_draft_dispatch_together():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(dispatch_id="d1"))
    db.invoices.docs.append({
        "_id": "d1", "company_id": "c1", "invoice_type": "dispatch", "e_type": "e_dispatch",
        "invoice_number": "IRS-1", "status": "draft",
    })
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        _run(server._delete_order_core("ord_1", USER))
    assert not db.orders.docs
    assert not db.invoices.docs
    assert {t["entity_type"] for t in db.trash.docs} >= {"order", "invoice"}


def test_other_tenant_order_not_deleted():
    import server

    db = FakeDB()
    db.orders.docs.append(_order())
    db.orders.docs.append(_order(_id="ord_b", company_id="c2", order_number="B2B-B"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", OTHER))
        assert ei.value.status_code == 404
        _run(server._delete_order_core("ord_1", USER))
    assert {o["_id"] for o in db.orders.docs} == {"ord_b"}


def test_order_with_another_invoice_stays_on_invoice_delete():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_other", invoice_number="TA-OTHER"))
    db.invoices.docs.append(_draft_inv())
    db.invoices.docs.append(_draft_inv(_id="inv_other", invoice_number="TA-OTHER", order_id="ord_1"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        _run(server._soft_delete_invoice_doc(_draft_inv(), note="Taslak", user=USER))
    assert {o["_id"] for o in db.orders.docs} == {"ord_1"}
    assert db.orders.docs[0]["invoice_id"] == "inv_other"
    assert {i["_id"] for i in db.invoices.docs} == {"inv_other"}


def test_bulk_delete_mixed_per_item():
    import server

    db = FakeDB()
    db.orders.docs.append(_order())
    db.orders.docs.append(_order(_id="ord_g", invoice_id="inv_g", invoice_number="TA-G"))
    db.invoices.docs.append(_draft_inv(_id="inv_g", invoice_number="TA-G", order_id="ord_g", status="approved", einvoice_state="sent", gib_uuid="u"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        out = _run(server.bulk_delete_orders({"ids": ["ord_1", "ord_g"]}, USER))
    assert out["deleted"] == 1
    assert out["failed"] == 1
    by_id = {r["id"]: r for r in out["results"]}
    assert by_id["ord_1"]["ok"] is True
    assert by_id["ord_g"]["ok"] is False
    assert by_id["ord_g"]["status"] == 409


def test_bulk_delete_invoices_mixed_per_item():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_1", invoice_number="TA20260001"))
    db.invoices.docs.append(_draft_inv())
    db.invoices.docs.append(_draft_inv(_id="inv_g", invoice_number="TA-G", order_id="ord_g", status="approved", einvoice_state="sent", gib_uuid="u"))
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2:
        out = _run(server.bulk_delete_invoices({"ids": ["inv_1", "inv_g"]}, USER))
    assert out["deleted"] == 1
    assert out["failed"] == 1
    by_id = {r["id"]: r for r in out["results"]}
    assert by_id["inv_1"]["ok"] is True
    assert by_id["inv_g"]["ok"] is False
    assert by_id["inv_g"]["status"] in (400, 409)
    assert not any(o["_id"] == "ord_1" for o in db.orders.docs)
    assert any(i["_id"] == "inv_g" for i in db.invoices.docs)


def test_stamp_does_not_relink_trashed_docs():
    import server

    db = FakeDB()
    db.invoices.docs.append(_draft_inv())
    with patch.object(server, "db", db):
        _run(server._stamp_draft_order_invoice_link(_draft_inv(order_id="ord_gone")))
    assert not db.orders.docs
    db.orders.docs.append(_order(invoice_id="inv_live"))
    db.invoices.docs.clear()
    with patch.object(server, "db", db):
        _run(server._stamp_draft_order_invoice_link(_draft_inv()))
    assert db.orders.docs[0]["invoice_id"] == "inv_live"


def test_cascade_requires_both_delete_permissions():
    import server

    db = FakeDB()
    db.orders.docs.append(_order(invoice_id="inv_1", invoice_number="TA20260001"))
    db.invoices.docs.append(_draft_inv())
    limited = {**USER, "is_super_admin": False, "role": "sales"}
    role = {"code": "sales", "permissions": {"/orders": "delete", "/invoices": "view"}}
    ctx, p1, p2 = _delete_patches(server, db)
    with ctx, p1, p2, patch.object(server.rbac, "role_for", AsyncMock(return_value=role)):
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", limited))
    assert ei.value.status_code == 403
    assert db.orders.docs and db.invoices.docs
