"""Şirketler arası arka plan işleri. Canlı veritabanına ve 8021 portuna bağlanmaz.

.env okunmaz. SQLite her zaman çalışır. MariaDB 11.8 strict, STORAGE_MARIADB_DSN
veya STORAGE_SHARED_V2_TEST_DSN yoksa atlanır. Bayrak açıkken her iş legacy,
shared_v2 ve dedicated şirketi bir kez ve kendi deposunda işler. Açılamayan
depo loglanır, diğerleri sürer. Bayrak kapalıyken iter üretmez.
"""
from __future__ import annotations

import asyncio
import logging
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from dashboard_memdb import MemDB  # noqa: E402
import attendance  # noqa: E402
import attendance_security  # noqa: E402
import company_audit  # noqa: E402
import edoc_backup  # noqa: E402
import employee_pay  # noqa: E402
import event_notify  # noqa: E402
import expenses  # noqa: E402
import idempotency  # noqa: E402
import partner_pay  # noqa: E402
import pricing  # noqa: E402
import saas  # noqa: E402
import saas_billing  # noqa: E402
import shopfloor_pause  # noqa: E402
import storage_dedicated  # noqa: E402
import storage_router  # noqa: E402
import storage_shared_v2  # noqa: E402
import tenant_scope  # noqa: E402
from storage_migrations.engine import apply  # noqa: E402
from storage_migrations.loader import load_migrations  # noqa: E402
from storage_migrations.masking import add_secret  # noqa: E402
from storage_migrations.session import assert_not_live, connect  # noqa: E402

CO_LEGACY = "co_legacy"
CO_SHARED = "co_shared"
CO_DED = "co_ded"
CO_BAD = "co_bad"
GOOD = (CO_LEGACY, CO_SHARED, CO_DED)
_TODAY = datetime.now(timezone.utc).date()
AS_OF = _TODAY.isoformat()
PAY_START = _TODAY.replace(day=1).isoformat()
SECRET = "job-store-secret-word"
VKN = "1234567890"
ETTN = "11111111-2222-4333-8444-555555555555"
STRICT = "STRICT_TRANS_TABLES,ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION"


def _raw_mariadb() -> str:
    return (
        os.environ.get("STORAGE_MARIADB_DSN")
        or os.environ.get("STORAGE_SHARED_V2_TEST_DSN")
        or ""
    ).strip()


def _guard_dsn(dsn: str) -> str:
    text = str(dsn or "")
    if ":8021" in text or "8021/" in text:
        raise AssertionError("8021 hedefi reddedildi")
    assert_not_live(text)
    return text


def _migrate(dsn: str) -> None:
    _guard_dsn(dsn)
    session = connect(dsn, write=True)
    try:
        if session.dialect == "mysql":
            session.execute(f"SET SESSION sql_mode = '{STRICT}'")
        apply(session, load_migrations(), confirm=True, dry_run=False)
    finally:
        session.close()


def _mariadb_pair() -> tuple[str, str]:
    from mariadb_fixture import isolated_dsn
    from urllib.parse import unquote, urlparse
    import pymysql

    shared = _guard_dsn(isolated_dsn(_raw_mariadb()))
    parsed = urlparse(shared.replace("mariadb://", "mysql://", 1).replace("mysql+pymysql://", "mysql://", 1))
    base = (parsed.path or "/").lstrip("/").split("?")[0]
    ded_name = f"{base}_d"
    admin = pymysql.connect(
        host=parsed.hostname or "127.0.0.1",
        port=parsed.port or 3306,
        user=unquote(parsed.username or ""),
        password=unquote(parsed.password or ""),
        charset="utf8mb4",
        autocommit=True,
        connect_timeout=5,
    )
    try:
        with admin.cursor() as cur:
            cur.execute(
                f"CREATE DATABASE IF NOT EXISTS `{ded_name}` "
                "CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci"
            )
            cur.execute(f"SET SESSION sql_mode = '{STRICT}'")
    finally:
        admin.close()
    dedicated = shared.replace(f"/{base}", f"/{ded_name}", 1)
    return _guard_dsn(shared), _guard_dsn(dedicated)


def _strict_live(engine: str) -> None:
    if engine != "mariadb":
        return
    shared = storage_shared_v2.get_store()
    if shared.conn is not None and shared.dialect == "mysql":
        cur = shared.conn.cursor()
        cur.execute(f"SET SESSION sql_mode = '{STRICT}'")
        cur.close()
    pool = storage_dedicated._pools.get(CO_DED)
    if pool is not None and pool.session is not None and pool.session.dialect == "mysql":
        pool.session.execute(f"SET SESSION sql_mode = '{STRICT}'")


