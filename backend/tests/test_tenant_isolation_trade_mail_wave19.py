"""Dış ticaret, şirket postası ve atölye duraklatma kiracı dalgası 19.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, fiyat, maliyet, posta şifresi, OAuth token ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance as att  # noqa: E402
import comm_service  # noqa: E402
import mail_accounts  # noqa: E402
import shopfloor_pause  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trade  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
SECRET_PW = "pw-secret-COA-991"
SECRET_TOKEN = "oauth-secret-xyz-7781"
_MONDAY = datetime(2026, 10, 19, 10, 30, tzinfo=ZoneInfo("Europe/Istanbul"))
_AFTER_END = datetime(2026, 10, 19, 18, 15, tzinfo=ZoneInfo("Europe/Istanbul"))

_REMOVED = (
    ("trade.py", "convert_trade_file", "contacts", "find_one"),
    ("trade.py", "convert_trade_file", "invoices", "find_one"),
    ("trade.py", "convert_trade_file", "invoices", "update_one"),
    ("trade.py", "convert_trade_file", "products", "update_one"),
    ("trade.py", "convert_trade_file", "trade_files", "update_one"),
    ("trade.py", "create_trade_file", "trade_files", "insert_one"),
    ("trade.py", "set_trade_status", "trade_files", "find_one"),
    ("trade.py", "set_trade_status", "trade_files", "update_one"),
    ("trade.py", "update_trade_file", "trade_files", "find_one"),
    ("trade.py", "update_trade_file", "trade_files", "update_one"),
    ("mail_accounts.py", "mark_needs_reauth", "mail_accounts", "update_one"),
    ("mail_accounts.py", "save_mail_account", "mail_accounts", "find_one"),
    ("mail_accounts.py", "save_mail_account", "mail_accounts", "insert_one"),
    ("mail_accounts.py", "save_mail_account", "mail_accounts", "update_one"),
    ("mail_accounts.py", "send_tracked_mail", "mail_logs", "insert_one"),
    ("mail_accounts.py", "test_mail_account", "mail_accounts", "update_one"),
    ("shopfloor_pause.py", "pause_policy_for_employee", "attendance", "find_one"),
    ("shopfloor_pause.py", "pause_policy_for_employee", "shift_plans", "find_one"),
    ("shopfloor_pause.py", "run_auto_pause_work_orders", "attendance", "find_one"),
    ("shopfloor_pause.py", "run_auto_pause_work_orders", "shift_plans", "find_one"),
    ("shopfloor_pause.py", "run_auto_pause_work_orders", "work_orders", "update_many"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _DB(MemDB):
    pass


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _item(**extra):
    row = {
        "product_id": "",
        "name": "Parca",
        "quantity": 1,
        "unit": "Adet",
        "unit_price_fx": 10,
        "gtip": "8471.30",
        "origin_country": "CN",
    }
    row.update(extra)
    return row


def _trade(company_id, doc_id, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "kind": "import",
        "status": "draft",
        "contact_id": "cnt-a",
        "contact_name": "Cari A",
        "file_number": "ITH-2026-0007",
        "currency": "USD",
        "fx_rate": 40,
        "fx_source": "manual",
        "country": "CN",
        "incoterm": "CIF",
        "landed_cost": 400,
        "items": [_item()],
    }
    row.update(extra)
    return row


def _contact(company_id, doc_id, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "Cari " + company_id,
        "tax_number_or_id": "111" if company_id == CO_A else "9999999999",
        "address": "Adres " + company_id,
    }
    row.update(extra)
    return row


def _product(company_id, doc_id, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "Urun " + company_id,
        "purchase_price": 11 if company_id == CO_A else 77,
        "gtip": "1111.00" if company_id == CO_A else "9999.99",
        "origin_country": "TR" if company_id == CO_A else "DE",
    }
    row.update(extra)
    return row


def _account(company_id, **extra):
    row = {
        "_id": "acct-shared",
        "company_id": company_id,
        "user_id": "user-" + company_id,
        "email": "a@co-a.test" if company_id == CO_A else "b@co-b.test",
        "display_name": company_id,
        "provider": "custom",
        "imap_host": "imap.example.test",
        "imap_port": 993,
        "smtp_host": "smtp.example.test",
        "smtp_port": 587,
        "password_enc": comm_service.encrypt(SECRET_PW if company_id == CO_A else "other-pw-b"),
        "oauth_refresh_enc": "" if company_id == CO_A else SECRET_TOKEN,
        "status": "unverified" if company_id == CO_A else "locked-b",
        "last_error": None if company_id == CO_A else "keep-b",
    }
    row.update(extra)
    return row


class _Req:
    def __init__(self):
        self.headers = {}
        self.query_params = {}

    async def json(self):
        return {}


def _spy(coll):
    seen = []
    original = coll.find_one

    async def wrapped(query=None, projection=None, sort=None):
        row = await original(query, projection, sort)
        seen.append(None if row is None else row.get("_id"))
        return row

    coll.find_one = wrapped
    return seen


def _schedule(**extra):
    row = {
        "start": "09:00",
        "end": "18:00",
        "break_minutes": 60,
        "work_days": [0, 1, 2, 3, 4],
        "exit_tolerance_minutes": 0,
        "timezone": "Europe/Istanbul",
    }
    row.update(extra)
    return row


def test_create_trade_file_sets_resolved_company(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    user = _user(CO_A)
    with pytest.raises(HTTPException) as denied:
        _run(trade.create_trade_file({
            "company_id": CO_B,
            "kind": "export",
            "contact_name": "Cari",
            "currency": "USD",
            "fx_rate": 40,
            "items": [_item(product_id="")],
        }, user))
    assert denied.value.status_code == 403
    assert db.trade_files.docs == []
    created = _run(trade.create_trade_file({
        "kind": "export",
        "contact_name": "Cari A",
        "currency": "USD",
        "fx_rate": 40,
        "file_number": "EL-19",
        "items": [_item()],
    }, user))
    assert created["company_id"] == CO_A
    assert created["file_number"] == "EL-19"
    assert db.trade_files.docs[0]["company_id"] == CO_A


def test_update_and_status_miss_other_company(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    _add(db, "trade_files", _trade(CO_B, "file-b", notes="gizli-b", status="draft"))
    _add(db, "trade_files", _trade(CO_A, "file-a", notes="eski", status="draft", kind="export"))
    before = _digest(db, CO_B)
    user = _user(CO_A)
    with pytest.raises(HTTPException) as missing:
        _run(trade.update_trade_file("file-b", {
            "notes": "degisti",
            "contact_name": "Cari A",
            "currency": "USD",
            "fx_rate": 40,
            "items": [_item()],
        }, user))
    with pytest.raises(HTTPException) as status_missing:
        _run(trade.set_trade_status("file-b", {"status": "cancelled"}, user))
    assert missing.value.status_code == 404
    assert missing.value.detail == "Dosya bulunamadı."
    assert status_missing.value.status_code == 404
    updated = _run(trade.update_trade_file("file-a", {
        "notes": "yeni-a",
        "contact_name": "Cari A",
        "currency": "USD",
        "fx_rate": 40,
        "kind": "export",
        "items": [_item()],
    }, user))
    changed = _run(trade.set_trade_status("file-a", {"status": "declared", "declaration_no": "BEY-1"}, user))
    assert updated["company_id"] == CO_A
    assert updated["notes"] == "yeni-a"
    assert changed["status"] == "declared"
    assert changed["declaration_no"] == "BEY-1"
    assert _row(db, "trade_files", CO_B, "file-b")["notes"] == "gizli-b"
    assert _row(db, "trade_files", CO_B, "file-b")["status"] == "draft"
    assert _digest(db, CO_B) == before


def test_update_same_id_does_not_write_other_company(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    _add(db, "trade_files", _trade(CO_B, "file-shared", notes="gizli-b", kind="export"))
    _add(db, "trade_files", _trade(CO_A, "file-shared", notes="eski-a", kind="export"))

    async def _own(db_arg, collection, doc_id, actor, **kwargs):
        allowed = {str(item) for item in (actor.get("company_ids") or [])}
        for row in db_arg[collection].docs:
            if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
                return copy.deepcopy(row)
        raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Dosya bulunamadı.")

    monkeypatch.setattr(trade.tenant_access, "get_tenant_doc", _own)
    before = _digest(db, CO_B)
    updated = _run(trade.update_trade_file("file-shared", {
        "notes": "yalniz-a",
        "contact_name": "Cari A",
        "currency": "USD",
        "fx_rate": 40,
        "kind": "export",
        "items": [_item()],
    }, _user(CO_A)))
    _run(trade.set_trade_status("file-shared", {"status": "cleared"}, _user(CO_A)))
    assert updated["notes"] == "yalniz-a"
    assert _row(db, "trade_files", CO_A, "file-shared")["status"] == "cleared"
    assert _row(db, "trade_files", CO_B, "file-shared")["notes"] == "gizli-b"
    assert _row(db, "trade_files", CO_B, "file-shared")["status"] == "draft"
    assert _digest(db, CO_B) == before


def test_convert_rejects_other_company_contact(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    calls = []

    async def _stub(inv, user):
        calls.append(inv)
        return {"id": "inv-new", "invoice_number": "ITH-NEW"}

    monkeypatch.setattr(trade, "_create_invoice", _stub)
    _add(db, "contacts", _contact(CO_B, "cnt-b", name="Unvan B", tax_number_or_id="9999999999"))
    _add(db, "trade_files", _trade(CO_A, "file-a", contact_id="cnt-b", contact_name="Cari A"))
    seen = _spy(db.contacts)
    before = _digest(db, CO_B)
    with pytest.raises(HTTPException) as missing:
        _run(trade.convert_trade_file("file-a", {}, _user(CO_A)))
    assert missing.value.status_code == 400
    assert missing.value.detail == "Fatura için önce cari bağlayın."
    assert calls == []
    assert "cnt-b" not in seen
    assert db.invoices.docs == []
    assert _digest(db, CO_B) == before
    assert _row(db, "contacts", CO_B, "cnt-b")["name"] == "Unvan B"


def test_convert_does_not_price_other_company_product(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    calls = []

    async def _stub(inv, user):
        calls.append(inv.contact_name)
        return {"id": "inv-new", "invoice_number": "ITH-NEW"}

    monkeypatch.setattr(trade, "_create_invoice", _stub)
    _add(db, "contacts", _contact(CO_A, "cnt-a"))
    _add(db, "products", _product(CO_B, "prod-shared"))
    _add(db, "products", _product(CO_A, "prod-shared"))
    _add(db, "trade_files", _trade(CO_A, "file-a", items=[_item(product_id="prod-shared", gtip="8471.30", origin_country="CN")]))
    before = _digest(db, CO_B)
    result = _run(trade.convert_trade_file("file-a", {}, _user(CO_A)))
    assert result["status"] == "success"
    assert calls == ["Cari A"]
    foreign = _row(db, "products", CO_B, "prod-shared")
    assert foreign["purchase_price"] == 77
    assert foreign["gtip"] == "9999.99"
    assert foreign["origin_country"] == "DE"
    assert _digest(db, CO_B) == before
    own = _row(db, "products", CO_A, "prod-shared")
    assert own["purchase_price"] != 11
    assert own["company_id"] == CO_A


def test_convert_exists_does_not_return_other_invoice(monkeypatch):
    db = _DB()
    monkeypatch.setattr(trade, "_db", db)
    calls = []

    async def _stub(inv, user):
        calls.append("created")
        return {"id": "inv-new", "invoice_number": "ITH-NEW"}

    monkeypatch.setattr(trade, "_create_invoice", _stub)
    _add(db, "invoices", {"_id": "inv-shared", "company_id": CO_B, "invoice_number": "B-SECRET", "notes": "gizli"})
    _add(db, "invoices", {"_id": "inv-shared", "company_id": CO_A, "invoice_number": "A-OK"})
    _add(db, "invoices", {"_id": "inv-b-only", "company_id": CO_B, "invoice_number": "B-ONLY", "notes": "yalniz-b"})
    _add(db, "trade_files", _trade(CO_A, "file-exists", invoice_id="inv-shared"))
    _add(db, "trade_files", _trade(CO_A, "file-foreign", invoice_id="inv-b-only", contact_id="cnt-a"))
    _add(db, "contacts", _contact(CO_A, "cnt-a"))
    before = _digest(db, CO_B)
    exists = _run(trade.convert_trade_file("file-exists", {}, _user(CO_A)))
    assert exists["status"] == "exists"
    assert exists["invoice"]["invoice_number"] == "A-OK"
    assert exists["invoice"].get("notes") != "gizli"
    assert "B-SECRET" not in json.dumps(exists)
    fresh = _run(trade.convert_trade_file("file-foreign", {}, _user(CO_A)))
    assert fresh["status"] == "success"
    assert fresh["invoice"]["invoice_number"] == "ITH-NEW"
    assert calls == ["created"]
    assert _row(db, "invoices", CO_B, "inv-shared")["invoice_number"] == "B-SECRET"
    assert _row(db, "invoices", CO_B, "inv-b-only")["notes"] == "yalniz-b"
    assert _digest(db, CO_B) == before


def _patch_mail(monkeypatch):
    async def _smtp_ok(_account):
        return {"ok": True}

    monkeypatch.setattr(comm_service, "imap_test", lambda _account: {"ok": True, "folders": 3})
    monkeypatch.setattr(comm_service, "smtp_login_test", _smtp_ok)


def test_save_and_test_do_not_change_other_mail_account(monkeypatch, caplog):
    db = _DB()
    monkeypatch.setattr(mail_accounts, "_db", db)
    _patch_mail(monkeypatch)
    _add(db, "mail_accounts", _account(CO_B))
    _add(db, "mail_accounts", _account(CO_A))
    before = _digest(db, CO_B)
    user = _user(CO_A)
    with caplog.at_level(logging.DEBUG):
        saved = _run(mail_accounts.save_mail_account({
            "company_id": CO_A,
            "email": "yeni@co-a.test",
            "password": SECRET_PW,
            "provider": "custom",
            "imap_host": "imap.example.test",
            "smtp_host": "smtp.example.test",
        }, user))
        tested = _run(mail_accounts.test_mail_account(_Req(), company_id=CO_A, user=user))
    assert saved["email"] == "yeni@co-a.test"
    assert saved["company_id"] == CO_A
    assert "password" not in saved
    assert "password_enc" not in saved
    assert tested["ok"] is True
    own = _row(db, "mail_accounts", CO_A, "acct-shared")
    assert own["email"] == "yeni@co-a.test"
    assert own["status"] == "connected"
    foreign = _row(db, "mail_accounts", CO_B, "acct-shared")
    assert foreign["email"] == "b@co-b.test"
    assert foreign["status"] == "locked-b"
    assert foreign["last_error"] == "keep-b"
    assert foreign["oauth_refresh_enc"] == SECRET_TOKEN
    assert _digest(db, CO_B) == before
    assert SECRET_PW not in caplog.text
    assert SECRET_TOKEN not in caplog.text


def test_save_insert_sets_company_id(monkeypatch, caplog):
    db = _DB()
    monkeypatch.setattr(mail_accounts, "_db", db)
    _patch_mail(monkeypatch)
    _add(db, "mail_accounts", _account(CO_B, _id="acct-b"))
    before = _digest(db, CO_B)
    with caplog.at_level(logging.DEBUG):
        saved = _run(mail_accounts.save_mail_account({
            "email": "yeni@co-a.test",
            "password": SECRET_PW,
            "provider": "custom",
            "imap_host": "imap.example.test",
            "smtp_host": "smtp.example.test",
        }, _user(CO_A)))
    assert saved["company_id"] == CO_A
    assert saved["email"] == "yeni@co-a.test"
    created = [doc for doc in db.mail_accounts.docs if doc.get("company_id") == CO_A]
    assert len(created) == 1
    assert created[0]["company_id"] == CO_A
    assert _digest(db, CO_B) == before
    assert SECRET_PW not in caplog.text
    assert SECRET_TOKEN not in caplog.text


def test_mark_needs_reauth_skips_without_company(monkeypatch, caplog):
    db = _DB()
    monkeypatch.setattr(mail_accounts, "_db", db)
    _add(db, "mail_accounts", _account(CO_B))
    _add(db, "mail_accounts", _account(CO_A, status="connected"))
    before = _digest(db, CO_B)
    with caplog.at_level(logging.DEBUG):
        _run(mail_accounts.mark_needs_reauth("acct-shared"))
        _run(mail_accounts.mark_needs_reauth("acct-shared", company_id=""))
        _run(mail_accounts.mark_needs_reauth("acct-shared", company_id=None))
    assert _row(db, "mail_accounts", CO_A, "acct-shared")["status"] == "connected"
    assert _row(db, "mail_accounts", CO_B, "acct-shared")["status"] == "locked-b"
    _run(mail_accounts.mark_needs_reauth("acct-shared", company_id=CO_A))
    assert _row(db, "mail_accounts", CO_A, "acct-shared")["status"] == "needs_reauth"
    assert _row(db, "mail_accounts", CO_B, "acct-shared")["status"] == "locked-b"
    assert _digest(db, CO_B) == before
    assert SECRET_PW not in caplog.text
    assert SECRET_TOKEN not in caplog.text


def test_send_tracked_mail_log_has_company_id(monkeypatch, caplog):
    db = _DB()
    monkeypatch.setattr(mail_accounts, "_db", db)
    account = _account(CO_A)
    account["password"] = SECRET_PW
    sent = {"n": 0}

    async def _ok(*_args, **_kwargs):
        sent["n"] += 1

    async def _fail(*_args, **_kwargs):
        raise RuntimeError("smtp down")

    monkeypatch.setattr(comm_service, "smtp_send", _ok)
    with caplog.at_level(logging.DEBUG):
        doc = _run(mail_accounts.send_tracked_mail(
            company_id=CO_A,
            to=["alici@example.test"],
            subject="konu",
            body="merhaba",
            account=account,
        ))
    assert sent["n"] == 1
    assert doc["company_id"] == CO_A
    assert db.mail_logs.docs[-1]["company_id"] == CO_A
    assert db.mail_logs.docs[-1]["status"] != "failed"
    monkeypatch.setattr(comm_service, "smtp_send", _fail)
    with pytest.raises(HTTPException) as failed:
        _run(mail_accounts.send_tracked_mail(
            company_id=CO_A,
            to=["alici@example.test"],
            subject="konu",
            body="merhaba",
            account=account,
        ))
    assert failed.value.status_code == 424
    assert db.mail_logs.docs[-1]["company_id"] == CO_A
    assert db.mail_logs.docs[-1]["status"] == "failed"
    assert all(row.get("company_id") == CO_A for row in db.mail_logs.docs)
    assert SECRET_PW not in caplog.text
    assert SECRET_TOKEN not in caplog.text


def test_pause_policy_ignores_other_company_shift(monkeypatch):
    monkeypatch.setattr(att, "local_now", lambda schedule=None: _MONDAY)
    db = _DB()
    monkeypatch.setattr(att, "_db", db)
    eid = "emp-shared"
    _add(db, "shift_plans", {
        "_id": "plan-b", "company_id": CO_B, "employee_id": eid, "date": "2026-10-19", "off": True,
    })
    _add(db, "attendance", {
        "_id": "att-b", "company_id": CO_B, "employee_id": eid, "date": "2026-10-19",
        "assigned_overtime_hours": 8, "check_in": "09:00",
    })
    _add(db, "shift_plans", {
        "_id": "plan-a-off", "company_id": CO_A, "employee_id": "emp-off", "date": "2026-10-19", "off": True,
    })
    before = _digest(db, CO_B)
    company = {"_id": CO_A, "work_schedule": _schedule()}
    open_policy = _run(shopfloor_pause.pause_policy_for_employee(
        {"_id": eid, "company_id": CO_A, "full_name": "Ali"}, company,
    ))
    closed = _run(shopfloor_pause.pause_policy_for_employee(
        {"_id": "emp-off", "company_id": CO_A, "full_name": "Veli"}, company,
    ))
    blank = _run(shopfloor_pause.pause_policy_for_employee(
        {"_id": eid, "full_name": "Ali"}, company,
    ))
    assert open_policy["allowed"] is True
    assert open_policy["phase"] == "mesai"
    assert closed["allowed"] is False
    assert blank["allowed"] is True
    assert blank["phase"] == "mesai"
    assert _digest(db, CO_B) == before


def test_auto_pause_does_not_touch_other_company(monkeypatch):
    monkeypatch.setattr(att, "local_now", lambda schedule=None: _AFTER_END)
    db = _DB()
    monkeypatch.setattr(att, "_db", db)
    eid = "emp-shared"
    wo = "wo-shared"
    _add(db, "companies", {"_id": CO_A, "work_schedule": _schedule()})
    _add(db, "companies", {"_id": CO_B, "work_schedule": _schedule(end="23:00")})
    _add(db, "employees", {"_id": eid, "company_id": CO_A, "full_name": "Ali", "status": "active"})
    _add(db, "employees", {"_id": eid, "company_id": CO_B, "full_name": "Ali", "status": "active"})
    _add(db, "shift_plans", {
        "_id": "plan-b", "company_id": CO_B, "employee_id": eid, "date": "2026-10-19",
        "start": "09:00", "end": "23:00", "off": False,
    })
    _add(db, "attendance", {"_id": "att-b", "company_id": CO_B, "employee_id": eid, "date": "2026-10-19"})
    _add(db, "work_orders", {"_id": wo, "company_id": CO_B, "status": "in_progress", "operator_name": "Ali"})
    _add(db, "work_orders", {"_id": wo, "company_id": CO_A, "status": "in_progress", "operator_name": "Ali"})
    before = _digest(db, CO_B)
    result = _run(shopfloor_pause.run_auto_pause_work_orders(CO_A))
    assert result and result[0]["company_id"] == CO_A
    assert _row(db, "work_orders", CO_A, wo)["status"] == "paused"
    assert _row(db, "work_orders", CO_B, wo)["status"] == "in_progress"
    assert "paused_at" not in _row(db, "work_orders", CO_B, wo)
    assert _digest(db, CO_B) == before


def test_wave19_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 21
    assert len(set(_REMOVED)) == 21
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
