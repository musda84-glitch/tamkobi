"""Şirket SSE kanalı: tür+id, şirket izolasyonu, token audience, nginx başlığı."""
import asyncio
import os
import sys

from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-company-events-jwt-secret-not-default-32b")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import auth_utils  # noqa: E402
import company_events  # noqa: E402


def _app_token():
    return auth_utils.create_access_token("usr_1", "a@example.com", "admin", aud="app")


def _ik_token():
    return auth_utils.create_access_token("usr_1", "a@example.com", "personel", aud="ik")


async def _user_dep(request: Request) -> dict:
    token = auth_utils.session_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
    payload = auth_utils.decode_access_payload(token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=401, detail="Geçersiz token türü")
    auth_utils.enforce_token_audience(payload, request, path=request.url.path)
    return {
        "id": payload["sub"],
        "active_company_id": "co_a",
        "company_ids": ["co_a"],
    }


def _client():
    company_events.reset_for_tests()
    company_events.init(None, _user_dep)
    app = FastAPI()
    app.include_router(company_events.router)
    return TestClient(app, base_url="http://app.tamkobi.com")


class TestChangeKind:
    def test_finance_kinds_and_skips(self):
        assert company_events.change_kind("bank_transactions", {"source": "virman", "_id": "b1", "company_id": "c"}) == "transfer"
        assert company_events.change_kind(
            "bank_transactions",
            {"source": "payment", "contact_id": "k1", "_id": "b2", "company_id": "c", "amount": 10},
        ) == "payment"
        assert company_events.change_kind(
            "bank_transactions",
            {"source": "partner", "partner_tx_id": "p1", "_id": "b3", "company_id": "c"},
        ) == "partner_transaction"
        assert company_events.change_kind("bank_transactions", {"_id": "b4", "company_id": "c"}) == "bank_transaction"
        assert company_events.change_kind("partner_transactions", {"contact_id": "k", "_id": "t1", "company_id": "c"}) == "payment"
        assert company_events.change_kind("partner_transactions", {"_id": "t2", "company_id": "c"}) == "partner_transaction"
        assert company_events.change_kind("invoices", {"_id": "i1", "company_id": "c"}) == "invoice"
        assert company_events.change_kind("orders", {"_id": "o1", "company_id": "c"}) == "order"
        assert company_events.change_kind("contacts", {"_id": "k1", "company_id": "c"}) == "contact"
        assert company_events.change_kind("products", {"_id": "s1", "company_id": "c"}) == "stock"
        assert company_events.change_kind("stock_movements", {"_id": "m1", "company_id": "c"}) == "stock"
        assert company_events.change_kind("company_events", {"_id": "e1", "company_id": "c"}) is None
        assert company_events.change_kind("users", {"_id": "u1", "company_id": "c"}) is None
        assert company_events.change_kind("invoices", None) is None

    def test_wire_is_type_and_id_only(self):
        wired = company_events.wire_event({
            "type": "invoice",
            "id": "inv1",
            "company_id": "co_a",
            "amount": 500,
            "name": "Ali",
        })
        assert wired == {"event": "changed", "type": "invoice", "id": "inv1"}
        assert set(wired) == {"event", "type", "id"}


class TestCompanyIsolation:
    def setup_method(self):
        company_events.reset_for_tests()

    def teardown_method(self):
        company_events.reset_for_tests()

    def test_subscriber_sees_only_own_company(self):
        own = company_events.subscribe("co_a")
        other = company_events.subscribe("co_b")
        company_events.note_change("invoices", {
            "_id": "inv_b",
            "company_id": "co_b",
            "grand_total": 1000,
            "contact_name": "Gizli",
        })
        company_events.note_change("orders", {
            "_id": "ord_a",
            "company_id": "co_a",
            "total_amount": 50,
        })
        company_events.note_change("products", {"company_id": "co_a"})
        got = own.get_nowait()
        assert got["type"] == "order"
        assert got["id"] == "ord_a"
        assert "total_amount" not in got
        assert company_events.wire_event(got) == {"event": "changed", "type": "order", "id": "ord_a"}
        leaked = other.get_nowait()
        assert leaked["id"] == "inv_b"
        assert own.empty()
        assert other.empty()

    def test_events_for_company_filters_cursor_and_tenant(self):
        rows = [
            {"company_id": "co_b", "type": "invoice", "id": "x", "created_at": "2026-10-14T12:00:02+00:00"},
            {"company_id": "co_a", "type": "stock", "id": "old", "created_at": "2026-10-14T12:00:00+00:00"},
            {"company_id": "co_a", "type": "contact", "id": "new", "created_at": "2026-10-14T12:00:05+00:00"},
        ]
        out = company_events.events_for_company(rows, "co_a", "2026-10-14T12:00:01+00:00")
        assert [row["id"] for row in out] == ["new"]


