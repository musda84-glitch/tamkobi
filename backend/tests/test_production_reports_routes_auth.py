"""Production requirements and report GET routes: route-level auth and company resolution.

In-process TestClient and a memory database. No live server, port 8021, MySQL, or tamkobi_p0.
SMTP and WhatsApp are mocked.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-production-reports-routes-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import comm_service  # noqa: E402
import event_notify  # noqa: E402
import pricing  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, project_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
NEXUS = "comp_nexus_main_01"
DENY = "Bu şirket hesabına erişiminiz yok."
RANGE = {"date_from": "2026-10-01", "date_to": "2026-10-31"}
_NOW = datetime.now(timezone.utc).isoformat()


def _run(coro):
    return asyncio.run(coro)


class MemCursor:
    def __init__(self, docs):
        self._docs = docs
        self._sort = None
        self._limit = None

    def sort(self, key, direction=1):
        self._sort = [(key, direction)] if isinstance(key, str) else list(key)
        return self

    def limit(self, n):
        self._limit = int(n)
        return self

    def _rows(self, length=None):
        rows = sort_docs(list(self._docs), self._sort) if self._sort else list(self._docs)
        cap = self._limit
        if length is not None:
            cap = int(length) if cap is None else min(cap, int(length))
        if cap is not None:
            rows = rows[:cap]
        return copy.deepcopy(rows)

    async def to_list(self, length=None):
        return self._rows(length)

    def __aiter__(self):
        rows = self._rows()

        async def _gen():
            for row in rows:
                yield row

        return _gen()


class MemColl:
    def __init__(self, name, db):
        self.name = name
        self.db = db
        self.docs = []

    def _note(self, op):
        self.db.writes.append({"coll": self.name, "op": op})

    def find(self, query=None, projection=None):
        matched = []
        for doc in self.docs:
            if match_query(doc, query or {}):
                matched.append(project_doc(doc, projection) if projection else doc)
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None, sort=None):
        rows = [doc for doc in self.docs if match_query(doc, query or {})]
        if sort:
            rows = sort_docs(rows, sort)
        for doc in rows:
            return project_doc(doc, projection) if projection else copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def insert_one(self, doc):
        self._note("insert_one")
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        self._note("update_one")
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def create_index(self, *args, **kwargs):
        return None


class MemDB:
    def __init__(self):
        self._cols = {}
        self.writes = []
        self.side = {"smtp": [], "wa": [], "mail": []}

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

    async def list_collection_names(self):
        return list(self._cols)

    async def _ensure(self):
        return None


def _user(uid, company_ids, active, *, superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _user_a():
    return _user("user-a", [COMP_A], COMP_A)


def _invoice(doc_id, company_id, **extra):
    base = {
        "_id": doc_id,
        "company_id": company_id,
        "invoice_type": "sales",
        "status": "issued",
        "payment_status": "unpaid",
        "grand_total": 0,
        "paid_amount": 0,
        "subtotal": 0,
        "vat_total": 0,
        "issue_date": "2026-10-01",
        "due_date": "2026-10-15",
        "contact_id": "",
        "contact_name": "",
        "items": [],
    }
    base.update(extra)
    return base


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A"},
        {"_id": COMP_B, "name": "B-SECRET LTD"},
        {"_id": NEXUS, "name": "NEXUS-ONLY"},
    ])
    db.invoices.docs.extend([
        _invoice(
            "invSalesA", COMP_A, payment_status="partially_paid", grand_total=120, paid_amount=20,
            subtotal=100, vat_total=20, contact_id="ctA", contact_name="Cari A", due_date="2020-01-01",
            items=[{"name": "Kalem A", "quantity": 2, "total": 100, "vat_rate": 20, "product_id": "prodA", "cost_price": 30}],
        ),
        _invoice(
            "invPurchA", COMP_A, invoice_type="purchase", payment_status="paid", grand_total=60, paid_amount=60,
            subtotal=50, vat_total=10, contact_id="ctSupA", contact_name="Tedarik A",
            items=[{"name": "Alış A", "quantity": 1, "total": 50, "vat_rate": 20, "product_id": "rawA"}],
        ),
        _invoice(
            "invSalesB", COMP_B, grand_total=999, paid_amount=0, subtotal=800, vat_total=199,
            contact_id="ctB", contact_name="B-SECRET", due_date="2020-01-01",
            items=[{"name": "B-SECRET-ITEM", "quantity": 9, "total": 800, "vat_rate": 20, "product_id": "prodB", "cost_price": 1}],
        ),
        _invoice(
            "invPurchB", COMP_B, invoice_type="purchase", payment_status="unpaid", grand_total=480, paid_amount=0,
            subtotal=400, vat_total=80, contact_id="ctSupB", contact_name="B-SECRET-ALIS", due_date="2020-01-01",
            items=[{"name": "B-SECRET-ALIS", "quantity": 4, "total": 400, "vat_rate": 20, "product_id": "rawB"}],
        ),
        _invoice(
            "invSalesN", NEXUS, grand_total=3, paid_amount=0, subtotal=3, vat_total=0,
            contact_id="ctN", contact_name="NEXUS-ONLY",
            items=[{"name": "NEXUS-ONLY", "quantity": 1, "total": 3, "vat_rate": 0, "product_id": "prodN", "cost_price": 1}],
        ),
    ])
    db.contacts.docs.extend([
        {"_id": "ctA", "company_id": COMP_A, "name": "Cari A", "phone": "555A"},
        {"_id": "ctB", "company_id": COMP_B, "name": "B-SECRET", "phone": "555B"},
    ])
    db.products.docs.extend([
        {"_id": "prodA", "company_id": COMP_A, "name": "Ürün A", "sku": "SKU-A", "category": "KatA", "unit": "Adet",
         "type": "product", "stock_quantity": 3, "min_stock_alert": 5, "purchase_price": 10, "sale_price": 40, "track_stock": True},
        {"_id": "rawA", "company_id": COMP_A, "name": "Ham A", "sku": "RAW-A", "category": "Hammadde", "unit": "Adet",
         "type": "raw_material", "stock_quantity": 4, "min_stock_alert": 0, "purchase_price": 10, "sale_price": 0, "track_stock": True},
        {"_id": "svcA", "company_id": COMP_A, "name": "Servis A", "sku": "SVC-A", "type": "service", "stock_quantity": 9,
         "min_stock_alert": 1, "purchase_price": 1, "sale_price": 2, "track_stock": False},
        {"_id": "prodB", "company_id": COMP_B, "name": "B-SECRET", "sku": "SKU-B", "category": "KatB", "unit": "Adet",
         "type": "product", "stock_quantity": 0, "min_stock_alert": 1, "purchase_price": 100, "sale_price": 500, "track_stock": True},
        {"_id": "rawB", "company_id": COMP_B, "name": "B-SECRET-HAM", "sku": "RAW-B", "category": "Hammadde", "unit": "Adet",
         "type": "raw_material", "stock_quantity": 50, "min_stock_alert": 1, "purchase_price": 8, "sale_price": 9, "track_stock": True},
        {"_id": "prodN", "company_id": NEXUS, "name": "NEXUS-ONLY", "sku": "SKU-N", "type": "product", "stock_quantity": 1,
         "min_stock_alert": 0, "purchase_price": 1, "sale_price": 1, "track_stock": True},
    ])
    db.expenses.docs.extend([
        {"_id": "expA", "company_id": COMP_A, "amount": 15, "date": "2026-10-01", "category": "Kira A"},
        {"_id": "expB", "company_id": COMP_B, "amount": 700, "date": "2026-10-01", "category": "B-SECRET"},
    ])
    db.bank_transactions.docs.extend([
        {"_id": "txInA", "company_id": COMP_A, "date": "2026-10-01", "type": "inflow", "amount": 40, "category": "Satış"},
        {"_id": "txOutA", "company_id": COMP_A, "date": "2026-10-02", "type": "outflow", "amount": 5, "category": "Kira"},
        {"_id": "txTrA", "company_id": COMP_A, "date": "2026-10-01", "type": "transfer", "amount": 1000, "category": "Virman"},
        {"_id": "txInB", "company_id": COMP_B, "date": "2026-10-01", "type": "inflow", "amount": 9000, "category": "B-SECRET"},
    ])
    db.bank_accounts.docs.extend([
        {"_id": "accA", "company_id": COMP_A, "current_balance": 100, "account_name": "Kasa A"},
        {"_id": "accB", "company_id": COMP_B, "current_balance": 8000, "account_name": "B-SECRET"},
    ])
    db.orders.docs.extend([
        {"_id": "ordA", "company_id": COMP_A, "created_at": _NOW, "order_date": _NOW, "channel": "manual",
         "total_amount": 42, "order_status": "approved", "customer_name": "Müşteri A"},
        {"_id": "ordB", "company_id": COMP_B, "created_at": _NOW, "order_date": _NOW, "channel": "B-SECRET",
         "total_amount": 7777, "order_status": "approved", "customer_name": "B-SECRET"},
    ])
    db.marketplace_claims.docs.extend([
        {"_id": "clA", "company_id": COMP_A, "status": "Created"},
        {"_id": "clB", "company_id": COMP_B, "status": "Created"},
    ])
    include = {"orders": True, "low_stock": True, "shipments": True, "receivables": True}
    db.morning_summary_settings.docs.extend([
        {"_id": "msA", "company_id": COMP_A, "enabled": True, "time": "07:30", "emails": ["a@firma.test"],
         "whatsapp_numbers": ["5551112233"], "include": include, "last_sent": "2026-10-01T00:00:00+00:00",
         "last_result": {"email": {"ok": True}}, "last_sent_day": "2000-01-01"},
        {"_id": "msB", "company_id": COMP_B, "enabled": True, "time": "09:45", "emails": ["b-secret@firma.test"],
         "whatsapp_numbers": ["5559998877"], "include": include, "last_sent": "B-SECRET-SENT",
         "last_result": {"error": "B-SECRET"}, "last_sent_day": "2000-01-01"},
    ])
    for cid in (COMP_A, COMP_B):
        db.company_notify_prefs.docs.append({
            "_id": f"cnp_{cid}",
            "company_id": cid,
            "events": {
                "morning_summary": {"inapp": True, "email": True, "sms": False, "digest": "instant"},
            },
        })
    db.recipes.docs.extend([
        {
            "_id": "recA", "company_id": COMP_A, "name": "Reçete A", "target_quantity": 1, "unit": "Adet",
            "labor_cost": 0, "overhead_cost": 0, "is_active": True,
            "materials": [
                {"product_id": "rawA", "product_name": "Ham A", "quantity": 1, "unit": "Adet", "cost_per_unit": 10, "wastage_percent": 0},
                {"product_id": "rawB", "product_name": "Yabancı kalem", "quantity": 1, "unit": "Adet", "cost_per_unit": 3, "wastage_percent": 0},
            ],
        },
        {
            "_id": "recB", "company_id": COMP_B, "name": "B-SECRET-RECETE", "target_quantity": 1, "unit": "Adet",
            "labor_cost": 0, "overhead_cost": 0, "is_active": True,
            "materials": [
                {"product_id": "rawB", "product_name": "B-SECRET-HAM", "quantity": 1, "unit": "Adet", "cost_per_unit": 8, "wastage_percent": 0},
            ],
        },
    ])


def _get_routes():
    return [
        (server.get_report, server.get_current_user, "/api/reports/sales", {"kind": "sales"}),
        (server.production_requirements, server.get_current_user, "/api/production/requirements", {"recipe_id": "recA", "quantity": 2}),
        (pricing.get_summary_settings, pricing._user_dep, "/api/reports/morning-summary/settings", {}),
        (pricing.preview_summary, pricing._user_dep, "/api/reports/morning-summary/preview", {}),
    ]


def _snapshot(db):
    # Lisans kontrolü boş company_licenses / platform_settings koleksiyonu açabilir.
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items() if coll.docs}


def _no_foreign(text):
    assert "B-SECRET" not in text
    assert "NEXUS-ONLY" not in text


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=superadmin)


def _auth(uid, *, superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin)}"}


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    db.users.docs.append(_user("user-sa-a", [COMP_A], COMP_A, superadmin=True))
    _seed(db)
    prev = (server.db, rbac._db, saas._db, addons._db, pricing._db, pricing._current_user, dict(pricing._deps), event_notify._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    pricing._db = db
    event_notify._db = db
    pricing._current_user = server.get_current_user

    async def mail_account(company_id):
        db.side["mail"].append(company_id)
        return {"email": "from@firma.test", "display_name": "From"}

    async def wa_send(payload):
        db.side["wa"].append(copy.deepcopy(payload))
        return {"simulated": True}

    async def smtp_send(acc, to, subject, body, html=None, **kwargs):
        db.side["smtp"].append({"to": list(to), "subject": subject, "body": body, "company_hint": acc.get("display_name")})

    pricing._deps["mail_account"] = mail_account
    pricing._deps["wa_send"] = wa_send
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(comm_service, "smtp_send", smtp_send):
            client.__enter__()
            entered = True
            yield client, db
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, pricing._db, pricing._current_user, pricing._deps, event_notify._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def test_route_signatures_have_auth_and_no_nexus_default():
    for fn, dep, _path, _extra in _get_routes():
        sig = inspect.signature(fn)
        assert sig.parameters["company_id"].default is None
        assert sig.parameters["user"].default.dependency is dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
    for fn in (pricing.put_summary_settings, pricing.send_summary_now):
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is pricing._user_dep
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert 'resolve_company_id(user, req.get("company_id"))' in src
    report = inspect.getsource(server.get_report)
    assert "cid = tenant_access.resolve_company_id(user, company_id)" in report
    assert "comp_nexus_main_01" not in report
    assert ".to_list(20000)" in report and ".to_list(50000)" in report and ".to_list(10000)" in report
    assert 'detail="Rapor türü bulunamadı."' in report
    req = inspect.getsource(server.production_requirements)
    assert 'get_tenant_doc(db, "recipes", recipe_id, user, not_found="Reçete bulunamadı.")' in req
    assert "stock_company_id=r.get(\"company_id\")" in req
    assert "_recipe_costs(r)" in req
    pricing_text = Path(pricing.__file__).read_text(encoding="utf-8")
    assert "await get_summary_settings(" not in pricing_text
    assert "await preview_summary(" not in pricing_text
    assert pricing_text.count("await summary_settings_payload(") >= 3
    assert "await summary_preview_payload(" in pricing_text
    sched = inspect.getsource(pricing.scheduler_loop)
    assert "await send_summary(" in sched
    assert "get_summary_settings" not in sched
    assert "send_summary_now" not in sched
    assert "preview_summary" not in sched
    server_text = Path(server.__file__).read_text(encoding="utf-8")
    assert "await get_report(" not in server_text
    for name in ("get_summary_settings", "preview_summary", "put_summary_settings", "send_summary_now"):
        assert "comp_nexus_main_01" not in inspect.getsource(getattr(pricing, name))


def test_no_token_is_401(api):
    client, db = api
    before = _snapshot(db)
    calls = [
        ("get", "/api/reports/sales", None),
        ("get", "/api/production/requirements", {"recipe_id": "recA"}),
        ("get", "/api/reports/morning-summary/settings", None),
        ("get", "/api/reports/morning-summary/preview", None),
        ("put", "/api/reports/morning-summary/settings", {}),
        ("post", "/api/reports/morning-summary/send", {}),
    ]
    for method, path, payload in calls:
        if method == "get":
            response = client.get(path, params=payload)
        elif method == "put":
            response = client.put(path, json=payload)
        else:
            response = client.post(path, json=payload)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == "Giriş yapmanız gerekiyor."
        _no_foreign(response.text)
    assert _snapshot(db) == before
    assert db.writes == []
    assert db.side == {"smtp": [], "wa": [], "mail": []}


def test_direct_call_without_user_is_401(api):
    _client, db = api
    before = _snapshot(db)
    with pytest.raises(HTTPException) as exc:
        _run(server.get_report(kind="sales", company_id=COMP_A, user=None))
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _run(server.production_requirements(recipe_id="recA", user=None))
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _run(pricing.get_summary_settings(company_id=COMP_A, user=None))
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _run(pricing.preview_summary(company_id=COMP_A, user=None))
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _run(pricing.put_summary_settings({"company_id": COMP_A}, user=None))
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        _run(pricing.send_summary_now({"company_id": COMP_A}, user=None))
    assert exc.value.status_code == 401
    assert _snapshot(db) == before
    assert db.side["smtp"] == [] and db.side["wa"] == []


def test_other_company_is_403_and_send_is_not_called(api):
    client, db = api
    before = _snapshot(db)
    headers = _auth("user-a")
    gets = [
        ("/api/reports/sales", {**RANGE, "company_id": COMP_B}),
        ("/api/reports/profit", {**RANGE, "company_id": COMP_B, "group": "product"}),
        ("/api/reports/stock", {"company_id": COMP_B}),
        ("/api/reports/vat", {**RANGE, "company_id": COMP_B}),
        ("/api/production/requirements", {"recipe_id": "recA", "quantity": 2, "company_id": COMP_B}),
        ("/api/reports/morning-summary/settings", {"company_id": COMP_B}),
        ("/api/reports/morning-summary/preview", {"company_id": COMP_B}),
    ]
    for path, params in gets:
        response = client.get(path, params=params, headers=headers)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        _no_foreign(response.text)
    put = client.put("/api/reports/morning-summary/settings", json={"company_id": COMP_B, "enabled": False}, headers=headers)
    assert put.status_code == 403, put.text
    assert put.json()["detail"] == DENY
    sent = client.post("/api/reports/morning-summary/send", json={"company_id": COMP_B}, headers=headers)
    assert sent.status_code == 403, sent.text
    assert sent.json()["detail"] == DENY
    _no_foreign(sent.text)
    assert _snapshot(db) == before
    assert db.writes == []
    assert db.side == {"smtp": [], "wa": [], "mail": []}


def test_direct_call_other_company_is_403_without_middleware(api):
    _client, db = api
    user_a = _user_a()
    before = _snapshot(db)
    with pytest.raises(HTTPException) as exc:
        _run(server.get_report(kind="vat", company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403 and exc.value.detail == DENY
    with pytest.raises(HTTPException) as exc:
        _run(server.production_requirements(recipe_id="recA", quantity=2, company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403 and exc.value.detail == DENY
    with pytest.raises(HTTPException) as exc:
        _run(pricing.preview_summary(company_id=COMP_B, user=user_a))
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        _run(pricing.send_summary_now({"company_id": COMP_B}, user=user_a))
    assert exc.value.status_code == 403
    assert db.side["smtp"] == [] and db.side["wa"] == [] and db.side["mail"] == []
    assert _snapshot(db) == before


def test_missing_company_id_uses_active_company_only(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    sales = client.get("/api/reports/sales", params=RANGE, headers=headers)
    assert sales.status_code == 200, sales.text
    _no_foreign(sales.text)
    direct = _run(server.get_report(kind="sales", company_id=None, user=user_a, **RANGE))
    assert sales.json() == direct
    assert sales.json()["rows"][0]["name"] == "Cari A"
    assert sales.json()["totals"]["gross"] == 120

    blank = client.get("/api/reports/stock", params={"company_id": ""}, headers=headers)
    assert blank.status_code == 200, blank.text
    _no_foreign(blank.text)
    assert [row["name"] for row in blank.json()["rows"]] == ["Ham A", "Ürün A"]

    req = client.get("/api/production/requirements", params={"recipe_id": "recA", "quantity": 2}, headers=headers)
    assert req.status_code == 200, req.text
    _no_foreign(req.text)
    direct_req = _run(server.production_requirements(recipe_id="recA", quantity=2, company_id=None, user=user_a))
    assert req.json() == direct_req

    settings = client.get("/api/reports/morning-summary/settings", headers=headers)
    assert settings.status_code == 200, settings.text
    _no_foreign(settings.text)
    assert settings.json()["emails"] == ["a@firma.test"]
    assert settings.json() == _run(pricing.get_summary_settings(company_id=None, user=user_a))

    preview = client.get("/api/reports/morning-summary/preview", headers=headers)
    assert preview.status_code == 200, preview.text
    _no_foreign(preview.text)
    assert preview.json() == _run(pricing.preview_summary(company_id=None, user=user_a))
    assert "Firma A" in preview.json()["text"]
    assert db.side["smtp"] == [] and db.side["wa"] == []


def test_reports_return_only_own_company_data(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()

    sales = client.get("/api/reports/sales", params={**RANGE, "company_id": COMP_A, "group": "contact"}, headers=headers)
    assert sales.status_code == 200, sales.text
    body = sales.json()
    assert body["kind"] == "sales" and body["group"] == "contact"
    assert [row["name"] for row in body["rows"]] == ["Cari A"]
    assert body["totals"] == {"count": 1, "net": 100.0, "vat": 20.0, "gross": 120.0, "paid": 20.0, "open": 100.0}
    _no_foreign(sales.text)
    assert body == _run(server.get_report(kind="sales", company_id=COMP_A, group="contact", user=user_a, **RANGE))

    purchases = client.get("/api/reports/purchases", params={**RANGE, "company_id": COMP_A}, headers=headers)
    assert purchases.status_code == 200, purchases.text
    assert [row["name"] for row in purchases.json()["rows"]] == ["Tedarik A"]
    assert purchases.json()["totals"]["gross"] == 60
    _no_foreign(purchases.text)

    profit = client.get("/api/reports/profit", params={**RANGE, "company_id": COMP_A, "group": "product"}, headers=headers)
    assert profit.status_code == 200, profit.text
    pb = profit.json()
    assert [row["name"] for row in pb["rows"]] == ["Kalem A"]
    assert pb["totals"]["revenue"] == 100
    assert pb["totals"]["cost"] == 60
    assert pb["totals"]["expenses"] == 15
    assert pb["totals"]["net_profit"] == 25
    _no_foreign(profit.text)
    assert pb == _run(server.get_report(kind="profit", company_id=COMP_A, group="product", user=user_a, **RANGE))

    stock = client.get("/api/reports/stock", params={"company_id": COMP_A}, headers=headers)
    assert stock.status_code == 200, stock.text
    sb = stock.json()
    assert [row["name"] for row in sb["rows"]] == ["Ham A", "Ürün A"]
    assert sb["totals"]["count"] == 2
    assert sb["totals"]["cost_value"] == 70
    assert sb["totals"]["critical"] == 0
    assert sb["totals"]["low"] == 1
    assert sb["rows"][1]["status"] == "low"
    _no_foreign(stock.text)

    vat = client.get("/api/reports/vat", params={**RANGE, "company_id": COMP_A}, headers=headers)
    assert vat.status_code == 200, vat.text
    vb = vat.json()
    assert vb["totals"]["sales_vat"] == 20
    assert vb["totals"]["purchase_vat"] == 10
    assert vb["totals"]["payable_vat"] == 10
    assert [row["name"] for row in vb["rows"]] == ["2026-10"]
    _no_foreign(vat.text)

    aging = client.get("/api/reports/aging", params={"company_id": COMP_A}, headers=headers)
    assert aging.status_code == 200, aging.text
    ab = aging.json()
    assert [row["name"] for row in ab["rows"]] == ["Cari A"]
    assert ab["rows"][0]["phone"] == "555A"
    assert ab["rows"][0]["d90p"] == 100
    assert ab["totals"]["total"] == 100
    assert ab["totals_payable"]["total"] == 0
    _no_foreign(aging.text)

    cash = client.get("/api/reports/cashflow", params={**RANGE, "company_id": COMP_A}, headers=headers)
    assert cash.status_code == 200, cash.text
    cb = cash.json()
    assert cb["totals"]["inflow"] == 40
    assert cb["totals"]["outflow"] == 5
    assert cb["totals"]["net"] == 35
    assert cb["totals"]["cash_now"] == 100
    assert cb["totals"]["expected_in"] == 100
    assert cb["totals"]["expected_out"] == 0
    assert cb["totals"]["projected"] == 200
    assert [row["name"] for row in cb["categories"]] == ["Kira", "Satış"]
    _no_foreign(cash.text)

    unknown = client.get("/api/reports/unicorn", params={"company_id": COMP_A}, headers=headers)
    assert unknown.status_code == 404, unknown.text
    assert unknown.json()["detail"] == "Rapor türü bulunamadı."
    _no_foreign(unknown.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.get_report(kind="unicorn", company_id=COMP_A, user=user_a))
    assert exc.value.status_code == 404
    assert exc.value.detail == "Rapor türü bulunamadı."
    assert db.side["smtp"] == [] and db.writes == []


def test_production_requirements_hides_other_company_recipe_and_stock(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    own = client.get("/api/production/requirements", params={"recipe_id": "recA", "quantity": 2, "company_id": COMP_A}, headers=headers)
    assert own.status_code == 200, own.text
    body = own.json()
    by_id = {row["product_id"]: row for row in body["rows"]}
    assert by_id["rawA"]["in_stock"] == 4
    assert by_id["rawA"]["needed"] == 2
    assert by_id["rawA"]["shortage"] == 0
    assert by_id["rawA"]["cost"] == 20
    assert by_id["rawB"]["in_stock"] == 0
    assert by_id["rawB"]["shortage"] == 2
    assert by_id["rawB"]["product_name"] == "Yabancı kalem"
    assert body["total_material_cost"] == 26
    assert body["unit_cost"] == 13
    assert body["estimated_total_cost"] == 26
    assert body["has_shortage"] is True
    _no_foreign(own.text)
    assert body == _run(server.production_requirements(recipe_id="recA", quantity=2, company_id=COMP_A, user=user_a))

    hidden = client.get("/api/production/requirements", params={"recipe_id": "recB", "quantity": 1}, headers=headers)
    assert hidden.status_code == 404, hidden.text
    assert hidden.json()["detail"] == "Reçete bulunamadı."
    _no_foreign(hidden.text)
    with pytest.raises(HTTPException) as exc:
        _run(server.production_requirements(recipe_id="recB", quantity=1, company_id=None, user=user_a))
    assert exc.value.status_code == 404
    assert exc.value.detail == "Reçete bulunamadı."

    missing = client.get("/api/production/requirements", params={"recipe_id": "missing", "company_id": COMP_A}, headers=headers)
    assert missing.status_code == 404
    assert missing.json()["detail"] == "Reçete bulunamadı."

    unfiltered = _run(server._requirements(db.recipes.docs[0], 2))
    assert next(row for row in unfiltered if row["product_id"] == "rawB")["in_stock"] == 50
    filtered = _run(server._requirements(db.recipes.docs[0], 2, stock_company_id=COMP_A))
    assert next(row for row in filtered if row["product_id"] == "rawB")["in_stock"] == 0
    assert db.writes == []


def test_morning_summary_settings_preview_and_send_stay_on_own_company(api):
    client, db = api
    headers = _auth("user-a")
    user_a = _user_a()
    settings = client.get("/api/reports/morning-summary/settings", params={"company_id": COMP_A}, headers=headers)
    assert settings.status_code == 200, settings.text
    assert settings.json()["time"] == "07:30"
    assert settings.json()["emails"] == ["a@firma.test"]
    assert settings.json()["last_sent"] == "2026-10-01T00:00:00+00:00"
    _no_foreign(settings.text)
    assert settings.json() == _run(pricing.summary_settings_payload(COMP_A))

    preview = client.get("/api/reports/morning-summary/preview", params={"company_id": COMP_A}, headers=headers)
    assert preview.status_code == 200, preview.text
    summary = preview.json()["summary"]
    assert summary["orders_total"] == 1
    assert summary["orders_amount"] == 42
    assert summary["pending_shipments"] == 1
    assert summary["low_stock_count"] == 1
    assert summary["low_stock"][0]["name"] == "Ürün A"
    assert summary["overdue_count"] == 1
    assert summary["overdue_total"] == 100
    assert summary["open_claims"] == 1
    assert list(summary["orders_by_channel"]) == ["manual"]
    assert "Firma A" in preview.json()["text"]
    _no_foreign(preview.text)
    assert preview.json() == _run(pricing.summary_preview_payload(COMP_A))

    saved = client.put("/api/reports/morning-summary/settings", json={
        "company_id": COMP_A,
        "enabled": True,
        "time": "06:15",
        "emails": [" A@Firma.Test "],
        "whatsapp_numbers": ["05551112233"],
        "include": {"orders": True, "low_stock": False, "shipments": True, "receivables": True},
    }, headers=headers)
    assert saved.status_code == 200, saved.text
    assert saved.json()["time"] == "06:15"
    assert saved.json()["emails"] == ["a@firma.test"]
    assert saved.json()["whatsapp_numbers"] == ["5551112233"]
    assert saved.json()["include"]["low_stock"] is False
    assert saved.json() == _run(pricing.summary_settings_payload(COMP_A))
    stored_b = next(doc for doc in db.morning_summary_settings.docs if doc["company_id"] == COMP_B)
    assert stored_b["emails"] == ["b-secret@firma.test"]
    assert stored_b["last_sent"] == "B-SECRET-SENT"
    _no_foreign(saved.text)

    sent = client.post("/api/reports/morning-summary/send", json={"company_id": COMP_A}, headers=headers)
    assert sent.status_code == 200, sent.text
    assert sent.json()["status"] == "success"
    assert sent.json()["message"] == "Sabah özeti gönderildi."
    assert "Firma A" in sent.json()["text"]
    _no_foreign(sent.text)
    assert db.side["mail"] == []
    assert db.side["smtp"] == []
    queued = [doc for doc in db.notify_outbox.docs if doc.get("company_id") == COMP_A and doc.get("event") == "morning_summary"]
    assert len(queued) == 1
    assert queued[0]["to"] == ["a@firma.test"]
    assert queued[0]["html"] and queued[0]["text"]
    assert "B-SECRET" not in queued[0]["html"] and "B-SECRET" not in queued[0]["text"]
    assert db.side["wa"][0]["company_id"] == COMP_A
    assert db.side["wa"][0]["to"] == "5551112233"
    assert "☀️" in db.side["wa"][0]["message"] and "<table" not in db.side["wa"][0]["message"]
    logs = [doc for doc in db.morning_summary_logs.docs if doc["company_id"] == COMP_A]
    assert len(logs) == 1 and logs[0]["manual"] is True
    assert all(doc["company_id"] != COMP_B for doc in db.morning_summary_logs.docs)
    assert next(doc for doc in db.morning_summary_settings.docs if doc["company_id"] == COMP_B)["last_sent"] == "B-SECRET-SENT"


def test_super_admin_follows_resolve_company_id(api):
    client, db = api
    headers = _auth("user-sa", superadmin=True)
    for path, params in (
        ("/api/reports/sales", RANGE),
        ("/api/production/requirements", {"recipe_id": "recB", "quantity": 1}),
        ("/api/reports/morning-summary/settings", None),
        ("/api/reports/morning-summary/preview", None),
    ):
        missing = client.get(path, params=params, headers=headers)
        assert missing.status_code == 400, (path, missing.text)
        assert missing.json()["detail"] == "Şirket seçilmedi."
    put = client.put("/api/reports/morning-summary/settings", json={"enabled": False}, headers=headers)
    assert put.status_code == 400, put.text
    sent = client.post("/api/reports/morning-summary/send", json={}, headers=headers)
    assert sent.status_code == 400, sent.text
    assert db.side["smtp"] == [] and db.side["wa"] == []

    sales = client.get("/api/reports/sales", params={**RANGE, "company_id": COMP_B}, headers=headers)
    assert sales.status_code == 200, sales.text
    assert [row["name"] for row in sales.json()["rows"]] == ["B-SECRET"]
    assert sales.json()["totals"]["gross"] == 999

    stock = client.get("/api/reports/stock", params={"company_id": NEXUS}, headers=headers)
    assert stock.status_code == 200, stock.text
    assert [row["name"] for row in stock.json()["rows"]] == ["NEXUS-ONLY"]

    req = client.get("/api/production/requirements", params={"recipe_id": "recB", "quantity": 1, "company_id": COMP_B}, headers=headers)
    assert req.status_code == 200, req.text
    assert req.json()["rows"][0]["in_stock"] == 50
    assert req.json()["rows"][0]["product_name"] == "B-SECRET-HAM"
    wrong = client.get("/api/production/requirements", params={"recipe_id": "recA", "company_id": COMP_B}, headers=headers)
    assert wrong.status_code == 404
    assert wrong.json()["detail"] == "Reçete bulunamadı."

    settings = client.get("/api/reports/morning-summary/settings", params={"company_id": COMP_B}, headers=headers)
    assert settings.status_code == 200, settings.text
    assert settings.json()["emails"] == ["b-secret@firma.test"]
    preview = client.get("/api/reports/morning-summary/preview", params={"company_id": COMP_B}, headers=headers)
    assert preview.status_code == 200, preview.text
    assert preview.json()["summary"]["orders_amount"] == 7777
    assert "B-SECRET LTD" in preview.json()["text"]

    active = client.get("/api/reports/sales", params=RANGE, headers=_auth("user-sa-a", superadmin=True))
    assert active.status_code == 200, active.text
    assert [row["name"] for row in active.json()["rows"]] == ["Cari A"]
    _no_foreign(active.text)


class _FrozenPricingDateTime:
    """Stand-in for pricing.datetime. now(tz) is 2026-01-15 at a fixed Turkey clock."""

    def __init__(self, hour: int, minute: int):
        self._when = datetime(2026, 1, 15, hour, minute, tzinfo=pricing.TR_TZ)

    def now(self, tz=None):
        if tz is None:
            return self._when.replace(tzinfo=None)
        return self._when.astimezone(tz)


def _run_scheduler_once(clock, called):
    sleeps = {"n": 0}

    async def fake_sleep(_seconds):
        sleeps["n"] += 1
        if sleeps["n"] >= 2:
            raise asyncio.CancelledError()

    async def _boom(*_args, **_kwargs):
        called["routes"].append(True)
        raise AssertionError("route called")

    with patch.object(pricing, "datetime", clock), \
         patch.object(pricing, "get_summary_settings", _boom), \
         patch.object(pricing, "preview_summary", _boom), \
         patch.object(pricing, "send_summary_now", _boom), \
         patch.object(pricing.asyncio, "sleep", fake_sleep):
        with pytest.raises(asyncio.CancelledError):
            _run(pricing.scheduler_loop())


def test_scheduler_uses_send_summary_helper_not_the_route(api):
    _client, db = api
    called = {"routes": []}
    # Seeded schedules are 07:30 and 09:45. 10:00 is after both, including at midnight.
    _run_scheduler_once(_FrozenPricingDateTime(10, 0), called)
    assert called["routes"] == []
    assert db.side["mail"] == []
    assert db.side["smtp"] == []
    queued = [doc for doc in db.notify_outbox.docs if doc.get("event") == "morning_summary"]
    assert {doc["to"][0] for doc in queued} == {"a@firma.test", "b-secret@firma.test"}
    logs = db.morning_summary_logs.docs
    assert {doc["company_id"] for doc in logs} == {COMP_A, COMP_B}
    assert all(doc["manual"] is False for doc in logs)
    assert {doc.get("last_sent_day") for doc in db.morning_summary_settings.docs} == {"2026-01-15"}


def test_scheduler_sends_at_0800_tr_not_at_0759(api):
    _client, db = api
    for doc in db.morning_summary_settings.docs:
        if doc["company_id"] == COMP_A:
            doc["time"] = "08:00"
        else:
            # Missing time uses the scheduler default, which is also 08:00.
            doc.pop("time", None)
    called = {"routes": []}
    _run_scheduler_once(_FrozenPricingDateTime(7, 59), called)
    assert called["routes"] == []
    assert db.side["mail"] == []
    assert db.side["smtp"] == []
    assert db.side["wa"] == []
    assert db.morning_summary_logs.docs == []
    assert {doc.get("last_sent_day") for doc in db.morning_summary_settings.docs} == {"2000-01-01"}

    _run_scheduler_once(_FrozenPricingDateTime(8, 0), called)
    assert called["routes"] == []
    assert db.side["mail"] == []
    assert db.side["smtp"] == []
    queued = [doc for doc in db.notify_outbox.docs if doc.get("event") == "morning_summary"]
    assert {doc["to"][0] for doc in queued} == {"a@firma.test", "b-secret@firma.test"}
    logs = db.morning_summary_logs.docs
    assert {doc["company_id"] for doc in logs} == {COMP_A, COMP_B}
    assert all(doc["manual"] is False for doc in logs)
    assert {doc.get("last_sent_day") for doc in db.morning_summary_settings.docs} == {"2026-01-15"}
