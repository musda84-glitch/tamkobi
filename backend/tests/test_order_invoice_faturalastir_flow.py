"""Sipariş → taslak fatura → Faturalaştır (approve) → e-belge; taslak silme/geri getirme."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

ADMIN = {"_id": "u1", "role": "admin", "is_super_admin": True, "company_id": "c1"}
STAFF_ORDERS_ONLY = {
    "_id": "u2",
    "role": "staff",
    "company_id": "c1",
    "permissions": {"/orders": "delete", "/invoices": "view"},
}


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def _draft_inv(**extra):
    inv = {
        "_id": "inv_d1",
        "company_id": "c1",
        "status": "draft",
        "invoice_number": "TA2026000000001",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "order_id": "ord_1",
        "contact_name": "Cari",
        "grand_total": 100,
        "effects_applied": False,
    }
    inv.update(extra)
    return inv


def _draft_order(**extra):
    o = {
        "_id": "ord_1",
        "company_id": "c1",
        "order_number": "B2B-2026-0001",
        "customer_name": "Cari",
        "is_invoiced": False,
        "invoice_id": "inv_d1",
        "invoice_number": "TA2026000000001",
        "total_amount": 100,
        "channel": "b2b",
    }
    o.update(extra)
    return o


def test_send_to_gib_rejects_sales_draft_409():
    import server

    inv = _draft_inv()
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)):
        with pytest.raises(HTTPException) as ei:
            _run(server.send_invoice_to_gib("inv_d1", {}, ADMIN))
    assert ei.value.status_code == 409
    assert ei.value.detail == server.ONCE_FATURALASTIRIN


def test_send_to_gib_rejects_approving_409():
    import server

    inv = _draft_inv(status="approving")
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server.e_invoice, "issue_invoice", AsyncMock()
    ) as issue:
        with pytest.raises(HTTPException) as ei:
            _run(server.send_invoice_to_gib("inv_d1", {}, ADMIN))
        issue.assert_not_called()
    assert ei.value.status_code == 409
    assert ei.value.detail == "Fatura onaylanıyor"


def test_send_to_gib_skips_409_for_incoming_purchase():
    import server

    inv = _draft_inv(invoice_type="purchase", direction="incoming", source="edoc_inbox")
    mock_db = MagicMock()
    mock_db.invoices.update_one = AsyncMock()
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server, "_is_incoming_purchase_invoice", return_value=True
    ), patch.object(server, "_apply_invoice_effects", AsyncMock()), patch.object(
        server, "db", mock_db
    ), patch.object(server.e_invoice, "issue_invoice", AsyncMock(side_effect=HTTPException(status_code=400, detail="Gelen e-fatura kesilmez."))):
        with pytest.raises(HTTPException) as ei:
            _run(server.send_invoice_to_gib("inv_d1", {"e_type": "e_invoice"}, ADMIN))
    assert ei.value.status_code == 400
    assert "kesilmez" in str(ei.value.detail)


def test_send_to_gib_allows_dispatch_draft():
    import server

    inv = _draft_inv(invoice_type="dispatch", e_type="e_dispatch")
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server.e_invoice, "issue_invoice", AsyncMock(return_value={"status": "success", "message": "ok"})
    ) as issue:
        out = _run(server.send_invoice_to_gib("inv_d1", {"e_type": "e_dispatch"}, ADMIN))
    issue.assert_awaited()
    assert out["status"] == "success"


def test_delete_order_cascades_draft_with_shared_restore_group():
    import server

    order = _draft_order()
    inv = _draft_inv()
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=order)), patch.object(
        server, "_live_invoices_linked_to_order", AsyncMock(return_value=[inv])
    ), patch.object(server, "_invoice_finance_block", AsyncMock(return_value=None)), patch.object(
        server, "_order_sent_dispatch_block", AsyncMock(return_value=None)
    ), patch.object(server, "_soft_delete_invoice_doc", AsyncMock(return_value="t-inv")) as del_inv, patch.object(
        server, "_soft_delete_order_doc", AsyncMock(return_value="t-ord")
    ) as del_ord:
        out = _run(server._delete_order_core("ord_1", ADMIN))
    assert "taslak fatura" in out["message"].lower()
    assert del_inv.await_args.kwargs.get("unlink") is False
    assert del_inv.await_args.kwargs.get("restore_group")
    assert del_ord.await_args.kwargs.get("restore_group") == del_inv.await_args.kwargs.get("restore_group")


def test_delete_order_invoiced_409():
    import server

    order = _draft_order(is_invoiced=True)
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=order)):
        with pytest.raises(HTTPException) as ei:
            _run(server._delete_order_core("ord_1", ADMIN))
    assert ei.value.status_code == 409
    assert ei.value.detail == server.FATURALASMIS_DELETE_MSG


def test_delete_invoice_cascades_single_order_draft():
    import server

    inv = _draft_inv()
    order = _draft_order()
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server, "_invoice_finance_block", AsyncMock(return_value=None)
    ), patch.object(
        server, "_live_orders_linked_to_invoice", AsyncMock(return_value=[order])
    ), patch.object(server, "_live_invoices_linked_to_order", AsyncMock(return_value=[inv])), patch.object(
        server, "_trash_linked_order_and_draft", AsyncMock(return_value="gid")
    ) as trash_pair:
        out = _run(server.delete_invoice("inv_d1", ADMIN))
    trash_pair.assert_awaited_once()
    assert "bağlı sipariş" in out["message"].lower()


def test_delete_invoice_unlinks_when_order_has_other_invoices():
    import server

    inv = _draft_inv()
    other = _draft_inv(_id="inv_d2", invoice_number="TA2")
    order = _draft_order()
    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server, "_invoice_finance_block", AsyncMock(return_value=None)
    ), patch.object(
        server, "_live_orders_linked_to_invoice", AsyncMock(return_value=[order])
    ), patch.object(server, "_live_invoices_linked_to_order", AsyncMock(return_value=[inv, other])), patch.object(
        server, "_soft_delete_invoice_doc", AsyncMock(return_value="t1")
    ) as soft, patch.object(server, "_trash_linked_order_and_draft", AsyncMock()) as trash_pair:
        out = _run(server.delete_invoice("inv_d1", ADMIN))
    trash_pair.assert_not_awaited()
    assert soft.await_args.kwargs.get("unlink") is True
    assert "bağlı sipariş" not in out["message"].lower()


def test_delete_pair_requires_both_permissions():
    import server

    order = _draft_order()
    inv = _draft_inv()
    with pytest.raises(HTTPException) as ei:
        _run(server._trash_linked_order_and_draft(
            order, inv, STAFF_ORDERS_ONLY,
            order_note="o", invoice_note="i",
        ))
    assert ei.value.status_code == 403


def test_delete_pair_other_tenant_not_linked(monkeypatch):
    import server

    order = _draft_order(company_id="c1")
    other = _draft_inv(company_id="c2", _id="inv_other")
    mock_db = MagicMock()
    mock_db.invoices.find = MagicMock()
    mock_db.invoices.find.return_value.to_list = AsyncMock(return_value=[])
    with patch.object(server, "db", mock_db):
        rows = _run(server._live_invoices_linked_to_order(order))
    assert other not in rows
    assert rows == []


def test_restore_group_restores_siblings_same_company():
    import trash

    rec_inv = {
        "_id": "t1",
        "restore_group": "gid",
        "company_id": "c1",
        "collection": "invoices",
        "entity_type": "invoice",
        "label": "TA1",
        "doc": {"_id": "inv_d1", "company_id": "c1", "invoice_id": "inv_d1"},
        "related": [],
    }
    rec_ord = {
        "_id": "t2",
        "restore_group": "gid",
        "company_id": "c1",
        "collection": "orders",
        "entity_type": "order",
        "label": "B2B-1",
        "doc": {"_id": "ord_1", "company_id": "c1", "invoice_id": "inv_d1"},
        "related": [],
    }
    mock_db = MagicMock()
    mock_db.trash.find_one = AsyncMock(return_value=rec_inv)
    mock_db.trash.find = MagicMock()
    mock_db.trash.find.return_value.to_list = AsyncMock(return_value=[rec_ord])
    mock_db.trash.delete_many = AsyncMock()
    restored = []

    async def fake_restore(item):
        restored.append(item["_id"])
        return item["doc"], 0, [(item["collection"], item["doc"]["_id"])]

    user = {"is_super_admin": True}
    with patch.object(trash, "_db", mock_db), patch.object(
        trash.tenant_access, "user_may_access_company", return_value=True
    ), patch.object(trash, "_restore_one_trash_rec", side_effect=fake_restore), patch.object(
        trash, "_clear_sync_tombstones", AsyncMock()
    ), patch.object(trash, "_hooks", {}):
        out = _run(trash.restore_trash_item("t1", user))
    assert set(restored) == {"t1", "t2"}
    assert "ortak grup" in out["message"]


def test_create_draft_on_intake_is_not_invoiced():
    import server

    order = _draft_order(invoice_id=None, invoice_number=None)
    order["items"] = [{"product_name": "Kalem", "quantity": 1, "unit_price": 100, "vat_rate": 20, "unit": "Adet"}]
    contact = {"_id": "cnt_1", "name": "Cari", "tax_number_or_id": "11111111111", "payment_term_days": 14}
    inserted = {}

    async def _insert(doc):
        inserted["doc"] = doc

    mock_db = MagicMock()
    mock_db.invoices.find_one = AsyncMock(return_value=None)
    mock_db.invoices.insert_one = AsyncMock(side_effect=_insert)
    mock_db.invoices.count_documents = AsyncMock(return_value=1)
    mock_db.orders.update_one = AsyncMock()

    with patch.object(server, "db", mock_db), patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value=contact)
    ), patch.object(server, "_fill_stock_codes", AsyncMock()):
        doc = _run(server._create_draft_invoice_for_order(order, source="intake"))

    assert doc["status"] == "draft"
    assert doc.get("effects_applied") is not True
    assert inserted["doc"]["status"] == "draft"
    assert inserted["doc"].get("effects_applied") is not True
    set_fields = mock_db.orders.update_one.await_args.args[1]["$set"]
    assert set_fields["is_invoiced"] is False
    assert set_fields["invoice_id"] == inserted["doc"]["_id"]


def test_approve_applies_effects_without_gib():
    import server

    inv = _draft_inv()
    approved = {**inv, "status": "approved", "effects_applied": True, "gib_status": "Onaylandı"}
    mock_db = MagicMock()
    mock_db.invoices.update_one = AsyncMock()
    mock_db.invoices.find_one = AsyncMock(return_value=approved)
    mock_db.orders.find_one = AsyncMock(return_value=_draft_order())
    mock_db.contacts.find_one = AsyncMock(return_value=None)

    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server, "_is_incoming_purchase_invoice", return_value=False
    ), patch.object(server, "_apply_invoice_effects", AsyncMock()) as effects, patch.object(
        server, "_mark_order_invoiced_from_invoice", AsyncMock()
    ) as mark, patch.object(
        server, "_ensure_order_contact", AsyncMock(return_value={"_id": "cnt_1"})
    ), patch.object(
        server, "_post_marketplace_settlement", AsyncMock(return_value=None)
    ), patch.object(server, "db", mock_db), patch.object(
        server.e_invoice, "issue_invoice", AsyncMock()
    ) as gib, patch.object(
        server.ubl_export, "strip_issued_invoice_note", return_value=""
    ):
        out = _run(server.approve_invoice("inv_d1", ADMIN))

    effects.assert_awaited_once()
    mark.assert_awaited_once()
    gib.assert_not_called()
    assert out["status"] == "success"
    written = mock_db.invoices.update_one.await_args.args[1]["$set"]
    assert written["status"] == "approved"
    assert written["effects_applied"] is True


def test_stamp_draft_link_skips_missing_order():
    import server

    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=None)
    mock_db.orders.update_one = AsyncMock()
    with patch.object(server, "db", mock_db):
        _run(server._stamp_draft_order_invoice_link(_draft_inv()))
    mock_db.orders.update_one.assert_not_called()


def test_stamp_draft_link_does_not_rebind_other_invoice():
    import server

    mock_db = MagicMock()
    mock_db.orders.find_one = AsyncMock(return_value=_draft_order(invoice_id="inv_other"))
    mock_db.orders.update_one = AsyncMock()
    with patch.object(server, "db", mock_db):
        _run(server._stamp_draft_order_invoice_link(_draft_inv()))
    mock_db.orders.update_one.assert_not_called()
