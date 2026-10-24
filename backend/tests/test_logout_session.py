"""Çıkış yalnız kendi istemcisini düşürür: web çerezi ve mobil bearer.

Bellek içi veritabanı. Canlı veritabanı ve 8021 yok.
"""
from __future__ import annotations

import asyncio
import copy
import os
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, Response

os.environ.setdefault("JWT_SECRET", "test-logout-session-jwt-secret-not-default-32b")

import auth_utils  # noqa: E402
from mysql_store import apply_update, match_query  # noqa: E402


class _Coll:
    def __init__(self):
        self.docs = []

    def find(self, query=None):
        rows = [copy.deepcopy(doc) for doc in self.docs if match_query(doc, query or {})]
        return SimpleNamespace(to_list=self._to_list(rows))

    @staticmethod
    def _to_list(rows):
        async def inner(_limit=None):
            return rows
        return inner

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))

    async def update_one(self, query, update, upsert=False):
        for index, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[index] = apply_update(doc, update, query)
                return None
        return None


class _DB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll()
            self._cols[name] = coll
        return coll


def _user():
    return {
        "_id": "usr1",
        "email": "ada@example.com",
        "name": "Ada",
        "role": "admin",
        "is_active": True,
        "company_ids": ["co1"],
        "active_company_id": "co1",
        "token_version": 0,
    }


def _request(token: str, refresh: str = "", *, https: bool = True):
    headers = {"Authorization": f"Bearer {token}"}
    if https:
        headers["x-forwarded-proto"] = "https"
    return SimpleNamespace(
        headers=headers,
        cookies={"access_token": token, "refresh_token": refresh, "sa_return": "admin-ticket"},
        url="https://app.tamkobi.com/api/auth/logout" if https else "http://127.0.0.1/api/auth/logout",
        client=SimpleNamespace(host="203.0.113.10"),
    )


def test_login_remember_defaults_to_false():
    import server

    body = server.LoginRequest(email="ada@example.com", password="gizli-degil-test")
    assert body.remember is False


def _pair(client: str, *, version: int = 0):
    sid = auth_utils.new_session_id()
    access = auth_utils.create_access_token(
        "usr1", "ada@example.com", "admin", aud="app",
        token_version=version, client=client, sid=sid,
    )
    refresh = auth_utils.create_refresh_token("usr1", token_version=version, client=client, sid=sid)
    return access, refresh


def _mobile_request(token: str):
    return SimpleNamespace(
        headers={
            "Authorization": f"Bearer {token}",
            "X-Tamkobi-Client": "mobile",
            "x-forwarded-proto": "https",
        },
        cookies={},
        url="https://app.tamkobi.com/api/auth/logout",
        client=SimpleNamespace(host="203.0.113.10"),
    )


def test_issued_tokens_carry_client_and_web_logout_spares_mobile(monkeypatch, caplog):
    import server

    db = _DB()
    asyncio.run(db.users.insert_one(_user()))
    monkeypatch.setattr(server, "db", db)
    access, refresh = _pair("web")
    mobile_access, mobile_refresh = _pair("mobile")
    legacy = auth_utils.create_access_token(
        "usr1", "ada@example.com", "admin", aud="app", client=None,
    )
    access_payload = auth_utils.decode_access_payload(access)
    refresh_payload = auth_utils.decode_access_payload(refresh)
    mobile_payload = auth_utils.decode_access_payload(mobile_access)
    assert access_payload["cli"] == "web" and access_payload["tv"] == 0 and access_payload["sid"]
    assert refresh_payload["cli"] == "web" and refresh_payload["sid"] == access_payload["sid"]
    assert access_payload["jti"] != refresh_payload["jti"]
    assert mobile_payload["cli"] == "mobile" and mobile_payload["sid"] != access_payload["sid"]
    assert "cli" not in auth_utils.decode_access_payload(legacy)

    asyncio.run(db.web_login_qr.insert_one({
        "_id": "qr1",
        "user_id": "usr1",
        "status": "approved",
    }))
    response = Response()
    with caplog.at_level("INFO"):
        body = asyncio.run(server.logout(_request(access, refresh), response))
    assert body["status"] == "success"
    assert access not in str(body)
    assert refresh not in str(body)
    assert mobile_access not in caplog.text
    assert access not in caplog.text
    assert refresh not in caplog.text

    raw = "\n".join(response.headers.getlist("set-cookie"))
    assert "access_token=" in raw
    assert "refresh_token=" in raw
    assert "sa_return=" in raw
    assert "Max-Age=0" in raw
    assert "Secure" in raw
    assert "HttpOnly" in raw
    assert "Domain=" not in raw

    stored = asyncio.run(db.users.find_one({"_id": "usr1"}))
    assert stored["token_versions"]["web"] == 1
    assert int(stored["token_versions"].get("mobile") or 0) == 0
    assert int(stored.get("token_version") or 0) == 0
    with pytest.raises(HTTPException) as denied:
        asyncio.run(auth_utils.get_user_from_token(access, db))
    assert denied.value.status_code == 401
    assert not auth_utils.session_generation_current(refresh_payload, stored)
    mobile_user = asyncio.run(auth_utils.get_user_from_token(mobile_access, db))
    assert mobile_user["email"] == "ada@example.com"
    assert auth_utils.session_generation_current(
        auth_utils.decode_access_payload(mobile_refresh), stored,
    )
    legacy_user = asyncio.run(auth_utils.get_user_from_token(legacy, db))
    assert legacy_user["email"] == "ada@example.com"

    fresh, _fresh_refresh = _pair("web", version=stored["token_versions"]["web"])
    again = asyncio.run(auth_utils.get_user_from_token(fresh, db))
    assert again["email"] == "ada@example.com"
    qr = asyncio.run(db.web_login_qr.find_one({"_id": "qr1"}))
    assert qr["status"] == "revoked"


