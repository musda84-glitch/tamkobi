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
    # Eski cari (giriş e-postası boş, şifre cari üzerinde) kimlik olmadan VKN ile girer.
    missing = client.post("/api/public/b2b/login", json={"email": "1111111111", "password": PWD})
    assert missing.status_code == 200, missing.text
    assert _names(missing.json()) == {"Firma C"}
    assert missing.json()["redirect"] == "/portal/portal-secret-vkn"
    assert "portal-secret-a" not in missing.text
    assert "PRICE-SECRET" not in missing.text
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
    assert _names(by_tax.json()) == {"Firma A", "Firma B", "Firma C"}
    assert "portal-secret-vkn" not in by_tax.text
    assert "redirect" not in by_tax.json()
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
    # coOff portalı açık; ikinci kimlik aynı VKN'de seçim listesine girer, reddedilmez.
    db.companies.docs[2]["b2b_settings"]["enabled"] = True
    split = client.post("/api/public/b2b/login", json={"email": "1111111111", "password": PWD})
    assert split.status_code == 200, split.text
    assert {"Firma A", "Firma Kapalı", "Firma C"} <= _names(split.json())
    assert "portal-secret-split" not in split.text
    assert "PRICE-SECRET" not in split.text
    assert "redirect" not in split.json()


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
    assert notice["subject"] == b2b_identity._NOTICE_SUBJECT
    assert "<script>" not in notice["subject"]
    assert "Firma" not in notice["subject"]
    import re
    accept_token = re.search(r"accept-link/([A-Za-z0-9_\-]+)", notice["html"]).group(1)
    preview = client.get(f"/api/public/b2b/accept-link/{accept_token}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "pending"
    stored = next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB")
    assert not stored.get("accepted_at")
    accepted = client.post(f"/api/public/b2b/accept-link/{accept_token}")
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
    verify_mail = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_verify_email")
    verify_token = re.search(r"verify-email/([A-Za-z0-9_\-]+)", verify_mail["html"]).group(1)
    verify_row = db.b2b_email_verifications.docs[-1]
    assert verify_row["_id"] == b2b_identity.token_digest(verify_token)
    assert verify_row["_id"] != verify_token
    assert verify_token not in str(verify_row)
    queued = verify_mail
    assert queued["status"] == "pending"
    preview_mail = client.get(f"/api/public/b2b/verify-email/{verify_token}")
    assert preview_mail.status_code == 200, preview_mail.text
    assert preview_mail.json()["status"] == "pending"
    assert db.b2b_identities.docs[0]["email_verified_at"] is None
    confirmed = client.post(f"/api/public/b2b/verify-email/{verify_token}")
    assert confirmed.status_code == 200, confirmed.text
    again_mail = client.post(f"/api/public/b2b/verify-email/{verify_token}")
    assert again_mail.status_code == 400
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
    assert notes[0]["subject"] == b2b_identity._NOTICE_SUBJECT
    assert "Firma B" not in notes[0]["subject"]
    assert "<i>" not in notes[0]["html"]
    assert "&lt;i&gt;" in notes[0]["html"]
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
    import re
    raw = re.search(r"/b2b/sifre/([A-Za-z0-9_\-]+)", queued["html"]).group(1)
    stored = db.b2b_password_resets.docs[-1]
    assert stored["_id"] == b2b_identity.token_digest(raw)
    assert stored["_id"] != raw
    assert raw not in str(stored)


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


def _identity_row(password_hash=HASH, verified=None):
    return {
        "_id": "id-ali",
        "email": "ali@example.com",
        "password_hash": password_hash,
        "email_verified_at": verified,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    }


async def _portal_change(db, contact_id, current, new_plain):
    contact = next(row for row in db.contacts.docs if row["_id"] == contact_id)
    blocked = await b2b_identity.portal_current_password_error(db, contact, current, new_plain)
    if blocked:
        return blocked
    new_hash = hash_password(new_plain)
    await db.contacts.update_one(
        {"_id": contact_id},
        {"$set": {"b2b_password_hash": new_hash}},
    )
    fresh = next(row for row in db.contacts.docs if row["_id"] == contact_id)
    return await b2b_identity.change_own_password(db, fresh, new_hash, current_plain=current)


def test_change_password_cannot_take_over_identity(db, monkeypatch):
    """Tedarikçi kurban e-postasını ve kendi cari şifresini koyup portal şifresini değiştirince kimlik durur."""
    import asyncio
    from pathlib import Path
    src = Path(__file__).resolve().parents[1].joinpath("server.py").read_text(encoding="utf-8")
    start = src.index("async def b2b_change_password")
    end = src.index("\ndef _decorate_b2b_held_order", start)
    body = src[start:end]
    assert "current_plain=current" in body
    assert "_mark_accepted" not in body
    reset_src = src[src.index("async def _b2b_reset_doc"):src.index("\ndef _alias_key")]
    assert "token_digest" in reset_src
    assert '{"_id": token}' not in reset_src

    db.b2b_identities.docs.append(_identity_row())
    victim = next(row for row in db.contacts.docs if row["_id"] == "cB")
    victim["b2b_password_hash"] = HASH_B
    db.b2b_sessions.docs.append({
        "_id": "sess-victim",
        "identity_id": "id-ali",
        "email": "ali@example.com",
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "contact_ids": ["cA"],
    })
    marked = []

    async def spy(*_a, **_k):
        marked.append(True)

    monkeypatch.setattr(b2b_identity, "_mark_accepted", spy)
    result = asyncio.run(_portal_change(db, "cB", PWD_B, "ele-gecir-9"))
    assert result is None or result.get("password_hash") == HASH
    identity = db.b2b_identities.docs[0]
    assert identity["password_hash"] == HASH
    assert verify_password(PWD, identity["password_hash"])
    assert not verify_password("ele-gecir-9", identity["password_hash"])
    fresh = next(row for row in db.contacts.docs if row["_id"] == "cB")
    assert verify_password("ele-gecir-9", fresh["b2b_password_hash"])
    assert marked == []
    assert db.b2b_sessions.docs
    assert not any(row.get("accepted_at") for row in db.b2b_link_acceptances.docs)

    monkeypatch.undo()
    db.b2b_identities.docs[0]["password_hash"] = ""
    fresh = next(row for row in db.contacts.docs if row["_id"] == "cB")
    fresh["b2b_password_hash"] = HASH_B
    asyncio.run(b2b_identity._mark_accepted(db, "ali@example.com", fresh))
    assert any(row.get("accepted_at") and row.get("contact_id") == "cB" for row in db.b2b_link_acceptances.docs)
    monkeypatch.setattr(b2b_identity, "_mark_accepted", spy)
    marked.clear()
    asyncio.run(_portal_change(db, "cB", PWD_B, "ele-gecir-8"))
    assert db.b2b_identities.docs[0]["password_hash"] == ""
    assert marked == []

    db.b2b_identities.docs.clear()
    db.b2b_link_acceptances.docs.clear()
    marked.clear()
    lone = next(row for row in db.contacts.docs if row["_id"] == "cA")
    lone["b2b_password_hash"] = HASH
    asyncio.run(_portal_change(db, "cA", PWD, "yeni-cari-1"))
    assert db.b2b_identities.docs == []
    assert marked == []
    assert not any(row.get("accepted_at") for row in db.b2b_link_acceptances.docs)

    monkeypatch.undo()
    db.b2b_identities.docs.append(_identity_row())
    db.b2b_sessions.docs.append({
        "_id": "sess-ok",
        "identity_id": "id-ali",
        "email": "ali@example.com",
        "expires_at": datetime.now(timezone.utc).isoformat(),
        "contact_ids": ["cA"],
    })
    asyncio.run(_portal_change(db, "cA", PWD, "yeni-kimlik-1"))
    assert verify_password("yeni-kimlik-1", db.b2b_identities.docs[0]["password_hash"])
    assert all(row.get("email") != "ali@example.com" for row in db.b2b_sessions.docs)
    assert any(row.get("accepted_at") and row.get("contact_id") == "cA" for row in db.b2b_link_acceptances.docs)


def test_supplier_contact_password_does_not_accept_link(client, db, monkeypatch):
    """Tedarikçi kurban e-postasına kendi şifresini koyup girince bağ kabul edilmez."""
    import re
    db.b2b_identities.docs.append(_identity_row())
    for row in db.contacts.docs:
        if row["_id"] == "cB":
            row["b2b_password_hash"] = HASH_B
    marked = []

    async def spy(*_a, **_k):
        marked.append(True)

    monkeypatch.setattr(b2b_identity, "_mark_accepted", spy)
    stolen = _login(client, password=PWD_B)
    assert stolen.status_code == 200, stolen.text
    assert _names(stolen.json()) == {"Firma B"}
    assert marked == []
    stolen_token = stolen.json()["select_token"]
    monkeypatch.undo()
    assert not any(
        row.get("contact_id") == "cB" and row.get("accepted_at") for row in db.b2b_link_acceptances.docs
    )

    victim = _login(client)
    assert victim.status_code == 200, victim.text
    assert _names(victim.json()) == {"Firma A"}
    token = victim.json()["select_token"]
    started = client.post(
        "/api/public/b2b/verify-email/start",
        headers={"Authorization": f"B2bSession {token}"},
    )
    assert started.status_code == 200, started.text
    mail = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_verify_email")
    raw = re.search(r"verify-email/([A-Za-z0-9_\-]+)", mail["html"]).group(1)
    preview = client.get(f"/api/public/b2b/verify-email/{raw}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "pending"
    assert db.b2b_identities.docs[0]["email_verified_at"] is None
    confirmed = client.post(f"/api/public/b2b/verify-email/{raw}")
    assert confirmed.status_code == 200, confirmed.text

    again = _login(client)
    assert again.status_code == 200, again.text
    assert _names(again.json()) == {"Firma A"}
    held = client.get("/api/public/b2b/suppliers", headers={"Authorization": f"B2bSession {stolen_token}"})
    assert held.status_code == 200, held.text
    assert "Firma A" not in _names(held.json())
    assert not any(
        row.get("contact_id") == "cB" and row.get("accepted_at") for row in db.b2b_link_acceptances.docs
    )


def test_contact_password_session_cannot_elevate_into_identity(client, db):
    """B'nin cari şifresiyle açtığı oturum kurbanın kimliğine bağlanmaz."""
    import re
    db.b2b_identities.docs.append(_identity_row())
    for row in db.contacts.docs:
        if row["_id"] == "cB":
            row["b2b_password_hash"] = HASH_B
    stolen = _login(client, password=PWD_B)
    assert stolen.status_code == 200, stolen.text
    assert _names(stolen.json()) == {"Firma B"}
    stolen_token = stolen.json()["select_token"]
    session = next(row for row in db.b2b_sessions.docs if row["_id"] == b2b_identity._sha256(stolen_token))
    assert not session.get("identity_id")
    assert session.get("contact_ids") == ["cB"]
    blocked = client.post(
        "/api/public/b2b/verify-email/start",
        headers={"Authorization": f"B2bSession {stolen_token}"},
    )
    assert blocked.status_code == 403, blocked.text
    assert not any(row.get("event") == "b2b_verify_email" for row in db.notify_outbox.docs)

    victim = _login(client)
    assert victim.status_code == 200, victim.text
    assert _names(victim.json()) == {"Firma A"}
    started = client.post(
        "/api/public/b2b/verify-email/start",
        headers={"Authorization": f"B2bSession {victim.json()['select_token']}"},
    )
    assert started.status_code == 200, started.text
    mail = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_verify_email")
    raw = re.search(r"verify-email/([A-Za-z0-9_\-]+)", mail["html"]).group(1)
    confirmed = client.post(f"/api/public/b2b/verify-email/{raw}")
    assert confirmed.status_code == 200, confirmed.text
    assert db.b2b_identities.docs[0]["email_verified_at"]

    held = client.get("/api/public/b2b/suppliers", headers={"Authorization": f"B2bSession {stolen_token}"})
    assert held.status_code == 200, held.text
    assert _names(held.json()) == {"Firma B"}
    foreign = client.post(
        "/api/public/b2b/select-supplier",
        json={"select_token": stolen_token, "contact_id": "cA"},
    )
    assert foreign.status_code == 403
    own = client.post(
        "/api/public/b2b/select-supplier",
        json={"select_token": stolen_token, "contact_id": "cB"},
    )
    assert own.status_code == 200, own.text
    assert own.json()["redirect"] == "/portal/portal-secret-b"


def test_accept_link_post_is_atomic_and_expires(client, db):
    import asyncio
    import re
    from pathlib import Path
    src = Path(b2b_identity.__file__).read_text(encoding="utf-8")
    body = src[src.index("async def accept_supplier_link"):src.index("async def start_email_verification")]
    assert "update_one_atomic" in body
    assert "find_one_and_update" not in body
    assert '"_id": row["_id"]' in body
    db.b2b_identities.docs.append(_identity_row())
    contact = next(row for row in db.contacts.docs if row["_id"] == "cB")
    upd = {"b2b_login_email": "ali@example.com", "b2b_enabled": True}

    async def issue():
        await b2b_identity.consider_link_notice(db, contact, {**contact, **upd}, upd)

    asyncio.run(issue())
    notice = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_link_notice")
    raw = re.search(r"accept-link/([A-Za-z0-9_\-]+)", notice["html"]).group(1)
    stored = next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB")
    assert stored["token_hash"] == b2b_identity.token_digest(raw)
    assert stored.get("token_used_at") is None
    expires = datetime.fromisoformat(stored["expires_at"])
    delta = expires - datetime.now(timezone.utc)
    assert timedelta(hours=71) < delta < timedelta(hours=73)
    preview = client.get(f"/api/public/b2b/accept-link/{raw}")
    assert preview.status_code == 200, preview.text
    assert preview.json()["status"] == "pending"
    assert preview.json()["company_name"] == "Firma B"
    assert not next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB").get("accepted_at")
    stored["expires_at"] = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    expired_get = client.get(f"/api/public/b2b/accept-link/{raw}")
    expired_post = client.post(f"/api/public/b2b/accept-link/{raw}")
    assert expired_get.status_code == 400
    assert "süresi doldu" in expired_get.json()["detail"]
    assert expired_post.status_code == 400
    assert "süresi doldu" in expired_post.json()["detail"]
    assert not next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB").get("accepted_at")
    stored["expires_at"] = (datetime.now(timezone.utc) + timedelta(hours=72)).isoformat()
    first = client.post(f"/api/public/b2b/accept-link/{raw}")
    assert first.status_code == 200, first.text
    used = next(row for row in db.b2b_link_acceptances.docs if row.get("contact_id") == "cB")
    assert used["accepted_at"]
    assert used["token_used_at"]
    assert used["token_hash"] is None
    again = client.post(f"/api/public/b2b/accept-link/{raw}")
    assert again.status_code == 400
    preview_used = client.get(f"/api/public/b2b/accept-link/{raw}")
    assert preview_used.status_code == 400


def test_link_notice_daily_cap_per_recipient_and_company(db, monkeypatch):
    import asyncio
    monkeypatch.setattr(b2b_identity, "_NOTICE_DAILY_PER_RECIPIENT", 1)
    monkeypatch.setattr(b2b_identity, "_NOTICE_DAILY_PER_COMPANY", 100)
    db.b2b_identities.docs.append(_identity_row())
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    db.notify_outbox.docs.append({
        "_id": "old-notice",
        "company_id": "coB",
        "event": "b2b_link_notice",
        "to": ["ali@example.com"],
        "subject": b2b_identity._NOTICE_SUBJECT,
        "created_at": yesterday,
        "status": "pending",
    })
    contact_b = next(row for row in db.contacts.docs if row["_id"] == "cB")
    upd_b = {"b2b_login_email": "ali@example.com", "b2b_enabled": True}

    async def notice(before, upd):
        await b2b_identity.consider_link_notice(db, before, {**before, **upd}, upd)

    asyncio.run(notice(contact_b, upd_b))
    assert upd_b["b2b_link_notified_email"] == "ali@example.com"
    contact_a = next(row for row in db.contacts.docs if row["_id"] == "cA")
    upd_a = {"b2b_login_email": "ali@example.com", "b2b_enabled": True}
    asyncio.run(notice(contact_a, upd_a))
    assert "b2b_link_notified_email" not in upd_a
    today = [row for row in db.notify_outbox.docs if row.get("event") == "b2b_link_notice" and row.get("created_at") != yesterday]
    assert len(today) == 1
    assert today[0]["subject"] == b2b_identity._NOTICE_SUBJECT

    monkeypatch.setattr(b2b_identity, "_NOTICE_DAILY_PER_RECIPIENT", 100)
    monkeypatch.setattr(b2b_identity, "_NOTICE_DAILY_PER_COMPANY", 1)

    async def send(to):
        return await b2b_identity._send_link_notice(
            db, to=to, company_name="<script>Evil</script>", contact_name="Cari",
            company_id="coZ", token="raw-token-not-stored",
        )

    assert asyncio.run(send("bir@example.com")) is True
    sent = next(row for row in db.notify_outbox.docs if row.get("to") == ["bir@example.com"])
    assert sent["subject"] == b2b_identity._NOTICE_SUBJECT
    assert "Evil" not in sent["subject"]
    assert "<script>" not in sent["subject"]
    assert "&lt;script&gt;" in sent["html"]
    assert asyncio.run(send("iki@example.com")) is False
    assert not any(row.get("to") == ["iki@example.com"] for row in db.notify_outbox.docs)


def test_verify_start_is_rate_limited_and_reset_token_is_hashed(client, db):
    import re
    db.b2b_identities.docs.append(_identity_row())
    res = _login(client)
    assert res.status_code == 200, res.text
    token = res.json()["select_token"]
    headers = {"Authorization": f"B2bSession {token}"}
    for _ in range(5):
        started = client.post("/api/public/b2b/verify-email/start", headers=headers)
        assert started.status_code == 200, started.text
    locked = client.post("/api/public/b2b/verify-email/start", headers=headers)
    assert locked.status_code == 429
    assert locked.json()["detail"] == b2b_identity._VERIFY_LOCK
    digest = b2b_identity._sha256("ali@example.com")
    counters = [row for row in db.login_attempts.docs if digest in row["identifier"]]
    assert any(row["identifier"].startswith("b2b:verify:acct:") for row in counters)
    assert any(row["identifier"].startswith("b2b:verify:ip:") for row in counters)
    assert "ali@example.com" not in "".join(row["identifier"] for row in counters)
    assert len(db.b2b_email_verifications.docs) == 5
    mails = [row for row in db.notify_outbox.docs if row.get("event") == "b2b_verify_email"]
    assert len(mails) == len(db.b2b_email_verifications.docs) == 5
    for mail, row in zip(mails, db.b2b_email_verifications.docs):
        raw = re.search(r"verify-email/([A-Za-z0-9_\-]+)", mail["html"]).group(1)
        assert row["_id"] == b2b_identity.token_digest(raw)
        assert row["_id"] != raw
        assert raw not in str(row)
    past = (datetime.now(timezone.utc) - timedelta(minutes=16)).isoformat()
    for row in counters:
        row["last_attempt"] = past
    again = client.post("/api/public/b2b/verify-email/start", headers=headers)
    assert again.status_code == 200, again.text


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


def _identity(iid, email, password_hash=HASH, verified=True):
    return {
        "_id": iid,
        "email": email,
        "password_hash": password_hash,
        "email_verified_at": datetime.now(timezone.utc).isoformat() if verified else None,
        "is_active": True,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "last_login_at": None,
    }


def test_vkn_login_identity_legacy_and_normalized_forms(client, db):
    db.companies.docs.append(_company("coId", "Kimlik A.Ş."))
    db.contacts.docs.append(_contact(
        "cId", "coId", "Kimlik Cari", login_email="kimlik@example.com", email="kimlik@example.com",
        token="portal-secret-id", tax="5555555555",
    ))
    db.b2b_identities.docs.append(_identity("id-kimlik", "kimlik@example.com"))
    for typed in ("5555555555", "555 555 5555", "TR5555555555", "5555555555 "):
        res = client.post("/api/public/b2b/login", json={"email": typed, "password": PWD})
        assert res.status_code == 200, (typed, res.text)
        assert res.json()["redirect"] == "/portal/portal-secret-id"
        assert "PRICE-SECRET" not in res.text
        assert "424242" not in res.text

    db.companies.docs.append(_company("coOld", "Eski A.Ş."))
    db.contacts.docs.append(_contact(
        "cOld", "coOld", "Eski Cari", login_email="", email="eski-vkn@example.com",
        token="portal-secret-old", tax="6666666666", password_hash=HASH_B,
    ))
    legacy = client.post("/api/public/b2b/login", json={"email": "666 666 6666", "password": PWD_B})
    assert legacy.status_code == 200, legacy.text
    assert legacy.json()["redirect"] == "/portal/portal-secret-old"
    assert not any(row.get("email") == "eski-vkn@example.com" for row in db.b2b_identities.docs)
    wrong = client.post("/api/public/b2b/login", json={"email": "6666666666", "password": PWD})
    assert wrong.status_code == 401
    assert wrong.json()["detail"] == b2b_identity._FAIL
    assert "Eski A.Ş." not in wrong.text

    db.companies.docs.append(_company("coTckn", "TCKN A.Ş."))
    db.contacts.docs.append(_contact(
        "cTckn", "coTckn", "TCKN Cari", login_email="", email="tckn@example.com",
        token="portal-secret-tckn", tax="12345678901",
    ))
    tckn = client.post("/api/public/b2b/login", json={"email": "12345 678 901", "password": PWD})
    assert tckn.status_code == 200, tckn.text
    assert tckn.json()["redirect"] == "/portal/portal-secret-tckn"

    messy = _contact(
        "cMessy", "coId", "Boşluklu", login_email="", email="messy@example.com",
        token="portal-secret-messy", tax="123 456 7890", password_hash=HASH,
    )
    messy["tax_norm"] = "1234567890"
    db.contacts.docs.append(messy)
    spaced = client.post("/api/public/b2b/login", json={"email": "1234567890", "password": PWD})
    assert spaced.status_code == 200, spaced.text
    assert spaced.json()["redirect"] == "/portal/portal-secret-messy"
    assert next(row["tax_number_or_id"] for row in db.contacts.docs if row["_id"] == "cMessy") == "123 456 7890"


def test_same_vkn_two_suppliers_selects_only_matching_passwords(client, db):
    db.companies.docs.append(_company("co1", "Bir Ltd"))
    db.companies.docs.append(_company("co2", "İki Ltd"))
    db.contacts.docs.append(_contact(
        "c1", "co1", "C1", login_email="bir@example.com", email="bir@example.com",
        token="portal-secret-bir", tax="7777777777",
    ))
    db.contacts.docs.append(_contact(
        "c2", "co2", "C2", login_email="iki@example.com", email="iki@example.com",
        token="portal-secret-iki", tax="7777777777", password_hash=HASH_B,
    ))
    db.b2b_identities.docs.append(_identity("id-bir", "bir@example.com"))
    db.b2b_identities.docs.append(_identity("id-iki", "iki@example.com", HASH_B))
    both_wrong_setup = client.post("/api/public/b2b/login", json={"email": "7777777777", "password": "nope"})
    assert both_wrong_setup.status_code == 401
    assert both_wrong_setup.json()["detail"] == b2b_identity._FAIL
    assert "Bir Ltd" not in both_wrong_setup.text
    assert "İki Ltd" not in both_wrong_setup.text

    one = client.post("/api/public/b2b/login", json={"email": "TR7777777777", "password": PWD})
    assert one.status_code == 200, one.text
    assert one.json()["redirect"] == "/portal/portal-secret-bir"
    assert _names(one.json()) == {"Bir Ltd"}
    assert "portal-secret-iki" not in one.text
    assert "İki Ltd" not in one.text

    for row in db.b2b_identities.docs:
        if row["_id"] == "id-iki":
            row["password_hash"] = HASH
    for row in db.contacts.docs:
        if row["_id"] == "c2":
            row["b2b_password_hash"] = HASH
    both = client.post("/api/public/b2b/login", json={"email": "777 777 7777", "password": PWD})
    assert both.status_code == 200, both.text
    assert _names(both.json()) == {"Bir Ltd", "İki Ltd"}
    assert both.json().get("select_token")
    assert "redirect" not in both.json()
    assert "portal-secret-bir" not in both.text
    assert "portal-secret-iki" not in both.text


def test_vkn_skips_disabled_passive_and_other_tenant(client, db):
    db.companies.docs.append(_company("coHide", "Gizli Ltd", enabled=False))
    db.companies.docs.append(_company("coOpen", "Açık Ltd"))
    db.contacts.docs.append(_contact(
        "cHide", "coHide", "Gizli Cari", login_email="gizli@example.com", email="gizli@example.com",
        token="portal-secret-hide", tax="8888888888", balance=999001,
    ))
    db.contacts.docs.append(_contact(
        "cPassive", "coOpen", "Pasif Cari", login_email="pasif-vkn@example.com", email="pasif-vkn@example.com",
        token="portal-secret-passive", tax="8888888888", active=False,
    ))
    db.contacts.docs.append(_contact(
        "cOffB2B", "coOpen", "Kapalı B2B", login_email="kapali@example.com", email="kapali@example.com",
        token="portal-secret-b2boff", tax="8888888888", enabled=False,
    ))
    db.contacts.docs.append(_contact(
        "cOpen", "coOpen", "Açık Cari", login_email="acik@example.com", email="acik@example.com",
        token="portal-secret-open", tax="8888888888",
    ))
    db.contacts.docs.append(_contact(
        "cOtherTax", "coOpen", "Başka VKN", login_email="baska-vkn@example.com", email="baska-vkn@example.com",
        token="portal-secret-othertax", tax="1010101010",
    ))
    for mail in ("gizli@example.com", "pasif-vkn@example.com", "kapali@example.com", "acik@example.com", "baska-vkn@example.com"):
        db.b2b_identities.docs.append(_identity(f"id-{mail}", mail))
    res = client.post("/api/public/b2b/login", json={"email": "8888888888", "password": PWD})
    assert res.status_code == 200, res.text
    assert _names(res.json()) == {"Açık Ltd"}
    assert res.json()["name"] == "Açık Cari"
    blob = res.text
    for secret in ("Gizli Ltd", "Pasif Cari", "Kapalı B2B", "Başka VKN", "portal-secret-hide", "portal-secret-passive", "999001", "1010101010"):
        assert secret not in blob


def test_vkn_lock_counts_normalized_spellings_once(client, db):
    spellings = ["123 456 7890", "1234567890", "TR1234567890", "1234567890 ", "123.456.7890"]
    for typed in spellings:
        res = client.post("/api/public/b2b/login", json={"email": typed, "password": "wrong"})
        assert res.status_code == 401, (typed, res.text)
    locked = client.post("/api/public/b2b/login", json={"email": "1234567890", "password": "wrong"})
    assert locked.status_code == 429
    assert locked.json()["detail"] == b2b_identity._LOCK
    digest = b2b_identity._sha256("1234567890")
    acct = [row for row in db.login_attempts.docs if row["identifier"] == f"b2b:acct:{digest}"]
    assert len(acct) == 1
    assert acct[0]["count"] == 5
    blob = "".join(row["identifier"] for row in db.login_attempts.docs)
    assert "123 456 7890" not in blob
    assert "TR1234567890" not in blob


def test_canonical_login_stores_digits_and_skips_link_notice(db):
    import asyncio
    from fastapi import HTTPException
    assert b2b_identity.canonical_b2b_login("1234567890") == "1234567890"
    assert b2b_identity.canonical_b2b_login(" 123 456 7890 ") == "1234567890"
    assert b2b_identity.canonical_b2b_login("Ali@Example.com") == "ali@example.com"
    assert b2b_identity.canonical_b2b_login("") == ""
    with pytest.raises(HTTPException) as err:
        b2b_identity.canonical_b2b_login("abc")
    assert err.value.status_code == 400
    assert "VKN" in err.value.detail
    before = list(db.notify_outbox.docs)

    async def run():
        upd = {"b2b_login_email": "1234567890", "b2b_enabled": True}
        contact = {"_id": "cA", "company_id": "coA", "name": "Cari A", "b2b_enabled": True, "b2b_login_email": ""}
        await b2b_identity.consider_link_notice(db, contact, {**contact, **upd}, upd)

    asyncio.run(run())
    assert db.notify_outbox.docs == before
    plans = b2b_identity.plan_tax_norm_backfill([
        {"_id": "a", "company_id": "coA", "tax_number_or_id": "123 456 7890"},
        {"_id": "b", "company_id": "coA", "tax_number_or_id": "1234567890", "tax_norm": "1234567890"},
        {"_id": "c", "company_id": "coA", "tax_number_or_id": "abc"},
    ])
    assert plans == [{"contact_id": "a", "company_id": "coA", "patch": {"tax_norm": "1234567890"}}]


def test_forgot_vkn_normalizes_and_unknown_is_generic(db):
    import asyncio
    db.contacts.docs.append(_contact(
        "cTaxMail", "coA", "Vergili", login_email="", email="vergi@example.com",
        token="portal-secret-taxmail", tax="9090909090",
    ))
    generic = {"status": "ok", "message": "ayni", "channel": "email"}

    async def run(ident):
        contact = await b2b_identity.find_legacy_contact(db, ident)
        out = await b2b_identity.finish_b2b_forgot(
            db, ident, None, {"ok": True}, dict(generic), contact,
        )
        return contact, out

    contact, queued = asyncio.run(run("TR 909 090 9090"))
    assert contact["_id"] == "cTaxMail"
    assert queued["status"] == "ok"
    mail = next(row for row in db.notify_outbox.docs if row.get("event") == "b2b_password_reset")
    assert mail["to"] == ["vergi@example.com"]
    before = len(db.notify_outbox.docs)
    missing, same = asyncio.run(run("0000000000"))
    assert missing is None
    assert same == generic
    assert len(db.notify_outbox.docs) == before


def test_logout_drops_only_that_session_and_keeps_portal_token(client, db, monkeypatch):
    res = _login(client)
    token = res.json()["select_token"]
    other = "other-select-token-keep"
    db.b2b_sessions.docs.append({
        "_id": b2b_identity._sha256(other),
        "identity_id": "keep",
        "email": "keep@example.com",
        "expires_at": (datetime.now(timezone.utc) + timedelta(minutes=10)).isoformat(),
        "contact_ids": ["cB"],
    })
    contact = next(row for row in db.contacts.docs if row["_id"] == "cA")
    before_token = contact["b2b_token"]
    logged = []
    monkeypatch.setattr(b2b_identity.logger, "warning", lambda *a, **k: logged.append((a, k)))
    monkeypatch.setattr(b2b_identity.logger, "info", lambda *a, **k: logged.append((a, k)))
    monkeypatch.setattr(b2b_identity.applog, "log_auth", lambda *a, **k: logged.append((a, k)))
    out = client.post("/api/public/b2b/logout", headers={"Authorization": f"B2BSession {token}"})
    assert out.status_code == 200
    assert out.json() == {"status": "success"}
    assert token not in out.text
    assert token not in str(logged)
    ids = {row["_id"] for row in db.b2b_sessions.docs}
    assert b2b_identity._sha256(token) not in ids
    assert b2b_identity._sha256(other) in ids
    assert contact["b2b_token"] == before_token
    suppliers = client.get("/api/public/b2b/suppliers", headers={"Authorization": f"B2BSession {token}"})
    assert suppliers.status_code == 401
    again = client.post("/api/public/b2b/logout", json={"select_token": "not-a-session"})
    assert again.status_code == 200
    assert again.json() == {"status": "success"}
    assert b2b_identity._sha256(other) in {row["_id"] for row in db.b2b_sessions.docs}
    missing = client.post("/api/public/b2b/logout")
    assert missing.status_code == 200
    assert "not-a-session" not in missing.text
