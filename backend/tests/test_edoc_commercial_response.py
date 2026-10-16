"""Gelen TICARIFATURA GİB KABUL/RED. İşNet'e gerçek istek yok."""
from __future__ import annotations

import asyncio
import copy
import os
import sys
from contextlib import contextmanager
from datetime import date
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from mysql_store import UpdateResult, apply_update, match_query  # noqa: E402
import edocs  # noqa: E402
import isnet_portal  # noqa: E402

TODAY = date(2026, 10, 16)
USER = {"id": "usr_1", "name": "Ada", "company_ids": ["c1"], "role": "admin"}
OTHER = {"id": "usr_2", "name": "Başka", "company_ids": ["c2"], "role": "admin"}


class MemoryCollection:
    def __init__(self):
        self.docs = {}
        self._lock = asyncio.Lock()

    async def insert_one(self, doc):
        async with self._lock:
            stored = copy.deepcopy(doc)
            self.docs[stored["_id"]] = stored
            return stored

    async def find_one(self, query):
        async with self._lock:
            for doc in self.docs.values():
                if match_query(doc, query or {}):
                    return copy.deepcopy(doc)
            return None

    async def update_one(self, query, update, upsert=False):
        async with self._lock:
            for doc_id, old in list(self.docs.items()):
                if match_query(old, query):
                    self.docs[doc_id] = apply_update(old, update, query)
                    return UpdateResult(1, 1, None)
            return UpdateResult(0, 0, None)


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        return self[name]

    def __getitem__(self, name):
        if name not in self._cols:
            self._cols[name] = MemoryCollection()
        return self._cols[name]


def _run(coro):
    return asyncio.run(coro)


def _doc(**extra):
    base = {
        "_id": "ed1",
        "company_id": "c1",
        "status": "pending",
        "kind": "invoice",
        "number": "GIB2026001",
        "uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "issue_date": "2026-10-16",
        "profile": "TICARIFATURA",
        "source": "isnet",
        "supplier": {"name": "Tedarikçi", "tax_id": "1111111111"},
        "lines": [],
    }
    base.update(extra)
    return base


def _settings():
    return {
        "_id": "es1",
        "company_id": "c1",
        "provider": "isnet",
        "status": "configured",
        "mode": "test",
        "username": "1234567890",
        "corporate_code": "4242",
        "password_enc": "enc",
    }


async def _install(db, doc):
    edocs.init(db, {})
    await db.incoming_edocs.insert_one(doc)
    await db.einvoice_settings.insert_one(_settings())


def _portal(rows, approve_result=None, *, hold=None, started=None, bodies=None):
    approve_result = approve_result if approve_result is not None else (200, {"Result": 0})

    async def fake_login(settings, password, **kwargs):
        return {"token": "tok-not-logged", "companies": [{"id": "4242"}]}

    async def fake_post(client, url, token, body):
        if bodies is not None:
            bodies.append((url, body))
        if "GetApprovableIncomingInvoiceList" in url:
            return 200, {"Result": 0, "Invoices": rows}
        if "ApproveIncomingInvoice" in url:
            if started is not None:
                started.set()
            if hold is not None:
                await hold.wait()
            return approve_result
        raise AssertionError(url)

    return fake_login, fake_post


class _DummyClient:
    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        return False


@contextmanager
def _patched(login, post):
    with patch.object(edocs, "_istanbul_today", lambda: TODAY), \
         patch.object(edocs, "_portal_password", lambda settings: "s3cret-pw"), \
         patch.object(isnet_portal, "_mobile_login", login), \
         patch.object(isnet_portal, "_mobile_post_json", post), \
         patch.object(isnet_portal.httpx, "AsyncClient", _DummyClient):
        yield