class World:
    def __init__(self, engine: str, monkeypatch, tmp_path: Path):
        self.engine = engine
        self.catalog = MemDB()
        self.monkeypatch = monkeypatch
        key = Fernet.generate_key().decode()
        monkeypatch.setenv("CREDENTIAL_ENCRYPTION_KEY", key)
        monkeypatch.setenv("DATA_DIR", str(tmp_path))
        monkeypatch.setenv("TAMKOBI_DATA_DIR", str(tmp_path / "nodata"))
        monkeypatch.setenv("STORAGE_ROUTER_ENABLED", "1")
        monkeypatch.setenv("JWT_SECRET", "test-job-store-jwt")
        import comm_service

        self._comm = comm_service
        comm_service.reset_fernet_for_tests()
        if engine == "sqlite":
            shared_path = tmp_path / "shared.db"
            ded_path = tmp_path / "ded.db"
            self.shared_dsn = f"sqlite:///{shared_path}"
            self.ded_dsn = f"sqlite:///{ded_path}"
        else:
            self.shared_dsn, self.ded_dsn = _mariadb_pair()
        _migrate(self.shared_dsn)
        _migrate(self.ded_dsn)
        monkeypatch.setenv("STORAGE_SHARED_V2_DSN", self.shared_dsn)
        storage_router.reset()
        storage_shared_v2.reset_store()
        storage_dedicated.reset_pools()
        tenant_scope._MODE = "off"

    def close(self) -> None:
        storage_router.reset()
        storage_shared_v2.reset_store()
        storage_dedicated.reset_pools()
        self._comm.reset_fernet_for_tests()

    async def boot(self) -> None:
        await self.catalog.companies.insert_one({"_id": CO_LEGACY, "name": "Legacy", "work_schedule": _schedule()})
        await self.catalog.companies.insert_one({
            "_id": CO_SHARED, "name": "Shared", "storage_mode": "shared_v2", "work_schedule": _schedule(),
        })
        await self.catalog.companies.insert_one({
            "_id": CO_DED,
            "name": "Dedicated",
            "storage_mode": "dedicated",
            "dedicated_dsn_ref": storage_router.seal_dedicated_dsn(self.ded_dsn),
            "work_schedule": _schedule(),
        })
        await self.catalog.companies.insert_one({
            "_id": CO_BAD, "name": "Bad", "storage_mode": "dedicated", "work_schedule": _schedule(),
        })
        await storage_router.open_company_store(self.catalog, CO_SHARED)
        await storage_router.open_company_store(self.catalog, CO_DED)
        _strict_live(self.engine)
        self._bind_modules()

    def _bind_modules(self) -> None:
        db = self.catalog
        attendance._db = db
        pricing._db = db
        event_notify._db = db
        edoc_backup._db = db
        edoc_backup._deps = {}
        saas_billing._db = db
        saas._db = db
        expenses._db = db
        import e_invoice

        e_invoice._db = db

    async def put(self, cid: str, collection: str, doc: dict) -> None:
        store = await storage_router.open_company_store(self.catalog, cid)
        body = dict(doc)
        body["company_id"] = cid
        await store[collection].insert_one(body)

    async def find(self, cid: str, collection: str, query=None) -> list:
        store = await storage_router.open_company_store(self.catalog, cid)
        q = dict(query or {})
        q["company_id"] = cid
        cursor = store[collection].find(q)
        if hasattr(cursor, "to_list"):
            return list(await cursor.to_list(100))
        return list(cursor)


def _schedule() -> dict:
    return {
        "start": "09:00",
        "end": "18:00",
        "work_days": [0, 1, 2, 3, 4, 5, 6],
        "timezone": "Europe/Istanbul",
        "late_tolerance_minutes": 10,
        "exit_tolerance_minutes": 0,
        "notify_missing_checkin": True,
        "notify_checkin_reminder": True,
    }


@pytest.fixture(params=["sqlite", "mariadb"])
def engine(request):
    if request.param == "mariadb" and not _raw_mariadb():
        pytest.skip("STORAGE_MARIADB_DSN / STORAGE_SHARED_V2_TEST_DSN yok")
    return request.param


@pytest.fixture
def world(engine, monkeypatch, tmp_path):
    item = World(engine, monkeypatch, tmp_path)
    asyncio.run(item.boot())
    yield item
    item.close()


