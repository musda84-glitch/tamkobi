"""Şirket API anahtarı ve şirketler arası okuma paylaşımı.

Canlı veritabanına ve 8021 portuna bağlanmaz. Ortam değişkeni modül yükünde
değiştirilmez.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import company_api_keys as keys  # noqa: E402
import company_links as links  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402
from platform_store import _sha256_hex  # noqa: E402

INFO_FIELDS = {"prefix", "last4", "created_at", "last_used_at", "last_used_by"}


def _company(cid, name):
    return {"_id": cid, "name": name, "license_id": cid}


def _user(uid, company_id, email, role="admin"):
    return {
        "_id": uid,
        "email": email,
        "name": email.split("@")[0],
        "role": role,
        "company_ids": [company_id],
        "active_company_id": company_id,
        "is_active": True,
    }


@pytest.fixture
def world():
    mem = MemDB()
    mem.companies.docs.extend([
        _company("coA", "Firma A"),
        _company("coB", "Firma <B>"),
        _company("coC", "Firma C"),
    ])
    mem.users.docs.extend([
        _user("usrA", "coA", "admin-a@example.com"),
        _user("usrB", "coB", "admin-b@example.com"),
        _user("usrC", "coC", "admin-c@example.com"),
        _user("usrSales", "coA", "sales-a@example.com", role="sales"),
    ])
    mem.contacts.docs.extend([
        {
            "_id": "cntA",
            "company_id": "coA",
            "name": "Cari A",
            "email": "cari-a@example.com",
            "b2b_token": "secret-b2b-token-a",
            "b2b_password_hash": "secret-b2b-hash-a",
            "balance": 10,
        },
        {
            "_id": "cntB",
            "company_id": "coB",
            "name": "Cari B",
            "email": "cari-b@example.com",
            "b2b_token": "secret-b2b-token-b",
            "balance": 20,
        },
    ])
    mem.products.docs.extend([
        {
            "_id": "prdA",
            "company_id": "coA",
            "name": "Urun A",
            "sku": "SKU-A",
            "sale_price": 15,
            "purchase_price": 999,
            "stock_quantity": 4,
            "notes": "gizli-not-a",
        },
        {
            "_id": "prdB",
            "company_id": "coB",
            "name": "Urun B",
            "sku": "SKU-B",
            "sale_price": 30,
            "purchase_price": 888,
            "stock_quantity": 7,
            "vat_rate": 20,
            "currency": "TRY",
        },
    ])
    mem.invoices.docs.append({
        "_id": "invB",
        "company_id": "coB",
        "invoice_number": "FTR-B-1",
        "invoice_type": "sales",
        "issue_date": "2026-10-01",
        "contact_name": "Cari B",
        "grand_total": 36,
        "currency": "TRY",
        "status": "issued",
        "notes": "gizli-fatura-notu",
        "items": [{"name": "Urun B", "quantity": 1, "unit": "ad", "unit_price": 30, "vat_rate": 20, "total": 36, "cost": 888}],
    })
    mem.pricing_rules.docs.append({
        "_id": "ruleB",
        "company_id": "coB",
        "channel": "b2b",
        "margin_pct": 12,
        "purchase_price": 777,
    })

    async def current_user(request: Request):
        uid = request.headers.get("x-user") or ""
        user = await mem.users.find_one({"_id": uid})
        if not user:
            raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
        return user

    prev = (saas._db, saas._current_user, keys._db, keys._current_user, links._db, links._current_user)
    saas.init(mem, current_user)
    links.init(mem, current_user)
    app = FastAPI()
    app.include_router(keys.router)
    app.include_router(links.router)
    client = TestClient(app)
    try:
        yield {"db": mem, "client": client}
    finally:
        saas._db, saas._current_user = prev[0], prev[1]
        keys._db, keys._current_user = prev[2], prev[3]
        links._db, links._current_user = prev[4], prev[5]


def _h(uid):
    """Oturum JWT'si tk_live_ değildir. Sahte kullanıcı x-user ile seçilir."""
    return {"x-user": uid, "Authorization": "Bearer session"}


def _create_key(client, uid, company_id):
    res = client.post(f"/api/license/companies/{company_id}/api-key", headers=_h(uid))
    assert res.status_code == 200, res.text
    return res.json()


def _secret_absent(blob, secret):
    assert secret not in blob
    assert "secret_enc" not in blob


def test_key_returned_once_and_only_hash_is_stored(world):
    client, db = world["client"], world["db"]
    created = _create_key(client, "usrA", "coA")
    secret = created["api_key"]
    assert secret.startswith("tk_live_")
    assert len(secret) >= len("tk_live_") + 32
    assert set(created) == INFO_FIELDS | {"api_key"}
    again = client.post("/api/license/companies/coA/api-key", headers=_h("usrA"))
    assert again.status_code == 409
    assert "tk_live_" not in again.text
    info = client.get("/api/license/companies/coA/api-key", headers=_h("usrA"))
    assert info.status_code == 200
    assert set(info.json()) == INFO_FIELDS
    assert info.json()["prefix"] == "tk_live_"
    assert info.json()["last4"] == secret[-4:]
    assert "api_key" not in info.json()
    stored = db.company_api_keys.docs
    assert len(stored) == 1
    doc = stored[0]
    assert doc["key_hash"] == _sha256_hex(secret)
    assert doc["key_hash"] == hashlib.sha256(secret.encode()).hexdigest()
    dumped = json.dumps(doc)
    _secret_absent(dumped, secret)
    assert "api_key" not in doc
    assert doc["company_id"] == "coA"


