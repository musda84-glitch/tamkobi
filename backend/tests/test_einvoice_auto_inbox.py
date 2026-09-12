"""e-Fatura gelen kutusu: otomatik çekim + XML/PDF içeri alma."""
import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))


class TestEinvoiceViewDefaults:
    def test_auto_flags_default_true_when_missing(self):
        import server

        view = server._einvoice_view("comp1", {"provider": "n11faturam", "status": "configured"})
        assert view["auto_pull"] is True
        assert view["auto_process"] is True

    def test_auto_flags_respect_explicit_false(self):
        import server

        view = server._einvoice_view(
            "comp1",
            {"provider": "n11faturam", "status": "configured", "auto_pull": False, "auto_process": False},
        )
        assert view["auto_pull"] is False
        assert view["auto_process"] is False


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

    def test_sync_also_processes_pending_by_default(self):
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

    def test_sync_can_skip_process(self):
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
    def test_tick_skips_when_auto_pull_false(self):
        import server

        settings_list = [
            {"provider": "n11faturam", "status": "configured", "company_id": "c1", "auto_pull": False, "auto_process": True},
            {"provider": "n11faturam", "status": "configured", "company_id": "c2", "auto_pull": True, "auto_process": True},
            {"provider": "n11faturam", "status": "configured", "company_id": "c3", "auto_pull": True, "auto_process": False},
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
        assert pulls == ["c2", "c3"]
        assert processes == ["c2"]
