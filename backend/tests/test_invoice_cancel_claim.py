"""Yerel fatura iptali: atomik claim, cari/stok geri alma, trash yok, GİB/İşNet yok."""
from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from mysql_store import apply_update, match_query


def _run(coro):
    return asyncio.run(coro)


class _Cursor:
    def __init__(self, rows):
        self.rows = rows

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
            return await self.update_one(q, upd)

    async def update_many(self, q, upd):
        n = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, q or {}):
                self.docs[i] = apply_update(doc, upd, q)
                n += 1
        return MagicMock(matched_count=n, modified_count=n)

    async def count_documents(self, q=None):
        return len(self._find(q))


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

    def __getitem__(self, name):
        return getattr(self, name)


USER = {"is_super_admin": True, "active_company_id": "co", "company_ids": ["co"]}
OTHER = {"is_super_admin": False, "active_company_id": "other", "company_ids": ["other"]}


def _sales_inv(**extra):
    doc = {
        "_id": "inv_s",
        "company_id": "co",
        "status": "approved",
        "e_type": "e_archive",
        "invoice_type": "sales",
        "invoice_number": "EA-1",
        "contact_id": "c1",
        "contact_name": "Cari",
        "grand_total": 120.0,
        "local_total": 120.0,
        "currency": "TRY",
        "fx_rate": 1,
        "effects_applied": True,
        "items": [{"product_id": "p1", "name": "Mal", "quantity": 2, "unit_price": 50}],
        "paid_amount": 0,
        "payment_status": "unpaid",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "einvoice_state": "sent",
        "gib_status": "İşNet SOAP API ile GİB'e iletildi",
    }
    doc.update(extra)
    return doc


def _purchase_inv(**extra):
    doc = _sales_inv(
        _id="inv_p",
        e_type="e_invoice",
        invoice_type="purchase",
        invoice_number="EF-1",
        direction="incoming",
        source="edoc_inbox",
        stock_effects_applied=True,
        gib_status="Gelen E-Fatura Onaylandı",
    )
    doc.update(extra)
    return doc


def _seed(db: FakeDB, inv, *, balance=200.0, stock=10.0):
    db.invoices.docs = [dict(inv)]
    db.contacts.docs = [{"_id": "c1", "company_id": "co", "name": "Cari", "balance": balance}]
    db.products.docs = [{"_id": "p1", "company_id": "co", "name": "Mal", "stock_quantity": stock}]


def _patch(db, extra=()):
    import server

    ctxs = [
        patch.object(server, "db", db),
        patch.object(server, "_cancel_promissory_for_query", AsyncMock()),
        patch("contact_balance.sync_contact_balance", AsyncMock()),
        patch.object(server.e_invoice, "issue_invoice", AsyncMock()),
        patch.object(server.trash, "soft_delete", AsyncMock(return_value="trash_x")),
        patch.object(server.isnet, "send_invoice", AsyncMock(), create=True),
        patch.object(server.isnet, "cancel_invoice", AsyncMock(), create=True),
    ]
    ctxs.extend(extra)
    return ctxs


def _stack(ctxs):
    from contextlib import ExitStack

    stack = ExitStack()
    for c in ctxs:
        stack.enter_context(c)
    return stack


def test_gib_sent_earchive_cancel_succeeds_without_isnet_or_trash():
    import server

    db = FakeDB()
    _seed(db, _sales_inv())
    with _stack(_patch(db)):
        out = _run(server.cancel_invoice("inv_s", {}, USER))
        trash_fn = server.trash.soft_delete
        issue = server.e_invoice.issue_invoice
        isnet_send = getattr(server.isnet, "send_invoice", None)
        isnet_cancel = getattr(server.isnet, "cancel_invoice", None)

        assert out["status"] == "success"
        row = db.invoices.docs[0]
        assert row["status"] == "cancelled"
        assert row["gib_status"] == "İptal edildi"
        assert row["payment_status"] == "cancelled"
        assert db.trash.docs == []
        trash_fn.assert_not_called()
        issue.assert_not_called()
        if isnet_send:
            isnet_send.assert_not_called()
        if isnet_cancel:
            isnet_cancel.assert_not_called()


def test_gib_sent_einvoice_cancel_succeeds_no_409():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(e_type="e_invoice", invoice_number="EF-S"))
    with _stack(_patch(db)):
        out = _run(server.cancel_invoice("inv_s", {}, USER))
    assert out["status"] == "success"
    assert db.invoices.docs[0]["status"] == "cancelled"


def test_cancel_sales_restores_contact_and_increases_stock():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(), balance=120.0, stock=8.0)
    with _stack(_patch(db)):
        _run(server.cancel_invoice("inv_s", {}, USER))
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)
    assert db.invoices.docs[0]["status"] == "cancelled"


def test_cancel_purchase_decreases_stock():
    import server

    db = FakeDB()
    _seed(db, _purchase_inv(), balance=-120.0, stock=12.0)
    with _stack(_patch(db)):
        _run(server.cancel_invoice("inv_p", {}, USER))
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)


def test_cancel_skips_stock_when_from_dispatch():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(stock_effects_from_dispatch=True), balance=120.0, stock=8.0)
    with _stack(_patch(db)):
        _run(server.cancel_invoice("inv_s", {}, USER))
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(8.0)
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)


def test_second_cancel_is_409():
    import server

    db = FakeDB()
    _seed(db, _sales_inv())
    with _stack(_patch(db)):
        _run(server.cancel_invoice("inv_s", {}, USER))
        with pytest.raises(HTTPException) as ei:
            _run(server.cancel_invoice("inv_s", {}, USER))
    assert ei.value.status_code == 409
    assert "iptal edildi" in ei.value.detail.lower()