def test_rotate_invalidates_old_key_immediately(world):
    client = world["client"]
    first = _create_key(client, "usrB", "coB")["api_key"]
    own = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {first}"})
    assert own.status_code == 200
    assert own.json()["items"][0]["name"] == "Cari B"
    rotated = client.post("/api/license/companies/coB/api-key/rotate", headers=_h("usrB"))
    assert rotated.status_code == 200
    second = rotated.json()["api_key"]
    assert second != first
    assert set(rotated.json()) == INFO_FIELDS | {"api_key"}
    old = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {first}"})
    assert old.status_code == 401
    new = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {second}"})
    assert new.status_code == 200
    info = client.get("/api/license/companies/coB/api-key", headers=_h("usrB"))
    assert "api_key" not in info.json()
    assert second not in info.text


def test_compare_digest_runs_for_miss_and_hit(world, monkeypatch):
    client = world["client"]
    secret = _create_key(client, "usrA", "coA")["api_key"]
    seen = []
    real = hmac.compare_digest

    def wrapped(left, right):
        seen.append((left, right))
        return real(left, right)

    monkeypatch.setattr(keys.hmac, "compare_digest", wrapped)
    assert keys._digest_equal("short", "much-longer-value") is False
    assert seen, "uzunluk farkında compare_digest çağrılmadı"
    seen.clear()
    missing = client.get("/api/shared/coA/cari", headers={"Authorization": "Bearer tk_live_wrong-key-value-not-stored"})
    assert missing.status_code == 401
    assert seen, "yanlış anahtarda compare_digest çağrılmadı"
    seen.clear()
    hit = client.get("/api/shared/coA/cari", headers={"Authorization": f"Bearer {secret}"})
    assert hit.status_code == 200
    assert any(real(left, right) and left == right for left, right in seen)


def test_other_company_key_is_404_and_non_admin_is_403(world):
    client = world["client"]
    _create_key(client, "usrA", "coA")
    foreign = client.get("/api/license/companies/coB/api-key", headers=_h("usrA"))
    assert foreign.status_code == 404
    assert foreign.status_code != 403
    sales = client.get("/api/license/companies/coA/api-key", headers=_h("usrSales"))
    assert sales.status_code == 403
    foreign_post = client.post("/api/license/companies/coB/api-key", headers=_h("usrA"))
    assert foreign_post.status_code == 404
    assert "tk_live_" not in foreign_post.text


def test_pending_scope_third_party_and_disconnect(world):
    client, db = world["client"], world["db"]
    secret_b = _create_key(client, "usrB", "coB")["api_key"]
    secret_a = _create_key(client, "usrA", "coA")["api_key"]
    secret_c = _create_key(client, "usrC", "coC")["api_key"]
    asked = client.post(
        "/api/license/companies/coA/links",
        headers=_h("usrA"),
        json={"api_key": secret_b},
    )
    assert asked.status_code == 200, asked.text
    link = asked.json()
    assert link["status"] == "pending"
    assert link["from_company"] == "coA"
    assert link["to_company"] == "coB"
    assert link["scopes"] == {"cari": "none", "stok": "none", "fiyat": "none", "fatura": "none"}
    assert secret_b not in json.dumps(db.company_links.docs)
    pending = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_a}"})
    assert pending.status_code == 403
    session_pending = client.get("/api/shared/coB/cari", headers=_h("usrA"))
    assert session_pending.status_code == 403
    approved = client.post(
        f"/api/license/companies/coB/links/{link['id']}/approve",
        headers=_h("usrB"),
        json={"scopes": {"cari": "read", "stok": "none", "fiyat": "none", "fatura": "write"}},
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["status"] == "active"
    assert approved.json()["scopes"]["fatura"] == "write"
    assert db.company_links.docs[0]["scopes"]["fatura"] == "write"
    cari = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_a}"})
    assert cari.status_code == 200
    assert cari.json()["items"][0]["name"] == "Cari B"
    assert "secret-b2b-token-b" not in cari.text
    stok = client.get("/api/shared/coB/stok", headers={"Authorization": f"Bearer {secret_a}"})
    assert stok.status_code == 403
    fiyat = client.get("/api/shared/coB/fiyat", headers=_h("usrA"))
    assert fiyat.status_code == 403
    fatura = client.get("/api/shared/coB/fatura", headers={"Authorization": f"Bearer {secret_a}"})
    assert fatura.status_code == 200
    assert fatura.json()["items"][0]["invoice_number"] == "FTR-B-1"
    assert "gizli-fatura-notu" not in fatura.text
    assert "888" not in json.dumps(fatura.json()["items"][0].get("items"))
    own = client.get("/api/shared/coA/stok", headers={"Authorization": f"Bearer {secret_a}"})
    assert own.status_code == 200
    assert own.json()["items"][0]["sku"] == "SKU-A"
    assert "purchase_price" not in own.text
    assert "999" not in own.text
    third_bearer = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_c}"})
    assert third_bearer.status_code == 403
    third_session = client.get("/api/shared/coB/cari", headers=_h("usrC"))
    assert third_session.status_code == 403
    reverse = client.get("/api/shared/coA/cari", headers={"Authorization": f"Bearer {secret_b}"})
    assert reverse.status_code == 403
    posted = client.post("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_a}"})
    assert posted.status_code == 405
    cut = client.post(f"/api/license/companies/coA/links/{link['id']}/revoke", headers=_h("usrA"))
    assert cut.status_code == 200
    assert cut.json()["status"] == "revoked"
    after = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_a}"})
    assert after.status_code == 403
    owner_still = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_b}"})
    assert owner_still.status_code == 200


