"""Atölye iş ekranı: boşta kilit, kuyruk, ara sayım, devralma, geri alma, çizim.

Bellek içi veritabanı. Canlı veritabanına ve 8021 portuna bağlanmaz.
PIN ve operatör token'ı loglanmaz.
"""
from __future__ import annotations

import asyncio
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
_TESTS = Path(__file__).resolve().parent
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))
sys.path.insert(0, str(_TESTS))

import server  # noqa: E402
import shopfloor_devices  # noqa: E402
import shopfloor_drawing  # noqa: E402
import shopfloor_idle  # noqa: E402
import shopfloor_partial  # noqa: E402
import shopfloor_pin  # noqa: E402
import shopfloor_queue  # noqa: E402
import shopfloor_scrap  # noqa: E402
import shopfloor_undo  # noqa: E402
import signed_links  # noqa: E402
from test_shopfloor_pin import MemDB, _emp, _log_clean, _user  # noqa: E402

CID = "c1"
OTHER = "c2"
SECRET = "test-shopfloor-screen-secret-value"
BASE = datetime(2026, 10, 21, 12, 0, tzinfo=timezone.utc)
PIN = "7391"
WIDE = {
    "start": "00:00",
    "end": "23:59",
    "break_minutes": 0,
    "work_days": [0, 1, 2, 3, 4, 5, 6],
    "exit_tolerance_minutes": 0,
    "timezone": "Europe/Istanbul",
}


class _Req:
    def __init__(self, key="", token=""):
        self.headers = {}
        if key:
            self.headers["Idempotency-Key"] = key
        if token:
            self.headers["x-shopfloor-operator"] = token


@pytest.fixture
def mem(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)
    db = MemDB()
    prev = server.db
    server.db = db
    yield db
    server.db = prev


def _clock(monkeypatch, moment):
    holder = {"now": moment}

    def _now():
        return holder["now"]

    monkeypatch.setattr(shopfloor_idle, "utcnow", _now)
    monkeypatch.setattr(shopfloor_pin, "utcnow", _now)
    monkeypatch.setattr(shopfloor_undo, "utcnow", _now)
    return holder


def _token(moment, *, oid="e1", name="Ali", aid="dev1", iat_at=None):
    return shopfloor_pin.issue_operator_token(
        company_id=CID,
        atolye_user_id=aid,
        operator_id=oid,
        operator_type="employee",
        operator_name=name,
        pin_ver=1,
        exp=moment + timedelta(hours=4),
        now=iat_at or moment,
    )


def _seed_emp(db, eid="e1", name="Ali"):
    db.employees.docs.append(_emp(eid, CID, name, pin_hash="pin-hash-not-plain", pin_ver=1))


def _device(stations):
    return _user("dev1", CID, name="Kiosk", role="atolye_device", account_type="atolye_device", stations=stations)


def _wo(**extra):
    row = {
        "_id": "wo1",
        "company_id": CID,
        "order_id": "po1",
        "order_code": "URT-1",
        "product_name": "Dolap",
        "step_name": "Kesim",
        "step_no": 1,
        "station": "CNC",
        "status": "in_progress",
        "planned_quantity": 10,
        "unit": "Adet",
        "operator_name": "Ali",
        "operator_employee_id": "e1",
        "logs": [],
    }
    row.update(extra)
    return row


def _order(**extra):
    row = {
        "_id": "po1",
        "company_id": CID,
        "status": "in_production",
        "planned_quantity": 2,
        "completed_quantity": 0,
        "order_code": "URT-1",
        "finished_product_id": "p1",
        "finished_product_name": "Dolap",
        "priority": 5,
    }
    row.update(extra)
    return row


