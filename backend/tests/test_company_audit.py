"""Firma işlem geçmişi: kiracı izolasyonu, yetki, hassas alan yasağı."""
from __future__ import annotations

import asyncio
import copy
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from mysql_store import match_query
import company_audit
import rbac


class _Cursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction=-1):
        self._docs.sort(key=lambda d: str(d.get(key) or ""), reverse=direction < 0)
        return self

    async def to_list(self, length=None):
        rows = self._docs
        if length is not None:
            rows = rows[:length]
        return copy.deepcopy(rows)


class MemoryCollection:
    def __init__(self):
        self.docs = {}

    async def create_index(self, *args, **kwargs):
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = copy.deepcopy(doc)
        return doc

    async def find_one(self, query):
        if set(query) == {"_id"}:
            doc = self.docs.get(query["_id"])
            return copy.deepcopy(doc) if doc else None
        for doc in self.docs.values():
            if match_query(doc, query):
                return copy.deepcopy(doc)
        return None

    def find(self, query=None):
        matched = [copy.deepcopy(d) for d in self.docs.values() if match_query(d, query or {})]
        return _Cursor(matched)

    async def delete_one(self, query):
        for doc_id, old in list(self.docs.items()):
            if match_query(old, query):
                del self.docs[doc_id]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class MemoryDB:
    def __init__(self):
        self._cols = {}

    def __getitem__(self, name):
        self._cols.setdefault(name, MemoryCollection())
        return self._cols[name]


def _req(method, path, headers=None, company_id=""):
    q = {}
    if company_id:
        q["company_id"] = company_id
    return SimpleNamespace(
        method=method,
        url=SimpleNamespace(path=path),
        headers=headers or {},
        query_params=q,
        state=SimpleNamespace(),
    )


def _admin(company_id="co_a"):
    return {"_id": "usr_admin", "id": "usr_admin", "name": "Ayşe Yönetici", "role": "admin",
            "company_ids": [company_id], "active_company_id": company_id, "password_hash": "hash-secret",
            "token": "should-not-leak"}


def _sales(company_id="co_a"):
    return {"_id": "usr_sales", "id": "usr_sales", "name": "Satışçı", "role": "sales",
            "company_ids": [company_id], "active_company_id": company_id}


@pytest.fixture
def db():
    return MemoryDB()


def test_feature_hidden_unless_granted():
    assert rbac.feature_default("manager", "company_audit") is False
    assert rbac.feature_default("personel", "company_audit") is False
    assert rbac.role_features({"code": "sales", "features": {}})["company_audit"] is False
    assert rbac.role_features({"code": "sales", "features": {"company_audit": True}})["company_audit"] is True
    assert rbac.role_features({"code": "admin", "features": {}})["company_audit"] is True


def test_router_is_append_only():
    methods = set()
    for route in company_audit.router.routes:
        methods |= set(getattr(route, "methods", None) or [])
    assert "DELETE" not in methods
    assert "PUT" not in methods
    assert "PATCH" not in methods
    assert "POST" not in methods
    assert "GET" in methods


def test_sensitive_fields_never_stored(db):
    before = {
        "_id": "p1", "company_id": "co_a", "name": "Kalem", "sale_price": 100,
        "password": "s3cret", "password_hash": "hash", "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature",
        "card_number": "4111111111111111", "cvv": "123", "api_key": "sk_live_abc",
    }
    after = {**before, "sale_price": 120, "password": "hunter2", "card_number": "5500000000000004"}
    summary = company_audit.diff_summary(before, after)
    assert "100" in summary and "120" in summary
    assert "Fiyat" in summary
    blob = json.dumps(summary, ensure_ascii=False)
    for secret in ("s3cret", "hunter2", "4111111111111111", "5500000000000004", "sk_live_abc", "123"):
        assert secret not in blob


def test_update_commit_omits_secrets_and_records_price(db):
    asyncio.run(_update_commit_omits_secrets_and_records_price(db))


