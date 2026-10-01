"""e_invoice servisi: alıcı doğrulama, senaryo, UBL profili, create API birimleri."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import e_invoice  # noqa: E402
import ubl_export  # noqa: E402


class TestScenarioAndBuyer:
    def test_normalize_scenario(self):
        assert e_invoice.normalize_scenario("TEMEL", "e_invoice") == "TEMELFATURA"
        assert e_invoice.normalize_scenario("TICARI", "e_invoice") == "TICARIFATURA"
        assert e_invoice.normalize_scenario(None, "e_archive") == "EARSIVFATURA"

    def test_validate_buyer_requires_tax_for_einvoice(self):
        with pytest.raises(HTTPException):
            e_invoice.validate_buyer({"name": "A"}, {}, "e_invoice")
        ok = e_invoice.validate_buyer({"name": "A", "tax_number_or_id": "1234567890"}, {}, "e_invoice")
        assert ok["tax_id"] == "1234567890"

    def test_validate_buyer_archive_allows_empty_tax(self):
        ok = e_invoice.validate_buyer({"name": "Nihai"}, {}, "e_archive")
        assert ok["tax_id"] == "11111111111"

    def test_should_resolve_e_type_from_gib(self):
        assert e_invoice.should_resolve_e_type_from_gib("auto") is True
        assert e_invoice.should_resolve_e_type_from_gib("e_invoice") is True
        assert e_invoice.should_resolve_e_type_from_gib("e_archive") is True
        assert e_invoice.should_resolve_e_type_from_gib(None) is True
        assert e_invoice.should_resolve_e_type_from_gib("paper") is False
        assert e_invoice.should_resolve_e_type_from_gib("e_export") is False

    def test_scenario_forces_einvoice(self):
        assert e_invoice.honor_explicit_einvoice("e_invoice") is True
        assert e_invoice.honor_explicit_einvoice("E_INVOICE") is True
        assert e_invoice.honor_explicit_einvoice("e_archive") is False
        assert e_invoice.honor_explicit_einvoice("auto") is False
        assert e_invoice.honor_explicit_einvoice(None) is False
        assert e_invoice.honor_explicit_einvoice("") is False

    def test_format_integrator_gib_status(self):
        assert "Test" in e_invoice.format_integrator_gib_status(
            label="İşNet", mode="test", portal_status="", verified=False
        )
        assert "GİB onaylı" in e_invoice.format_integrator_gib_status(
            label="İşNet", mode="live", portal_status="Succeed", verified=True
        )
        assert e_invoice.format_integrator_gib_status(
            label="İşNet SOAP API", mode="live", portal_status="", verified=True
        ).startswith("İşNet")


class TestResolveBuyerMukellef:
    def test_simulated_vkn_is_efatura_tckn_is_archive(self):
        fake_db = MagicMock()
        fake_db.contacts.find_one = AsyncMock(return_value=None)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
        e_invoice.init(fake_db)

        async def _run():
            vkn = await e_invoice.resolve_buyer_mukellef("c1", "1234567890")
            tckn = await e_invoice.resolve_buyer_mukellef("c1", "12345678901")
            return vkn, tckn

        vkn, tckn = asyncio.get_event_loop().run_until_complete(_run())
        assert vkn["suggested_e_type"] == "e_invoice" and vkn["is_e_invoice_user"] is True
        assert tckn["suggested_e_type"] == "e_archive" and tckn["is_e_invoice_user"] is False

    def test_contact_flag_overrides_simulated_length(self):
        fake_db = MagicMock()
        contact = {"_id": "cnt1", "name": "X", "tax_number_or_id": "1234567890", "is_e_invoice_user": False}
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={})
        e_invoice.init(fake_db)

        out = asyncio.get_event_loop().run_until_complete(
            e_invoice.resolve_buyer_mukellef("c1", "1234567890", contact=contact)
        )
        assert out["suggested_e_type"] == "e_archive"


class TestUblProfileOverride:
    def test_temel_profile(self):
        inv = {
            "_id": "inv1", "invoice_number": "NX202600000001", "e_type": "e_invoice",
            "issue_date": "2026-09-12", "contact_name": "Alıcı", "contact_tax_id": "6320984412",
            "items": [{"name": "X", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
            "subtotal": 10, "vat_total": 2, "grand_total": 12, "_profile_override": "TEMELFATURA",
        }
        seller = {"name": "Satıcı", "tax_number": "1234567801", "city": "İstanbul", "address": "A"}
        buyer = {"name": "Alıcı", "tax_number_or_id": "6320984412", "city": "Ankara"}
        xml = ubl_export.build_invoice_ubl(inv, seller, buyer).decode()
        assert "TEMELFATURA" in xml
        assert "TICARIFATURA" not in xml


class TestIssueInvoiceSimulated:
    def test_issue_paper_and_simulated(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_sim", "company_id": "c1", "invoice_type": "sales", "e_type": "e_archive",
            "status": "draft", "contact_id": "cnt1", "contact_name": "Musteri", "contact_tax_id": "12345678901",
            "invoice_number": "NX1", "items": [],
        }
        contact = {"_id": "cnt1", "name": "Musteri", "tax_number_or_id": "12345678901"}
        company = {"_id": "c1", "name": "Firma", "tax_number": "1234567801"}

        async def find_one(q):
            if "_id" in q:
                if q["_id"] == "inv_sim":
                    return inv
                if q["_id"] == "cnt1":
                    return contact
                if q["_id"] == "c1":
                    return company
            if "company_id" in q:
                return {"company_id": "c1", "provider": "", "status": "simulated", "mode": "test"}
            return None

        fake_db.invoices.find_one = AsyncMock(side_effect=find_one)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()

        e_invoice.init(fake_db, {"consume_credits": AsyncMock(return_value=99)})

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")):
                paper = await e_invoice.issue_invoice("inv_sim", e_type="paper")
                assert paper["einvoice_state"] == "sent"
                inv["e_type"] = "e_archive"
                sim = await e_invoice.issue_invoice("inv_sim", e_type="auto", scenario="TICARI")
                assert sim["einvoice_state"] == "sent"
                assert sim["tracking_id"]
                assert sim["provider"] == "simulated"
                assert sim["e_type"] == "e_archive"
                assert sim.get("gib_lookup", {}).get("suggested_e_type") == "e_archive"
                return sim

        asyncio.get_event_loop().run_until_complete(_run())

    def test_issue_overrides_wrong_manual_type_from_gib(self):
        """Kullanıcı e_archive seçse bile GİB mükellefi ise e_invoice kesilir."""
        fake_db = MagicMock()
        inv = {
            "_id": "inv_vkn", "company_id": "c1", "invoice_type": "sales", "e_type": "e_archive",
            "status": "draft", "contact_id": "cnt2", "contact_name": "Sirket", "contact_tax_id": "1234567890",
            "invoice_number": "NX2", "items": [],
        }
        contact = {"_id": "cnt2", "name": "Sirket", "tax_number_or_id": "1234567890", "is_e_invoice_user": True}
        company = {"_id": "c1", "name": "Firma", "tax_number": "1234567801"}

        async def find_one(q):
            if q.get("_id") == "inv_vkn":
                return inv
            if q.get("_id") == "cnt2":
                return contact
            if q.get("_id") == "c1":
                return company
            return {"status": "simulated"}

        fake_db.invoices.find_one = AsyncMock(side_effect=find_one)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"consume_credits": AsyncMock(return_value=10)})

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")):
                # İstemci yanlışlıkla e_archive gönderse bile GİB kaydı e_invoice zorlar
                out = await e_invoice.issue_invoice("inv_vkn", e_type="e_archive")
                assert out["e_type"] == "e_invoice"
                assert "E-Fatura" in out["message"]
                # invoice e_type güncellemesi
                sets = [c.args[1]["$set"] for c in fake_db.invoices.update_one.await_args_list if "$set" in (c.args[1] if c.args else {})]
                assert any(s.get("e_type") == "e_invoice" for s in sets)

        asyncio.get_event_loop().run_until_complete(_run())

    def test_explicit_einvoice_honors_temel_ticari(self):
        """Temel/Ticari onayı e_type=e_invoice gönderir; TCKN (e-arşiv) olsa bile e-fatura kalır."""
        fake_db = MagicMock()
        inv = {
            "_id": "inv_force", "company_id": "c1", "invoice_type": "sales", "e_type": "paper",
            "status": "draft", "contact_id": "cnt3", "contact_name": "Nihai", "contact_tax_id": "12345678901",
            "invoice_number": "NX3", "items": [],
        }
        contact = {"_id": "cnt3", "name": "Nihai", "tax_number_or_id": "12345678901", "is_e_invoice_user": False}
        company = {"_id": "c1", "name": "Firma", "tax_number": "1234567801"}

        async def find_one(q):
            if q.get("_id") == "inv_force":
                return inv
            if q.get("_id") == "cnt3":
                return contact
            if q.get("_id") == "c1":
                return company
            return {"status": "simulated"}

        fake_db.invoices.find_one = AsyncMock(side_effect=find_one)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"status": "simulated"})
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"consume_credits": AsyncMock(return_value=10)})

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")):
                with patch.object(e_invoice, "resolve_buyer_mukellef", AsyncMock()) as lookup:
                    out = await e_invoice.issue_invoice("inv_force", e_type="e_invoice", scenario="TEMEL")
                    lookup.assert_not_awaited()
                assert out["e_type"] == "e_invoice"
                assert out["einvoice_state"] == "sent"

        asyncio.get_event_loop().run_until_complete(_run())

    def test_isnet_not_configured_refuses_simulated_gib(self):
        """İşNet seçili ama configured değilse sahte GİB başarısı yok."""
        fake_db = MagicMock()
        inv = {
            "_id": "inv_isnet", "company_id": "c1", "invoice_type": "sales", "e_type": "e_archive",
            "status": "draft", "contact_id": "cnt1", "contact_name": "Musteri", "contact_tax_id": "12345678901",
            "invoice_number": "TA202600000095", "items": [],
        }
        contact = {"_id": "cnt1", "name": "Musteri", "tax_number_or_id": "12345678901"}
        company = {"_id": "c1", "name": "Firma", "tax_number": "4810173324"}

        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(
            return_value={"provider": "isnet", "status": "simulated", "mode": "test"}
        )
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"password_fn": lambda s: ""})

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")):
                with pytest.raises(HTTPException) as e:
                    await e_invoice.issue_invoice("inv_isnet", e_type="e_archive")
                assert e.value.status_code == 400
                assert "yapılandırılmamış" in e.value.detail.lower() or "simüle" in e.value.detail.lower()

        asyncio.get_event_loop().run_until_complete(_run())


class TestRefreshOutbound:
    def test_timeout_queued(self):
        fake_db = MagicMock()

        class Cur:
            def sort(self, *a, **k):
                return self
            def limit(self, n):
                return self
            def __aiter__(self):
                async def gen():
                    yield {
                        "_id": "q1", "company_id": "c1", "einvoice_state": "queued",
                        "queued_at": "2020-01-01T00:00:00+00:00", "gib_tracking_id": None,
                    }
                return gen()

        fake_db.invoices.find = MagicMock(return_value=Cur())
        fake_db.invoices.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value={})
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={})
        e_invoice.init(fake_db)

        res = asyncio.get_event_loop().run_until_complete(e_invoice.refresh_outbound_statuses())
        assert res["checked"] == 1
        assert res["updated"] == 1
        fake_db.invoices.update_one.assert_awaited()

    def test_isnet_ignores_poisoned_n11_url(self):
        """İşNet faturasına yanlış basılmış n11 URL → GetDocumentViewerLink."""
        fake_db = MagicMock()
        inv = {
            "_id": "inv1",
            "company_id": "c1",
            "integrator": "isnet",
            "e_type": "e_archive",
            "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "gib_document_url": "https://ebelge.n11faturam.com/ViewDocument.aspx?ID=1&UUID=x",
            "invoice_number": "TA1",
        }
        settings = {"provider": "isnet", "status": "configured", "company_tax_id": "4810173324", "mode": "test"}
        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
        fake_db.invoices.update_one = AsyncMock()
        e_invoice.init(fake_db)

        async def _run():
            with patch.object(
                e_invoice.isnet,
                "get_document_viewer_link",
                AsyncMock(return_value={"url": "https://isnet.example/view?k=1", "html_url": "https://isnet.example/view?k=1", "pdf_url": ""}),
            ):
                out = await e_invoice.resolve_gib_document_url("inv1")
            assert out["url"].startswith("https://isnet.example")
            assert out["source"] == "viewer_link"

        asyncio.get_event_loop().run_until_complete(_run())


class TestIntegratorCredits:
    def test_returns_isnet_balance(self):
        fake_db = MagicMock()
        fake_db.einvoice_settings.find_one = AsyncMock(
            return_value={"provider": "isnet", "status": "configured", "company_tax_id": "4810173324", "mode": "test"}
        )
        e_invoice.init(fake_db)

        async def _run():
            with patch.object(
                e_invoice.isnet,
                "get_company_balance",
                AsyncMock(return_value={"remaining_credit": "42", "balance": "42", "message": "OK"}),
            ):
                out = await e_invoice.api_integrator_credits("c1")
            assert out["balance"] == 42
            assert out["source"] == "isnet"
            assert out["provider"] == "isnet"

        asyncio.get_event_loop().run_until_complete(_run())

    def test_unconfigured_returns_null_balance(self):
        fake_db = MagicMock()
        fake_db.einvoice_settings.find_one = AsyncMock(return_value={"provider": "isnet", "status": "simulated"})
        e_invoice.init(fake_db)
        out = asyncio.get_event_loop().run_until_complete(e_invoice.api_integrator_credits("c1"))
        assert out["balance"] is None
        assert out["source"] == "none"


class TestFetchIntegratorXml:
    def test_http_error_returns_none_for_local_fallback(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_xml",
            "company_id": "c1",
            "e_type": "e_invoice",
            "status": "approved",
            "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_number": "TA1",
            "integrator": "isnet",
        }
        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.einvoice_settings.find_one = AsyncMock(
            return_value={"provider": "isnet", "status": "configured", "company_tax_id": "4810173324"}
        )
        e_invoice.init(fake_db)

        async def _run():
            with patch.object(
                e_invoice.isnet,
                "download_invoice_xml",
                AsyncMock(side_effect=HTTPException(status_code=404, detail="İşNet XML anahtarı (key) bulunamadı.")),
            ):
                out = await e_invoice.fetch_integrator_xml("inv_xml")
            assert out is None

        asyncio.get_event_loop().run_until_complete(_run())


class TestFinalizeAndTrack:
    def test_create_request_and_record(self):
        req = e_invoice.InvoiceCreateRequest(order_id="o1", company_id="c1", scenario="TEMEL")
        assert req.scenario == "TEMEL"
        assert e_invoice.scenario_short("TEMELFATURA") == "TEMEL"
        assert e_invoice.state_to_track_status("sent") == "SENT"

        fake_db = MagicMock()
        inv = {"_id": "inv_x", "company_id": "c1", "invoice_number": "NX99", "grand_total": 120.5, "gib_scenario": "TICARIFATURA", "e_type": "e_archive"}
        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.orders.update_one = AsyncMock()
        fake_db.e_invoices.find_one = AsyncMock(return_value=None)
        fake_db.e_invoices.update_one = AsyncMock()
        e_invoice.init(fake_db)

        async def _run():
            out = await e_invoice.finalize_create_result(
                {"status": "success", "einvoice_state": "sent", "gib_uuid": "U-1", "e_type": "e_archive"},
                "inv_x",
                order_id="ord1",
                company_id="c1",
            )
            assert out["invoice_number"] == "NX99"
            assert out["company_id"] == "c1"
            assert out["e_type"] == "e_archive"
            fake_db.e_invoices.update_one.assert_awaited()
            patch_set = fake_db.orders.update_one.await_args[0][1]["$set"]
            assert patch_set["einvoice_state"] == "sent"
            assert patch_set["e_type"] == "e_archive"
            return out

        asyncio.run(_run())


class TestIsnetOfficialInvoiceNumber:
    def test_issue_patches_list_number_from_portal(self):
        """İşNet portal no (UUU…) → invoice_number + gib_invoice_id; yerel TKB ezilmez kaynak olarak."""
        fake_db = MagicMock()
        inv = {
            "_id": "inv_uuu",
            "company_id": "c1",
            "invoice_type": "sales",
            "e_type": "e_invoice",
            "status": "draft",
            "contact_id": "cnt1",
            "contact_name": "Musteri",
            "contact_tax_id": "1234567890",
            "invoice_number": "NX2026000000103",
            "items": [],
        }
        contact = {
            "_id": "cnt1",
            "name": "Musteri",
            "tax_number_or_id": "1234567890",
            "is_e_invoice_user": True,
            "e_invoice_alias": "urn:mail:pk@x.com",
        }
        company = {"_id": "c1", "name": "Firma", "tax_number": "4810173324"}
        settings = {
            "provider": "isnet",
            "status": "configured",
            "mode": "test",
            "company_tax_id": "4810173324",
        }

        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"password_fn": lambda s: "x", "consume_credits": AsyncMock(return_value=5)})

        sent = {
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "UUU2026999464749",
            "official_invoice_id": "UUU2026999464749",
            "number_source": "portal",
            "ubl_id": "TKB2026000000103",
            "document_url": "https://view.example/x",
            "verified": True,
            "gib_status_raw": "Onaylandı",
            "mode": "test",
        }

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")), patch.object(
                e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value={"suggested_e_type": "e_invoice", "is_e_invoice_user": True})
            ), patch.object(e_invoice.isnet, "send_document", AsyncMock(return_value=sent)), patch.object(
                e_invoice, "store_outgoing_xml", AsyncMock()
            ), patch("n11faturam.build_ubl", return_value=("<Invoice/>", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "UUU2026999464749")):
                out = await e_invoice.issue_invoice("inv_uuu", e_type="e_invoice", scenario="TEMEL")
            assert out["invoice_number"] == "UUU2026999464749"
            assert out["gib_invoice_id"] == "UUU2026999464749"
            sets = [c.args[1]["$set"] for c in fake_db.invoices.update_one.await_args_list if "$set" in (c.args[1] if c.args else {})]
            final = [s for s in sets if s.get("einvoice_state") == "sent"]
            assert final
            assert final[-1]["invoice_number"] == "UUU2026999464749"
            assert final[-1]["local_invoice_number"] == "NX2026000000103"

        asyncio.get_event_loop().run_until_complete(_run())

    def test_issue_does_not_promote_local_ubl_tkb_as_official(self):
        fake_db = MagicMock()
        inv = {
            "_id": "inv_tkb",
            "company_id": "c1",
            "invoice_type": "sales",
            "e_type": "e_archive",
            "status": "draft",
            "contact_id": "cnt1",
            "contact_name": "Musteri",
            "contact_tax_id": "11111111111",
            "invoice_number": "NX2026000000103",
            "items": [],
        }
        contact = {"_id": "cnt1", "name": "Musteri", "tax_number_or_id": "11111111111"}
        company = {"_id": "c1", "name": "Firma", "tax_number": "4810173324"}
        settings = {"provider": "isnet", "status": "configured", "mode": "test", "company_tax_id": "4810173324"}

        fake_db.invoices.find_one = AsyncMock(return_value=inv)
        fake_db.contacts.find_one = AsyncMock(return_value=contact)
        fake_db.contacts.update_one = AsyncMock()
        fake_db.companies.find_one = AsyncMock(return_value=company)
        fake_db.einvoice_settings.find_one = AsyncMock(return_value=settings)
        fake_db.invoices.update_one = AsyncMock()
        fake_db.outgoing_einvoice_xml.update_one = AsyncMock()
        e_invoice.init(fake_db, {"password_fn": lambda s: "x", "consume_credits": AsyncMock(return_value=5)})

        sent = {
            "ettn": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            "invoice_id": "TKB2026000000103",
            "official_invoice_id": "",
            "number_source": "ubl",
            "ubl_id": "TKB2026000000103",
            "document_url": "",
            "verified": False,
            "mode": "test",
        }

        async def _run():
            with patch.object(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>")), patch.object(
                e_invoice, "resolve_buyer_mukellef", AsyncMock(return_value={"suggested_e_type": "e_archive", "is_e_invoice_user": False})
            ), patch.object(e_invoice.isnet, "send_document", AsyncMock(return_value=sent)), patch.object(
                e_invoice, "store_outgoing_xml", AsyncMock()
            ), patch("n11faturam.build_ubl", return_value=("<Invoice/>", "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "TKB2026000000103")):
                out = await e_invoice.issue_invoice("inv_tkb", e_type="e_archive")
            assert out["invoice_number"] == "NX2026000000103"
            assert out.get("gib_invoice_id") in (None, "")
            sets = [c.args[1]["$set"] for c in fake_db.invoices.update_one.await_args_list if c.args and "$set" in c.args[1]]
            final = [s for s in sets if s.get("einvoice_state") == "sent"]
            assert final
            assert "invoice_number" not in final[-1] or final[-1].get("invoice_number") != "TKB2026000000103"
            assert final[-1].get("gib_invoice_id") in (None, "")

        asyncio.get_event_loop().run_until_complete(_run())