def test_log_store_failure_hides_secret_vkn_ettn(caplog):
    add_secret(SECRET)
    exc = RuntimeError(f"mysql://user:{SECRET}@db.internal/app vkn {VKN} ettn {ETTN} gAAAA-sealed")
    with caplog.at_level(logging.WARNING, logger="storage_router"):
        storage_router.log_store_failure(CO_BAD, exc)
    text = caplog.text
    assert CO_BAD in text
    assert SECRET not in text
    assert VKN not in text
    assert ETTN not in text
    assert "gAAAA" not in text
    assert "db.internal" not in text


def test_flag_off_iter_yields_nothing_and_partner_stays_on_catalog(monkeypatch):
    monkeypatch.delenv("STORAGE_ROUTER_ENABLED", raising=False)
    storage_router.reset()

    async def boom(*_a, **_k):
        raise AssertionError("bayrak kapalıyken depo açılmamalı")

    monkeypatch.setattr(storage_router, "open_company_store", boom)
    db = MemDB()

    async def run():
        found = []
        async for item in storage_router.iter_company_stores(db):
            found.append(item)
        assert found == []
        await db.companies.insert_one({"_id": CO_LEGACY, "name": "L", "storage_mode": "dedicated"})
        await db.partners.insert_one({
            "_id": "p1", "company_id": CO_LEGACY, "name": "Ortak",
            "monthly_salary": 1000, "salary_start_date": PAY_START, "salary_recurring": True,
        })
        out = await partner_pay.accrue_due_for_all_companies(db, as_of=AS_OF)
        assert out["companies"] == 1
        assert out["posted_count"] == 1
        row = await db.partner_transactions.find_one({"company_id": CO_LEGACY, "type": "salary"})
        assert row is not None

    asyncio.run(run())


def test_iter_skips_bad_store_and_visits_each_company_once(world, caplog):
    async def run():
        seen = []
        with caplog.at_level(logging.WARNING, logger="storage_router"):
            async for cid, store in storage_router.iter_company_stores(world.catalog):
                seen.append((cid, store.mode))
                await store.products.insert_one({"_id": f"probe-{cid}", "company_id": cid, "name": cid})
        return seen

    seen = asyncio.run(run())
    assert seen == [(CO_LEGACY, "legacy"), (CO_SHARED, "shared_v2"), (CO_DED, "dedicated")]
    text = caplog.text
    assert SECRET not in text
    assert VKN not in text
    assert ETTN not in text
    assert "gAAAA" not in text
    assert "://" not in text

    async def check():
        for cid in GOOD:
            rows = await world.find(cid, "products", {"name": cid})
            assert len(rows) == 1
            for other in GOOD:
                if other == cid:
                    continue
                leaked = await world.find(other, "products", {"name": cid})
                assert leaked == []

    asyncio.run(check())


def test_each_job_hits_every_company_store_once(world, monkeypatch):
    asyncio.run(_each_job(world, monkeypatch))


