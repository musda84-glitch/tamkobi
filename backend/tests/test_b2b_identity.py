"""B2B kimliği: çoklu tedarikçi, seçim oturumu, lazy migration, brute-force."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

from auth_utils import hash_password, verify_password  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
import b2b_identity  # noqa: E402

PWD = "secret-1"
PWD_B = "secret-b"
HASH = hash_password(PWD)
HASH_B = hash_password(PWD_B)


def _company(cid, name, *, enabled=True, login_method="both", logo=""):
    return {
        "_id": cid,
        "name": name,
        "logo_url": logo,
        "b2b_settings": {"enabled": enabled, "login_method": login_method},
    }


def _contact(cid, company_id, name, *, email="ali@example.com", login_email="ali@example.com",
             enabled=True, password_hash=HASH, token="portal-secret", tax="", balance=424242,
             active=True, price="PRICE-SECRET"):
    return {
        "_id": cid,
        "company_id": company_id,
        "name": name,
        "email": email,
        "b2b_login_email": login_email,
        "b2b_enabled": enabled,
        "b2b_password_hash": password_hash,
        "b2b_token": token,
        "tax_number_or_id": tax,
        "balance": balance,
        "sale_price": price,
        "is_active": active,
    }


@pytest.fixture
def db():
    mem = MemDB()
    mem.companies.docs.extend([
        _company("coA", "Firma A", logo="/logo-a.png"),
        _company("coB", "Firma B", logo="/logo-b.png"),
        _company("coOff", "Firma Kapalı"),
        _company("coLink", "Firma Link", login_method="link"),
        _company("coC", "Firma C"),
    ])
    mem.contacts.docs.extend([
        _contact("cA", "coA", "Cari A", token="portal-secret-a", tax="1111111111"),
        _contact("cB", "coB", "Cari B", token="portal-secret-b", tax="2222222222"),
        _contact("cOff", "coOff", "Cari Kapalı", enabled=False, token="portal-secret-off"),
        _contact("cLink", "coLink", "Cari Link", token="portal-secret-link"),
        _contact("cMail", "coC", "Cari Mail", login_email="", email="ali@example.com", token="portal-secret-mail", tax="3333333333"),
        _contact("cVkn", "coC", "Cari VKN", login_email="", email="baska@example.com", token="portal-secret-vkn", tax="1111111111"),
    ])
    b2b_identity.init(mem)
    b2b_identity.set_mailer(lambda **_k: False)
    yield mem
    b2b_identity.init(None)
    b2b_identity.set_mailer(None)


@pytest.fixture
def client(db):
    app = FastAPI()
    app.include_router(b2b_identity.router)
    return TestClient(app)


def _login(client, email="ali@example.com", password=PWD):
    return client.post("/api/public/b2b/login", json={"email": email, "password": password})


def _names(body):
    return {row["company_name"] for row in body["suppliers"]}


def test_two_suppliers_hide_closed_link_email_and_vkn_only(client):
    res = _login(client)
    assert res.status_code == 200, res.text
    body = res.json()
    assert _names(body) == {"Firma A", "Firma B"}
    assert "redirect" not in body
    assert "token" not in body
    text = res.text
    for secret in (
        "portal-secret-a", "portal-secret-b", "portal-secret-off", "portal-secret-link",
        "portal-secret-mail", "portal-secret-vkn", "PRICE-SECRET", "424242", "b2b_password_hash",
        HASH, HASH_B,
    ):
        assert secret not in text
    row = body["suppliers"][0]
    assert set(row) == {"contact_id", "company_id", "company_name", "logo_url", "contact_name"}
    assert row["logo_url"] in ("/logo-a.png", "/logo-b.png")


def test_select_supplier_rejects_foreign_and_expired_and_hides_other_token(client, db):
    res = _login(client)
    token = res.json()["select_token"]
    denied = client.post("/api/public/b2b/select-supplier", json={"select_token": token, "contact_id": "missing"})
    assert denied.status_code == 403

    other = client.post("/api/public/b2b/login", json={"email": "veli@example.com", "password": "nope"})
    assert other.status_code == 401
    db.contacts.docs.append(_contact(
        "cOther", "coC", "Başka", login_email="veli@example.com", email="veli@example.com",
        password_hash=hash_password("other-pass"), token="portal-secret-other",
    ))
    other_login = client.post("/api/public/b2b/login", json={"email": "veli@example.com", "password": "other-pass"})
    assert other_login.status_code == 200, other_login.text
    foreign = client.post("/api/public/b2b/select-supplier", json={
        "select_token": other_login.json()["select_token"],
        "contact_id": "cA",
    })
    assert foreign.status_code == 403

    picked = client.post("/api/public/b2b/select-supplier", json={"select_token": token, "contact_id": "cA"})
    assert picked.status_code == 200, picked.text
    assert picked.json()["redirect"] == "/portal/portal-secret-a"
    assert "portal-secret-b" not in picked.text
    assert "PRICE-SECRET" not in picked.text
    assert HASH not in picked.text

    raw = res.json()["select_token"]
    assert raw not in {row["_id"] for row in db.b2b_sessions.docs}
    assert b2b_identity._sha256(raw) in {row["_id"] for row in db.b2b_sessions.docs}
    past = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
    expired_raw = "expired-session"
    db.b2b_sessions.docs.append({
        "_id": b2b_identity._sha256(expired_raw),
        "identity_id": "none",
        "email": "ali@example.com",
        "expires_at": past,
        "created_at": past,
        "contact_ids": ["cA"],
    })
    expired = client.post("/api/public/b2b/select-supplier", json={
        "select_token": expired_raw, "contact_id": "cA",
    })
    assert expired.status_code == 401


def test_login_without_identity_does_not_seed_other_password(client, db):
    for row in db.contacts.docs:
        if row["_id"] == "cB":
            row["b2b_password_hash"] = HASH_B
    first = _login(client)
    assert first.status_code == 200, first.text
    assert _names(first.json()) == {"Firma A"}
    assert db.b2b_identities.docs == []
    second = _login(client, password=PWD_B)
    assert second.status_code == 200, second.text
    assert _names(second.json()) == {"Firma B"}
    assert db.b2b_identities.docs == []
    assert next(row["b2b_password_hash"] for row in db.contacts.docs if row["_id"] == "cA") == HASH


def test_brute_force_locks_on_the_attempt_after_five(client, db):
    for _ in range(5):
        res = _login(client, email="yok@example.com", password="wrong")
        assert res.status_code == 401
        assert res.json()["detail"] == b2b_identity._FAIL
    locked = _login(client, email="yok@example.com", password="wrong")
    assert locked.status_code == 429
    past = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
    digest = b2b_identity._sha256("yok@example.com")
    touched = [row for row in db.login_attempts.docs if digest in row["identifier"]]
    assert len(touched) >= 2
    assert any(row["identifier"].startswith("b2b:acct:") for row in touched)
    assert any(row["identifier"].startswith("b2b:ip:") for row in touched)
    assert "yok@example.com" not in "".join(row["identifier"] for row in db.login_attempts.docs)
    for row in touched:
        row["last_attempt"] = past
    again = _login(client, email="yok@example.com", password="wrong")
    assert again.status_code == 401


def test_single_supplier_keeps_redirect(client, db):
    db.contacts.docs.clear()
    db.contacts.docs.append(_contact("only", "coA", "Tek Cari", login_email="tek@example.com", token="portal-secret-only"))
    res = client.post("/api/public/b2b/login", json={"email": "tek@example.com", "password": PWD})
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["redirect"] == "/portal/portal-secret-only"
    assert body["token"] == "portal-secret-only"
    assert body["name"] == "Tek Cari"
    assert len(body["suppliers"]) == 1


def test_vkn_requires_single_existing_identity(client, db):
    missing = client.post("/api/public/b2b/login", json={"email": "1111111111", "password": PWD})
    assert missing.status_code == 401
    scans = []
    original = db.companies.find

    def _find(query=None, *args, **kwargs):
        scans.append(query)
        return original(query, *args, **kwargs)

    db.companies.find = _find
    db.b2b_identities.docs.append({
        "_id": "id-ali",
        "email": "ali@example.com",
        "password_hash": HASH,
        "email_verified_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    })
    by_tax = client.post("/api/public/b2b/login", json={"email": "1111111111", "password": PWD})
    assert by_tax.status_code == 200, by_tax.text
    assert _names(by_tax.json()) == {"Firma A", "Firma B"}
    assert "portal-secret-vkn" not in by_tax.text
    assert scans == []

    db.b2b_identities.docs.append({
        "_id": "id-other",
        "email": "diger@example.com",
        "password_hash": HASH,
        "email_verified_at": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    })
    db.contacts.docs.append(_contact(
        "cSplit", "coOff", "Bölünmüş", login_email="diger@example.com",
        password_hash=HASH, tax="1111111111", token="portal-secret-split",
    ))
    # coOff portalı açık; ikinci kimlik aynı VKN'ye bağlanır.
    db.companies.docs[2]["b2b_settings"]["enabled"] = True
    split = client.post("/api/public/b2b/login", json={"email": "1111111111", "password": PWD})
    assert split.status_code == 401


def test_verified_identity_lists_link_only_after_accept(client, db):
    for row in db.contacts.docs:
        if row["_id"] == "cB":
            row["b2b_password_hash"] = HASH_B
            row["name"] = "<b>Cari B</b>"
    db.companies.docs[1]["name"] = "<script>Firma B</script>"
    db.b2b_identities.docs.append({
        "_id": "id-ali",
        "email": "ali@example.com",
        "password_hash": HASH,
        "email_verified_at": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    })
    res = _login(client)
    assert res.status_code == 200, res.text
    assert _names(res.json()) == {"Firma A"}
    token = res.json()["select_token"]
    hidden = client.post("/api/public/b2b/select-supplier", json={"select_token": token, "contact_id": "cB"})
    assert hidden.status_code == 403
    notice = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_link_notice")
    assert notice["status"] == "pending"
    assert "<script>" not in notice["html"]
    assert "<b>" not in notice["html"]
    assert "&lt;script&gt;" in notice["html"]
    assert "&lt;b&gt;" in notice["html"]
    import re
    accept_token = re.search(r"accept-link/([A-Za-z0-9_\-]+)", notice["html"]).group(1)
    accepted = client.get(f"/api/public/b2b/accept-link/{accept_token}")
    assert accepted.status_code == 200, accepted.text
    stored = next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB")
    assert stored["accepted_at"]
    still = client.get("/api/public/b2b/suppliers", headers={"Authorization": f"B2bSession {token}"})
    assert _names(still.json()) == {"Firma A"}
    started = client.post(
        "/api/public/b2b/verify-email/start",
        headers={"Authorization": f"B2bSession {token}"},
    )
    assert started.status_code == 200, started.text
    assert "ali@example.com" not in started.text or "gönderildi" in started.text
    verify_row = db.b2b_email_verifications.docs[-1]
    assert verify_row["_id"] not in started.text
    queued = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_verify_email")
    assert queued["status"] == "pending"
    confirmed = client.get(f"/api/public/b2b/verify-email/{verify_row['_id']}")
    assert confirmed.status_code == 200, confirmed.text
    listed = client.get("/api/public/b2b/suppliers", headers={"Authorization": f"B2bSession {token}"})
    assert listed.status_code == 200, listed.text
    assert _names(listed.json()) == {"Firma A", "<script>Firma B</script>"}
    chosen = client.post("/api/public/b2b/select-supplier", json={"select_token": token, "contact_id": "cB"})
    assert chosen.status_code == 200, chosen.text
    assert chosen.json()["redirect"] == "/portal/portal-secret-b"
    assert "portal-secret-a" not in chosen.text


def test_reset_updates_identity_and_keeps_contact_hash(db):
    contact = next(row for row in db.contacts.docs if row["_id"] == "cA")
    before = contact["b2b_password_hash"]

    async def run():
        return await b2b_identity.apply_password_reset(db, contact, "yeni-sifre")

    import asyncio
    db.b2b_sessions.docs.append({
        "_id": "sess-old",
        "identity_id": "old",
        "email": "ali@example.com",
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "contact_ids": ["cA"],
    })
    identity = asyncio.run(run())
    assert all(row.get("email") != "ali@example.com" for row in db.b2b_sessions.docs)
    assert contact["b2b_password_hash"] == before
    assert identity["email_verified_at"]
    assert verify_password("yeni-sifre", identity["password_hash"])
    assert not verify_password("yeni-sifre", contact["b2b_password_hash"])

    async def check(current, new_plain):
        return await b2b_identity.portal_current_password_error(db, contact, current, new_plain)

    assert asyncio.run(check("yeni-sifre", "baska-sifre")) is None
    assert asyncio.run(check("yanlis", "baska-sifre")) == "Mevcut şifre hatalı."
    assert asyncio.run(check("yeni-sifre", "yeni-sifre")) == "Yeni şifre mevcut şifreyle aynı olamaz."


def test_link_notice_queues_once_without_smtp(db, monkeypatch):
    import mail_service
    db.b2b_identities.docs.append({
        "_id": "id-ali",
        "email": "ali@example.com",
        "password_hash": HASH,
        "email_verified_at": None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    })

    def boom(*_a, **_k):
        raise AssertionError("smtp")

    monkeypatch.setattr(mail_service, "send_mail", boom)
    contact = next(row for row in db.contacts.docs if row["_id"] == "cB")
    contact["name"] = "<i>Cari</i>"
    upd = {"b2b_login_email": "ali@example.com", "b2b_enabled": True}

    async def run():
        await b2b_identity.consider_link_notice(db, contact, {**contact, **upd}, upd)

    import asyncio
    asyncio.run(run())
    assert upd["b2b_link_notified_email"] == "ali@example.com"
    notes = [row for row in db.notify_outbox.docs if row.get("event") == "b2b_link_notice"]
    assert len(notes) == 1
    assert notes[0]["status"] == "pending"
    assert notes[0]["to"] == ["ali@example.com"]
    assert "<i>" not in notes[0]["html"]
    assert "secret" not in notes[0]["text"]
    asyncio.run(run())
    assert len([row for row in db.notify_outbox.docs if row.get("event") == "b2b_link_notice"]) == 1


def test_inactive_contact_keeps_403(client, db):
    db.contacts.docs.clear()
    db.contacts.docs.append(_contact("pasif", "coA", "Pasif", login_email="pasif@example.com", active=False))
    res = client.post("/api/public/b2b/login", json={"email": "pasif@example.com", "password": PWD})
    assert res.status_code == 403
    assert res.json()["detail"] == "Cari hesap pasif. B2B girişi kapalı."


def test_link_method_keeps_403(client, db):
    db.contacts.docs.clear()
    db.contacts.docs.append(_contact("lnk", "coLink", "Link", login_email="link@example.com"))
    res = client.post("/api/public/b2b/login", json={"email": "link@example.com", "password": PWD})
    assert res.status_code == 403
    assert "kişiye özel link" in res.json()["detail"]


def test_supplier_write_does_not_change_identity_password(client, db):
    from pathlib import Path
    src = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    for name in ("update_contact", "contact_b2b_access", "put_contact_b2b_portal"):
        start = src.index(f"async def {name}(")
        end = src.index("\nasync def ", start + 10)
        body = src[start:end]
        assert "sync_identity_password" not in body
        assert "change_own_password" not in body
        assert "b2b_identities" not in body
    db.b2b_identities.docs.append({
        "_id": "id-ali",
        "email": "ali@example.com",
        "password_hash": HASH,
        "email_verified_at": datetime.now(timezone.utc).isoformat(),
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    })
    import asyncio
    contact = next(row for row in db.contacts.docs if row["_id"] == "cA")
    asyncio.run(b2b_identity._mark_accepted(db, "ali@example.com", contact))
    contact["b2b_password_hash"] = HASH_B
    kept = _login(client)
    assert kept.status_code == 200, kept.text
    assert db.b2b_identities.docs[0]["password_hash"] == HASH
    stolen = _login(client, password=PWD_B)
    assert stolen.status_code == 401


def test_account_lock_and_duplicate_key_and_403_keeps_counter(client, db):
    from mysql_store import DuplicateKeyError
    now = datetime.now(timezone.utc).isoformat()
    acct = b2b_identity._acct_lock_id("kilit@example.com")
    db.login_attempts.docs.append({"_id": acct, "identifier": acct, "count": 5, "last_attempt": now})
    locked = _login(client, email="kilit@example.com", password="wrong")
    assert locked.status_code == 429
    db.contacts.docs.clear()
    db.contacts.docs.append(_contact("pasif", "coA", "Pasif", login_email="pasif@example.com", active=False))
    db.login_attempts.docs.clear()
    for _ in range(2):
        bad = client.post("/api/public/b2b/login", json={"email": "pasif@example.com", "password": "wrong"})
        assert bad.status_code == 401
    acct_pasif = b2b_identity._acct_lock_id("pasif@example.com")
    before = next(row["count"] for row in db.login_attempts.docs if row["identifier"] == acct_pasif)
    blocked = client.post("/api/public/b2b/login", json={"email": "pasif@example.com", "password": PWD})
    assert blocked.status_code == 403
    after = next(row["count"] for row in db.login_attempts.docs if row["identifier"] == acct_pasif)
    assert after == before == 2

    async def boom(*_a, **_k):
        raise DuplicateKeyError("dup")

    db.login_attempts.update_one = boom
    dup = client.post("/api/public/b2b/login", json={"email": "yok@example.com", "password": "wrong"})
    assert dup.status_code == 401


def test_legacy_email_login_and_reset_queue(db, client, monkeypatch):
    import asyncio
    import mail_service
    db.companies.docs[4]["name"] = "<script>Firma</script>"
    db.contacts.docs.append(_contact(
        "cLeg", "coC", "<b>Eski</b>", login_email="", email="Eski@Example.com", token="portal-secret-legacy",
    ))

    def boom(*_a, **_k):
        raise AssertionError("smtp")

    monkeypatch.setattr(mail_service, "send_mail", boom)
    res = client.post("/api/public/b2b/login", json={"email": "eski@example.com", "password": PWD})
    assert res.status_code == 200, res.text
    assert res.json()["redirect"] == "/portal/portal-secret-legacy"
    assert db.b2b_identities.docs == []

    async def run():
        contact = await b2b_identity.find_legacy_contact(db, "eski@example.com")
        assert contact["_id"] == "cLeg"
        return await b2b_identity.finish_b2b_forgot(
            db, "eski@example.com", None, {"ok": True},
            {"status": "ok", "message": "x", "channel": "email"}, contact,
        )

    out = asyncio.run(run())
    assert out["status"] == "ok"
    queued = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_password_reset")
    assert queued["status"] == "pending"
    assert queued["to"] == ["eski@example.com"]
    assert "<script>" not in queued["html"]
    assert "<b>" not in queued["html"]
    assert "&lt;script&gt;" in queued["html"]
    assert "&lt;b&gt;" in queued["html"]


def test_unknown_login_uses_dummy_bcrypt_and_hides_ident(client, monkeypatch):
    import applog
    seen = []
    real = b2b_identity.verify_password

    def wrapped(plain, hashed):
        seen.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(b2b_identity, "verify_password", wrapped)
    logged = []

    def capture(event, message="", **fields):
        logged.append((event, message, fields))

    monkeypatch.setattr(b2b_identity.applog, "log_auth", capture)
    unknown = _login(client, email="yok@example.com", password="wrong")
    assert unknown.status_code == 401
    assert b2b_identity._DUMMY_HASH in seen
    tax = client.post("/api/public/b2b/login", json={"email": "9999999999", "password": PWD})
    assert tax.status_code == 401
    blob = str(logged)
    assert "yok@example.com" not in blob
    assert "9999999999" not in blob
    assert "b2b:email:" in blob
    assert "b2b:tax:" in blob
    _ = applog


def test_removed_b2b_tenant_keys_are_gone():
    import tenant_scope_allowlist as allowlist
    removed = (
        ("server.py", "_b2b_find_contact", "contacts", "find_one"),
        ("server.py", "b2b_login", "contacts", "find_one"),
        ("server.py", "b2b_login", "contacts", "update_one"),
        ("server.py", "b2b_reset_get", "contacts", "find_one"),
        ("server.py", "b2b_reset_post", "contacts", "find_one"),
        ("server.py", "b2b_reset_post", "contacts", "update_one"),
        ("server.py", "contact_b2b_access", "contacts", "find_one"),
        ("server.py", "contact_b2b_access", "contacts", "update_one"),
        ("server.py", "put_contact_b2b_portal", "contacts", "find_one"),
        ("server.py", "put_contact_b2b_portal", "contacts", "update_one"),
    )
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in removed if key in base]
    assert present == []