def test_idle_default_extends_and_locks_without_sliding(mem, monkeypatch):
    _seed_emp(mem)
    clock = _clock(monkeypatch, BASE)
    user = _device(["CNC"])
    issued = _token(BASE)
    wo = {"company_id": CID}

    async def _resolve():
        return await shopfloor_pin.resolve_operator(
            {"operator_token": issued, "pin": PIN}, user, wo,
        )

    who = asyncio.run(_resolve())
    assert str(who) == "Ali"
    sid_rows = mem.shopfloor_operator_sessions.docs
    assert len(sid_rows) == 1
    assert sid_rows[0]["company_id"] == CID
    first = sid_rows[0]["last_activity"]
    assert PIN not in first

    clock["now"] = BASE + timedelta(minutes=20)
    asyncio.run(_resolve())
    assert mem.shopfloor_operator_sessions.docs[0]["last_activity"] != first

    clock["now"] = BASE + timedelta(minutes=51)
    stale = mem.shopfloor_operator_sessions.docs[0]["last_activity"]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(_resolve())
    assert exc.value.status_code == 401
    assert exc.value.detail["code"] == "shopfloor_idle_locked"
    assert mem.shopfloor_operator_sessions.docs[0]["last_activity"] == stale


def test_idle_company_setting_and_absolute_cap(mem, monkeypatch, caplog):
    caplog.set_level(logging.DEBUG)
    _seed_emp(mem)
    mem.companies.docs.append({"_id": CID, "shopfloor_idle_lock_minutes": 60})
    clock = _clock(monkeypatch, BASE)
    user = _device(["CNC"])
    issued = _token(BASE)
    asyncio.run(shopfloor_pin.resolve_operator({"operator_token": issued}, user, {"company_id": CID}))
    clock["now"] = BASE + timedelta(minutes=45)
    asyncio.run(shopfloor_pin.resolve_operator({"operator_token": issued, "pin": PIN}, user, {"company_id": CID}))
    assert mem.shopfloor_operator_sessions.docs[0]["last_activity"]

    old = BASE - timedelta(hours=13)
    clock["now"] = BASE
    absolute = _token(BASE, iat_at=old)
    mem.shopfloor_operator_sessions.docs.clear()
    sid = shopfloor_idle.session_id(CID, "dev1", "e1", old)
    mem.shopfloor_operator_sessions.docs.append({
        "_id": sid,
        "company_id": CID,
        "last_activity": (BASE - timedelta(minutes=1)).isoformat(),
    })
    before = mem.shopfloor_operator_sessions.docs[0]["last_activity"]
    with pytest.raises(HTTPException) as exc:
        asyncio.run(shopfloor_pin.resolve_operator(
            {"operator_token": absolute, "pin": PIN}, user, {"company_id": CID},
        ))
    assert exc.value.status_code == 401
    assert exc.value.detail == shopfloor_pin.TOKEN_DETAIL
    assert mem.shopfloor_operator_sessions.docs[0]["last_activity"] == before
    _log_clean(caplog, PIN, absolute)