async def _update_commit_omits_secrets_and_records_price(db):
    await db["products"].insert_one({
        "_id": "p1", "company_id": "co_a", "name": "Kalem", "sale_price": 100,
        "password": "s3cret", "card_number": "4111111111111111", "token": "raw-token-value",
    })
    request = _req("PUT", "/api/products/p1", {"x-tamkobi-client": "mobile"}, "co_a")
    user = _admin()
    await company_audit.prepare(request, db, user)
    await db["products"].insert_one({
        "_id": "p1", "company_id": "co_a", "name": "Kalem", "sale_price": 120,
        "password": "hunter2", "card_number": "5500000000000004", "token": "raw-token-value",
    })
    # insert_one overwrites via our memory impl only if same id — replace explicitly
    db["products"].docs["p1"] = {
        "_id": "p1", "company_id": "co_a", "name": "Kalem", "sale_price": 120,
        "password": "hunter2", "card_number": "5500000000000004", "token": "raw-token-value",
    }
    await company_audit.commit_from_request(request, db, user, 200)
    stored = list(db[company_audit.COLLECTION].docs.values())
    assert len(stored) == 1
    row = stored[0]
    text = json.dumps(row, ensure_ascii=False)
    assert "Fiyat 100 → 120" in row["summary"]
    assert row["source"] == "mobile"
    assert row["company_id"] == "co_a"
    assert row["user_name"] == "Ayşe Yönetici"
    assert row["action"] == "update"
    for secret in ("s3cret", "hunter2", "4111111111111111", "5500000000000004", "raw-token-value", "hash-secret", "should-not-leak"):
        assert secret not in text
    assert "password" not in row
    assert "card_number" not in row
    assert "token" not in row


def test_login_does_not_store_password_or_token(db):
    asyncio.run(_login_does_not_store_password_or_token(db))


async def _login_does_not_store_password_or_token(db):
    user = _admin()
    user["password"] = "s3cret"
    request = _req("POST", "/api/auth/login", {"x-tamkobi-client": "mobile"})
    await company_audit.record_auth(db, user, request, "login", "Giriş yapıldı")
    row = list(db[company_audit.COLLECTION].docs.values())[0]
    text = json.dumps(row, ensure_ascii=False)
    assert row["action"] == "login"
    assert row["source"] == "mobile"
    assert "s3cret" not in text
    assert "hash-secret" not in text
    assert "should-not-leak" not in text
    assert "Giriş yapıldı" in row["summary"]


def test_other_company_records_are_hidden_and_forbidden(db):
    asyncio.run(_other_company_records_are_hidden_and_forbidden(db))


async def _other_company_records_are_hidden_and_forbidden(db):
    admin = _admin("co_a")
    await company_audit.write(db, company_id="co_a", user=admin, module="/stock", action="update",
                              record_label="Kalem", summary="Fiyat 100 → 120", ip="10.0.0.1")
    await company_audit.write(db, company_id="co_b", user={"id": "usr_b", "name": "Başka"}, module="/invoices",
                              action="invoice_issue", record_label="FTR-9", summary="Fatura kesildi: FTR-9")
    own = await company_audit.list_entries(db, admin, "co_a")
    assert own["company_id"] == "co_a"
    assert len(own["items"]) == 1
    assert own["items"][0]["record_label"] == "Kalem"
    assert all(item["company_id"] == "co_a" for item in own["items"])
    with pytest.raises(HTTPException) as denied:
        await company_audit.list_entries(db, admin, "co_b")
    assert denied.value.status_code == 403
    with pytest.raises(HTTPException) as missing:
        await company_audit.list_entries(db, admin, "")
    assert missing.value.status_code == 400


def test_unauthorized_role_gets_403_until_granted(db):
    asyncio.run(_unauthorized_role_gets_403_until_granted(db))


