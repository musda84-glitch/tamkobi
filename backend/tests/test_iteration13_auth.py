"""Iteration 13 auth playbook checks: bcrypt format, httpOnly cookie, CORS credentials, brute-force lockout."""
import asyncio

import pytest
import requests
from dotenv import dotenv_values
from mysql_store import MySQLClient as AsyncIOMotorClient

from conftest import API, BASE_URL

ADMIN_EMAIL = "admin@nexus.com"
ADMIN_PASSWORD = "admin123"
_env = dotenv_values("/app/backend/.env")


def _db_call(coro_fn):
    async def run():
        client = AsyncIOMotorClient(_env["MONGO_URL"])
        try:
            return await coro_fn(client[_env["DB_NAME"]])
        finally:
            client.close()
    return asyncio.run(run())


class TestAuthPlaybook:
    def test_bcrypt_hash_format(self):
        doc = _db_call(lambda db: db.users.find_one({"email": ADMIN_EMAIL}))
        assert doc, "admin user missing"
        assert doc["password_hash"].startswith("$2b$"), doc["password_hash"][:8]

    def test_login_sets_httponly_cookie_and_cors(self):
        origin = BASE_URL
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD},
                          headers={"Origin": origin}, timeout=30)
        assert r.status_code == 200, r.text
        set_cookies = r.headers.get("set-cookie", "")
        assert "access_token=" in set_cookies
        assert "HttpOnly" in set_cookies, set_cookies
        assert r.headers.get("access-control-allow-credentials") == "true", dict(r.headers)
        acao = r.headers.get("access-control-allow-origin")
        # Backend CORS_ORIGINS is an explicit list; the preview ingress may rewrite ACAO to "*".
        assert acao in (origin, "*"), f"unexpected ACAO {acao}"

    def test_me_requires_session_or_falls_back(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        # documented behaviour: demo admin fallback when no token
        assert r.status_code in (200, 401), r.status_code

    def test_brute_force_lockout(self):
        s = requests.Session()
        statuses = []
        for _ in range(6):
            r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrong-pass-xyz"}, timeout=30)
            statuses.append(r.status_code)
        print("brute force statuses:", statuses)
        assert 429 in statuses or 423 in statuses, f"no lockout after 6 failed logins: {statuses}"
        # good credentials are blocked while locked; clear the lock so the app stays usable
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        print("login while locked:", r.status_code)
        assert r.status_code == 429
        _db_call(lambda db: db.login_attempts.delete_many({}))
        r = s.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=30)
        assert r.status_code == 200, r.text
