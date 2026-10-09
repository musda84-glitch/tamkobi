"""GİB kesiminde «şimdi» tarih/saat damgası (stamp_now)."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import e_invoice  # noqa: E402
import ubl_export  # noqa: E402


class TestApplyIssueStamp:
    def test_normalize_issue_time(self):
        assert e_invoice.normalize_issue_time("14:30") == "14:30:00"
        assert e_invoice.normalize_issue_time("14:30:07") == "14:30:07"
        assert e_invoice.normalize_issue_time("") == ""
        assert e_invoice.normalize_issue_time(None) == ""

    def test_stamp_now_writes_client_or_istanbul(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_st",
            "company_id": "c1",
            "status": "approved",
            "issue_date": "2026-01-01",
            "issue_time": "00:00:00",
            "einvoice_state": "draft",
            "gib_status": "Onaylandı",
        }
        fake_db.invoices.update_one = AsyncMock()
        fake_db.invoices.find_one = AsyncMock(
            return_value={**inv, "issue_date": "2026-10-09", "issue_time": "22:56:00"}
        )
        e_invoice.init(fake_db)

        async def _run():
            out = await e_invoice.apply_issue_stamp(
                "inv_st",
                inv,
                stamp_now=True,
                issue_date="2026-10-09",
                issue_time="22:56:00",
            )
            assert out["issue_date"] == "2026-10-09"
            assert out["issue_time"] == "22:56:00"
            set_arg = fake_db.invoices.update_one.await_args.args[1]["$set"]
            assert set_arg == {"issue_date": "2026-10-09", "issue_time": "22:56:00"}

        asyncio.get_event_loop().run_until_complete(_run())

    def test_stamp_now_without_client_uses_istanbul(self):
        fake_db = MagicMock()
        inv = {"_id": "inv_st2", "status": "draft", "issue_date": "2020-01-01"}
        fake_db.invoices.update_one = AsyncMock()
        fake_db.invoices.find_one = AsyncMock(side_effect=lambda q: {**inv, **fake_db._patch})

        async def _upd(q, upd):
            fake_db._patch = upd["$set"]

        fake_db.invoices.update_one = AsyncMock(side_effect=_upd)
        fake_db._patch = {}
        e_invoice.init(fake_db)

        async def _run():
            out = await e_invoice.apply_issue_stamp("inv_st2", inv, stamp_now=True)
            assert out["issue_date"]
            assert out["issue_time"]
            assert len(out["issue_time"]) == 8

        asyncio.get_event_loop().run_until_complete(_run())

    def test_stamp_blocked_when_gib_locked(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_lock",
            "status": "approved",
            "einvoice_state": "sent",
            "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        }
        e_invoice.init(fake_db)

        async def _run():
            with pytest.raises(HTTPException) as ei:
                await e_invoice.apply_issue_stamp("inv_lock", inv, stamp_now=True)
            assert ei.value.status_code == 400

        asyncio.get_event_loop().run_until_complete(_run())

    def test_issue_invoice_applies_stamp_before_ubl(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_stamp",
            "company_id": "c1",
            "invoice_type": "sales",
            "e_type": "e_archive",
            "status": "draft",
            "contact_id": "cnt1",
            "contact_name": "Ali",
            "contact_tax_id": "11111111111",
            "invoice_number": "SF-STAMP",
            "issue_date": "2026-01-01",
            "issue_time": "",
            "items": [{"name": "X", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 12}],
            "subtotal": 10,
            "vat_total": 2,
            "grand_total": 12,
        }
        contact = {"_id": "cnt1", "name": "Ali", "tax_number_or_id": "11111111111"}
        company = {"_id": "c1", "name": "Firma", "tax_number": "1234567801"}

        state = {"inv": dict(inv)}

        async def find_one(q):
            if q.get("_id") == "inv_stamp":
                return dict(state["inv"])
            if q.get("_id") == "cnt1":
                return contact
            if q.get("_id") == "c1":
                return company
            return {"status": "simulated"}

        async def update_one(q, upd):
            if q.get("_id") == "inv_stamp" and "$set" in upd:
                state["inv"].update(upd["$set"])

        fake_db.invoices.find_one = AsyncMock(side_effect=find_one)
        fake_db.invoices.update_one = AsyncMock(side_effect=update_one)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"consume_credits": AsyncMock(return_value=10)})

        captured = {}

        async def fake_build(inv_doc, *a, **k):
            captured["issue_date"] = inv_doc.get("issue_date")
            captured["issue_time"] = inv_doc.get("issue_time")
            return b"<Invoice/>"

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(side_effect=fake_build)):
                await e_invoice.issue_invoice(
                    "inv_stamp",
                    e_type="e_archive",
                    stamp_now=True,
                    issue_date="2026-10-09",
                    issue_time="22:56:00",
                )
            assert captured["issue_date"] == "2026-10-09"
            assert captured["issue_time"] == "22:56:00"
            assert state["inv"]["issue_date"] == "2026-10-09"
            assert state["inv"]["issue_time"] == "22:56:00"

        asyncio.get_event_loop().run_until_complete(_run())


class TestUblIssueTimeIstanbul:
    def test_default_issue_time_is_hhmmss(self):
        t = ubl_export.default_issue_time()
        assert len(t) == 8
        assert t[2] == ":" and t[5] == ":"
