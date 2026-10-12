"""Gerçek HTTP: süper admin 2FA kurtarma kodu (MariaDB mysql_store).

Çalışan API gerekir. Seed SA hesabına dokunmaz — geçici SA kullanıcı oluşturur.
API yoksa fail (sessiz skip yok).
"""
from __future__ import annotations

import asyncio
import os
import sys
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path

import pyotp
import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE = (os.environ.get("REACT_APP_BACKEND_URL") or "http://127.0.0.1:8000").rstrip("/")
API = BASE + "/api"


def _api_up() -> bool:
    try:
        r = requests.get(f"{API}/version", timeout=5)
        return r.status_code == 200
    except Exception:
        return False


def _require_api():
    if not _api_up():
        pytest.fail(f"API ayakta değil: {API}/version (REACT_APP_BACKEND_URL={BASE})")


def _db_client():
    from dotenv import load_dotenv
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")
    try:
        from setup_state import apply_saved_secrets
        apply_saved_secrets()
    except Exception:
        pass
    from mysql_store import MySQLClient, mysql_settings_from_env
    client = MySQLClient()
    db_name = str(mysql_settings_from_env().get("db") or "tamkobi").strip()
    return client, client[db_name]


async def _create_temp_sa(email: str, password: str) -> str:
    from auth_utils import hash_password
    client, db = _db_client()
    try:
        await db._ensure()
        uid = f"usr_2fa_{uuid.uuid4().hex[:10]}"
        now = datetime.now(timezone.utc).isoformat()
        await db.users.insert_one({
            "_id": uid,
            "email": email,
            "password_hash": hash_password(password),
            "name": "2FA HTTP Test SA",
            "role": "admin",
            "is_super_admin": True,
            "is_active": True,
            "company_ids": [],
            "active_company_id": "",
            "preferences": {},
            "totp_enabled": False,
            "totp_secret": "",
            "totp_recovery_hashes": [],
            "created_at": now,
        })
        return uid
    finally:
        try:
            await client.close_async()
        except Exception:
            client.close()


async def _delete_temp_sa(uid: str, email: str):
    client, db = _db_client()
    try:
        await db._ensure()
        await db.users.delete_one({"_id": uid})
        await db.login_attempts.delete_one({"identifier": f"2fa:{uid}"})
        # şifre kilidi kayıtları
        async for doc in db.login_attempts.find({}):
            ident = str(doc.get("identifier") or "")
            if email in ident:
                await db.login_attempts.delete_one({"_id": doc["_id"]})
    finally:
        try:
            await client.close_async()
        except Exception:
            client.close()


def _login_password(email: str, password: str) -> tuple[requests.Session, dict]:
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json={"email": email, "password": password, "remember": False}, timeout=20)
    assert r.status_code == 200, r.text
    return s, r.json()


def _enable_2fa(session: requests.Session) -> list[str]:
    r = session.post(f"{API}/auth/2fa/setup/start", timeout=20)
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    code = pyotp.TOTP(secret).now()
    r2 = session.post(f"{API}/auth/2fa/setup/confirm", json={"code": code}, timeout=20)
    assert r2.status_code == 200, r2.text
    codes = r2.json().get("recovery_codes") or []
    assert len(codes) == 10
    return codes


def _pending_login(email: str, password: str) -> str:
    r = requests.post(
        f"{API}/auth/login",
        json={"email": email, "password": password, "remember": False},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("requires_2fa") is True, body
    assert body.get("pending_token")
    return body["pending_token"]


@pytest.fixture
def temp_sa():
    _require_api()
    email = f"2fa_http_{uuid.uuid4().hex[:8]}@tamkobi.test"
    password = "2fa-Http-Test-1"
    uid = asyncio.run(_create_temp_sa(email, password))
    try:
        yield email, password, uid
    finally:
        try:
            asyncio.run(_delete_temp_sa(uid, email))
        except Exception:
            pass


def test_recovery_code_works_on_live_mysql(temp_sa):
    email, password, _uid = temp_sa
    s, body = _login_password(email, password)
    assert not body.get("requires_2fa")
    assert body.get("user", {}).get("is_super_admin")
    codes = _enable_2fa(s)
    s.post(f"{API}/auth/logout", timeout=10)

    pending = _pending_login(email, password)
    r = requests.post(
        f"{API}/auth/2fa/verify",
        json={"pending_token": pending, "code": codes[0]},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    assert r.json().get("token")
    assert r.json().get("user", {}).get("is_super_admin")

    st = requests.get(f"{API}/auth/2fa/status", cookies=r.cookies, timeout=15)
    assert st.status_code == 200, st.text
    assert st.json().get("recovery_codes_remaining") == 9

    requests.post(f"{API}/auth/logout", cookies=r.cookies, timeout=10)

    pending2 = _pending_login(email, password)
    r2 = requests.post(
        f"{API}/auth/2fa/verify",
        json={"pending_token": pending2, "code": codes[0]},
        timeout=20,
    )
    assert r2.status_code == 401, r2.text


def test_concurrent_same_recovery_exactly_one_success(temp_sa):
    email, password, _uid = temp_sa
    s, _ = _login_password(email, password)
    codes = _enable_2fa(s)
    s.post(f"{API}/auth/logout", timeout=10)

    pending = _pending_login(email, password)
    code = codes[0]

    def one():
        return requests.post(
            f"{API}/auth/2fa/verify",
            json={"pending_token": pending, "code": code},
            timeout=30,
        )

    statuses = []
    with ThreadPoolExecutor(max_workers=6) as pool:
        futs = [pool.submit(one) for _ in range(6)]
        for f in as_completed(futs):
            statuses.append(f.result().status_code)

    assert statuses.count(200) == 1, statuses
    assert all(x in (200, 401) for x in statuses), statuses
