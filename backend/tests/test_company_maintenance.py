"""Firma bakımı. storage_write_lock ile aynı kilit. Canlı veritabanına ve 8021'e bağlanmaz."""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from starlette.requests import Request

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
import mysql_store  # noqa: E402
import server  # noqa: E402
import storage_router  # noqa: E402
import tenant_db  # noqa: E402
from tenant_scope import TenantScope  # noqa: E402

CID = "co_maint"
BANNER = "Bakım yapılıyor, kayıt geçici olarak kapalı"


@pytest.fixture(autouse=True)
def _reset(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    storage_router.reset()
    server.clear_marketplace_holds()
    yield
    storage_router.reset()
    server.clear_marketplace_holds()


def _scope(company_id=CID):
    return TenantScope(
        company_id=company_id,
        allowed=frozenset({company_id}),
        kind="user",
        actor_id="user-maint",
        reason="test",
    )


def _request(method: str, path: str, query: str = "") -> Request:
    return Request({
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": method,
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": query.encode(),
        "headers": [],
        "client": ("10.1.1.8", 4000),
        "server": ("test", 80),
    })


class _Coll:
    def __init__(self, db, name="products"):
        self._db = db
        self.name = name


def test_banner_copy_is_on_web_and_mobile():
    root = _BACKEND.parent
    web = (root / "frontend/src/components/MainLayout.jsx").read_text(encoding="utf-8")
    mobile = (root / "mobile/src/app/_layout.tsx").read_text(encoding="utf-8")
    drawer = (root / "frontend/src/components/saas/CompanyLicenseDrawer.jsx").read_text(encoding="utf-8")
    assert BANNER in web
    assert 'data-testid="maintenance-banner"' in web
    assert BANNER in mobile
    assert BANNER in drawer
    assert "/maintenance" in drawer


def test_lock_blocks_writes_and_keeps_reads(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    db = MemDB()

    async def run():
        await db.companies.insert_one({"_id": CID, "name": "Bakım", "storage_mode": "legacy"})
        await db.products.insert_one({"_id": "p1", "company_id": CID, "name": "Kalem", "sku": "K"})
        before = storage_router.read_count
        await storage_router.set_company_maintenance(db, CID, True)
        company = await db.companies.find_one({"_id": CID})
        assert company["storage_write_lock"] is True
        assert "maintenance" not in company
        handle = tenant_db.TenantDB(db, _scope())
        found = await handle.products.find_one({"_id": "p1"})
        assert found["name"] == "Kalem"
        with pytest.raises(storage_router.StorageWriteLocked) as exc:
            await handle.products.insert_one({"_id": "p2", "company_id": CID, "name": "Yeni", "sku": "Y"})
        assert "salt okunur" in str(exc.value)
        assert BANNER in str(exc.value)
        await mysql_store._reject_maintenance(_Coll(db), "find", query={"company_id": CID})
        with pytest.raises(storage_router.StorageWriteLocked):
            await mysql_store._reject_maintenance(
                _Coll(db), "update_one", query={"_id": "p1", "company_id": CID}, update={"$set": {"name": "Yok"}},
            )
        storage_router.forget_mode(CID)
        with pytest.raises(storage_router.StorageWriteLocked):
            await mysql_store._reject_maintenance(
                _Coll(db), "delete_one", query={"company_id": CID},
            )
        assert storage_router.read_count == before == 0
        assert await db.products.find_one({"_id": "p2"}) is None
        await storage_router.set_company_maintenance(db, CID, False)
        await handle.products.insert_one({"_id": "p2", "company_id": CID, "name": "Yeni", "sku": "Y"})
        assert (await handle.products.find_one({"_id": "p2"}))["name"] == "Yeni"

    asyncio.run(run())


def test_http_423_and_super_admin_toggle_replays_orders(monkeypatch):
    async def _none(*_args, **_kwargs):
        return None

    monkeypatch.setattr(server, "_ensure_order_contact", _none)
    monkeypatch.setattr(server, "_attach_draft_invoice_on_intake", _none)
    monkeypatch.setattr(server, "_try_shopphp_settlement", _none)
    monkeypatch.setattr(server, "_notify_marketplace_inserted", _none)
    db = MemDB()
    previous_db = server.db
    server.db = db
    import platform_store

    previous_audit = platform_store._db
    platform_store.init(db)
    orders = db.orders
    real_insert = orders.insert_one
    real_update = orders.update_one

    async def insert_one(doc):
        company = await db.companies.find_one({"_id": doc.get("company_id")})
        if company and company.get("storage_write_lock"):
            raise storage_router.StorageWriteLocked(storage_router.WRITE_LOCK_MESSAGE, company_id=CID)
        return await real_insert(doc)

    async def update_one(query, update, upsert=False):
        company = await db.companies.find_one({"_id": (query or {}).get("company_id")})
        if company and company.get("storage_write_lock"):
            raise storage_router.StorageWriteLocked(storage_router.WRITE_LOCK_MESSAGE, company_id=CID)
        return await real_update(query, update, upsert=upsert)

    orders.insert_one = insert_one
    orders.update_one = update_one

    async def run():
        await db.companies.insert_one({"_id": CID, "name": "Bakım"})
        await storage_router.set_company_maintenance(db, CID, True)
        incoming = [{
            "channel": "hepsiburada",
            "order_number": "HB-M",
            "customer_name": "gizli-musteri",
            "total_amount": 4,
            "items": [],
        }]
        locked = await server._upsert_marketplace_orders(CID, incoming)
        assert locked["held"] == 1
        assert locked["inserted"] == 0
        assert await db.orders.count_documents({"company_id": CID}) == 0
        user = {"_id": "sa_1", "is_super_admin": True}
        opened = await server.system_company_maintenance(
            CID, server.CompanyMaintenanceBody(enabled=False), _request("POST", f"/api/system/companies/{CID}/maintenance"), user,
        )
        assert opened["maintenance"] is False
        assert opened["replayed"]["inserted"] == 1
        assert "held" not in opened["replayed"]
        assert "held" not in opened
        rows = await db.orders.find({"company_id": CID}).to_list(5)
        assert {row["order_number"] for row in rows} == {"HB-M"}
        assert server._marketplace_holds == {}
        audit = await db.platform_audit_log.find({"target_id": CID}).to_list(5)
        assert audit[-1]["action"] == "company_maintenance_off"
        assert audit[-1]["actor_id"] == "sa_1"
        assert "gAAAA" not in str(audit)
        assert "dedicated_dsn" not in str(audit)
        again = await server.system_company_maintenance(
            CID, server.CompanyMaintenanceBody(enabled=True), _request("POST", f"/api/system/companies/{CID}/maintenance"), user,
        )
        assert again["maintenance"] is True
        assert "replayed" not in again
        on = await db.platform_audit_log.find({"action": "company_maintenance_on"}).to_list(5)
        assert on and on[0]["target_id"] == CID
        missing = await server.system_company_maintenance(
            "co_yok", server.CompanyMaintenanceBody(enabled=True), _request("POST", "/api/system/companies/co_yok/maintenance"), user,
        )
        return missing

    try:
        with pytest.raises(server.HTTPException) as missing:
            asyncio.run(run())
        assert missing.value.status_code == 404
    finally:
        server.db = previous_db
        platform_store._db = previous_audit
        server.clear_marketplace_holds()


def test_write_middleware_returns_423_and_lets_reads_through():
    db = MemDB()
    previous_db = server.db
    server.db = db

    async def run():
        await db.companies.insert_one({"_id": CID, "storage_write_lock": True})
        guard = server._MaintenanceWriteGuard(lambda *_args, **_kwargs: None)
        called = {"n": 0}

        async def call_next(_request):
            called["n"] += 1
            from starlette.responses import JSONResponse
            return JSONResponse({"ok": True})

        blocked = await guard.dispatch(
            _request("POST", "/api/products", f"company_id={CID}"),
            call_next,
        )
        assert blocked.status_code == 423
        assert blocked.body
        import json
        assert json.loads(blocked.body)["detail"] == BANNER
        assert called["n"] == 0
        reading = await guard.dispatch(_request("GET", "/api/products", f"company_id={CID}"), call_next)
        assert reading.status_code == 200
        login = await guard.dispatch(_request("POST", "/api/auth/login", f"company_id={CID}"), call_next)
        assert login.status_code == 200
        toggle = await guard.dispatch(
            _request("POST", f"/api/system/companies/{CID}/maintenance"),
            call_next,
        )
        assert toggle.status_code == 200
        sync = await guard.dispatch(
            _request("POST", "/api/integrations/ecommerce/ch/sync-now", f"company_id={CID}"),
            call_next,
        )
        assert sync.status_code == 200
        other = await guard.dispatch(_request("DELETE", "/api/products", "company_id=co_other"), call_next)
        assert other.status_code == 200
        assert called["n"] == 5
        response = await server._maintenance_write_locked(
            _request("POST", "/api/products"),
            storage_router.StorageWriteLocked(storage_router.WRITE_LOCK_MESSAGE, company_id=CID),
        )
        assert response.status_code == 423
        assert json.loads(response.body)["detail"] == BANNER

    try:
        asyncio.run(run())
    finally:
        server.db = previous_db