def test_kabul_sends_approval_type_zero_and_updates_linked_invoice():
    async def scenario():
        db = MemoryDB()
        doc = _doc(invoice_id="inv1")
        await _install(db, doc)
        await db.invoices.insert_one({"_id": "inv1", "company_id": "c1", "gib_response": None, "status": "approved"})
        bodies = []
        login, post = _portal(
            [{"InvoiceId": 987654, "Ettn": doc["uuid"], "InvoiceNumber": "DIGER"}, {"InvoiceId": 1, "Ettn": "nope", "InvoiceNumber": doc["number"]}],
            bodies=bodies,
        )
        with _patched(login, post):
            out = await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert out["commercial_response"] == "accepted"
        assert out["gib_response"] == "accepted"
        assert out["gib_status"] == "Gelen E-Fatura Onaylandı"
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert stored["commercial_response"] == "accepted"
        assert stored["responded_by"] == "usr_1"
        assert stored["status"] == "pending"
        inv = await db.invoices.find_one({"_id": "inv1"})
        assert inv["gib_response"] == "accepted"
        assert inv["gib_status"] == "Gelen E-Fatura Onaylandı"
        assert inv["status"] == "approved"
        approve = [b for u, b in bodies if "ApproveIncomingInvoice" in u]
        assert len(approve) == 1
        assert approve[0]["ApprovalType"] == 0
        assert approve[0]["InvoiceId"] == 987654
        assert approve[0]["CompanyId"] == 4242
        assert "s3cret-pw" not in str(bodies)
        assert "tok-not-logged" not in str(bodies)
        listed = [u for u, _b in bodies if "GetApprovableIncomingInvoiceList" in u]
        assert listed
        assert not any("ApproveStagingInvoice" in u for u, _b in bodies)
        audits = list(db.company_audit_log.docs.values())
        assert audits and "s3cret-pw" not in str(audits)
        assert "contacts" not in db._cols or not db.contacts.docs
        again = None
        with _patched(login, post):
            again = await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert again["commercial_response"] == "accepted"
        assert len([b for u, b in bodies if "ApproveIncomingInvoice" in u]) == 1
        with pytest.raises(HTTPException) as diff:
            with _patched(login, post):
                await edocs.respond_inbox_document("ed1", {"approval": "RED", "reason": "olmaz"}, USER)
        assert diff.value.status_code == 409

    _run(scenario())