class _Col:
    def __init__(self):
        self.rows = []

    async def insert_one(self, doc):
        self.rows.append(dict(doc))

    async def delete_many(self, _q):
        return None


class _Db:
    def __init__(self):
        self.company_events = _Col()


class TestFlush:
    def test_flush_coalesces_same_entity(self):
        company_events.reset_for_tests()
        db = _Db()
        company_events.init(db, None)
        company_events.note_change("invoices", {"_id": "inv1", "company_id": "co_a", "grand_total": 9})
        company_events.note_change("invoices", {"_id": "inv1", "company_id": "co_a", "grand_total": 11})
        company_events.note_change("contacts", {"_id": "k1", "company_id": "co_a", "balance": -3})
        written = asyncio.run(company_events.flush_once())
        company_events.reset_for_tests()
        assert written == 2
        kinds = {(row["type"], row["id"]) for row in db.company_events.rows}
        assert kinds == {("invoice", "inv1"), ("contact", "k1")}
        for row in db.company_events.rows:
            assert "grand_total" not in row
            assert "balance" not in row


class TestStreamAuth:
    def teardown_method(self):
        company_events.reset_for_tests()

    def test_ik_audience_rejected_on_app_host(self):
        client = _client()
        res = client.get(
            "/api/events/stream",
            headers={"Authorization": f"Bearer {_ik_token()}"},
        )
        assert res.status_code == 401

    def test_other_company_forbidden(self):
        client = _client()
        res = client.get(
            "/api/events/stream",
            params={"company_id": "co_other"},
            headers={"Authorization": f"Bearer {_app_token()}"},
        )
        assert res.status_code == 403

    def test_iterator_emits_hello_then_type_and_id(self):
        company_events.reset_for_tests()

        class _Req:
            def __init__(self):
                self.n = 0

            async def is_disconnected(self):
                self.n += 1
                if self.n == 1:
                    company_events.note_change("invoices", {
                        "_id": "inv9",
                        "company_id": "co_a",
                        "grand_total": 1250,
                    })
                    return False
                return True

        async def _collect():
            chunks = []
            async for chunk in company_events.iter_company_events("co_a", _Req()):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(_collect())
        body = "".join(chunks)
        assert body.startswith(": ok\n\n")
        assert 'event: changed\ndata: {"event":"changed","type":"invoice","id":"inv9"}' in body
        assert "grand_total" not in body
        assert "1250" not in body

    def test_idle_wait_keeps_stream_open(self, monkeypatch):
        """wait_for idle timeout (asyncio.TimeoutError) must not close the stream."""
        import inspect

        source = inspect.getsource(company_events.iter_company_events)
        assert "except asyncio.TimeoutError:" in source
        assert source.count("except TimeoutError:") == 0

        monkeypatch.setattr(company_events, "POLL_SEC", 0.02)
        monkeypatch.setattr(company_events, "HEARTBEAT_SEC", 0.08)
        company_events.reset_for_tests()

        class _Req:
            def __init__(self):
                self.n = 0

            async def is_disconnected(self):
                self.n += 1
                if self.n == 6:
                    company_events.note_change("invoices", {
                        "_id": "late1",
                        "company_id": "co_a",
                    })
                return self.n > 6

        async def _collect():
            chunks = []
            async for chunk in company_events.iter_company_events("co_a", _Req()):
                chunks.append(chunk)
            return chunks

        chunks = asyncio.run(_collect())
        body = "".join(chunks)
        assert body.startswith(": ok\n\n")
        assert ": ping\n\n" in body
        assert '"type":"invoice","id":"late1"' in body

    def test_app_stream_sends_nginx_header(self, monkeypatch):
        async def _finite(_company_id, _request):
            yield ": ok\n\n"

        monkeypatch.setattr(company_events, "iter_company_events", _finite)
        client = _client()
        res = client.get(
            "/api/events/stream",
            params={"company_id": "co_a"},
            headers={"Authorization": f"Bearer {_app_token()}"},
        )
        assert res.status_code == 200
        assert "text/event-stream" in (res.headers.get("content-type") or "")
        assert res.headers.get("x-accel-buffering") == "no"
        assert "no-cache" in (res.headers.get("cache-control") or "")
        assert ": ok" in res.text


