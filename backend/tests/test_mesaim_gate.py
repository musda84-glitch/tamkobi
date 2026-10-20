"""Mesai çıkışı kilidi. Bellek içi DB; canlı veritabanı ve 8021 yok."""
from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "tests"))

import pytest  # noqa: E402

import attendance  # noqa: E402
import mesaim_gate  # noqa: E402
import rbac  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from rbac import normalize_role_code  # noqa: E402

DETAIL = mesaim_gate.MESAIM_LOCKED_DETAIL


def _staff(**extra):
    user = {
        "role": "personel",
        "employee_id": "e1",
        "active_company_id": "c1",
        "company_ids": ["c1"],
    }
    user.update(extra)
    return user


def test_owner_normalizes_to_admin_and_is_not_locked():
    assert normalize_role_code("owner") == "admin"
    assert mesaim_gate.mesaim_locked(_staff(role="owner"), {}, {"check_in": "08:00", "check_out": "17:00"}) is False


def test_mesaim_locked_table():
    closed = {"check_in": "08:00", "check_out": "17:00"}
    open_day = {"check_in": "08:00", "check_out": ""}
    assert mesaim_gate.mesaim_locked(_staff(), {}, closed) is True
    assert mesaim_gate.mesaim_locked(_staff(), {}, open_day) is False
    assert mesaim_gate.mesaim_locked(_staff(), {}, None) is True
    assert mesaim_gate.mesaim_locked(_staff(role="admin"), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(role="manager"), {}, None) is False
    assert mesaim_gate.mesaim_locked(_staff(role="owner"), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(skip_check_in=True), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(), {"skip_check_in": True}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(employee_id=""), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(employee_id=None), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(is_super_admin=True), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(impersonation={"by": "destek"}), {}, closed) is False
    assert mesaim_gate.mesaim_locked(_staff(_token_payload={"imp_by": "destek"}), {}, closed) is False


def test_is_mesaim_gated_path():
    assert mesaim_gate.is_mesaim_gated_path("/api/production/work-orders/wo-1", "GET") is True
    assert mesaim_gate.is_mesaim_gated_path("/api/production/work-orders/wo-1/start", "POST") is True
    assert mesaim_gate.is_mesaim_gated_path("/api/personnel/attendance/me", "GET") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/auth/me", "GET") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/notifications", "GET") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/notifications/n1/read", "POST") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/invoices", "GET") is True
    assert mesaim_gate.is_mesaim_gated_path("/api/invoices/inv-1", "POST") is True
    # Özet ekranı kilitliyken bu iki ucu çağırır; /api/dashboard aksi halde "/" modülünde kilitlenir.
    assert mesaim_gate.is_mesaim_gated_path("/api/dashboard/overview", "GET") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/dashboard/tile-badges", "GET") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/personnel/attendance/att-1/confirm", "POST") is False
    assert mesaim_gate.is_mesaim_gated_path("/api/companies", "GET") is False


def _today():
    return attendance._today(attendance.merge_schedule({}, None))


def _db_with(record):
    db = MemDB()
    db.companies.docs.append({"_id": "c1"})
    db.employees.docs.append({"_id": "e1", "company_id": "c1", "full_name": "Ali"})
    if record is not None:
        db.attendance.docs.append({"_id": "a1", "company_id": "c1", "employee_id": "e1", "date": _today(), **record})
    return db


def _count_finds(db):
    db.finds = []
    for name in ("employees", "companies", "attendance"):
        coll = getattr(db, name)
        orig = coll.find_one

        async def wrapped(query=None, projection=None, sort=None, _orig=orig, _name=name):
            db.finds.append(_name)
            return await _orig(query, projection, sort)

        coll.find_one = wrapped
    return db


@pytest.fixture
def restore_gate_db():
    previous = mesaim_gate._db
    yield
    mesaim_gate._db = previous


def _client(db, users, monkeypatch):
    mesaim_gate.init(db)
    monkeypatch.setattr(rbac, "_db", db)

    async def fake_user(token, _database, request=None, path=None):
        return users.get(token)

    monkeypatch.setattr(mesaim_gate, "get_user_from_token", fake_user)
    app = FastAPI()
    app.add_middleware(mesaim_gate.MesaimGateMiddleware)

    @app.get("/api/production/work-orders")
    async def work_orders():
        return {"ok": True}

    @app.get("/api/personnel/attendance/me")
    async def attendance_me():
        return {"ok": True}

    @app.get("/api/invoices")
    async def invoices():
        return {"ok": True}

    return TestClient(app)


def test_middleware_locked_staff_gets_403(monkeypatch, restore_gate_db):
    db = _count_finds(_db_with({"check_in": "08:00", "check_out": "17:00"}))
    client = _client(db, {"staff": _staff()}, monkeypatch)
    res = client.get("/api/production/work-orders", headers={"Authorization": "Bearer staff"})
    assert res.status_code == 403
    body = res.json()
    assert body["code"] == "mesaim_locked"
    assert body["detail"] == DETAIL
    assert db.finds == ["employees", "companies", "attendance"]
    invoices = client.get("/api/invoices", headers={"Authorization": "Bearer staff"})
    assert invoices.status_code == 403
    assert invoices.json()["code"] == "mesaim_locked"


def test_middleware_open_session_and_admin_and_self_service(monkeypatch, restore_gate_db):
    db = _count_finds(_db_with({"check_in": "08:00", "check_out": ""}))
    users = {
        "staff": _staff(),
        "admin": _staff(role="admin"),
        "owner": _staff(role="owner"),
        "skip": _staff(skip_check_in=True),
    }
    client = _client(db, users, monkeypatch)
    open_res = client.get("/api/production/work-orders", headers={"Authorization": "Bearer staff"})
    assert open_res.status_code == 200
    assert open_res.json()["ok"] is True

    db.finds.clear()
    admin = client.get("/api/production/work-orders", headers={"Authorization": "Bearer admin"})
    assert admin.status_code == 200
    assert db.finds == []

    owner = client.get("/api/invoices", headers={"Authorization": "Bearer owner"})
    assert owner.status_code == 200
    assert db.finds == []

    skipped = client.get("/api/invoices", headers={"Authorization": "Bearer skip"})
    assert skipped.status_code == 200
    assert db.finds == []

    me = client.get("/api/personnel/attendance/me", headers={"Authorization": "Bearer staff"})
    assert me.status_code == 200
    assert db.finds == []


def test_middleware_missing_record_locks_and_employee_skip_does_not(monkeypatch, restore_gate_db):
    db = _count_finds(_db_with(None))
    db.employees.docs[0]["skip_check_in"] = False
    client = _client(db, {"staff": _staff()}, monkeypatch)
    missing = client.get("/api/production/work-orders", headers={"Authorization": "Bearer staff"})
    assert missing.status_code == 403
    assert missing.json()["code"] == "mesaim_locked"

    db.employees.docs[0]["skip_check_in"] = True
    db.finds.clear()
    skipped = client.get("/api/production/work-orders", headers={"Authorization": "Bearer staff"})
    assert skipped.status_code == 200
    assert db.finds == ["employees"]