def test_queue_station_modes_sort_and_tenant(mem, monkeypatch):
    monkeypatch.setenv("JWT_SECRET", SECRET)
    _seed_emp(mem)
    token = _token(datetime.now(timezone.utc))
    request = _Req(token=token)
    mem.companies.docs.append({
        "_id": CID,
        "work_parks": [{"id": "cnc", "name": "CNC"}, {"id": "montaj", "name": "Montaj"}],
    })
    mem.companies.docs.append({"_id": OTHER, "work_parks": [{"id": "gizli", "name": "Gizli"}]})
    orders = [
        _order(_id="po-a", order_code="URT-A", planned_date="2026-10-22", priority=2),
        _order(_id="po-b", order_code="URT-B", planned_date="2026-10-20", priority=1),
        _order(_id="po-c", order_code="URT-C", status="cancelled", planned_date="2026-10-01"),
        _order(_id="po-b2", company_id=OTHER, order_code="URT-SECRET", finished_product_name="GizliUrun"),
    ]
    for row in orders:
        mem.production_orders.docs.append(row)
    rows = [
        _wo(_id="mine", order_id="po-a", order_code="URT-A", planned_date="2026-12-01", status="paused", station="CNC", operator_name="Ali", operator_employee_id="e1", step_no=2),
        _wo(_id="ready-late", order_id="po-a", order_code="URT-A", planned_date="2026-10-22", status="ready", station="CNC", operator_name="", operator_employee_id="", step_no=1, priority=2),
        _wo(_id="ready-soon", order_id="po-b", order_code="URT-B", planned_date="2026-10-20", status="ready", station="CNC", operator_name="", operator_employee_id="", step_no=1, priority=1),
        _wo(_id="wait", order_id="po-b", order_code="URT-B", planned_date="2026-10-20", status="waiting", station="CNC", step_no=3, operator_name="", operator_employee_id=""),
        _wo(_id="other-op", order_id="po-b", order_code="URT-B", status="in_progress", station="CNC", operator_name="Veli", operator_employee_id="e9"),
        _wo(_id="montaj", order_id="po-a", order_code="URT-A", status="ready", station="Montaj", operator_name="", operator_employee_id=""),
        _wo(_id="cancelled", order_id="po-c", order_code="URT-C", status="ready", station="CNC"),
        _wo(_id="missing", order_id="po-missing", status="ready", station="CNC", order_code="YOK"),
        _wo(_id="foreign", company_id=OTHER, order_id="po-b2", order_code="URT-SECRET", product_name="GizliUrun", station="CNC", status="ready"),
        _wo(_id="draw", order_id="po-b", order_code="URT-B", status="ready", station="CNC", step_no=4, drawing_file_id="file-1", operator_name="", operator_employee_id=""),
    ]
    mem.work_orders.docs.extend(rows)

    async def _run(mode, stations):
        device = {
            "_id": "dev1",
            "company_id": CID,
            "station_mode": mode,
            "stations": stations,
            "status": "active",
        }
        names = await shopfloor_devices._stations_for(mem, device)
        user = shopfloor_devices._principal(device, names)
        return await shopfloor_queue.list_next(user, request, "Montaj")

    one = asyncio.run(_run("one", ["CNC"]))
    ids = [row["id"] for row in one]
    assert ids[0] == "mine"
    assert "montaj" not in ids
    assert "other-op" not in ids
    assert "cancelled" not in ids
    assert "missing" not in ids
    assert "foreign" not in ids
    assert "URT-SECRET" not in str(one)
    assert "GizliUrun" not in str(one)
    assert ids.index("ready-soon") < ids.index("ready-late")
    waiting = next(row for row in one if row["id"] == "wait")
    assert waiting["previous_step_pending"] is True
    assert waiting["product_name"] == "Dolap"
    drawn = next(row for row in one if row["id"] == "draw")
    assert drawn["has_drawing"] is True
    assert one[0]["status"] == "paused"

    many = asyncio.run(_run("many", ["CNC", "Montaj"]))
    assert "montaj" in [row["id"] for row in many]
    assert "foreign" not in [row["id"] for row in many]

    all_rows = asyncio.run(_run("all", []))
    assert "montaj" in [row["id"] for row in all_rows]

    admin = _user("admin1", CID, name="Yonetici", role="admin")
    filtered = asyncio.run(shopfloor_queue.list_next(admin, None, "Montaj"))
    assert [row["id"] for row in filtered] == ["montaj"]


