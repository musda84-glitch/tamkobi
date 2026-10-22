"""Depolama limiti, artış talebi ve admin-v1 HMAC uçları.

Bellek FakeDB. Canlı veritabanı yok.
"""
from __future__ import annotations

import asyncio
import json

import pytest
from fastapi import HTTPException

import addons
import platform_store as store
import saas
import storage_manager
import storage_quota
from test_platform_admin_v1 import FakeDB, _client, _detail, _issue, _signed_headers

_USER = {"email": "ayse@firma.test", "name": "Ayşe"}


def _audits(db, action):
    return [row for row in db.platform_audit_log.docs.values() if row.get("action") == action]


def _send(client, secret, key_id, method, path, payload=None, *, idem="idem-1", params=None):
    raw = b"" if payload is None else json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    headers, _, nonce = _signed_headers(secret, key_id, method, path, raw)
    if idem is not None and method != "GET":
        headers["Idempotency-Key"] = idem
    response = client.request(method, path, content=raw, headers=headers, params=params)
    return response, nonce


@pytest.fixture
def storage_db():
    fake = FakeDB()
    prev = (store._db, saas._db, saas._current_user, addons._db, storage_manager._db, storage_quota._db)
    store.init(fake)
    saas.init(fake, None)
    saas.invalidate()
    addons.init(fake)
    storage_manager._db = fake
    storage_quota.init(fake)

    async def seed():
        await fake.saas_plans.insert_one({
            "_id": "plan_std",
            "code": "std",
            "name": "Standart",
            "modules": [],
            "storage_limit_mb": 100,
            "user_limit": 5,
            "company_limit": 1,
        })
        await fake.companies.insert_one({"_id": "comp_a", "name": "A Firması", "license_id": "comp_a"})
        await fake.companies.insert_one({"_id": "comp_b", "name": "B Firması", "license_id": "comp_b"})
        await fake.company_licenses.insert_one({
            "_id": "comp_a", "plan_id": "plan_std", "status": "active", "storage_limit_mb": 512,
        })
        await fake.company_licenses.insert_one({
            "_id": "comp_b", "plan_id": "plan_std", "status": "active", "storage_limit_mb": 256,
        })
        await fake.files.insert_one({
            "_id": "file_a", "company_id": "comp_a", "size": 17436343, "is_deleted": False,
        })

    asyncio.run(seed())
    yield fake
    store.init(prev[0])
    saas.init(prev[1], prev[2])
    addons.init(prev[3])
    storage_manager._db = prev[4]
    storage_quota.init(prev[5])
    saas.invalidate()


def test_limit_message_uses_turkish_comma():
    text = storage_quota.storage_limit_message(17436343, 16)
    assert "16,6 MB" in text
    assert "limit 16 MB" in text
    assert text.startswith("Depolama limiti aşıldı.")
    view = storage_quota.usage_view(17436343, 5120)
    assert view["used_bytes"] == 17436343
    assert view["unlimited"] is False
    assert view["free_bytes"] == 5120 * 1024 * 1024 - 17436343
    assert storage_quota.usage_view(10, 0)["unlimited"] is True
    assert storage_quota.usage_view(10, 0)["percent"] is None


def test_parse_admin_limit_units_and_rejects():
    assert storage_quota.parse_admin_limit({"unlimited": True}) == 0
    assert storage_quota.parse_admin_limit({"storage_limit_mb": None}) is None
    assert storage_quota.parse_admin_limit({"storage_limit_mb": 0}) == 0
    assert storage_quota.parse_admin_limit({"amount": "5,5", "unit": "gb"}) == 5632
    assert storage_quota.mb_from_amount(2, "gb") == 2048
    with pytest.raises(HTTPException) as bad_bool:
        storage_quota.parse_admin_limit({"storage_limit_mb": True})
    assert bad_bool.value.status_code == 400
    with pytest.raises(HTTPException) as mixed:
        storage_quota.parse_admin_limit({"unlimited": True, "amount": 1})
    assert mixed.value.detail == "Sınırsız seçiliyken miktar gönderilmez."


def test_create_blocks_duplicate_unlimited_and_smaller(storage_db):
    async def run():
        created = await storage_quota.create_increase_request(
            "comp_a", _USER, {"amount": "2", "unit": "gb", "message": "Arşiv"},
        )
        assert created["status"] == "pending"
        assert created["status_label"] == "Bekliyor"
        assert created["requested_limit_mb"] == 2048
        assert created["current_limit_mb"] == 512
        assert created["requested_by_name"] == "Ayşe"
        with pytest.raises(HTTPException) as dup:
            await storage_quota.create_increase_request("comp_a", _USER, {"limit_mb": 4096})
        assert dup.value.detail == "Bekleyen bir depolama artış talebiniz zaten var."
        with pytest.raises(HTTPException) as small:
            await storage_quota.create_increase_request("comp_b", _USER, {"limit_mb": 256})
        assert small.value.detail == "İstenen limit mevcut limitten büyük olmalıdır."
        await saas.apply_license_update("comp_b", {"storage_limit_mb": 0})
        with pytest.raises(HTTPException) as unlimited:
            await storage_quota.create_increase_request("comp_b", _USER, {"limit_mb": 1024})
        assert unlimited.value.detail == "Depolama limitiniz sınırsız. Artış talebi gerekmez."
        rows = await storage_quota.list_increase_requests("comp_a")
        assert len(rows) == 1
        assert await storage_quota.list_increase_requests("comp_b") == []
        return created

    asyncio.run(run())