def test_red_requires_reason_and_marks_rejected():
    async def scenario():
        db = MemoryDB()
        await _install(db, _doc())
        bodies = []
        login, post = _portal([{"InvoiceId": 55, "Ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "InvoiceNumber": "GIB2026001"}], bodies=bodies)
        with pytest.raises(HTTPException) as missing:
            await edocs.respond_inbox_document("ed1", {"approval": "RED"}, USER)
        assert missing.value.status_code == 422
        with _patched(login, post):
            out = await edocs.respond_inbox_document("ed1", {"approval": "RED", "reason": "fiyat hatalı"}, USER)
        assert out["commercial_response"] == "rejected"
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert stored["status"] == "rejected"
        assert stored["reject_reason"] == "fiyat hatalı"
        approve = [b for u, b in bodies if "ApproveIncomingInvoice" in u][0]
        assert approve["ApprovalType"] == 1
        assert approve["Reason"] == "fiyat hatalı"

    _run(scenario())


def test_window_and_tenant_guards():
    async def scenario():
        db = MemoryDB()
        await _install(db, _doc(profile="TEMELFATURA"))
        with pytest.raises(HTTPException) as temel:
            with patch.object(edocs, "_istanbul_today", lambda: TODAY):
                await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert temel.value.status_code == 409
        assert temel.value.detail == "Temel faturaya yanıt verilmez"

        await db.incoming_edocs.update_one({"_id": "ed1"}, {"$set": {"profile": "TICARIFATURA", "issue_date": "2026-10-07"}})
        with pytest.raises(HTTPException) as late:
            with patch.object(edocs, "_istanbul_today", lambda: TODAY):
                await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert late.value.status_code == 409
        assert late.value.detail == "8 günlük süre doldu"

        await db.incoming_edocs.update_one({"_id": "ed1"}, {"$set": {"kind": "dispatch", "issue_date": "2026-10-16", "profile": "TICARIFATURA"}})
        with pytest.raises(HTTPException) as disp:
            await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert disp.value.status_code == 409

        with pytest.raises(HTTPException) as other:
            await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, OTHER)
        assert other.value.status_code == 404
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert "commercial_response" not in stored

    _run(scenario())


def test_concurrent_second_call_does_not_call_isnet_again():
    async def scenario():
        db = MemoryDB()
        await _install(db, _doc())
        bodies = []
        started = asyncio.Event()
        hold = asyncio.Event()
        login, post = _portal(
            [{"InvoiceId": 987654, "Ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "InvoiceNumber": "GIB2026001"}],
            bodies=bodies,
            started=started,
            hold=hold,
        )
        with _patched(login, post):
            first = asyncio.create_task(edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER))
            await asyncio.wait_for(started.wait(), 2)
            second = asyncio.create_task(edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER))
            await asyncio.sleep(0.05)
            hold.set()
            out = await first
            with pytest.raises(HTTPException) as raced:
                await second
        assert out["commercial_response"] == "accepted"
        assert raced.value.status_code == 409
        assert len([b for u, b in bodies if "ApproveIncomingInvoice" in u]) == 1

    _run(scenario())


def test_isnet_error_releases_claim():
    async def scenario():
        db = MemoryDB()
        await _install(db, _doc())
        login, post = _portal(
            [{"InvoiceId": 7, "InvoiceNumber": "GIB2026001", "Ettn": ""}],
            (200, {"Result": 2, "ErrorMessage": "portal reddetti"}),
        )
        with pytest.raises(HTTPException) as err:
            with _patched(login, post):
                await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert err.value.status_code == 400
        assert "portal reddetti" in err.value.detail
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert stored["status"] == "pending"
        assert "commercial_response" not in stored

        login2, post2 = _portal([])
        with pytest.raises(HTTPException) as missing:
            with _patched(login2, post2):
                await edocs.respond_inbox_document("ed1", {"approval": "KABUL"}, USER)
        assert missing.value.detail == "İşNet'te yanıt bekleyen fatura bulunamadı"
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert stored["status"] == "pending"
        assert "commercial_response" not in stored

    _run(scenario())


def test_red_on_ingested_invoice_does_not_delete_it():
    async def scenario():
        db = MemoryDB()
        await _install(db, _doc(status="approved", invoice_id="inv9"))
        await db.invoices.insert_one({
            "_id": "inv9", "company_id": "c1", "status": "approved", "grand_total": 10,
            "gib_response": None, "gib_status": "Gelen E-Fatura (Yanıt Bekleniyor)",
        })
        login, post = _portal([{"InvoiceId": 9, "Ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "InvoiceNumber": "GIB2026001"}])
        with _patched(login, post):
            out = await edocs.respond_inbox_document("ed1", {"approval": "RED", "reason": "iade değil"}, USER)
        assert "iptal veya iade" in out["message"]
        stored = await db.incoming_edocs.find_one({"_id": "ed1"})
        assert stored["status"] == "approved"
        assert stored["commercial_response"] == "rejected"
        inv = await db.invoices.find_one({"_id": "inv9"})
        assert inv["status"] == "approved"
        assert inv["gib_response"] == "rejected"
        assert inv["gib_status"] == "Gelen E-Fatura Reddedildi"

    _run(scenario())


def _approve_doc(profile, **extra):
    doc = {
        "_id": "ed2",
        "company_id": "c1",
        "status": "pending",
        "kind": "invoice",
        "number": "GF1",
        "contact_id": "cnt1",
        "contact_name": "Tedarikçi A",
        "supplier": {"tax_id": "1111111111", "name": "Tedarikçi A"},
        "lines": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10, "product_id": "p1"}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
        "source": "isnet",
        "profile": profile,
    }
    doc.update(extra)
    return doc


def test_temel_auto_accept_and_ticari_still_waits():
    async def scenario(profile, gib_status, gib_response):
        fake_db = MagicMock()
        doc = _approve_doc(profile)
        fake_db.incoming_edocs.find_one = AsyncMock(return_value=doc)
        fake_db.incoming_edocs.update_one = AsyncMock()
        fake_db.invoices.insert_one = AsyncMock()
        fake_db.contacts.update_one = AsyncMock()
        fake_db.products.update_one = AsyncMock()
        edocs.init(fake_db, {})
        out = await edocs.approve_inbox_document("ed2", {"update_stock": True, "allow_unmatched": True})
        assert out["status"] == "success"
        inv = fake_db.invoices.insert_one.await_args.args[0]
        assert inv["gib_status"] == gib_status
        assert inv["gib_response"] == gib_response
        fake_db.contacts.update_one.assert_awaited()

    _run(scenario("TEMELFATURA", "Gelen E-Fatura Onaylandı", "accepted"))
    _run(scenario("TICARIFATURA", "Gelen E-Fatura (Yanıt Bekleniyor)", None))


def test_reject_and_ignore_stay_local_and_process_still_delegates():
    async def scenario():
        fake_db = MagicMock()
        fake_db.incoming_edocs.update_one = AsyncMock(return_value=MagicMock(matched_count=1))
        edocs.init(fake_db, {})
        with patch("isnet_portal.respond_incoming_invoice", AsyncMock()) as remote, \
             patch.object(edocs.tenant_access, "get_tenant_doc", AsyncMock(return_value={"_id": "ed_r", "company_id": "c1", "status": "pending"})):
            rejected = await edocs.reject_edoc("ed_r", {"reason": "yerel"}, USER)
            ignored = await edocs.ignore_edoc("ed_i", {"reason": "yok"})
            remote.assert_not_awaited()
        assert "reddedildi" in rejected["message"].lower()
        assert fake_db.incoming_edocs.update_one.await_args_list[0].args[1]["$set"]["status"] == "rejected"
        assert ignored["status"] == "success"
        assert fake_db.incoming_edocs.update_one.await_args_list[1].args[1]["$set"]["status"] == "ignored"

        doc = _approve_doc("TEMELFATURA")
        with patch.object(edocs.tenant_access, "get_tenant_doc", AsyncMock(return_value=doc)), \
             patch.object(edocs, "_enrich", AsyncMock()), \
             patch.object(edocs, "ensure_supplier", AsyncMock(return_value=doc)), \
             patch.object(edocs, "approve_inbox_document", AsyncMock(return_value={"status": "success", "invoice_id": "i"})) as approve:
            fake_db.incoming_edocs.update_one = AsyncMock()
            out = await edocs.process_edoc("ed2", {}, USER)
        assert out["invoice_id"] == "i"
        req = approve.await_args.args[1]
        assert req["update_stock"] is True
        assert req["allow_unmatched"] is True
        assert req.get("auto_create_products") is not True

    _run(scenario())


def test_portal_matches_invoice_and_does_not_log_password(caplog):
    async def scenario():
        bodies = []
        login, post = _portal(
            [{"InvoiceId": "987654", "Ettn": "AAA", "InvoiceNumber": "XX"}],
            bodies=bodies,
        )
        settings = _settings()
        with patch.object(isnet_portal, "_mobile_login", login), \
             patch.object(isnet_portal, "_mobile_post_json", post), \
             patch.object(isnet_portal.httpx, "AsyncClient", _DummyClient), \
             caplog.at_level("INFO"):
            out = await isnet_portal.respond_incoming_invoice(
                settings, "s3cret-pw", ettn="aaa", invoice_number="", approval="KABUL", reason="",
            )
        assert out["ok"] is True
        assert out["invoice_id"] == 987654
        approve = [b for u, b in bodies if u.endswith("/ApproveIncomingInvoice")][0]
        assert approve["ApprovalType"] == 0
        assert approve["InvoiceId"] == 987654
        assert "s3cret-pw" not in str(bodies)
        assert "s3cret-pw" not in caplog.text
        assert "password" not in caplog.text.lower()

        login2, post2 = _portal([], bodies=[])
        with patch.object(isnet_portal, "_mobile_login", login2), \
             patch.object(isnet_portal, "_mobile_post_json", post2), \
             patch.object(isnet_portal.httpx, "AsyncClient", _DummyClient):
            missing = await isnet_portal.respond_incoming_invoice(
                settings, "s3cret-pw", ettn="yok", invoice_number="YOK", approval="RED", reason="neden",
            )
        assert missing["ok"] is False
        assert missing["error"] == "İşNet'te yanıt bekleyen fatura bulunamadı"

    _run(scenario())