def test_rate_limit_blocks_repeated_key_use(world, monkeypatch):
    client = world["client"]
    secret = _create_key(client, "usrA", "coA")["api_key"]
    monkeypatch.setattr(keys, "KEY_RATE_LIMIT", 2)
    headers = {"Authorization": f"Bearer {secret}"}
    assert client.get("/api/shared/coA/cari", headers=headers).status_code == 200
    assert client.get("/api/shared/coA/cari", headers=headers).status_code == 200
    blocked = client.get("/api/shared/coA/cari", headers=headers)
    assert blocked.status_code == 429
    assert secret not in blocked.text


def test_audit_mail_and_logs_omit_the_secret(world, caplog):
    client, db = world["client"], world["db"]
    with caplog.at_level(logging.DEBUG):
        created = _create_key(client, "usrA", "coA")
        secret = created["api_key"]
        asked = client.post(
            "/api/license/companies/coA/links",
            headers=_h("usrA"),
            json={"api_key": secret},
        )
        assert asked.status_code == 400
        secret_b = _create_key(client, "usrB", "coB")["api_key"]
        asked = client.post(
            "/api/license/companies/coA/links",
            headers=_h("usrA"),
            json={"api_key": secret_b},
        )
        assert asked.status_code == 200, asked.text
        logging.getLogger("tamkobi.company_api.test").warning("yanlışlıkla %s", secret)
        logging.getLogger("tamkobi.company_api.test").warning("yanlışlıkla %s", secret_b)
    blob = json.dumps({
        "keys": db.company_api_keys.docs,
        "links": db.company_links.docs,
        "audit": db.company_audit_log.docs,
        "mail": db.notify_outbox.docs,
        "logs": caplog.text,
    })
    _secret_absent(blob, secret)
    _secret_absent(blob, secret_b)
    assert "tk_live_[gizli]" in caplog.text
    assert db.company_audit_log.docs
    assert db.notify_outbox.docs
    assert db.notify_outbox.docs[0]["event"] == "company_link_request"
    assert db.notify_outbox.docs[0]["to"] == ["admin-b@example.com"]
    assert "&lt;B&gt;" in db.notify_outbox.docs[0]["html"]
    assert "Firma <B>" not in db.notify_outbox.docs[0]["html"]
    touched = client.get("/api/shared/coB/cari", headers={"Authorization": f"Bearer {secret_b}"})
    assert touched.status_code == 200
    info = client.get("/api/license/companies/coB/api-key", headers=_h("usrB")).json()
    assert info["last_used_by"] == "external"
    assert secret_b not in json.dumps(info)


def test_revoke_key_rejects_bearer_and_reissue_returns_a_new_secret(world):
    client = world["client"]
    secret = _create_key(client, "usrA", "coA")["api_key"]
    revoked = client.post("/api/license/companies/coA/api-key/revoke", headers=_h("usrA"))
    assert revoked.status_code == 200
    assert "api_key" not in revoked.json()
    denied = client.get("/api/shared/coA/cari", headers={"Authorization": f"Bearer {secret}"})
    assert denied.status_code == 401
    reissued = _create_key(client, "usrA", "coA")
    assert reissued["api_key"] != secret
    ok = client.get("/api/shared/coA/cari", headers={"Authorization": f"Bearer {reissued['api_key']}"})
    assert ok.status_code == 200


def test_shared_prefix_is_public_and_license_key_path_is_not():
    assert rbac.is_public_api_path("/api/shared/coA/cari", "GET") is True
    assert rbac.is_public_api_path("/api/license/companies/coA/api-key", "GET") is False
    assert "/api/shared/" in rbac.PUBLIC_API_ALLOWLIST


def test_export_manifest_excludes_key_and_link_collections():
    text = (_BACKEND / "data_export.py").read_text(encoding="utf-8")
    assert '"company_api_keys"' in text
    assert '"company_links"' in text


def test_direct_mail_events_include_company_links():
    import event_notify
    for name in (
        "company_link_request",
        "company_link_approved",
        "company_link_rejected",
        "company_link_revoked",
    ):
        assert name in event_notify._COMPANY_LINK_DIRECT_EVENTS