def test_mobile_logout_spares_web_session(monkeypatch):
    import server

    db = _DB()
    asyncio.run(db.users.insert_one(_user()))
    monkeypatch.setattr(server, "db", db)
    web_access, web_refresh = _pair("web")
    mobile_access, mobile_refresh = _pair("mobile")
    legacy = auth_utils.create_access_token(
        "usr1", "ada@example.com", "admin", aud="app", client=None,
    )
    asyncio.run(db.web_login_qr.insert_one({
        "_id": "qr1",
        "user_id": "usr1",
        "status": "approved",
    }))
    body = asyncio.run(server.logout(_mobile_request(mobile_access), Response()))
    assert body["status"] == "success"
    assert mobile_access not in str(body)

    stored = asyncio.run(db.users.find_one({"_id": "usr1"}))
    assert stored["token_versions"]["mobile"] == 1
    assert int(stored["token_versions"].get("web") or 0) == 0
    with pytest.raises(HTTPException) as denied:
        asyncio.run(auth_utils.get_user_from_token(mobile_access, db))
    assert denied.value.status_code == 401
    assert not auth_utils.session_generation_current(
        auth_utils.decode_access_payload(mobile_refresh), stored,
    )
    web_user = asyncio.run(auth_utils.get_user_from_token(web_access, db))
    assert web_user["email"] == "ada@example.com"
    assert auth_utils.session_generation_current(
        auth_utils.decode_access_payload(web_refresh), stored,
    )
    assert asyncio.run(auth_utils.get_user_from_token(legacy, db))["email"] == "ada@example.com"
    qr = asyncio.run(db.web_login_qr.find_one({"_id": "qr1"}))
    assert qr["status"] == "approved"


def test_legacy_token_dies_only_when_that_session_logs_out(monkeypatch):
    import server

    db = _DB()
    asyncio.run(db.users.insert_one(_user()))
    monkeypatch.setattr(server, "db", db)
    legacy = auth_utils.create_access_token(
        "usr1", "ada@example.com", "admin", aud="app", client=None,
    )
    other = auth_utils.create_access_token(
        "usr1", "ada@example.com", "admin", aud="app", client=None,
    )
    asyncio.run(server.logout(_request(legacy, ""), Response()))
    stored = asyncio.run(db.users.find_one({"_id": "usr1"}))
    assert stored["token_versions"]["web"] == 1
    with pytest.raises(HTTPException):
        asyncio.run(auth_utils.get_user_from_token(legacy, db))
    assert asyncio.run(auth_utils.get_user_from_token(other, db))["email"] == "ada@example.com"


def test_logout_leaves_shopfloor_device_token(monkeypatch):
    import server

    db = _DB()
    asyncio.run(db.users.insert_one(_user()))
    monkeypatch.setattr(server, "db", db)
    device = "co1.device-secret"
    request = SimpleNamespace(
        headers={"Authorization": f"Bearer {device}", "host": "app.tamkobi.com"},
        cookies={},
        url="https://app.tamkobi.com/api/auth/logout",
        client=SimpleNamespace(host="203.0.113.10"),
    )
    asyncio.run(server.logout(request, Response()))
    stored = asyncio.run(db.users.find_one({"_id": "usr1"}))
    assert int(stored.get("token_version") or 0) == 0
    assert int((stored.get("token_versions") or {}).get("web") or 0) == 0
    assert int((stored.get("token_versions") or {}).get("mobile") or 0) == 0


def test_clear_auth_cookies_match_secure_flag():
    https = SimpleNamespace(url="https://app.tamkobi.com/api/auth/logout", headers={})
    http = SimpleNamespace(url="http://127.0.0.1/api/auth/logout", headers={})
    secure = Response()
    plain = Response()
    auth_utils.clear_auth_cookies(secure, https)
    auth_utils.clear_auth_cookies(plain, http)
    secure_raw = "\n".join(secure.headers.getlist("set-cookie"))
    plain_raw = "\n".join(plain.headers.getlist("set-cookie"))
    assert "Secure" in secure_raw
    assert "Secure" not in plain_raw
    assert "Max-Age=0" in plain_raw