def test_partial_accumulates_rejects_and_replays(mem, caplog):
    caplog.set_level(logging.DEBUG)
    _seed_emp(mem)
    mem.work_orders.docs.append(_wo())
    user = _device(["CNC"])
    token = _token(BASE)
    req = _Req("same-key", token)

    async def _apply(body, request=None, wo_id="wo1"):
        return await shopfloor_partial.apply(wo_id, body, user, request)

    first = asyncio.run(_apply({"qty": 2, "pin": PIN}, req))
    second = asyncio.run(_apply({"qty": 3, "pin": PIN}, _Req("", token)))
    assert first["partial_qty_total"] == 2
    assert second["partial_qty_total"] == 5
    assert second["entry"]["employee_id"] == "e1"
    assert second["entry"]["device_id"] == "dev1"
    replay = asyncio.run(_apply({"qty": 4, "pin": PIN}, req))
    assert replay["replay"] is True
    assert replay["partial_qty_total"] == 5
    stored = mem.work_orders.docs[0]
    assert stored["partial_qty_total"] == 5
    assert len(stored["partial_counts"]) == 2
    assert any(log.get("action") == "partial_count" for log in stored["logs"])
    audits = mem.company_audit_log.docs
    assert audits and audits[0]["company_id"] == CID
    assert PIN not in str(audits)
    _log_clean(caplog, PIN, token)

    with pytest.raises(HTTPException) as neg:
        asyncio.run(_apply({"qty": -1}, _Req("", token)))
    assert neg.value.status_code == 400
    assert "negatif" in neg.value.detail
    with pytest.raises(HTTPException) as over:
        asyncio.run(_apply({"qty": 9}, _Req("", token)))
    assert over.value.status_code == 400
    assert "aşamaz" in over.value.detail
    assert mem.work_orders.docs[0]["partial_qty_total"] == 5

    mem.work_orders.docs.append(_wo(_id="wo-ready", status="ready"))
    with pytest.raises(HTTPException) as paused:
        asyncio.run(_apply({"qty": 1}, _Req("", token), "wo-ready"))
    assert paused.value.status_code == 400
    assert "devam eden" in paused.value.detail


def test_takeover_device_requires_confirm_web_flags(mem, monkeypatch):
    _clock(monkeypatch, BASE)
    _seed_emp(mem)
    _seed_emp(mem, "e2", "Veli")
    mem.production_orders.docs.append(_order(status="planned"))
    mem.work_orders.docs.append(_wo(
        status="ready",
        operator_name="Veli",
        operator_employee_id="e2",
    ))
    user = _device(["CNC"])
    token = _token(BASE, oid="e1", name="Ali")
    body = {"operator_token": token, "pin": PIN}

    with pytest.raises(HTTPException) as blocked:
        asyncio.run(server.start_work_order("wo1", body, user=user))
    assert blocked.value.status_code == 409
    assert blocked.value.detail["code"] == "takeover_confirm_required"
    assert blocked.value.detail["previous_operator"] == "Veli"
    assert mem.work_orders.docs[0]["status"] == "ready"

    opened = asyncio.run(server.start_work_order("wo1", {**body, "confirm_takeover": True}, user=user))
    assert opened["status"] == "success"
    assert opened["takeover"] is True
    logs = mem.work_orders.docs[0]["logs"]
    assert any(item.get("action") == "takeover" for item in logs)
    assert any("Devralma" in str(item.get("summary") or "") for item in mem.company_audit_log.docs)
    assert PIN not in str(mem.company_audit_log.docs)

    mem.work_orders.docs.clear()
    mem.work_orders.docs.append(_wo(status="ready", operator_name="Veli", operator_employee_id="e1"))
    same = asyncio.run(server.start_work_order("wo1", {"operator_token": _token(BASE, name="Baska")}, user=user))
    assert same.get("takeover") is not True

    mem.work_orders.docs.clear()
    mem.work_orders.docs.append(_wo(status="ready", operator_name="Eski", operator_employee_id=""))
    web = _user("admin1", CID, name="Yeni", role="admin")
    flagged = asyncio.run(server.start_work_order("wo1", {"operator_name": "Baskasi"}, user=web))
    assert flagged["status"] == "success"
    assert flagged["takeover"] is True
    assert flagged["previous_operator"] == "Eski"


