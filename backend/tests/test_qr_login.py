"""QR ile web girişi. Bellek içi. Canlı veritabanına ve 8021'e bağlanmaz."""
from __future__ import annotations

import asyncio
import copy
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.environ.setdefault("JWT_SECRET", "test-qr-login-jwt-secret-not-default-value")

import applog  # noqa: E402
import qr_login  # noqa: E402


class Mem:
    def __init__(self):
        self.docs = {}
        self.updates = []

    def _match(self, doc, query):
        for key, value in (query or {}).items():
            if doc.get(key) != value:
                return False
        return True

    async def find_one(self, query):
        for doc in self.docs.values():
            if self._match(doc, query):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = copy.deepcopy(doc)
        return SimpleNamespace(inserted_id=doc["_id"])

    def _apply(self, doc, update):
        for key, value in (update.get("$inc") or {}).items():
            doc[key] = int(doc.get(key) or 0) + int(value)
        doc.update(update.get("$set") or {})

    async def update_one(self, query, update, upsert=False):
        self.updates.append((copy.deepcopy(query), copy.deepcopy(update)))
        for doc in self.docs.values():
            if self._match(doc, query):
                self._apply(doc, update)
                return SimpleNamespace(matched_count=1, modified_count=1)
        if not upsert:
            return SimpleNamespace(matched_count=0, modified_count=0)
        doc = {}
        for key, value in (query or {}).items():
            if not str(key).startswith("$"):
                doc[key] = value
        if "_id" not in doc:
            doc["_id"] = query.get("identifier") or "row"
        self._apply(doc, update)
        self.docs[doc["_id"]] = doc
        return SimpleNamespace(matched_count=1, modified_count=1, upserted_id=doc["_id"])

    async def update_one_atomic(self, query, update):
        return await self.update_one(query, update, upsert=False)


class Db:
    def __init__(self):
        self.web_login_qr = Mem()
        self.login_attempts = Mem()
        self.users = Mem()
        self.companies = Mem()


class Req:
    def __init__(self, ip="203.0.113.10", ua="Mozilla/5.0 Chrome/120.0"):
        self.headers = {"host": "app.tamkobi.com", "user-agent": ua, "x-forwarded-proto": "https"}
        self.client = SimpleNamespace(host=ip)
        self.url = SimpleNamespace(path="/api/auth/qr-login/start", scheme="https", hostname="app.tamkobi.com")


class Resp:
    def __init__(self):
        self.cookies = []

    def set_cookie(self, **kw):
        self.cookies.append(kw)


def _user(**over):
    base = {
        "_id": "usr1",
        "email": "ada@example.com",
        "name": "Ada Kaya",
        "role": "admin",
        "company_ids": ["c1", "c2"],
        "active_company_id": "c1",
        "is_active": True,
        "is_super_admin": False,
        "totp_enabled": False,
        "_token_payload": {"cli": "mobile"},
    }
    base.update(over)
    return base


@pytest.fixture
def db():
    store = Db()
    store.companies.docs["c1"] = {"_id": "c1", "name": "Birinci Ltd"}
    store.companies.docs["c2"] = {"_id": "c2", "name": "İkinci A.Ş."}
    return store


@pytest.fixture
def clock(monkeypatch):
    state = {"now": datetime(2026, 6, 1, 12, 0, tzinfo=timezone.utc)}
    monkeypatch.setattr(qr_login, "_now", lambda: state["now"])
    return state


@pytest.fixture
def logs(monkeypatch):
    events = []

    def capture(event, message="", **fields):
        events.append((event, message, fields))

    monkeypatch.setattr(applog, "log_auth", capture)
    return events


def _run(coro):
    return asyncio.run(coro)


async def _issue(user, request, response, remember=False):
    response.set_cookie(key="access_token", value="issued-session")
    return {
        "token": "issued-session",
        "user": {
            "id": user["_id"],
            "name": user["name"],
            "email": user["email"],
            "active_company_id": user.get("active_company_id"),
        },
        "remember": remember,
    }


