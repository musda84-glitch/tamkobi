"""Sabit comp_nexus_main_01 fallback'i kalkmış olmalı.

Bellek içi veritabanı ve TestClient. 8021'e ve canlı veritabanına bağlanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import logging
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-no-default-company-fallback-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import cheques  # noqa: E402
import company_audit  # noqa: E402
import migration  # noqa: E402
import order_production_recipe  # noqa: E402
import pricing  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import tax_obligations  # noqa: E402
import trade  # noqa: E402
import trash  # noqa: E402
from mysql_store import match_query, new_upsert_doc  # noqa: E402

COMP_A = "comp-a"
COMP_B = "comp-b"
NEXUS = "comp_nexus_main_01"
DENY = "Bu şirket hesabına erişiminiz yok."
MISSING = "Kayıtta firma bilgisi yok."

_ALLOWED_NAMES = {
    "saas.py",
    "saas_billing.py",
    "legal_docs.py",
    "platform_public.py",
    "rbac.py",
    "addons.py",
}
_SKIP_DIRS = {"tests", "scripts", "__pycache__", ".pytest_cache"}

_CSV = (
    "Cari Adı,Tür,Telefon\n"
    "Örnek A.Ş.,customer,05320000000\n"
    "İkinci Ltd,supplier,05321111111\n"
).encode("utf-8")
_PDF = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF"
_DAYS = {"0": {"start": "09:00", "end": "18:00", "break_minutes": 60}}


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs

    def sort(self, key, direction=1):
        return self

    def limit(self, n):
        return self

    async def to_list(self, length=None):
        rows = copy.deepcopy(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return rows

    def __aiter__(self):
        rows = copy.deepcopy(self._docs)

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def find(self, query=None, projection=None):
        return MemCursor([d for d in self.docs if match_query(d, query or {})])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        self.docs.extend(copy.deepcopy(list(docs)))
        return SimpleNamespace(inserted_ids=[d.get("_id") for d in docs])

    async def update_one(self, query, update, upsert=False):
        from mysql_store import apply_update

        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def delete_one(self, query=None):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl(name, self)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, company_ids, active, *, role="admin"):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
        "user_number": "U-000001" if uid == "user-a" else "U-000002",
    }


def _token(uid):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin")


def _auth(uid):
    return {"Authorization": f"Bearer {_token(uid)}"}


def _snapshot(db):
    """Yalnızca dolu koleksiyonlar. Boş getattr koleksiyonu yazma sayılmaz."""
    return {
        name: copy.deepcopy(coll.docs)
        for name, coll in db._cols.items()
        if coll.docs
    }


def _nexus_rows(db):
    rows = []
    for name, coll in sorted(db._cols.items()):
        for doc in coll.docs:
            if doc.get("company_id") == NEXUS or doc.get("_id") == NEXUS:
                rows.append((name, doc.get("_id")))
            inner = doc.get("doc")
            if isinstance(inner, dict) and inner.get("company_id") == NEXUS:
                rows.append((name, doc.get("_id")))
    return rows


async def _fake_extract(data, name, content_type="", source_kind=""):
    return {
        "draft": {
            "source_kind": "tahakkuk",
            "title": "KDV",
            "period": "2026-01",
            "obligations": [{"amount": 100, "period": "2026-01", "payment_status": "unpaid"}],
        },
        "source": "test",
    }


def _exercise(client, headers, company):
    """company is _OMIT or an explicit id the endpoint should see."""
    cheque = {"contact_id": "ctA", "amount": 150, "direction": "received", "skip_ledger": True}
    trash_body = {}
    template = {"name": "Sabah", "days": _DAYS}
    rule = {"margin_pct": 25}
    form = {"entity": "contacts", "source": "other"}
    params = {}
    if company is not _OMIT:
        cheque["company_id"] = company
        trash_body["company_id"] = company
        template["company_id"] = company
        rule["company_id"] = company
        form["company_id"] = company
        params["company_id"] = company
    return [
        client.post("/api/cheques", json=cheque, headers=headers),
        client.post("/api/trash/empty", json=trash_body, headers=headers),
        client.post("/api/personnel/shift-templates", json=template, headers=headers),
        client.post(
            "/api/migration/parse",
            files={"file": ("cariler.csv", _CSV, "text/csv")},
            data=form,
            headers=headers,
        ),
        client.post(
            "/api/tax-obligations/extract",
            files={"file": ("belge.pdf", _PDF, "application/pdf")},
            params=params or None,
            headers=headers,
        ),
        client.put("/api/pricing/rules/trendyol", json=rule, headers=headers),
    ]


_OMIT = object()


@pytest.fixture()
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-none", [], None),
    ])
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "A"},
        {"_id": COMP_B, "name": "B"},
        {"_id": NEXUS, "name": "Demo"},
    ])
    db.contacts.docs.append({"_id": "ctA", "company_id": COMP_A, "name": "Cari A", "balance": 0})
    db.trash.docs.extend([
        {"_id": "tA", "company_id": COMP_A, "entity_type": "product", "label": "A"},
        {"_id": "tB", "company_id": COMP_B, "entity_type": "product", "label": "B"},
        {"_id": "tN", "company_id": NEXUS, "entity_type": "product", "label": "N"},
    ])
    db.products.docs.extend([
        {"_id": "prod-a", "company_id": COMP_A, "name": "Vida", "sku": "VIDA", "stock_quantity": 4},
        {"_id": "prod-none", "company_id": None, "name": "Adsız", "sku": "SKU-NONE", "stock_quantity": 1},
    ])

    prev = (
        server.db,
        cheques._db, cheques._current_user,
        trash._db, trash._current_user,
        attendance._db, attendance._current_user,
        migration._db, migration._current_user,
        tax_obligations._db, tax_obligations._current_user,
        pricing._db, pricing._current_user,
        rbac._db, saas._db, addons._db, company_audit._db,
    )
    server.db = db
    cheques._db = trash._db = attendance._db = migration._db = tax_obligations._db = pricing._db = db
    cheques._current_user = trash._current_user = attendance._current_user = migration._current_user = server.get_current_user
    tax_obligations._current_user = pricing._current_user = server.get_current_user
    rbac._db = saas._db = addons._db = company_audit._db = db
    saas.invalidate()

    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch("tax_obligations.extract_tax_file", _fake_extract):
            client.__enter__()
            entered = True
            yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        (
            server.db,
            cheques._db, cheques._current_user,
            trash._db, trash._current_user,
            attendance._db, attendance._current_user,
            migration._db, migration._current_user,
            tax_obligations._db, tax_obligations._current_user,
            pricing._db, pricing._current_user,
            rbac._db, saas._db, addons._db, company_audit._db,
        ) = prev
        saas.invalidate()


def test_production_sources_have_no_default_company_fallback():
    hits = []
    for path in _BACKEND.rglob("*.py"):
        rel = path.relative_to(_BACKEND)
        if rel.parts and rel.parts[0] in _SKIP_DIRS:
            continue
        name = path.name
        if name == "demo.py" or name.startswith("seed") or name in _ALLOWED_NAMES:
            continue
        if NEXUS in path.read_text(encoding="utf-8"):
            hits.append(str(rel))
    assert hits == []


def test_allowed_files_still_name_the_demo_company():
    for name in ("saas.py", "saas_billing.py", "legal_docs.py", "platform_public.py", "rbac.py", "addons.py", "demo.py", "seed_data.py"):
        assert NEXUS in (_BACKEND / name).read_text(encoding="utf-8")


def test_omitted_company_uses_active_company(api):
    client, db = api
    headers = _auth("user-a")
    cheque, emptied, template, parsed, tax, rule = _exercise(client, headers, _OMIT)

    assert cheque.status_code == 200, cheque.text
    assert cheque.json()["company_id"] == COMP_A
    assert [d["company_id"] for d in db.cheques.docs] == [COMP_A]

    assert emptied.status_code == 200, emptied.text
    assert emptied.json()["deleted"] == 1
    assert {d["_id"] for d in db.trash.docs} == {"tB", "tN"}

    assert template.status_code == 200, template.text
    assert template.json()["company_id"] == COMP_A
    assert db.shift_templates.docs[-1]["company_id"] == COMP_A

    assert parsed.status_code == 200, parsed.text
    assert parsed.json()["row_count"] == 2
    assert db.migration_uploads.docs[-1]["company_id"] == COMP_A

    assert tax.status_code == 200, tax.text
    assert tax.json()["company_id"] == COMP_A
    assert db.tax_documents.docs[-1]["company_id"] == COMP_A

    assert rule.status_code == 200, rule.text
    assert db.pricing_rules.docs[-1]["company_id"] == COMP_A
    assert db.pricing_rules.docs[-1]["channel"] == "trendyol"

    assert not any(cid == NEXUS for _name, cid in ((n, i) for n, i in _nexus_rows(db) if n != "companies" and n != "trash"))
    assert any(d["_id"] == "tN" and d["company_id"] == NEXUS for d in db.trash.docs)


def test_foreign_company_is_forbidden_and_writes_nothing(api):
    client, db = api
    before = _snapshot(db)
    nexus_before = _nexus_rows(db)
    for response in _exercise(client, _auth("user-a"), COMP_B):
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == DENY
    assert _snapshot(db) == before
    assert _nexus_rows(db) == nexus_before


def test_user_without_company_is_rejected_and_demo_is_untouched(api):
    client, db = api
    before = _snapshot(db)
    for response in _exercise(client, _auth("user-none"), _OMIT):
        assert response.status_code == 403, response.text
        assert response.json()["detail"] == DENY
    assert _snapshot(db) == before
    assert any(d["company_id"] == NEXUS for d in db.trash.docs)
    assert db.cheques.docs == []
    assert db.shift_templates.docs == []
    assert db.migration_uploads.docs == []
    assert db.tax_documents.docs == []
    assert db.pricing_rules.docs == []


def test_record_without_company_returns_400_or_skips(api, caplog):
    client, db = api
    with pytest.raises(HTTPException) as trade_exc:
        trade._doc_from_req({})
    assert trade_exc.value.status_code == 400
    assert trade_exc.value.detail == MISSING
    kept = trade._doc_from_req({}, existing={"company_id": COMP_A, "kind": "export"})
    assert kept["company_id"] == COMP_A

    line = {"product_id": "p", "product_name": "P", "quantity": 1}
    with pytest.raises(ValueError, match=MISSING):
        order_production_recipe.build_order_recipe_payload({"_id": "o1"}, [line])
    with pytest.raises(ValueError, match=MISSING):
        order_production_recipe.recipe_mongo_doc({"name": "x"})
    payload = order_production_recipe.build_order_recipe_payload(
        {"_id": "o1", "company_id": COMP_A, "order_number": "S-1"},
        [line],
    )
    assert payload["company_id"] == COMP_A
    assert order_production_recipe.recipe_mongo_doc(payload)["company_id"] == COMP_A

    copied = client.post("/api/products/prod-none/copy", headers=_auth("user-a"))
    assert copied.status_code == 400, copied.text
    assert copied.json()["detail"] == MISSING
    assert [d["_id"] for d in db.products.docs] == ["prod-a", "prod-none"]

    own = client.post("/api/products/prod-a/copy", headers=_auth("user-a"))
    assert own.status_code == 200, own.text
    assert own.json()["company_id"] == COMP_A
    assert not any(d.get("company_id") == NEXUS for d in db.products.docs)

    caplog.set_level(logging.WARNING)
    updated = client.put(
        "/api/products/prod-none",
        json={"category": "Hırdavat", "unit": "Adet", "name": "Adsız 2"},
        headers=_auth("user-a"),
    )
    assert updated.status_code == 200, updated.text
    assert db.product_categories.docs == []
    assert db.units.docs == []
    assert any("kayıtta firma bilgisi yok" in rec.message for rec in caplog.records)
    stored = next(d for d in db.products.docs if d["_id"] == "prod-none")
    assert stored.get("company_id") in (None, "")
    assert stored.get("name") == "Adsız 2"


def test_auth_me_license_requires_active_company(api):
    client, db = api
    calls = []
    real = saas.effective

    async def _spy(company_id):
        calls.append(company_id)
        return await real(company_id)

    with patch("server.saas.effective", _spy):
        missing = client.get("/api/auth/me", headers=_auth("user-none"))
        assert missing.status_code == 200, missing.text
        assert missing.json()["user"]["active_company_id"] is None
        assert missing.json()["license"] is None
        assert calls == []

        present = client.get("/api/auth/me", headers=_auth("user-a"))

    assert present.status_code == 200, present.text
    assert present.json()["user"]["active_company_id"] == COMP_A
    assert present.json()["license"]["company_id"] == COMP_A
    assert calls == [COMP_A]
    assert not any(d.get("company_id") == NEXUS for d in db.cheques.docs)


def test_compute_prices_internal_call_requires_payload_company():
    with pytest.raises(HTTPException) as exc:
        _run(pricing.compute_prices({"channel": "trendyol"}))
    assert exc.value.status_code == 400
    assert exc.value.detail == "Şirket seçilmedi."
    src = inspect.getsource(pricing.compute_prices)
    assert "resolve_company_id" in src
    assert NEXUS not in src


def test_session_payload_uses_active_company_only():
    src = inspect.getsource(server._issue_session_for_user)
    me = inspect.getsource(server.get_me)
    for text in (src, me):
        assert NEXUS not in text
        assert "active_cid" in text
        assert "if active_cid else None" in text