async def _unauthorized_role_gets_403_until_granted(db):
    sales = _sales("co_a")
    await company_audit.write(db, company_id="co_a", user=_admin(), module="/stock", action="create",
                              record_label="Kalem", summary="Oluşturuldu: Kalem")
    with pytest.raises(HTTPException) as denied:
        await company_audit.list_entries(db, sales, "co_a")
    assert denied.value.status_code == 403
    await db["roles"].insert_one({
        "_id": "role_sales", "company_id": "co_a", "code": "sales",
        "features": {"company_audit": True},
    })
    seen = await company_audit.list_entries(db, sales, "co_a")
    assert len(seen["items"]) == 1


def test_purge_drops_only_records_older_than_one_year(db):
    asyncio.run(_purge_drops_only_records_older_than_one_year(db))


async def _purge_drops_only_records_older_than_one_year(db):
    old = datetime.now(timezone.utc) - timedelta(days=370)
    fresh = datetime.now(timezone.utc) - timedelta(days=10)
    await db[company_audit.COLLECTION].insert_one({
        "_id": "old", "company_id": "co_a", "at": old.isoformat(),
        "expires_at": (old + timedelta(days=365)).isoformat(), "summary": "eski",
    })
    await db[company_audit.COLLECTION].insert_one({
        "_id": "fresh", "company_id": "co_a", "at": fresh.isoformat(),
        "expires_at": (fresh + timedelta(days=365)).isoformat(), "summary": "yeni",
    })
    deleted = await company_audit.purge_expired(db)
    assert deleted == 1
    assert "old" not in db[company_audit.COLLECTION].docs
    assert "fresh" in db[company_audit.COLLECTION].docs


def test_important_actions_are_classified_and_committed(db):
    asyncio.run(_important_actions_are_classified_and_committed(db))


async def _important_actions_are_classified_and_committed(db):
    assert company_audit.action_for("POST", company_audit.parse_target("/api/products"), ) == "create"
    assert company_audit.action_for("DELETE", company_audit.parse_target("/api/contacts/c1")) == "delete"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/trash/t1/restore")) == "restore"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/orders/o1/approve")) == "approve"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/invoices/i1/send-to-gib")) == "invoice_issue"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/invoices/i1/cancel")) == "invoice_cancel"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/installments/x/pay")) == "payment"
    assert company_audit.action_for("POST", company_audit.parse_target("/api/cheques/c/collect")) == "collection"
    assert company_audit.action_for(
        "POST", company_audit.parse_target("/api/contacts/c1/record-payment"), hint_type="inflow",
    ) == "collection"
    assert company_audit.action_for("PUT", company_audit.parse_target("/api/roles/r1")) == "permission"
    assert company_audit.parse_target("/api/auth/login") is None

    await db["trash"].insert_one({
        "_id": "t1", "company_id": "co_a", "label": "Kalem",
        "doc": {"_id": "p1", "name": "Kalem", "company_id": "co_a"},
    })
    request = _req("POST", "/api/trash/t1/restore", {}, "co_a")
    await company_audit.prepare(request, db, _admin())
    await company_audit.commit_from_request(request, db, _admin(), 200)
    row = list(db[company_audit.COLLECTION].docs.values())[0]
    assert row["action"] == "restore"
    assert "Kalem" in row["summary"]
    assert "geri alındı" in row["summary"]
    assert row["href"].startswith("/")


def test_search_and_csv_keep_summary():
    text = company_audit.to_csv([{
        "at": "2026-01-01T00:00:00+00:00",
        "user_name": "Ayşe",
        "user_id": "usr_admin",
        "module_label": "Stoklar & Ürünler",
        "action_label": "Güncelleme",
        "record_label": "Kalem",
        "record_no": "",
        "summary": "Fiyat 100 → 120",
        "ip": "1.1.1.1",
        "source": "web",
    }])
    assert "Fiyat 100 → 120" in text
    assert "İşlem" in text