def test_code_is_hashed_with_jwt_secret_and_not_stored(db, clock, logs):
    started = _run(qr_login.start_session(db, Req(), remember=True))
    code = started["code"]
    secret = started["poll_secret"]
    assert qr_login.clean_code(code) == code
    assert "://" not in code
    stored = next(iter(db.web_login_qr.docs.values()))
    blob = json.dumps(stored, ensure_ascii=False)
    assert code not in blob
    assert secret not in blob
    assert stored["_id"] == qr_login.code_mac(code)
    assert stored["poll_hash"] == qr_login.poll_mac(secret)
    assert stored["browser"] == "Chrome"
    raw = Path(__file__).resolve().parents[1].joinpath("qr_login.py").read_text(encoding="utf-8")
    assert "CREDENTIAL_ENCRYPTION_KEY" not in raw
    assert "shopfloor_devices" not in raw
    logged = json.dumps(logs, ensure_ascii=False)
    assert code not in logged
    assert secret not in logged


def test_single_use_delivery_and_reuse_rejected(db, clock, logs):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=False))
    preview = _run(qr_login.preview(db, Req(), user, started["code"]))
    assert preview["company_name"] == "Birinci Ltd"
    assert preview["company_id"] == "c1"
    assert preview["user_name"] == "Ada Kaya"
    assert preview["ip"] == "203.0.113.10"
    assert _run(qr_login.approve(db, Req(), user, started["code"]))["status"] == "approved"
    with pytest.raises(HTTPException) as again:
        _run(qr_login.approve(db, Req(), user, started["code"]))
    assert again.value.status_code == 409

    resp = Resp()
    body = _run(qr_login.poll_status(
        db, Req(), resp, started["code"], started["poll_secret"], issue_session=_issue,
    ))
    assert body["status"] == "approved"
    assert body["token"] == "issued-session"
    assert body["user"]["active_company_id"] == "c1"
    assert resp.cookies and resp.cookies[0]["key"] == "access_token"
    assert "İkinci" not in json.dumps(body, ensure_ascii=False)

    resp2 = Resp()
    second = _run(qr_login.poll_status(
        db, Req(), resp2, started["code"], started["poll_secret"], issue_session=_issue,
    ))
    assert second == {"status": "consumed"}
    assert "token" not in second
    assert resp2.cookies == []
    sets = [upd.get("$set") or {} for _q, upd in db.users.updates]
    assert sets
    assert all(set(item) == {"last_login_at"} for item in sets)
    assert db.users.docs["usr1"]["active_company_id"] == "c1"
    logged = json.dumps(logs, ensure_ascii=False)
    assert started["code"] not in logged
    assert started["poll_secret"] not in logged
    assert "issued-session" not in logged


def test_other_browser_secret_does_not_receive_session(db, clock):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=True))
    other = _run(qr_login.start_session(db, Req(ip="203.0.113.11"), remember=True))
    _run(qr_login.approve(db, Req(), user, started["code"]))
    resp = Resp()
    with pytest.raises(HTTPException) as ei:
        _run(qr_login.poll_status(
            db, Req(), resp, started["code"], other["poll_secret"], issue_session=_issue,
        ))
    assert ei.value.status_code == 404
    assert resp.cookies == []
    assert db.web_login_qr.docs[qr_login.code_mac(started["code"])]["status"] == "approved"


def test_expiry_blocks_approve_and_poll(db, clock):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=True))
    clock["now"] = clock["now"] + timedelta(seconds=qr_login.QR_TTL_SECONDS + 1)
    with pytest.raises(HTTPException) as ei:
        _run(qr_login.approve(db, Req(), user, started["code"]))
    assert ei.value.status_code == 401
    pending = _run(qr_login.poll_status(
        db, Req(), Resp(), started["code"], started["poll_secret"], issue_session=_issue,
    ))
    assert pending == {"status": "expired"}
    assert db.users.updates == []


