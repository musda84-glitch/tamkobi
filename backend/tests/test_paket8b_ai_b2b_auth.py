"""Paket 8b: staff /ai POST uçları oturum + şirket + eklenti; B2B token maskesi ve ayar birleştirme.

Bellek içi veritabanı ve TestClient. 8021, canlı sunucu, tamkobi_p0 ve gerçek AI yok.
"""
from __future__ import annotations

import asyncio
import copy
import inspect
import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import HTTPException
from fastapi.params import Query as QueryParam
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-paket8b-ai-b2b-auth-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc, project_doc, sort_docs  # noqa: E402

COMP_A = "A"
COMP_B = "B"
DENY = "Bu şirket hesabına erişiminiz yok."
UNAUTH = "Giriş yapmanız gerekiyor."
B2B_MISSING = "B2B erişimi bulunamadı veya kapatılmış."
AI_KEYS = ("orders", "products", "invoice", "receipt", "advice", "cart", "ubl")
ADDON_ON = {
    "ai.advisor": True,
    "ai.invoice": True,
    "ai.orders": True,
    "ai.stock": True,
    "ai.b2b_cart": True,
    "ai.finance_docs": True,
}
ORDER_KEYS = {"filename", "orders", "count"}
ORDER_CONFIRM_KEYS = {"status", "created", "orders", "message"}
PRODUCT_KEYS = {"filename", "source", "products", "count", "new_count", "existing_count"}
PRODUCT_CONFIRM_KEYS = {"status", "inserted", "updated", "skipped", "message"}
INVOICE_KEYS = {"draft", "invoice_type", "source", "matched_contact", "file_url", "text_preview", "filename"}
RECEIPT_KEYS = {"draft", "source", "matched_contact", "filename", "text_preview"}
CART_KEYS = {"filename", "items", "unmatched", "total_lines", "parse_mode"}
LEARN_KEYS = {"saved", "count"}
ADVICE_KEYS = {"advice", "metrics", "source", "fallback"}
METRIC_KEYS = {
    "company_id", "company_name", "total_bank_balance", "total_receivables", "total_payables",
    "monthly_sales", "monthly_expenses", "pending_orders_count", "low_stock_count",
}


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

    def find(self, query=None, projection=None):
        matched = []
        for doc in self.docs:
            if match_query(doc, query or {}):
                matched.append(project_doc(doc, projection) if projection else copy.deepcopy(doc))
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
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def insert_many(self, docs):
        copied = [copy.deepcopy(doc) for doc in docs]
        self.docs.extend(copied)
        return SimpleNamespace(inserted_ids=[doc.get("_id") for doc in copied])

    async def update_one(self, query, update, upsert=False):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def update_many(self, query, update, upsert=False):
        modified = 0
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                modified += 1
        return SimpleNamespace(modified_count=modified, matched_count=modified)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True, projection=None):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                found = self.docs[i]
                return project_doc(found, projection) if projection else copy.deepcopy(found)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            found = self.docs[-1]
            return project_doc(found, projection) if projection else copy.deepcopy(found)
        return None

    async def delete_one(self, query):
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query):
        kept, deleted = [], 0
        for doc in self.docs:
            if match_query(doc, query or {}):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=deleted)

    async def create_index(self, *args, **kwargs):
        return None


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


def _user(uid, company_ids, active, *, role="admin", superadmin=False):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": role,
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(company_ids),
        "active_company_id": active,
    }


def _license(company_id):
    return {"_id": company_id, "status": "active", "addon_overrides": dict(ADDON_ON)}


def _set_addon(db, company_id, key, enabled):
    for doc in db.company_licenses.docs:
        if doc.get("_id") == company_id:
            doc.setdefault("addon_overrides", {})[key] = enabled
    saas.invalidate()