def test_approve_writes_license_and_reject_needs_note(storage_db):
    async def run():
        created = await storage_quota.create_increase_request(
            "comp_a", _USER, {"amount": 2, "unit": "gb"},
        )
        with pytest.raises(HTTPException) as missing_note:
            await storage_quota.resolve_increase_request("comp_a", created["id"], "rejected", "  ")
        assert missing_note.value.detail == "Red notu zorunlu."
        still = await storage_quota.latest_increase_request("comp_a")
        assert still["status"] == "pending"
        with pytest.raises(HTTPException) as other:
            await storage_quota.resolve_increase_request("comp_b", created["id"], "approved", "")
        assert other.value.status_code == 404
        approved = await storage_quota.resolve_increase_request(
            "comp_a", created["id"], "approved", "", actor="key_1",
        )
        assert approved["status_label"] == "Onaylandı"
        lic = await saas.effective("comp_a")
        assert lic["storage_limit_mb"] == 2048
        with pytest.raises(HTTPException) as done:
            await storage_quota.resolve_increase_request("comp_a", created["id"], "rejected", "geç")
        assert done.value.status_code == 409
        note = storage_db.notifications.docs
        assert any(row.get("type") == "storage_limit" and row.get("company_id") == "comp_a" for row in note.values())
        used = 17436343
        with pytest.raises(HTTPException) as blocked:
            await saas.check_storage_limit("comp_a", 2048 * 1024 * 1024 - used + 1)
        assert blocked.value.status_code == 403
        assert "Depolama limiti aşıldı" in blocked.value.detail
        await saas.check_storage_limit("comp_a", 0)

    asyncio.run(run())


def test_admin_v1_limit_and_request_are_scoped(storage_db):
    client = _client()
    db = storage_db
    writer, secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_WRITE, store.SCOPE_ADMIN_STORAGE_READ], name="storage")
    reader, read_secret = _issue(db, [store.SCOPE_ADMIN_STORAGE_READ], name="storage-read")
    limit_path = "/api/platform/admin-v1/companies/comp_a/storage/limit"
    missing, _ = _send(client, secret, writer["id"], "PUT", limit_path, {"amount": 5, "unit": "gb"}, idem=None)
    assert missing.status_code == 400
    assert _detail(missing) == "Idempotency-Key gerekli"
    denied, _ = _send(client, read_secret, reader["id"], "PUT", limit_path, {"amount": 1, "unit": "gb"}, idem="deny-1")
    assert denied.status_code == 403
    assert _detail(denied) == "Kapsam yetersiz"
    saved, _ = _send(client, secret, writer["id"], "PUT", limit_path, {"amount": "5", "unit": "gb"}, idem="lim-1")
    assert saved.status_code == 200, saved.text
    body = saved.json()["item"]
    assert body["storage_limit_mb"] == 5120
    assert body["used_bytes"] == 17436343
    assert body["unlimited"] is False
    again, _ = _send(client, secret, writer["id"], "PUT", limit_path, {"amount": "5", "unit": "gb"}, idem="lim-1")
    assert again.status_code == 200
    assert again.json()["item"]["storage_limit_mb"] == 5120
    assert len(_audits(db, "admin_v1.write.storage.limit")) == 1
    assert db.company_licenses.docs["comp_a"]["storage_limit_mb"] == 5120

    async def ask():
        return await storage_quota.create_increase_request(
            "comp_a", _USER, {"limit_mb": 8192, "message": "daha fazla"},
        )

    created = asyncio.run(ask())
    other = asyncio.run(storage_quota.create_increase_request("comp_b", _USER, {"limit_mb": 1024}))
    list_path = "/api/platform/admin-v1/companies/comp_a/storage/requests"
    listed, _ = _send(client, read_secret, reader["id"], "GET", list_path, idem=None)
    assert listed.status_code == 200, listed.text
    ids = [row["id"] for row in listed.json()["items"]]
    assert created["id"] in ids
    assert other["id"] not in ids
    resolve = f"{list_path}/{created['id']}"
    bare, _ = _send(client, secret, writer["id"], "PUT", resolve, {"status": "rejected"}, idem="rej-empty")
    assert bare.status_code == 400
    assert _detail(bare) == "Red notu zorunlu."
    rejected, _ = _send(
        client, secret, writer["id"], "PUT", resolve,
        {"status": "rejected", "note": "kota planı yeterli"}, idem="rej-1",
    )
    assert rejected.status_code == 200, rejected.text
    assert rejected.json()["item"]["status"] == "rejected"
    assert rejected.json()["item"]["status_label"] == "Reddedildi"
    assert db.company_licenses.docs["comp_a"]["storage_limit_mb"] == 5120
    assert len(_audits(db, "admin_v1.write.storage.request.resolve")) == 1
    fresh = asyncio.run(storage_quota.create_increase_request("comp_a", _USER, {"limit_mb": 10240}))
    approved, _ = _send(
        client, secret, writer["id"], "PUT", f"{list_path}/{fresh['id']}",
        {"status": "approved", "note": ""}, idem="ok-1",
    )
    assert approved.status_code == 200, approved.text
    assert approved.json()["item"]["status_label"] == "Onaylandı"
    assert db.company_licenses.docs["comp_a"]["storage_limit_mb"] == 10240
    summary, _ = _send(
        client, read_secret, reader["id"], "GET",
        "/api/platform/admin-v1/companies/comp_a/storage", idem=None,
    )
    assert summary.status_code == 200, summary.text
    assert summary.json()["used_bytes"] == 17436343
    assert summary.json()["storage_limit_mb"] == 10240
    assert "item" not in summary.json()