def test_undo_restores_stock_and_is_idempotent(mem, monkeypatch):
    clock = _clock(monkeypatch, BASE)
    _seed_emp(mem)
    mem.products.docs.append({"_id": "p1", "company_id": CID, "name": "Dolap", "stock_quantity": 10, "purchase_price": 4})
    mem.production_orders.docs.append(_order())
    mem.work_orders.docs.append(_wo(
        status="in_progress",
        planned_quantity=2,
        materials=[{"product_id": "a", "needed": 0}, {"product_id": "b", "needed": 0}],
        material_product_id="none",
        operator_name="Ali",
        operator_employee_id="e1",
    ))
    user = _user("admin1", CID, name="Ali", role="admin", employee_id="e1")
    finished = asyncio.run(server.finish_work_order("wo1", {"produced_qty": 2, "scrap_qty": 0}, user=user))
    assert finished["status"] == "success"
    assert finished.get("order_completed") is True
    assert mem.products.docs[0]["stock_quantity"] == 12
    snap = mem.work_orders.docs[0]["finish_undo_snapshot"]
    assert snap["movements"]
    assert snap["order_touched"] is True

    undone = asyncio.run(shopfloor_undo.apply("wo1", {}, user))
    assert undone["work_order_status"] == "in_progress"
    assert mem.products.docs[0]["stock_quantity"] == 10
    assert mem.production_orders.docs[0]["status"] == "in_production"
    reverses = [row for row in mem.stock_movements.docs if row.get("reverses")]
    assert len(reverses) == 1
    again = asyncio.run(shopfloor_undo.apply("wo1", {}, user))
    assert again["undo_id"] == undone["undo_id"]
    assert len([row for row in mem.stock_movements.docs if row.get("reverses")]) == 1
    assert any(item.get("action") == "restore" for item in mem.company_audit_log.docs)

    mem.work_orders.docs.append(_wo(
        _id="wo-late",
        status="done",
        finished_at=(BASE - timedelta(hours=2)).isoformat(),
        operator_employee_id="e1",
        operator_name="Ali",
        finish_undo_snapshot={"wo_before": {"status": "in_progress"}, "movements": []},
    ))
    with pytest.raises(HTTPException) as late:
        asyncio.run(shopfloor_undo.apply("wo-late", {}, user))
    assert late.value.status_code == 409
    assert late.value.detail["code"] == "undo_window_expired"

    mem.work_orders.docs.append(_wo(
        _id="wo-next",
        status="done",
        finished_at=BASE.isoformat(),
        operator_employee_id="e1",
        step_no=1,
        finish_undo_snapshot={
            "wo_before": {"status": "in_progress"},
            "movements": [{"_id": "m-next", "company_id": CID, "product_id": "p1", "change": 2}],
        },
    ))
    mem.work_orders.docs.append(_wo(_id="wo-next-2", status="in_progress", step_no=2, operator_employee_id="e9"))
    mem.stock_movements.docs.append({"_id": "m-next", "company_id": CID, "product_id": "p1", "change": 2})
    stock_before = mem.products.docs[0]["stock_quantity"]
    with pytest.raises(HTTPException) as nxt:
        asyncio.run(shopfloor_undo.apply("wo-next", {}, user))
    assert nxt.value.status_code == 409
    assert nxt.value.detail["code"] == "undo_next_step_started"
    assert mem.products.docs[0]["stock_quantity"] == stock_before

    clock["now"] = BASE
    mem.work_orders.docs.append(_wo(
        _id="wo-other",
        order_id="po-other",
        status="done",
        finished_at=BASE.isoformat(),
        operator_employee_id="e1",
        operator_name="Ali",
        finish_undo_snapshot={"wo_before": {"status": "in_progress"}, "movements": []},
    ))
    stranger = _device(["CNC"])
    token = _token(BASE, oid="e2", name="Veli", aid="dev1")
    _seed_emp(mem, "e2", "Veli")
    with pytest.raises(HTTPException) as denied:
        asyncio.run(shopfloor_undo.apply("wo-other", {"operator_token": token}, stranger))
    assert denied.value.status_code == 403
    assert "yönetici" in denied.value.detail

    admin = _user("boss", CID, name="Patron", role="admin")
    allowed = asyncio.run(shopfloor_undo.apply("wo-other", {}, admin))
    assert allowed["undo_id"]