def _seed(db):
    db.companies.docs.extend([
        {
            "_id": COMP_A, "name": "Firma A",
            "b2b_settings": {
                "enabled": True, "welcome_note": "Merhaba", "default_discount": 12,
                "card_payment_enabled": False, "show_prices": False,
            },
        },
        {"_id": COMP_B, "name": "B-SECRET LTD", "b2b_settings": {"enabled": True, "welcome_note": "B-SECRET-NOTE"}},
    ])
    db.company_licenses.docs.extend([_license(COMP_A), _license(COMP_B)])
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-member", [COMP_A], COMP_A, role="sales"),
        _user("user-sa", [], "", superadmin=True),
    ])
    db.bank_accounts.docs.extend([
        {"_id": "accA", "company_id": COMP_A, "current_balance": 100, "account_name": "Kasa A"},
        {"_id": "accB", "company_id": COMP_B, "current_balance": 99999, "account_name": "B-SECRET-BANK"},
    ])
    db.contacts.docs.extend([
        {
            "_id": "ctA", "company_id": COMP_A, "type": "customer", "name": "Cari A", "balance": 40,
            "tax_number_or_id": "1111111111", "email": "a@example.com", "phone": "555",
            "b2b_enabled": True, "b2b_token": "tok-a", "b2b_discount": 3, "is_active": True,
        },
        {
            "_id": "ctB", "company_id": COMP_B, "type": "customer", "name": "B-SECRET", "balance": -500,
            "tax_number_or_id": "999", "email": "b@example.com", "b2b_enabled": True,
            "b2b_token": "tok-b-secret", "b2b_discount": 9, "is_active": True,
        },
    ])
    db.invoices.docs.extend([
        {"_id": "invAs", "company_id": COMP_A, "invoice_type": "sales", "grand_total": 80, "invoice_number": "A-1"},
        {"_id": "invAp", "company_id": COMP_A, "invoice_type": "purchase", "grand_total": 20, "invoice_number": "A-2"},
        {"_id": "invB", "company_id": COMP_B, "invoice_type": "sales", "grand_total": 5000, "invoice_number": "B-SECRET-1"},
    ])
    db.products.docs.extend([
        {
            "_id": "pA", "company_id": COMP_A, "name": "Urun A", "sku": "SKU-A", "barcode": "111",
            "stock_quantity": 1, "min_stock_alert": 5, "sale_price": 10, "show_in_b2b": True,
        },
        {
            "_id": "pB", "company_id": COMP_B, "name": "B-SECRET-URUN", "sku": "SKU-B", "barcode": "999",
            "stock_quantity": 0, "min_stock_alert": 1, "sale_price": 50, "show_in_b2b": True,
        },
    ])
    db.orders.docs.extend([
        {"_id": "oA", "company_id": COMP_A, "order_status": "pending", "order_number": "A-ORD", "customer_name": "Cari A"},
        {"_id": "oB", "company_id": COMP_B, "order_status": "pending", "order_number": "B-SECRET-ORD", "customer_name": "B-SECRET"},
    ])


class BoomFile:
    filename = "liste.pdf"
    content_type = "application/pdf"

    async def read(self):
        raise AssertionError("dosya okundu")


def _snap(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _changed(before, after):
    names = set(before) | set(after)
    out = {}
    for name in names:
        left = before.get(name) or []
        right = after.get(name) or []
        if left != right:
            out[name] = name
    return out


def _require_detail(company_id, key):
    try:
        _run(addons.require(company_id, key))
    except HTTPException as exc:
        assert exc.status_code == 403
        return exc.detail
    raise AssertionError(f"{key} was enabled for {company_id}")


def _token(uid, *, superadmin=False, role="admin"):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", role, is_super_admin=superadmin)


def _auth(uid, *, superadmin=False, role="admin"):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin, role=role)}"}


def _total(calls):
    return sum(calls[k] for k in AI_KEYS)


