"""e-Fatura gelen kutusu: otomatik çekim; içeri alma varsayılan kapalı."""
import asyncio
import os
import sys
from types import ModuleType
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


def _stub_emergent():
    """Cloud VM'de emergentintegrations yoksa hafif stub."""
    if "emergentintegrations" in sys.modules:
        return
    root = ModuleType("emergentintegrations")
    llm = ModuleType("emergentintegrations.llm")
    chat = ModuleType("emergentintegrations.llm.chat")

    class LlmChat:
        def __init__(self, *a, **k):
            pass

        async def send_message(self, *a, **k):
            return ""

    class UserMessage:
        def __init__(self, *a, **k):
            pass

    chat.LlmChat = LlmChat
    chat.UserMessage = UserMessage
    payments = ModuleType("emergentintegrations.payments")
    stripe_svc = ModuleType("emergentintegrations.payments.stripe")
    stripe_checkout = ModuleType("emergentintegrations.payments.stripe.checkout")

    class StripeCheckout:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionRequest:
        def __init__(self, *a, **k):
            pass

    class CheckoutSessionResponse:
        def __init__(self, *a, **k):
            pass

    stripe_checkout.StripeCheckout = StripeCheckout
    stripe_checkout.CheckoutSessionRequest = CheckoutSessionRequest
    stripe_checkout.CheckoutSessionResponse = CheckoutSessionResponse
    sys.modules["emergentintegrations"] = root
    sys.modules["emergentintegrations.llm"] = llm
    sys.modules["emergentintegrations.llm.chat"] = chat
    sys.modules["emergentintegrations.payments"] = payments
    sys.modules["emergentintegrations.payments.stripe"] = stripe_svc
    sys.modules["emergentintegrations.payments.stripe.checkout"] = stripe_checkout


_stub_emergent()


class TestEinvoiceViewDefaults:
    def test_auto_pull_defaults_true_auto_process_defaults_false(self):
        import server

        view = server._einvoice_view("comp1", {"provider": "n11faturam", "status": "configured"})
        assert view["auto_pull"] is True
        # İçeri alma varsayılan kapalı — manuel onay / stok eşleme gerekir
        assert view["auto_process"] is False

    def test_auto_flags_respect_explicit_values(self):
        import server

        view = server._einvoice_view(
            "comp1",
            {"provider": "n11faturam", "status": "configured", "auto_pull": False, "auto_process": True},
        )
        assert view["auto_pull"] is False
        assert view["auto_process"] is True

    def test_isnet_e_dispatch_defaults_and_flag(self):
        import server

        view = server._einvoice_view("comp1", {"provider": "isnet", "status": "configured"})
        assert view["e_dispatch_enabled"] is True
        assert view["despatch_defaults"]["plate"] == ""
        assert "e-İrsaliye" in (view.get("hint") or "")

        view2 = server._einvoice_view(
            "comp1",
            {
                "provider": "isnet",
                "status": "configured",
                "e_dispatch_enabled": False,
                "despatch_defaults": {"plate": "34abc123", "driver_tckn": "12345678901"},
            },
        )
        assert view2["e_dispatch_enabled"] is False
        assert view2["despatch_defaults"]["plate"] == "34abc123"
        assert view2["despatch_defaults"]["driver_tckn"] == "12345678901"

        normalized = server._normalize_despatch_defaults(
            {"despatch_plate": "34 ab c123", "despatch_driver_tckn": "111"},
            {},
        )
        assert normalized["plate"] == "34ABC123"
        assert normalized["driver_tckn"] == "111"