def test_concurrent_cancel_reverses_effects_once():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(), balance=120.0, stock=8.0)
    calls = {"n": 0}
    real = server._reverse_invoice_effects

    async def counted(inv):
        calls["n"] += 1
        await asyncio.sleep(0)
        await real(inv)

    with _stack(_patch(db, extra=[patch.object(server, "_reverse_invoice_effects", counted)])):
        async def run():
            r1, r2 = await asyncio.gather(
                server.cancel_invoice("inv_s", {}, USER),
                server.cancel_invoice("inv_s", {}, USER),
                return_exceptions=True,
            )
            return r1, r2

        a, b = _run(run())
    wins = [x for x in (a, b) if isinstance(x, dict) and x.get("status") == "success"]
    losses = [x for x in (a, b) if isinstance(x, HTTPException)]
    assert len(wins) == 1
    assert len(losses) == 1
    assert losses[0].status_code == 409
    assert calls["n"] == 1
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)


def test_cancelled_approve_and_send_to_gib_409():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(status="cancelled", gib_status="İptal edildi"))
    with _stack(_patch(db)):
        with pytest.raises(HTTPException) as ea:
            _run(server.approve_invoice("inv_s", USER))
        with pytest.raises(HTTPException) as es:
            _run(server.send_invoice_to_gib("inv_s", {}, USER))
        server.e_invoice.issue_invoice.assert_not_called()
    assert ea.value.status_code == 409
    assert ea.value.detail == "İptal edilmiş fatura"
    assert es.value.status_code == 409
    assert es.value.detail == "İptal edilmiş fatura"


def test_draft_and_paper_cancel_keep_existing_messages():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(status="draft", e_type="e_archive", gib_uuid=None, einvoice_state=None))
    with _stack(_patch(db)):
        with pytest.raises(HTTPException) as ed:
            _run(server.cancel_invoice("inv_s", {}, USER))
    assert ed.value.status_code == 400
    assert "Taslak" in ed.value.detail

    db2 = FakeDB()
    _seed(db2, _sales_inv(e_type="paper", gib_uuid=None, einvoice_state=None, gib_status="Kağıt Fatura (Matbu)"))
    with _stack(_patch(db2)):
        with pytest.raises(HTTPException) as ep:
            _run(server.cancel_invoice("inv_s", {}, USER))
    assert ep.value.status_code == 400
    assert "e-Fatura" in ep.value.detail


def test_approving_invoice_delete_and_send_to_gib_409():
    import server

    db = FakeDB()
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat()
    _seed(db, _sales_inv(
        status="approving",
        approving_at=now,
        effects_applied=False,
        gib_uuid=None,
        einvoice_state=None,
        gib_status="Taslak",
    ))
    with _stack(_patch(db)):
        with pytest.raises(HTTPException) as ed:
            _run(server.delete_invoice("inv_s", USER))
        with pytest.raises(HTTPException) as es:
            _run(server.send_invoice_to_gib("inv_s", {}, USER))
        issue = server.e_invoice.issue_invoice
        trash_fn = server.trash.soft_delete
        issue.assert_not_called()
        trash_fn.assert_not_called()
    assert ed.value.status_code == 409
    assert ed.value.detail == "Fatura onaylanıyor"
    assert es.value.status_code == 409
    assert es.value.detail == "Fatura onaylanıyor"
    assert db.invoices.docs[0]["status"] == "approving"
    assert db.trash.docs == []


def test_cancelling_invoice_delete_409():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(status="cancelling"))
    with _stack(_patch(db)):
        with pytest.raises(HTTPException) as ei:
            _run(server.delete_invoice("inv_s", USER))
        trash_fn = server.trash.soft_delete
        trash_fn.assert_not_called()
    assert ei.value.status_code == 409
    assert ei.value.detail == "Fatura iptal ediliyor"
    assert db.invoices.docs[0]["status"] == "cancelling"
    assert db.trash.docs == []


def test_concurrent_delete_and_cancel_single_winner():
    import server

    db = FakeDB()
    _seed(db, _sales_inv(), balance=120.0, stock=8.0)
    calls = {"n": 0}
    real = server._reverse_invoice_effects

    async def counted(inv):
        calls["n"] += 1
        await asyncio.sleep(0)
        await real(inv)

    with _stack(_patch(db, extra=[patch.object(server, "_reverse_invoice_effects", counted)])):
        async def run():
            return await asyncio.gather(
                server.cancel_invoice("inv_s", {}, USER),
                server.delete_invoice("inv_s", USER),
                return_exceptions=True,
            )

        a, b = _run(run())
        trash_fn = server.trash.soft_delete
        trash_fn.assert_not_called()
    results = [a, b]
    wins = [x for x in results if isinstance(x, dict) and x.get("status") == "success"]
    losses = [x for x in results if isinstance(x, HTTPException)]
    assert len(wins) == 1
    assert len(losses) == 1
    assert losses[0].status_code in (400, 409)
    assert db.trash.docs == []
    assert db.invoices.docs[0]["status"] == "cancelled"
    assert calls["n"] == 1
    assert db.contacts.docs[0]["balance"] == pytest.approx(0.0)
    assert db.products.docs[0]["stock_quantity"] == pytest.approx(10.0)


def test_other_tenant_invoice_404():
    import server

    db = FakeDB()
    _seed(db, _sales_inv())
    with _stack(_patch(db)):
        with pytest.raises(HTTPException) as ei:
            _run(server.cancel_invoice("inv_s", {}, OTHER))
        with pytest.raises(HTTPException) as ea:
            _run(server.approve_invoice("inv_s", OTHER))
    assert ei.value.status_code == 404
    assert ea.value.status_code == 404