@pytest.fixture
def api():
    db = MemDB()
    _seed(db)
    prev = (server.db, rbac._db, saas._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    calls = {key: 0 for key in AI_KEYS}
    calls["advice_ctx"] = None

    async def fake_orders(text):
        calls["orders"] += 1
        return {"orders": [{
            "order_number": "AI-1",
            "customer_name": "Cari A",
            "items": [{"product_name": "Urun A", "sku": "SKU-A", "quantity": 1, "unit_price": 10, "total": 10}],
        }]}

    async def fake_products(text):
        calls["products"] += 1
        return {"products": [{"name": "Yeni Urun", "sku": "SKU-NEW", "sale_price": 5, "stock_quantity": 2}]}

    async def fake_invoice(text, invoice_type="purchase"):
        calls["invoice"] += 1
        return {
            "supplier": {"name": "Tedarik A", "tax_number": "1111111111"},
            "invoice_number": "F-1",
            "items": [{"name": "Urun A", "sku": "SKU-A", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        }

    async def fake_receipt(data, name, content_type=""):
        calls["receipt"] += 1
        return {"draft": {"contact_name": "Cari A", "tax_number": "1111111111", "total": 10}, "source": "mock", "text_preview": "fis"}

    async def fake_advice(context, prompt, history=None):
        calls["advice"] += 1
        calls["advice_ctx"] = copy.deepcopy(context)
        return "MOCK-ADVICE"

    async def fake_cart(text):
        calls["cart"] += 1
        return {"items": [{"product_name": "Urun A", "sku": "SKU-A", "quantity": 2}]}

    def fake_ubl(data):
        calls["ubl"] += 1
        raise AssertionError("ubl parser")

    async def fake_text(file, data):
        return "siparis listesi metni yeterince uzun"

    def fake_put(path, data, content_type):
        return {"path": path, "size": len(data)}

    async def fake_folders(*_args, **_kwargs):
        return []

    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(server, "ai_service_extract_orders", fake_orders), \
                patch.object(server, "ai_service_extract_products", fake_products), \
                patch.object(server, "extract_invoice_from_text", fake_invoice), \
                patch.object(server, "extract_receipt_file", fake_receipt), \
                patch.object(server, "get_financial_ai_advice_result", fake_advice), \
                patch.object(server, "ai_service_extract_b2b_cart", fake_cart), \
                patch.object(server, "_file_to_text", fake_text), \
                patch.object(server, "put_object", fake_put), \
                patch("edocs.parse_ubl", fake_ubl), \
                patch("storage_manager.ensure_account_folders", fake_folders):
            client.__enter__()
            entered = True
            yield client, db, calls
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db = prev
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def _file_specs():
    blob = b"x" * 40
    return [
        ("cart", server.ai_cart_extract, "/api/ai/cart-extract", "ai.b2b_cart", "cart", CART_KEYS,
         ("liste.pdf", blob, "application/pdf"), None),
        ("orders", server.ai_order_extract, "/api/ai/order-extract", "ai.orders", "orders", ORDER_KEYS,
         ("siparis.txt", b"musteri kalem adet satir", "text/plain"), None),
        ("products", server.ai_product_extract, "/api/ai/product-extract", "ai.stock", "products", PRODUCT_KEYS,
         ("stok.pdf", blob, "application/pdf"), None),
        ("invoice", server.ai_invoice_extract, "/api/ai/invoice-extract", "ai.invoice", "invoice", INVOICE_KEYS,
         ("fatura.txt", b"Fatura metni yeterince uzun olsun diye", "text/plain"), None),
        ("receipt", server.ai_receipt_extract, "/api/ai/receipt-extract", "ai.finance_docs", "receipt", RECEIPT_KEYS,
         ("fis.jpg", blob, "image/jpeg"), None),
    ]


def _json_specs():
    learn = {"mappings": [{"alias": "kalemim", "product_id": "pA"}]}
    confirm = {"orders": [{
        "order_number": "AI-NEW-1",
        "customer_name": "Cari A",
        "contact_id": "ctA",
        "items": [{"product_name": "Urun A", "sku": "SKU-A", "quantity": 1, "unit_price": 10, "total": 10}],
    }]}
    products = {"products": [{"name": "Yeni Kart", "sku": "SKU-FRESH", "sale_price": 4, "stock_quantity": 1}]}
    advice = {"message": "nakit ozetle"}
    return [
        ("learn", server.ai_cart_learn, "/api/ai/cart-learn", "ai.b2b_cart", None, LEARN_KEYS, learn),
        ("order-confirm", server.ai_order_confirm, "/api/ai/order-extract/confirm", "ai.orders", None, ORDER_CONFIRM_KEYS, confirm),
        ("product-confirm", server.ai_product_confirm, "/api/ai/product-extract/confirm", "ai.stock", None, PRODUCT_CONFIRM_KEYS, products),
        ("advice", server.ask_financial_ai, "/api/ai/financial-advisor", "ai.advisor", "advice", ADVICE_KEYS, advice),
    ]


def _post_file(client, path, spec, *, headers=None, company_id="__omit__", extra=None):
    filename, content, content_type = spec
    params = {} if company_id == "__omit__" else {"company_id": company_id}
    if extra:
        params.update(extra)
    return client.post(path, params=params or None, files={"file": (filename, content, content_type)}, headers=headers)


def _post_json(client, path, body, *, headers=None, company_id="__omit__"):
    payload = dict(body)
    if company_id != "__omit__":
        payload["company_id"] = company_id
    return client.post(path, json=payload, headers=headers)


def test_route_signatures_have_auth_and_no_nexus_default():
    for _name, fn, _path, addon, _counter, _keys, _spec, _extra in _file_specs():
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is server.get_current_user
        default = sig.parameters["company_id"].default
        assert isinstance(default, QueryParam)
        assert default.default is None
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "resolve_company_id" in src
        assert src.index("resolve_company_id") < src.index("addons.require")
        assert src.index("addons.require") < src.index("file.read")
        assert f'addons.require(cid, "{addon}")' in src
    invoice = inspect.getsource(server.ai_invoice_extract)
    assert invoice.index("addons.require") < invoice.index("parse_ubl")
    assert invoice.index("addons.require") < invoice.index("extract_invoice_from_text")
    receipt = inspect.getsource(server.ai_receipt_extract)
    assert receipt.index("addons.require") < receipt.index("extract_receipt_file")
    orders = inspect.getsource(server.ai_order_extract)
    assert orders.index("addons.require") < orders.index("ai_service_extract_orders")
    products = inspect.getsource(server.ai_product_extract)
    assert products.index("addons.require") < products.index("ai_service_extract_products")
    cart = inspect.getsource(server.ai_cart_extract)
    assert cart.index("addons.require") < cart.index("_ai_cart_parse_upload")
    for _name, fn, _path, addon, _counter, _keys, _body in _json_specs():
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is server.get_current_user
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert src.index("resolve_company_id") < src.index("addons.require")
        assert f'addons.require(cid, "{addon}")' in src
    learn = inspect.getsource(server.ai_cart_learn)
    assert learn.index("addons.require") < learn.index("_ai_cart_learn_mappings")
    confirm = inspect.getsource(server.ai_order_confirm)
    assert confirm.index("addons.require") < confirm.index("insert_one")
    product_confirm = inspect.getsource(server.ai_product_confirm)
    assert '{"_id": match_id, "company_id": cid}' in product_confirm
    assert product_confirm.index("addons.require") < product_confirm.index("check_product_limit")
    advisor = inspect.getsource(server.ask_financial_ai)
    assert "FinancialAIChatRequest" in advisor
    after_resolve = advisor.split("resolve_company_id", 1)[1].split("\n", 1)[1]
    assert "req.company_id" not in after_resolve
    assert advisor.index("addons.require") < advisor.index("bank_accounts.find")
    assert server.FinancialAIChatRequest.model_fields["company_id"].default is None
    assert server.AIChatRequest.model_fields["company_id"].default is None
    public = inspect.getsource(server.b2b_ai_cart_learn)
    assert "get_current_user" not in public
    assert "_ai_cart_learn_mappings" in public
    assert "get_current_user" not in inspect.getsource(server.b2b_ai_cart)
    invoice_confirm = inspect.getsource(server.ai_invoice_confirm)
    assert "get_current_user" in invoice_confirm
    assert "resolve_company_id" in invoice_confirm


def test_no_session_is_401_without_ai_or_writes(api):
    client, db, calls = api
    before = _snap(db)
    for _name, _fn, path, _addon, _counter, _keys, spec, _extra in _file_specs():
        response = _post_file(client, path, spec, company_id=COMP_A)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == UNAUTH
    for _name, _fn, path, _addon, _counter, _keys, body in _json_specs():
        response = _post_json(client, path, body, company_id=COMP_A)
        assert response.status_code == 401, (path, response.text)
        assert response.json()["detail"] == UNAUTH
    assert _total(calls) == 0
    assert _changed(before, _snap(db)) == {}


def test_other_company_is_403_without_ai_or_writes(api):
    client, db, calls = api
    headers = _auth("user-a")
    before = _snap(db)
    for _name, _fn, path, _addon, _counter, _keys, spec, _extra in _file_specs():
        response = _post_file(client, path, spec, headers=headers, company_id=COMP_B)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        assert "B-SECRET" not in response.text
    for _name, _fn, path, _addon, _counter, _keys, body in _json_specs():
        response = _post_json(client, path, body, headers=headers, company_id=COMP_B)
        assert response.status_code == 403, (path, response.text)
        assert response.json()["detail"] == DENY
        assert "B-SECRET" not in response.text
    assert _total(calls) == 0
    assert _changed(before, _snap(db)) == {}


def test_addon_off_matches_require_and_skips_ai(api):
    client, db, calls = api
    headers = _auth("user-a")
    user = _user("user-a", [COMP_A], COMP_A)
    before = _snap(db)

    async def _allow(*_args, **_kwargs):
        return None

    for _name, fn, path, addon, _counter, _keys, spec, _extra in _file_specs():
        _set_addon(db, COMP_A, addon, False)
        detail = _require_detail(COMP_A, addon)
        with pytest.raises(HTTPException) as exc:
            if fn is server.ai_invoice_extract:
                _run(fn(file=BoomFile(), company_id=COMP_A, invoice_type="purchase", user=user))
            else:
                _run(fn(file=BoomFile(), company_id=COMP_A, user=user))
        assert exc.value.status_code == 403
        assert exc.value.detail == detail
        with patch.object(addons, "guard_request", _allow), patch.object(rbac, "_license_guard", _allow):
            response = _post_file(client, path, spec, headers=headers, company_id=COMP_A)
        assert response.status_code == 403, (path, response.text)
        assert response.json() == {"detail": detail}
        _set_addon(db, COMP_A, addon, True)

    for _name, fn, path, addon, _counter, _keys, body in _json_specs():
        _set_addon(db, COMP_A, addon, False)
        detail = _require_detail(COMP_A, addon)
        with pytest.raises(HTTPException) as exc:
            if fn is server.ask_financial_ai:
                _run(fn(server.FinancialAIChatRequest(message="x", company_id=COMP_A), user=user))
            else:
                _run(fn({**body, "company_id": COMP_A}, user=user))
        assert exc.value.status_code == 403
        assert exc.value.detail == detail
        with patch.object(addons, "guard_request", _allow), patch.object(rbac, "_license_guard", _allow):
            response = _post_json(client, path, body, headers=headers, company_id=COMP_A)
        assert response.status_code == 403, (path, response.text)
        assert response.json() == {"detail": detail}
        _set_addon(db, COMP_A, addon, True)

    assert _total(calls) == 0
    assert _changed(before, _snap(db)) == {}


def test_own_company_addon_on_returns_same_keys_and_one_ai_call(api):
    client, db, calls = api
    headers = _auth("user-a")
    for _name, _fn, path, _addon, counter, keys, spec, _extra in _file_specs():
        before = calls[counter]
        response = _post_file(client, path, spec, headers=headers, company_id=COMP_A)
        assert response.status_code == 200, (path, response.text)
        assert set(response.json()) == keys
        assert calls[counter] == before + 1
        assert "B-SECRET" not in response.text
    assert calls["orders"] == 1
    assert calls["products"] == 1
    assert calls["invoice"] == 1
    assert calls["receipt"] == 1
    assert calls["cart"] == 1
    assert calls["ubl"] == 0
    orders = db.orders.docs
    assert all(row.get("company_id") != COMP_B or row["_id"] == "oB" for row in orders)
    assert not any(row.get("name") == "Yeni Kart" for row in db.products.docs)

    learn = _post_json(
        client, "/api/ai/cart-learn",
        {"mappings": [{"alias": "kalemim", "product_id": "pA"}]},
        headers=headers, company_id=COMP_A,
    )
    assert learn.status_code == 200, learn.text
    assert set(learn.json()) == LEARN_KEYS
    assert learn.json()["count"] == 1
    assert calls["cart"] == 1
    saved = next(row for row in db.b2b_product_aliases.docs if row.get("alias"))
    assert saved["company_id"] == COMP_A
    assert saved["product_id"] == "pA"

    confirm = _post_json(
        client, "/api/ai/order-extract/confirm",
        {"orders": [{
            "order_number": "AI-NEW-1", "customer_name": "Cari A", "contact_id": "ctA",
            "items": [{"product_name": "Urun A", "sku": "SKU-A", "quantity": 1, "unit_price": 10, "total": 10}],
        }]},
        headers=headers, company_id=COMP_A,
    )
    assert confirm.status_code == 200, confirm.text
    assert set(confirm.json()) == ORDER_CONFIRM_KEYS
    assert confirm.json()["created"] == 1
    created = next(row for row in db.orders.docs if row.get("order_number") == "AI-NEW-1")
    assert created["company_id"] == COMP_A
    assert calls["orders"] == 1

    fresh = _post_json(
        client, "/api/ai/product-extract/confirm",
        {"products": [{"name": "Yeni Kart", "sku": "SKU-FRESH", "sale_price": 4, "stock_quantity": 1}]},
        headers=headers, company_id=COMP_A,
    )
    assert fresh.status_code == 200, fresh.text
    assert set(fresh.json()) == PRODUCT_CONFIRM_KEYS
    assert fresh.json()["inserted"] == 1
    card = next(row for row in db.products.docs if row.get("sku") == "SKU-FRESH")
    assert card["company_id"] == COMP_A
    assert calls["products"] == 1

    advice = _post_json(client, "/api/ai/financial-advisor", {"message": "nakit"}, headers=headers, company_id=COMP_A)
    assert advice.status_code == 200, advice.text
    assert set(advice.json()) == ADVICE_KEYS
    assert set(advice.json()["metrics"]) == METRIC_KEYS
    assert calls["advice"] == 1


def test_missing_company_uses_active_and_superadmin_can_pick(api):
    client, db, calls = api
    own = _post_json(client, "/api/ai/financial-advisor", {"message": "nakit"}, headers=_auth("user-a"))
    assert own.status_code == 200, own.text
    assert own.json()["metrics"]["company_id"] == COMP_A
    assert own.json()["metrics"]["company_name"] == "Firma A"
    assert own.json()["metrics"]["total_bank_balance"] == 100
    assert "B-SECRET" not in json.dumps(calls["advice_ctx"], ensure_ascii=False)
    assert "99999" not in own.text

    # Süper adminin aktif şirketi yok. Lisans/eklenti ara katmanı gövdeyi görmez;
    # açık company_id sorgu parametresinde de gider, handler gövdedeki id'yi çözer.
    picked = client.post(
        "/api/ai/financial-advisor",
        params={"company_id": COMP_B},
        json={"message": "nakit", "company_id": COMP_B},
        headers=_auth("user-sa", superadmin=True),
    )
    assert picked.status_code == 200, picked.text
    assert picked.json()["metrics"]["company_id"] == COMP_B
    assert picked.json()["metrics"]["total_bank_balance"] == 99999
    assert picked.json()["metrics"]["monthly_sales"] == 5000
    assert calls["advice_ctx"]["company_id"] == COMP_B
    assert calls["advice_ctx"]["total_receivables"] == 0
    assert "Firma A" not in json.dumps(calls["advice_ctx"], ensure_ascii=False)
    assert "Cari A" not in json.dumps(calls["advice_ctx"], ensure_ascii=False)

    cart = _post_file(
        client, "/api/ai/cart-extract",
        ("liste.pdf", b"x" * 40, "application/pdf"),
        headers=_auth("user-a"),
    )
    assert cart.status_code == 200, cart.text
    assert set(cart.json()) == CART_KEYS
    assert calls["cart"] == 1


def test_product_confirm_foreign_match_does_not_update_or_insert(api):
    client, db, calls = api
    before_b = copy.deepcopy(next(row for row in db.products.docs if row["_id"] == "pB"))
    count_before = len(db.products.docs)
    response = _post_json(
        client, "/api/ai/product-extract/confirm",
        {"products": [{
            "name": "Hacked", "sku": "SKU-B", "sale_price": 1, "stock_quantity": 99, "match_id": "pB",
        }]},
        headers=_auth("user-a"), company_id=COMP_A,
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert set(body) == PRODUCT_CONFIRM_KEYS
    assert body["inserted"] == 0
    assert body["updated"] == 0
    assert body["skipped"] == 1
    after_b = next(row for row in db.products.docs if row["_id"] == "pB")
    assert after_b == before_b
    assert len(db.products.docs) == count_before
    assert not any(row.get("name") == "Hacked" for row in db.products.docs)
    assert calls["products"] == 0


def test_financial_advisor_context_excludes_other_company(api):
    client, _db, calls = api
    response = _post_json(
        client, "/api/ai/financial-advisor", {"message": "ozet"},
        headers=_auth("user-a"), company_id=COMP_A,
    )
    assert response.status_code == 200, response.text
    metrics = response.json()["metrics"]
    assert metrics["total_bank_balance"] == 100
    assert metrics["total_receivables"] == 40
    assert metrics["total_payables"] == 0
    assert metrics["monthly_sales"] == 80
    assert metrics["monthly_expenses"] == 20
    assert metrics["pending_orders_count"] == 1
    assert metrics["low_stock_count"] == 1
    blob = json.dumps(calls["advice_ctx"], ensure_ascii=False)
    assert "B-SECRET" not in blob
    assert "99999" not in blob
    assert "5000" not in blob
    assert calls["advice"] == 1


def test_public_b2b_learn_stays_token_based(api):
    client, db, calls = api
    ok = client.post(
        "/api/public/b2b/tok-a/ai-cart/learn",
        json={"mappings": [{"alias": "portal kalem", "product_id": "pA"}]},
    )
    assert ok.status_code == 200, ok.text
    assert ok.json()["count"] == 1
    saved = next(row for row in db.b2b_product_aliases.docs if row.get("product_id") == "pA")
    assert saved["company_id"] == COMP_A
    bad = client.post("/api/public/b2b/no-such-token/ai-cart/learn", json={"mappings": []})
    assert bad.status_code == 404
    assert bad.json()["detail"] == B2B_MISSING
    assert calls["cart"] == 0
    foreign = next(row for row in db.products.docs if row["_id"] == "pB")
    assert foreign["name"] == "B-SECRET-URUN"


def test_b2b_settings_hides_token_for_member_and_put_merges(api):
    client, db, _calls = api
    admin = client.get(f"/api/companies/{COMP_A}/b2b-settings", headers=_auth("user-a"))
    assert admin.status_code == 200, admin.text
    admin_body = admin.json()
    assert admin_body["settings"]["welcome_note"] == "Merhaba"
    assert admin_body["settings"]["default_discount"] == 12
    assert admin_body["settings"]["show_prices"] is False
    customer = next(row for row in admin_body["customers"] if row["id"] == "ctA")
    assert customer["b2b_token"] == "tok-a"
    assert "b2b_token_hidden" not in customer

    member = client.get(f"/api/companies/{COMP_A}/b2b-settings", headers=_auth("user-member", role="sales"))
    assert member.status_code == 200, member.text
    member_body = member.json()
    assert member_body["settings"] == admin_body["settings"]
    hidden = next(row for row in member_body["customers"] if row["id"] == "ctA")
    assert hidden["b2b_token"] is None
    assert hidden["b2b_token_hidden"] is True
    assert "tok-a" not in member.text
    assert hidden["name"] == customer["name"]
    assert hidden["b2b_discount"] == customer["b2b_discount"]

    saved = client.put(
        f"/api/companies/{COMP_A}/b2b-settings",
        headers=_auth("user-a"),
        json={"card_payment_enabled": True},
    )
    assert saved.status_code == 200, saved.text
    stored = saved.json()["settings"]
    assert stored["card_payment_enabled"] is True
    assert stored["welcome_note"] == "Merhaba"
    assert stored["default_discount"] == 12
    assert stored["show_prices"] is False
    assert stored["enabled"] is True
    assert stored["show_stock"] is True
    company = next(row for row in db.companies.docs if row["_id"] == COMP_A)
    assert company["b2b_settings"]["welcome_note"] == "Merhaba"
    assert company["b2b_settings"]["default_discount"] == 12
    contact = next(row for row in db.contacts.docs if row["_id"] == "ctA")
    assert contact["b2b_discount"] == 3
    assert contact["b2b_token"] == "tok-a"