async def _each_job(world: World, monkeypatch) -> None:
    db = world.catalog
    for cid in GOOD:
        await world.put(cid, "partners", {
            "_id": f"pt-{cid}", "name": f"Ortak {cid}", "monthly_salary": 1500,
            "salary_start_date": PAY_START, "salary_recurring": True, "is_active": True,
        })
        await world.put(cid, "employees", {
            "_id": f"emp-{cid}", "full_name": f"P {cid}", "status": "active",
            "pay_start_date": PAY_START, "pay_recurring": True, "meal_allowance": 400,
        })
        await world.put(cid, "morning_summary_settings", {
            "_id": f"ms-{cid}", "enabled": True, "time": "00:00", "emails": [], "whatsapp_numbers": [],
        })
        await world.put(cid, "notify_outbox", {
            "_id": f"ob-{cid}", "event": "receivable_overdue", "digest": "",
            "status": "pending", "due_at": "2000-01-01T00:00:00+00:00",
            "subject": "ozet", "text": "ozet",
        })
        await world.put(cid, "invoices", {
            "_id": f"inv-due-{cid}", "invoice_type": "sales", "payment_status": "unpaid",
            "status": "issued", "due_date": "2020-01-01", "grand_total": 10, "paid_amount": 0,
            "invoice_number": f"F-{cid}",
        })
        await world.put(cid, "invoices", {
            "_id": f"inv-q-{cid}", "einvoice_state": "queued",
            "queued_at": "2020-01-01T00:00:00+00:00", "issued_at": "2020-01-01T00:00:00+00:00",
        })
        await world.put(cid, "invoices", {
            "_id": f"inv-edoc-{cid}", "invoice_type": "sales", "e_type": "e_archive",
            "issue_date": "2026-10-01",
        })
        await world.put(cid, "idempotency_keys", {
            "_id": f"old-{cid}", "created_at": "2020-01-01T00:00:00+00:00", "key": "old",
        })
        await world.put(cid, "idempotency_keys", {
            "_id": f"new-{cid}",
            "created_at": datetime.now(timezone.utc).isoformat(),
            "key": "new",
        })
        await world.put(cid, "company_audit_log", {
            "_id": f"aud-{cid}", "at": "2020-01-01T00:00:00+00:00", "action": "old",
        })
        await world.put(cid, "users", {
            "_id": f"usr-{cid}", "email": f"{cid}@example.test", "role": "admin",
            "company_ids": [cid], "is_super_admin": False,
        })
        await world.put(cid, "integration_configs", {
            "_id": f"ch-{cid}", "is_active": True, "channel": "trendyol", "auto_sync_orders": True,
        })
        await world.put(cid, "bank_connections", {
            "_id": f"bank-{cid}", "auto_sync": True,
        })
        await world.put(cid, "einvoice_settings", {
            "_id": f"ein-{cid}", "provider": "n11faturam", "status": "configured", "auto_pull": True,
        })
        await world.put(cid, "expenses", {
            "_id": f"rex-{cid}", "is_recurring": True, "next_date": PAY_START,
            "description": "kira", "total": 5, "amount": 5, "category": "Kira",
        })

    partner = await partner_pay.accrue_due_for_all_companies(db, as_of=AS_OF)
    assert partner["companies"] == 3
    assert partner["posted_count"] == 3
    employee = await employee_pay.accrue_due_for_all_companies(db, as_of=AS_OF)
    assert employee["companies"] == 3
    assert employee["posted_count"] == 3

    pricing._db = db
    await pricing._morning_routed()

    async def _deliver(_cid, _ev, _rows, _claim):
        return 1

    monkeypatch.setattr(event_notify, "_deliver_generic", _deliver)
    flushed = await event_notify.flush_notify_outbox(force=True)
    assert flushed["flushed"] == 3

    calls = []

    async def _notify(cid, event, *_a, **_k):
        store = storage_router.current_store()
        calls.append((cid, event, None if store is None else store.company_id))
        return {"status": "ok"}

    monkeypatch.setattr(event_notify, "notify_event", _notify)
    overdue = await event_notify.run_receivable_overdue()
    assert overdue["sent"] == 3
    assert sorted(item[0] for item in calls) == sorted(GOOD)
    assert all(item[0] == item[2] for item in calls)

    missing = await attendance.run_missing_checkin_check(force=True)
    assert sorted(item["company_id"] for item in missing) == sorted(GOOD)

    sent = []

    async def _send(emp, kind, *_a, **_k):
        sent.append((emp["company_id"], kind))

    moment = datetime(2026, 10, 22, 6, 10, tzinfo=timezone.utc)
    reminded = await attendance_security.run_reminders(
        db, attendance.merge_schedule, _send, now_utc=moment, window=1,
    )
    assert sorted(item["employee_id"] for item in reminded) == sorted(f"emp-{cid}" for cid in GOOD)
    again = await attendance_security.run_reminders(
        db, attendance.merge_schedule, _send, now_utc=moment, window=1,
    )
    assert again == []

    monkeypatch.setattr(shopfloor_pause, "should_auto_pause_now", lambda **_k: True)
    for cid in GOOD:
        await world.put(cid, "work_orders", {
            "_id": f"wo-{cid}", "status": "in_progress", "operator_employee_id": f"emp-{cid}",
            "operator_name": f"P {cid}",
        })
    paused = await shopfloor_pause.run_auto_pause_work_orders()
    assert sorted(item["company_id"] for item in paused) == sorted(GOOD)

    edoc = await edoc_backup.run_reminders()
    assert edoc["count"] == 3

    async def _effective(cid):
        return {
            "status": "trial",
            "days_left": 7,
            "plan_name": "Deneme",
            "plan_id": "plan-test",
            "trial_ends_at": "2026-10-29T00:00:00+00:00",
            "expires_at": "",
        }

    monkeypatch.setattr(saas, "effective", _effective)
    await db.platform_settings.insert_one({
        "_id": "platform", "email_enabled": False, "whatsapp_enabled": False,
        "reminder_days": [7, 1], "brand_name": "TamKobi",
    })
    lic = await saas_billing.run_reminders()
    assert lic["count"] == 3

    import e_invoice

    e_invoice._db = db
    outbound = await e_invoice.refresh_outbound_statuses(limit=50)
    assert outbound["updated"] == 3

    import sys

    if "server" not in sys.modules:
        import dotenv

        dotenv.load_dotenv = lambda *_a, **_k: False
    import marketplace_providers

    seen_mp = []
    seen_bank = []
    seen_ein = []

    async def _mp(channel_id, days=3, user=None):
        seen_mp.append(channel_id)
        return {"ok": True}

    async def _bank(conn_id, company_id=""):
        seen_bank.append((conn_id, company_id))
        return {"ok": True}

    async def _pull(cid, days=14, settings=None):
        seen_ein.append(cid)
        return {"ok": True}

    monkeypatch.setattr(marketplace_providers, "has_live_credentials", lambda _cfg: True)
    monkeypatch.setattr("bank_auto_sync.should_background_sync", lambda _c: True)
    import server

    server.db = db
    monkeypatch.setattr(server, "_sync_ecommerce_channel_core", _mp)
    monkeypatch.setattr(server, "_sync_bank_connection_core", _bank)
    monkeypatch.setattr(server, "pull_einvoice_incoming", _pull)
    sleeps = {"n": 0}

    async def _sleep(_seconds):
        sleeps["n"] += 1
        if sleeps["n"] >= 2:
            raise asyncio.CancelledError()

    monkeypatch.setattr(asyncio, "sleep", _sleep)
    with pytest.raises(asyncio.CancelledError):
        await server._marketplace_auto_sync_loop(interval_s=0)
    await server._run_bank_auto_sync_tick()
    await server._run_einvoice_inbox_auto_tick()
    assert sorted(seen_mp) == sorted(f"ch-{cid}" for cid in GOOD)
    assert sorted(item[0] for item in seen_bank) == sorted(f"bank-{cid}" for cid in GOOD)
    assert sorted(item[1] for item in seen_bank) == sorted(GOOD)
    assert sorted(seen_ein) == sorted(GOOD)

    purged_keys = await idempotency.purge_expired(db)
    assert purged_keys == 3
    purged_audit = await company_audit.purge_expired(db)
    assert purged_audit == 3

    async def _number(_cid):
        return "MSR-2026-0001"

    monkeypatch.setattr(expenses, "_next_number", _number)
    sleeps["n"] = 0
    with pytest.raises(asyncio.CancelledError):
        await employee_pay.scheduler_loop(db)

    for cid in GOOD:
        salaries = await world.find(cid, "partner_transactions", {"type": "salary"})
        assert len(salaries) == 1
        meals = await world.find(cid, "expenses", {"source": "employee_allowance"})
        assert len(meals) == 1
        logs = await world.find(cid, "morning_summary_logs")
        assert len(logs) == 1
        outbox = await world.find(cid, "notify_outbox", {"_id": f"ob-{cid}"})
        assert outbox and outbox[0].get("status") == "sending"
        alerts = await world.find(cid, "attendance_alerts")
        assert len(alerts) >= 1
        paused_rows = await world.find(cid, "work_orders", {"status": "paused"})
        assert len(paused_rows) == 1
        reminders = await world.find(cid, "edoc_backup_reminders")
        assert len(reminders) == 1
        notes = await world.find(cid, "notifications", {"type": "edoc_backup"})
        assert len(notes) == 1
        license_notes = await world.find(cid, "notifications", {"type": "license"})
        assert len(license_notes) == 1
        queued = await world.find(cid, "invoices", {"_id": f"inv-q-{cid}"})
        assert queued[0]["einvoice_state"] == "error"
        assert await world.find(cid, "idempotency_keys", {"_id": f"old-{cid}"}) == []
        assert len(await world.find(cid, "idempotency_keys", {"_id": f"new-{cid}"})) == 1
        assert await world.find(cid, "company_audit_log", {"_id": f"aud-{cid}"}) == []
        recurring = await world.find(cid, "expenses", {"recurring_parent_id": f"rex-{cid}"})
        assert len(recurring) == 1
        for other in GOOD:
            if other == cid:
                continue
            assert await world.find(other, "partner_transactions", {"partner_id": f"pt-{cid}"}) == []
            assert await world.find(other, "invoices", {"_id": f"inv-q-{cid}"}) == []

    license_rows = await db.license_reminders.find({}).to_list(20)
    assert len(license_rows) == 3
    assert CO_BAD not in {row.get("company_id") for row in license_rows}