def test_approved_session_survives_short_grace_then_expires(db, clock):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=True))
    clock["now"] = clock["now"] + timedelta(seconds=qr_login.QR_TTL_SECONDS - 1)
    _run(qr_login.approve(db, Req(), user, started["code"]))
    clock["now"] = clock["now"] + timedelta(seconds=2)
    body = _run(qr_login.poll_status(
        db, Req(), Resp(), started["code"], started["poll_secret"], issue_session=_issue,
    ))
    assert body["token"] == "issued-session"

    started2 = _run(qr_login.start_session(db, Req(ip="203.0.113.20"), remember=True))
    clock["now"] = clock["now"] + timedelta(seconds=qr_login.QR_TTL_SECONDS - 1)
    _run(qr_login.approve(db, Req(), user, started2["code"]))
    clock["now"] = clock["now"] + timedelta(seconds=qr_login.QR_DELIVER_GRACE_SECONDS + 5)
    late = _run(qr_login.poll_status(
        db, Req(), Resp(), started2["code"], started2["poll_secret"], issue_session=_issue,
    ))
    assert late == {"status": "expired"}
    assert "token" not in late


def test_unauthorized_and_super_admin_and_device_rejected(db, clock):
    started = _run(qr_login.start_session(db, Req(), remember=True))
    with pytest.raises(HTTPException) as anon:
        _run(qr_login.approve(db, Req(), None, started["code"]))
    assert anon.value.status_code == 401

    admin = _user(is_super_admin=True, totp_enabled=True)
    with pytest.raises(HTTPException) as sa:
        _run(qr_login.approve(db, Req(), admin, started["code"]))
    assert sa.value.status_code == 403
    assert db.web_login_qr.docs[qr_login.code_mac(started["code"])]["status"] == "pending"

    device = _user(_id="dev1", account_type="atolye_device", is_super_admin=False)
    with pytest.raises(HTTPException) as dev:
        _run(qr_login.approve(db, Req(), device, started["code"]))
    assert dev.value.status_code == 403

    inactive = _user(is_active=False)
    with pytest.raises(HTTPException) as off:
        _run(qr_login.approve(db, Req(), inactive, started["code"]))
    assert off.value.status_code == 403

    totp_user = _user(totp_enabled=True, is_super_admin=False)
    db.users.docs[totp_user["_id"]] = copy.deepcopy(totp_user)
    assert _run(qr_login.approve(db, Req(), totp_user, started["code"]))["status"] == "approved"
    assert db.users.docs["usr1"]["active_company_id"] == "c1"


def test_reject_then_approve_fails(db, clock):
    user = _user()
    started = _run(qr_login.start_session(db, Req(), remember=True))
    assert _run(qr_login.reject(db, Req(), user, started["code"]))["status"] == "rejected"
    with pytest.raises(HTTPException) as ei:
        _run(qr_login.approve(db, Req(), user, started["code"]))
    assert ei.value.status_code == 409
    body = _run(qr_login.poll_status(
        db, Req(), Resp(), started["code"], started["poll_secret"], issue_session=_issue,
    ))
    assert body == {"status": "rejected"}


def test_rate_limit_per_ip(db, clock):
    for _ in range(qr_login.QR_START_PER_MINUTE):
        _run(qr_login.start_session(db, Req(ip="198.51.100.8"), remember=True))
    with pytest.raises(HTTPException) as ei:
        _run(qr_login.start_session(db, Req(ip="198.51.100.8"), remember=True))
    assert ei.value.status_code == 429
    assert len(db.web_login_qr.docs) == qr_login.QR_START_PER_MINUTE
    other = _run(qr_login.start_session(db, Req(ip="198.51.100.9"), remember=True))
    assert other["code"]