class _FindCol:
    def __init__(self, rows=None):
        self.rows = list(rows or [])
        self.calls = 0

    def find(self, *_a, **_k):
        self.calls += 1
        rows = list(self.rows)

        class _Cursor:
            async def to_list(_self, _n):
                return rows

        return _Cursor()


class TestWorkerFanout:
    def teardown_method(self):
        company_events.reset_for_tests()

    def test_poll_interval_and_single_worker_skips_db(self, monkeypatch):
        assert company_events.POLL_SEC == 1.5
        monkeypatch.setattr(company_events, "_cmdline", lambda _pid: "")
        monkeypatch.delenv("TAMKOBI_WORKERS", raising=False)
        monkeypatch.delenv("WEB_CONCURRENCY", raising=False)
        assert company_events.worker_count() == 1
        col = _FindCol([{"company_id": "co_a", "type": "stock", "id": "s1", "created_at": "2099-01-01T00:00:00+00:00"}])
        company_events.reset_for_tests()
        company_events.init(type("Db", (), {"company_events": col})(), None)
        rows = asyncio.run(company_events._poll("co_a", "2020-01-01T00:00:00+00:00"))
        assert rows == []
        assert col.calls == 0

    def test_worker_count_prefers_process_flag_then_env(self, monkeypatch):
        monkeypatch.setattr(
            company_events,
            "_cmdline",
            lambda pid: "uvicorn server:app --workers 2" if pid == os.getppid() else "",
        )
        monkeypatch.setenv("TAMKOBI_WORKERS", "1")
        assert company_events.worker_count() == 2
        monkeypatch.setattr(company_events, "_cmdline", lambda _pid: "")
        monkeypatch.delenv("TAMKOBI_WORKERS", raising=False)
        monkeypatch.setenv("WEB_CONCURRENCY", "3")
        assert company_events.worker_count() == 3

    def test_single_worker_stream_uses_memory(self, monkeypatch):
        monkeypatch.setattr(company_events, "worker_count", lambda: 1)
        company_events.reset_for_tests()
        col = _FindCol([{"company_id": "co_a", "type": "stock", "id": "from-db", "created_at": "2099-01-01T00:00:00+00:00", "_id": "db1"}])
        company_events.init(type("Db", (), {"company_events": col})(), None)

        class _Req:
            def __init__(self):
                self.n = 0

            async def is_disconnected(self):
                self.n += 1
                if self.n == 1:
                    company_events.note_change("invoices", {"_id": "inv1", "company_id": "co_a"})
                    return False
                return True

        async def _collect():
            chunks = []
            async for chunk in company_events.iter_company_events("co_a", _Req()):
                chunks.append(chunk)
            return chunks

        body = "".join(asyncio.run(_collect()))
        assert '"type":"invoice","id":"inv1"' in body
        assert "from-db" not in body
        assert col.calls == 0

    def test_multi_worker_stream_reads_db(self, monkeypatch):
        monkeypatch.setattr(company_events, "worker_count", lambda: 2)
        company_events.reset_for_tests()
        col = _FindCol([{
            "company_id": "co_a",
            "type": "stock",
            "id": "s9",
            "created_at": "2099-01-01T00:00:00+00:00",
            "_id": "ev9",
        }])
        company_events.init(type("Db", (), {"company_events": col})(), None)

        class _Req:
            def __init__(self):
                self.n = 0

            async def is_disconnected(self):
                self.n += 1
                return self.n > 1

        async def _collect():
            chunks = []
            async for chunk in company_events.iter_company_events("co_a", _Req()):
                chunks.append(chunk)
            return chunks

        body = "".join(asyncio.run(_collect()))
        assert col.calls >= 1
        assert '"type":"stock","id":"s9"' in body