def test_drawing_tenant_type_and_path(mem, monkeypatch):
    mem.work_orders.docs.append(_wo(drawing_file_id="f1"))
    mem.files.docs.append({
        "_id": "f1",
        "company_id": CID,
        "storage_path": "drawings/plan.pdf",
        "original_filename": "plan.pdf",
        "content_type": "application/pdf",
        "is_deleted": False,
    })
    admin = _user("admin1", CID, role="admin")
    _row, record = asyncio.run(shopfloor_drawing.load_for_user("wo1", admin))
    described = shopfloor_drawing.describe(record)
    assert "/api/files/drawings/plan.pdf?t=" in described["url"]
    assert described["content_type"] == "application/pdf"
    assert described["expires_in"] == 900

    with pytest.raises(HTTPException) as missing_wo:
        asyncio.run(shopfloor_drawing.load_for_user("wo1", _user("b", OTHER, role="admin")))
    assert missing_wo.value.status_code == 404

    mem.work_orders.docs.append(_wo(_id="wo-b", company_id=OTHER, drawing_file_id="f-b"))
    with pytest.raises(HTTPException) as foreign:
        asyncio.run(shopfloor_drawing.load_for_user("wo-b", admin))
    assert foreign.value.status_code == 404

    device = _device(["Montaj"])
    with pytest.raises(HTTPException) as station:
        asyncio.run(shopfloor_drawing.load_for_user("wo1", device))
    assert station.value.status_code == 403

    mem.work_orders.docs.append(_wo(_id="wo-html", drawing_file_id="f-html"))
    mem.files.docs.append({
        "_id": "f-html",
        "company_id": CID,
        "storage_path": "drawings/x.html",
        "content_type": "text/html",
        "original_filename": "x.html",
    })
    with pytest.raises(HTTPException) as html:
        asyncio.run(shopfloor_drawing.load_for_user("wo-html", admin))
    assert html.value.status_code == 400
    assert html.value.detail["code"] == "drawing_type_rejected"

    mem.work_orders.docs.append(_wo(_id="wo-empty", drawing_file_id=""))
    with pytest.raises(HTTPException) as empty:
        asyncio.run(shopfloor_drawing.load_for_user("wo-empty", admin))
    assert empty.value.status_code == 404

    called = {"n": 0}

    def _boom(*args, **kwargs):
        called["n"] += 1
        raise AssertionError("imza üretilmemeli")

    monkeypatch.setattr(signed_links, "make_doc_share_token", _boom)
    mem.work_orders.docs.append(_wo(_id="wo-trav", drawing_file_id="f-trav"))
    mem.files.docs.append({
        "_id": "f-trav",
        "company_id": CID,
        "storage_path": "../etc/passwd",
        "content_type": "application/pdf",
        "original_filename": "passwd.pdf",
    })
    with pytest.raises(HTTPException) as trav:
        asyncio.run(shopfloor_drawing.load_for_user("wo-trav", admin))
    assert trav.value.status_code == 404
    assert called["n"] == 0


def test_pause_and_blocker_prefer_employee_id(mem, monkeypatch):
    async def _phase(emp, company):
        return {"allowed": True, "phase": "work"}

    monkeypatch.setattr(server.sfp, "pause_policy_for_employee", _phase)
    mem.companies.docs.append({"_id": CID, "work_schedule": WIDE})
    mem.employees.docs.append(_emp("e1", CID, "Ali", pin_ver=1))
    mem.employees.docs.append(_emp("e2", CID, "Ali", pin_ver=1))
    named = asyncio.run(server._shopfloor_pause_policy(CID, "Ali", None))
    picked = asyncio.run(server._shopfloor_pause_policy(CID, "Ali", "e2"))
    assert named["employee_id"] == "e1"
    assert picked["employee_id"] == "e2"
    other_card = [{"_id": "a", "status": "in_progress", "operator_name": "Ali", "operator_employee_id": "e1", "station": "PVC"}]
    legacy = [{"_id": "b", "status": "in_progress", "operator_name": "Ali", "station": "PVC"}]
    import shopfloor_operators as sfo
    assert sfo.operator_active_station_blocker(other_card, "Ali", "CNC", operator_employee_id="e2") is None
    assert sfo.operator_active_station_blocker(legacy, "Ali", "CNC", operator_employee_id="e2")["_id"] == "b"