def test_parallel_poll_delivers_once(db, clock):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=True))
    _run(qr_login.approve(db, Req(), user, started["code"]))

    async def both():
        return await asyncio.gather(
            qr_login.poll_status(db, Req(), Resp(), started["code"], started["poll_secret"], issue_session=_issue),
            qr_login.poll_status(db, Req(), Resp(), started["code"], started["poll_secret"], issue_session=_issue),
        )

    first, second = _run(both())
    tokens = [item.get("token") for item in (first, second) if item.get("token")]
    assert tokens == ["issued-session"]
    assert {first.get("status"), second.get("status")} == {"approved", "consumed"}


def test_public_paths_and_ik_allowlist():
    import host_audience
    import rbac

    assert rbac.is_public_api_path("/api/auth/qr-login/start", "POST") is True
    assert rbac.is_public_api_path("/api/auth/qr-login/status", "POST") is True
    assert rbac.is_public_api_path("/api/auth/qr-login/start", "GET") is False
    assert rbac.is_public_api_path("/api/auth/qr-login/status", "GET") is False
    assert rbac.is_public_api_path("/api/auth/qr-login/preview", "POST") is False
    assert rbac.is_public_api_path("/api/auth/qr-login/approve", "POST") is False
    assert rbac.is_public_api_path("/api/auth/qr-login/reject", "POST") is False
    assert host_audience.is_ik_self_service_path("/api/auth/qr-login/approve") is True
    assert host_audience.is_ik_self_service_path("/api/auth/qr-login/reject") is True
    text = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    for path in (
        "/auth/qr-login/start",
        "/auth/qr-login/status",
        "/auth/qr-login/preview",
        "/auth/qr-login/approve",
        "/auth/qr-login/reject",
    ):
        assert path in text


def test_approve_ignores_company_switch_request(db, clock):
    user = _user()
    db.users.docs[user["_id"]] = copy.deepcopy(user)
    started = _run(qr_login.start_session(db, Req(), remember=True))
    _run(qr_login.approve(db, Req(), user, started["code"]))
    stored = db.web_login_qr.docs[qr_login.code_mac(started["code"])]
    assert stored["company_id"] == "c1"
    assert stored["company_name"] == "Birinci Ltd"
    assert stored["company_id"] != "c2"
    assert db.users.docs["usr1"]["active_company_id"] == "c1"
    assert db.users.updates == []


def test_remember_defaults_to_false(db, clock):
    import server

    assert server.QrLoginStartRequest().remember is False
    assert server.LoginRequest(email="ada@example.com", password="gizli").remember is False
    started = _run(qr_login.start_session(db, Req()))
    stored = db.web_login_qr.docs[qr_login.code_mac(started["code"])]
    assert stored["remember"] is False


def test_impersonation_cannot_start_or_approve(db, clock):
    import jwt
    from auth_utils import JWT_ALGORITHM, get_jwt_secret

    started = _run(qr_login.start_session(db, Req()))
    imp = _user(_token_payload={"cli": "mobile", "imp_session": "ss-1", "imp_by": "destek@example.com"})
    with pytest.raises(HTTPException) as preview_err:
        _run(qr_login.preview(db, Req(), imp, started["code"]))
    assert preview_err.value.status_code == 403
    with pytest.raises(HTTPException) as approve_err:
        _run(qr_login.approve(db, Req(), imp, started["code"]))
    assert approve_err.value.status_code == 403
    with pytest.raises(HTTPException) as reject_err:
        _run(qr_login.reject(db, Req(), imp, started["code"]))
    assert reject_err.value.status_code == 403
    assert db.web_login_qr.docs[qr_login.code_mac(started["code"])]["status"] == "pending"

    token = jwt.encode(
        {
            "sub": "usr1",
            "email": "ada@example.com",
            "type": "access",
            "cli": "web",
            "imp_session": "ss-1",
            "imp_by": "destek@example.com",
            "exp": datetime.now(timezone.utc) + timedelta(hours=1),
        },
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )
    req = Req()
    req.headers = dict(req.headers)
    req.headers["Authorization"] = f"Bearer {token}"
    before = len(db.web_login_qr.docs)
    with pytest.raises(HTTPException) as start_err:
        _run(qr_login.start_session(db, req))
    assert start_err.value.status_code == 403
    assert len(db.web_login_qr.docs) == before