class TestPullAndProcess:
    def test_pull_skips_when_not_configured(self):
        import server

        with pytest.raises(HTTPException) as ei:
            asyncio.get_event_loop().run_until_complete(
                server.pull_einvoice_incoming("comp1", settings={"provider": "n11faturam", "status": "simulated"})
            )
        assert ei.value.status_code == 400

    def test_pull_ingests_xml_rows(self):
        import server

        settings = {
            "provider": "n11faturam",
            "status": "configured",
            "company_id": "comp1",
            "corporate_code": "X",
            "username": "u",
            "password_enc": "enc",
        }
        rows = [
            {"invoice_id": "A1", "uuid": "u1", "xml": b"<Invoice/>"},
            {"invoice_id": "A2", "uuid": "u2", "xml": None, "xml_error": "yok"},
        ]

        async def _run():
            with patch.object(server, "_einvoice_password", return_value="secret"), patch.object(
                server.n11faturam, "list_incoming", AsyncMock(return_value=rows)
            ), patch.object(
                server.edocs, "ingest_ubl_bytes", AsyncMock(return_value={"_id": "d1", "number": "A1"})
            ), patch.object(server.db.einvoice_settings, "update_one", AsyncMock()):
                return await server.pull_einvoice_incoming("comp1", days=7, settings=settings)

        result = asyncio.get_event_loop().run_until_complete(_run())
        assert result["found"] == 2
        assert result["pulled"] == 1
        assert len(result["failed"]) == 1

    def test_sync_does_not_process_by_default(self):
        """Varsayılan: çekim sonrası içeri alma yok — Bekleyen'de kalır."""
        import server

        settings = {"provider": "n11faturam", "status": "configured", "company_id": "comp1"}

        async def _run():
            with patch.object(server.db.einvoice_settings, "find_one", AsyncMock(return_value=settings)), patch.object(
                server, "pull_einvoice_incoming", AsyncMock(return_value={"status": "success", "pulled": 1, "message": "1 alındı."})
            ), patch.object(server.edocs, "process_pending_for_company", AsyncMock()) as proc:
                result = await server.sync_einvoice_incoming(company_id="comp1", days=14)
                proc.assert_not_called()
                return result

        result = asyncio.get_event_loop().run_until_complete(_run())
        assert "processed" not in result

    def test_sync_processes_when_setting_or_param_true(self):
        import server

        settings = {"provider": "n11faturam", "status": "configured", "auto_process": True, "company_id": "comp1"}

        async def _run():
            with patch.object(server.db.einvoice_settings, "find_one", AsyncMock(return_value=settings)), patch.object(
                server, "pull_einvoice_incoming", AsyncMock(return_value={"status": "success", "pulled": 1, "message": "1 alındı."})
            ), patch.object(
                server.edocs,
                "process_pending_for_company",
                AsyncMock(return_value={"processed": 2, "failed": [], "message": "2 belge içeri alındı."}),
            ):
                return await server.sync_einvoice_incoming(company_id="comp1", days=14)

        result = asyncio.get_event_loop().run_until_complete(_run())
        assert result["processed"] == 2
        assert "içeri alındı" in result["message"]

    def test_sync_can_force_skip_process_even_if_setting_on(self):
        import server

        settings = {"provider": "n11faturam", "status": "configured", "auto_process": True}

        async def _run():
            with patch.object(server.db.einvoice_settings, "find_one", AsyncMock(return_value=settings)), patch.object(
                server, "pull_einvoice_incoming", AsyncMock(return_value={"status": "success", "pulled": 0, "message": "yok."})
            ), patch.object(server.edocs, "process_pending_for_company", AsyncMock()) as proc:
                result = await server.sync_einvoice_incoming(company_id="comp1", days=14, auto_process=False)
                proc.assert_not_called()
                return result

        result = asyncio.get_event_loop().run_until_complete(_run())
        assert "processed" not in result


class TestAutoLoopSkip:
    def test_tick_skips_process_when_auto_process_false_or_missing(self):
        import server

        settings_list = [
            {"provider": "n11faturam", "status": "configured", "company_id": "c1", "auto_pull": False, "auto_process": True},
            {"provider": "n11faturam", "status": "configured", "company_id": "c2", "auto_pull": True, "auto_process": True},
            {"provider": "n11faturam", "status": "configured", "company_id": "c3", "auto_pull": True, "auto_process": False},
            {"provider": "isnet", "status": "configured", "company_id": "c4", "auto_pull": True, "auto_process": True},
        ]

        class _Cursor:
            def to_list(self, n):
                async def _():
                    return settings_list

                return _()

        async def _once():
            pulls, processes = [], []

            async def fake_pull(cid, days=14, settings=None):
                pulls.append(cid)
                return {"pulled": 0, "message": "ok"}

            async def fake_process(cid, req=None):
                processes.append(cid)
                return {"processed": 0, "failed": [], "message": "0"}

            with patch.object(server.db.einvoice_settings, "find", MagicMock(return_value=_Cursor())), patch.object(
                server, "pull_einvoice_incoming", side_effect=fake_pull
            ), patch.object(server.edocs, "process_pending_for_company", side_effect=fake_process):
                await server._run_einvoice_inbox_auto_tick()
            return pulls, processes

        pulls, processes = asyncio.get_event_loop().run_until_complete(_once())
        assert "c1" not in pulls
        assert pulls == ["c2", "c3", "c4"]
        # n11 + auto_process=True → c2; İşNet asla otomatik içeri alınmaz
        assert processes == ["c2"]