def test_scrap_reason_rules_and_finish_movement(mem):
    admin = _user("admin1", CID, role="admin", name="Ali")
    ok = asyncio.run(shopfloor_scrap.enforce(mem, CID, {"scrap_reason_code": "machine"}, 1, admin))
    assert ok["scrap_reason_label"] == "Makine"
    web = asyncio.run(shopfloor_scrap.enforce(mem, CID, {}, 2, admin))
    assert web["scrap_reason_code"] is None
    with pytest.raises(HTTPException) as bad:
        asyncio.run(shopfloor_scrap.enforce(mem, CID, {"scrap_reason_code": "nope"}, 1, admin))
    assert bad.value.status_code == 400
    mem.companies.docs.append({
        "_id": CID,
        "shopfloor_scrap_reasons": [
            {"code": "machine", "label": "Makine", "active": False},
            {"code": "other", "label": "Diğer", "active": True},
        ],
        "shopfloor_scrap_reason_required": True,
    })
    with pytest.raises(HTTPException) as inactive:
        asyncio.run(shopfloor_scrap.enforce(mem, CID, {"scrap_reason_code": "machine"}, 1, admin))
    assert inactive.value.detail == shopfloor_scrap.REASON_INACTIVE
    device = _device(["CNC"])
    with pytest.raises(HTTPException) as required:
        asyncio.run(shopfloor_scrap.enforce(mem, CID, {}, 1, device))
    assert required.value.detail == shopfloor_scrap.REASON_REQUIRED
    with pytest.raises(HTTPException) as note:
        asyncio.run(shopfloor_scrap.enforce(mem, CID, {"scrap_reason_code": "other", "scrap_reason_note": "x" * 201}, 1, admin))
    assert note.value.detail == shopfloor_scrap.NOTE_LONG

    mem.companies.docs.clear()
    _seed_emp(mem)
    mem.products.docs.append({"_id": "mat1", "company_id": CID, "name": "Plaka", "stock_quantity": 20})
    mem.work_orders.docs.append(_wo(
        material_product_id="mat1",
        material_name="Plaka",
        materials=[{"product_id": "mat1", "product_name": "Plaka", "needed": 4, "unit": "Adet"}],
        planned_quantity=4,
    ))
    mem.work_orders.docs.append(_wo(_id="wo2", step_no=2, status="waiting", step_name="Montaj", station="CNC"))
    mem.production_orders.docs.append(_order())
    done = asyncio.run(server.finish_work_order(
        "wo1",
        {"produced_qty": 3, "scrap_qty": 1, "scrap_reason_code": "cut_error"},
        user=admin,
    ))
    assert done["status"] == "success"
    assert mem.work_orders.docs[0]["scrap_reason_code"] == "cut_error"
    assert mem.work_orders.docs[0]["scrap_reason_label"] == "Kesim hatası"
    assert mem.stock_movements.docs[0]["scrap_reason_code"] == "cut_error"
    assert mem.stock_movements.docs[0]["company_id"] == CID


def test_settings_reject_invalid_idle_before_write(mem):
    mem.companies.docs.append({"_id": CID, "shopfloor_group_same_station": True})
    user = _user("admin1", CID, role="admin")
    with pytest.raises(HTTPException) as exc:
        asyncio.run(server.put_shopfloor_settings({"company_id": CID, "idle_lock_minutes": 2, "group_same_station": True}, user=user))
    assert exc.value.status_code == 400
    assert "shopfloor_idle_lock_minutes" not in mem.companies.docs[0]
    saved = asyncio.run(server.put_shopfloor_settings(
        {"company_id": CID, "group_same_station": True, "idle_lock_minutes": 45, "undo_finish_minutes": 8},
        user=user,
    ))
    assert saved["idle_lock_minutes"] == 45
    assert saved["undo_finish_minutes"] == 8
    assert saved["group_same_station"] is True
    assert mem.companies.docs[0]["shopfloor_idle_lock_minutes"] == 45