def test_approve_requires_mobile_client(db, clock):
    started = _run(qr_login.start_session(db, Req()))
    web = _user(_token_payload={"cli": "web"})
    with pytest.raises(HTTPException) as web_err:
        _run(qr_login.approve(db, Req(), web, started["code"]))
    assert web_err.value.status_code == 403
    bare = _user(_token_payload={})
    with pytest.raises(HTTPException) as bare_err:
        _run(qr_login.approve(db, Req(), bare, started["code"]))
    assert bare_err.value.status_code == 403
    assert db.web_login_qr.docs[qr_login.code_mac(started["code"])]["status"] == "pending"
    assert _run(qr_login.approve(db, Req(), _user(), started["code"]))["status"] == "approved"


def test_status_issues_web_session_through_issue_helper(db, clock, monkeypatch):
    from unittest.mock import AsyncMock, patch

    import auth_utils
    import server

    user = _user()
    plain = {key: value for key, value in user.items() if key != "_token_payload"}
    db.users.docs[plain["_id"]] = copy.deepcopy(plain)
    started = _run(qr_login.start_session(db, Req(), remember=False))
    _run(qr_login.approve(db, Req(), user, started["code"]))

    seen = {}

    async def fake_issue(fresh, request, response, remember=False, client=None):
        seen["client"] = client
        seen["remember"] = remember
        response.set_cookie(key="access_token", value="web-session")
        return {
            "token": "web-session",
            "user": {"id": fresh["_id"], "active_company_id": fresh.get("active_company_id")},
        }

    real_issue = server._issue_session_for_user
    monkeypatch.setattr(server, "db", db)
    monkeypatch.setattr(server, "_issue_session_for_user", fake_issue)
    req = Req()
    req.headers = dict(req.headers)
    req.headers["X-Tamkobi-Client"] = "mobile"
    body = _run(server.auth_qr_login_status(
        server.QrLoginStatusRequest(code=started["code"], poll_secret=started["poll_secret"]),
        req,
        Resp(),
    ))
    assert seen == {"client": "web", "remember": False}
    assert body["status"] == "approved"
    assert body["token"] == "web-session"
    monkeypatch.setattr(server, "_issue_session_for_user", real_issue)

    class Companies:
        def find(self, query):
            class Cur:
                async def to_list(self, limit):
                    return [{"_id": "c1", "name": "Birinci Ltd"}]
            return Cur()

    issue_req = Req()
    issue_req.headers = dict(issue_req.headers)
    issue_req.headers["X-Tamkobi-Client"] = "mobile"

    async def issue():
        with patch.object(server, "db", SimpleNamespace(companies=Companies())), patch(
            "company_audit.record_auth", AsyncMock(),
        ), patch(
            "rbac.role_for", AsyncMock(return_value={"name": "Yönetici", "permissions": {}}),
        ), patch(
            "attendance.employee_for_user", AsyncMock(return_value=None),
        ), patch(
            "user_numbers.ensure_user_number", AsyncMock(return_value="1"),
        ), patch(
            "superadmin_2fa.needs_2fa_setup", return_value=False,
        ), patch(
            "superadmin_2fa.user_totp_enabled", return_value=False,
        ), patch(
            "saas.effective", AsyncMock(return_value=None),
        ):
            return await server._issue_session_for_user(
                plain, issue_req, Resp(), remember=False, client="web",
            )

    issued = _run(issue())
    payload = auth_utils.decode_access_payload(issued["token"])
    assert payload["cli"] == "web"
    assert payload["sid"]
    assert payload["tv"] == 0
    assert "imp_session" not in payload
