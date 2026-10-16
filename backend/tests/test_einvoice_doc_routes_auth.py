"""E-fatura / UBL belge uçları: oturum ve şirket sahipliği.

Bellek içi veritabanı ve TestClient. 8021, canlı veritabanı ve dış entegratör yok.
"""
from __future__ import annotations

import copy
import inspect
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-einvoice-doc-routes-auth-jwt-secret-32b")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import auth_utils  # noqa: E402
import e_invoice  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import signed_links  # noqa: E402
import tenant_idor_allowlist as allowlist  # noqa: E402
import ubl_export  # noqa: E402
from mysql_store import match_query  # noqa: E402

COMP_A = "A"
COMP_B = "B"
INV_A = "invA"
INV_B = "invB"
INV_PAPER = "invPaper"
NOT_FOUND = "Fatura bulunamadı."
PAPER_DETAIL = "Yalnızca e-Fatura / e-Arşiv belgelerinin XML'i indirilebilir."
REMOTE_XML = b'<?xml version="1.0"?><Invoice>REMOTE-UBL</Invoice>'
GIB_INFO = {"url": "https://example.invalid/gib-doc", "provider": "isnet", "source": "stored"}
SECRET = "B-SECRET"

STATUS_FIELDS = (
    "invoice_id",
    "invoice_number",
    "e_type",
    "einvoice_state",
    "gib_status",
    "gib_status_code",
    "gib_uuid",
    "gib_invoice_id",
    "gib_tracking_id",
    "gib_scenario",
    "gib_document_url",
    "gib_error",
    "mode",
    "gib_mode",
    "has_xml",
    "xml_meta",
    "e_invoice_track",
)
REFRESH_FIELDS = (
    "status",
    "updated",
    "verified",
    "invoice_number",
    "gib_invoice_id",
    "gib_status",
    "gib_mode",
    "gib_document_url",
    "message",
)


def _routes(invoice_id: str):
    return (
        ("GET", f"/api/invoices/{invoice_id}/xml"),
        ("GET", f"/api/e-invoice/{invoice_id}/xml"),
        ("GET", f"/api/e-invoice/{invoice_id}/status"),
        ("POST", f"/api/e-invoice/{invoice_id}/refresh-status"),
        ("GET", f"/api/invoices/{invoice_id}/gib-document"),
        ("GET", f"/api/invoices/{invoice_id}/gib-document.json"),
    )


class MemCursor:
    def __init__(self, docs):
        self._docs = docs

    async def to_list(self, length=None):
        rows = list(self._docs)
        if length is not None:
            rows = rows[: int(length)]
        return copy.deepcopy(rows)


class MemColl:
    def __init__(self, name):
        self.name = name
        self.docs = []

    def find(self, query=None, projection=None):
        matched = [d for d in self.docs if match_query(d, query or {})]
        return MemCursor(matched)

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def insert_one(self, doc):
        self.docs.append(copy.deepcopy(doc))
        return SimpleNamespace(inserted_id=doc.get("_id"))

    async def update_one(self, query, update, upsert=False):
        return SimpleNamespace(modified_count=0, matched_count=0)

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
            coll = MemColl(name)
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


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


def _invoice(_id, company, number, *, e_type="e_invoice", **extra):
    doc = {
        "_id": _id,
        "company_id": company,
        "invoice_type": "sales",
        "e_type": e_type,
        "status": "issued",
        "einvoice_state": "sent",
        "gib_uuid": f"uuid-{_id}",
        "gib_tracking_id": f"trk-{_id}",
        "gib_status": "İşNet",
        "gib_status_code": "1300",
        "gib_invoice_id": f"GIB-{_id}",
        "gib_scenario": "TICARIFATURA",
        "gib_document_url": f"https://stored.invalid/{_id}",
        "gib_error": "",
        "gib_mode": "test",
        "invoice_number": number,
        "issue_date": "2026-10-16",
        "contact_name": extra.pop("contact_name", "Cari A"),
        "items": [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    doc.update(extra)
    return doc


def _seed(db):
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A", "tax_number": "1111111111"},
        {"_id": COMP_B, "name": "Firma B", "tax_number": "2222222222"},
    ])
    db.invoices.docs.extend([
        _invoice(INV_A, COMP_A, "A-INV-1", contact_name="Cari A"),
        _invoice(INV_B, COMP_B, "B-SECRET-NO", contact_name=SECRET),
        _invoice(INV_PAPER, COMP_A, "PAPER-A", e_type="paper", einvoice_state="paper", contact_name="Cari A"),
    ])


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=superadmin)


def _auth(uid, *, superadmin=False):
    return {"Authorization": f"Bearer {_token(uid, superadmin=superadmin)}"}


def _reset(mocks):
    mocks.fetch.reset_mock()
    mocks.refresh.reset_mock()
    mocks.resolve.reset_mock()


def _hit(client, mocks, method, path, **kwargs):
    _reset(mocks)
    if method == "GET" and path.endswith("/gib-document"):
        kwargs["follow_redirects"] = False
    return client.request(method, path, **kwargs)


def _no_secret(response):
    assert SECRET not in response.text
    assert "B-SECRET-NO" not in response.text


def _mocks_idle(mocks):
    assert mocks.fetch.await_count == 0
    assert mocks.refresh.await_count == 0
    assert mocks.resolve.await_count == 0


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.append(_user("user-a", [COMP_A], COMP_A))
    db.users.docs.append(_user("user-b", [COMP_B], COMP_B))
    db.users.docs.append(_user("user-sa", [], "", superadmin=True))
    _seed(db)

    async def _refresh(invoice_id):
        inv = await e_invoice._db.invoices.find_one({"_id": invoice_id}) or {}
        return {"updated": False, "verified": False, "invoice": inv}

    fetch = AsyncMock(return_value=REMOTE_XML)
    refresh = AsyncMock(side_effect=_refresh)
    resolve = AsyncMock(return_value=dict(GIB_INFO))
    mocks = SimpleNamespace(fetch=fetch, refresh=refresh, resolve=resolve)

    prev = (server.db, rbac._db, saas._db, addons._db, e_invoice._db, ubl_export._db)
    prev_user = (e_invoice._current_user, ubl_export._current_user)
    server.db = db
    rbac._db = db
    saas._db = db
    addons._db = db
    e_invoice._db = db
    ubl_export._db = db
    e_invoice._current_user = server.get_current_user
    ubl_export._current_user = server.get_current_user
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(e_invoice, "fetch_integrator_xml", fetch), \
             patch.object(e_invoice, "refresh_one_invoice_status", refresh), \
             patch.object(e_invoice, "resolve_gib_document_url", resolve):
            client.__enter__()
            entered = True
            yield client, mocks
    finally:
        if entered:
            client.__exit__(None, None, None)
        server.db, rbac._db, saas._db, addons._db, e_invoice._db, ubl_export._db = prev
        e_invoice._current_user, ubl_export._current_user = prev_user
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        saas.invalidate()


def test_doc_paths_are_not_allowlisted():
    banned = {
        ("GET", "/e-invoice/{invoice_id}/status"),
        ("POST", "/e-invoice/{invoice_id}/refresh-status"),
        ("GET", "/invoices/{invoice_id}/gib-document"),
        ("GET", "/invoices/{invoice_id}/gib-document.json"),
        ("GET", "/invoices/{invoice_id}/xml"),
    }
    assert not (banned & allowlist.TENANT_IDOR_ALLOWLIST)
    assert not (banned & set(allowlist.ALLOWLIST_REASONS))


def test_route_signatures_load_tenant_doc():
    guarded = (
        (ubl_export.invoice_xml, ubl_export._user_dep),
        (e_invoice.api_einvoice_status, e_invoice._user_dep),
        (e_invoice.api_refresh_einvoice_status, e_invoice._user_dep),
        (e_invoice.api_gib_document_redirect, e_invoice._user_dep),
        (e_invoice.api_gib_document_json, e_invoice._user_dep),
    )
    for fn, dep in guarded:
        sig = inspect.signature(fn)
        assert sig.parameters["user"].default.dependency is dep
        assert "get_tenant_doc" in inspect.getsource(fn)
    xml_src = inspect.getsource(e_invoice.api_einvoice_xml)
    assert "_require_einvoice_access" in xml_src
    assert "ubl_export.invoice_xml_payload" in xml_src
    assert "ubl_export.invoice_xml(" not in xml_src
    assert list(inspect.signature(e_invoice.refresh_one_invoice_status).parameters) == ["invoice_id"]
    assert list(inspect.signature(e_invoice.resolve_gib_document_url).parameters) == ["invoice_id"]
    assert "api_refresh_einvoice_status" not in inspect.getsource(e_invoice.refresh_outbound_statuses)
    assert "api_einvoice_status" not in inspect.getsource(e_invoice.outbound_status_loop)


def test_no_token_is_401(api):
    client, mocks = api
    for method, path in _routes(INV_B):
        response = _hit(client, mocks, method, path)
        assert response.status_code == 401, (path, response.text)
        _no_secret(response)
        _mocks_idle(mocks)


def test_other_company_is_404_without_integrator(api):
    client, mocks = api
    headers = _auth("user-a")
    for method, path in _routes(INV_B):
        response = _hit(client, mocks, method, path, headers=headers)
        assert response.status_code == 404, (path, response.text)
        assert response.json()["detail"] == NOT_FOUND
        _no_secret(response)
        _mocks_idle(mocks)


def test_missing_invoice_is_404(api):
    client, mocks = api
    headers = _auth("user-a")
    for method, path in _routes("missing-invoice"):
        response = _hit(client, mocks, method, path, headers=headers)
        assert response.status_code == 404, (path, response.text)
        assert response.json()["detail"] == NOT_FOUND
        _mocks_idle(mocks)


def _assert_own(method, path, response, mocks, number):
    if path.endswith("/xml"):
        assert response.status_code == 200, (path, response.text)
        assert "xml" in (response.headers.get("content-type") or "")
        assert response.content == REMOTE_XML
        assert response.headers.get("x-document-source") == "integrator"
        assert mocks.fetch.await_count == 1
        assert mocks.refresh.await_count == 0
        assert mocks.resolve.await_count == 0
        return
    if path.endswith("/status") and method == "GET":
        assert response.status_code == 200, (path, response.text)
        body = response.json()
        assert set(STATUS_FIELDS) <= set(body)
        assert body["invoice_id"] == path.split("/")[3]
        assert body["invoice_number"] == number
        assert body["einvoice_state"] == "sent"
        assert body["e_type"] == "e_invoice"
        assert body["gib_uuid"]
        assert body["mode"] == body["gib_mode"] == "test"
        assert mocks.refresh.await_count == 1
        assert mocks.fetch.await_count == 0
        assert mocks.resolve.await_count == 0
        return
    if path.endswith("/refresh-status"):
        assert response.status_code == 200, (path, response.text)
        body = response.json()
        assert set(REFRESH_FIELDS) <= set(body)
        assert body["status"] == "success"
        assert body["updated"] is False
        assert body["verified"] is False
        assert body["invoice_number"] == number
        assert body["gib_invoice_id"] == f"GIB-{path.split('/')[3]}"
        assert body["gib_status"] == "İşNet"
        assert body["gib_mode"] == "test"
        assert body["message"]
        assert mocks.refresh.await_count == 1
        assert mocks.fetch.await_count == 0
        assert mocks.resolve.await_count == 0
        return
    if path.endswith("/gib-document"):
        assert response.status_code == 302, (path, response.text)
        assert GIB_INFO["url"] in (response.headers.get("location") or "")
        assert mocks.resolve.await_count == 1
        assert mocks.fetch.await_count == 0
        assert mocks.refresh.await_count == 0
        return
    if path.endswith("/gib-document.json"):
        assert response.status_code == 200, (path, response.text)
        assert response.json() == GIB_INFO
        assert mocks.resolve.await_count == 1
        assert mocks.fetch.await_count == 0
        assert mocks.refresh.await_count == 0
        return
    raise AssertionError(path)


def test_own_company_is_200(api):
    client, mocks = api
    headers = _auth("user-a")
    for method, path in _routes(INV_A):
        response = _hit(client, mocks, method, path, headers=headers)
        _no_secret(response)
        _assert_own(method, path, response, mocks, "A-INV-1")


def test_super_admin_is_200(api):
    client, mocks = api
    headers = _auth("user-sa", superadmin=True)
    for method, path in _routes(INV_B):
        response = _hit(client, mocks, method, path, headers=headers)
        _assert_own(method, path, response, mocks, "B-SECRET-NO")


def test_paper_invoice_xml_is_400(api):
    client, mocks = api
    response = _hit(client, mocks, "GET", f"/api/invoices/{INV_PAPER}/xml", headers=_auth("user-a"))
    assert response.status_code == 400, response.text
    assert response.json()["detail"] == PAPER_DETAIL
    _mocks_idle(mocks)


def test_share_token_downloads_local_ubl_without_session(api):
    client, mocks = api
    token = signed_links.make_doc_share_token(INV_A, "e-invoice-xml")
    mocks.fetch.return_value = None
    seen = {}
    real = ubl_export.invoice_xml_payload

    async def _wrapped(inv):
        seen["id"] = inv.get("_id")
        return await real(inv)

    with patch.object(ubl_export, "invoice_xml_payload", _wrapped):
        response = _hit(client, mocks, "GET", f"/api/e-invoice/{INV_A}/xml", params={"t": token})
    assert response.status_code == 200, response.text
    assert "xml" in (response.headers.get("content-type") or "")
    assert b"A-INV-1" in response.content
    assert b"REMOTE-UBL" not in response.content
    assert response.headers.get("x-document-source") != "integrator"
    assert seen["id"] == INV_A
    assert mocks.fetch.await_count >= 1
    assert mocks.refresh.await_count == 0
    assert mocks.resolve.await_count == 0
    _no_secret(response)


def test_share_token_other_company_still_downloads_without_session(api):
    """İmzalı XML linki oturum ve şirket üyeliği istemez."""
    client, mocks = api
    token = signed_links.make_doc_share_token(INV_B, "e-invoice-xml")
    mocks.fetch.return_value = None
    response = _hit(client, mocks, "GET", f"/api/e-invoice/{INV_B}/xml", params={"t": token})
    assert response.status_code == 200, response.text
    assert b"B-SECRET-NO" in response.content
    assert b"REMOTE-UBL" not in response.content
    assert mocks.refresh.await_count == 0
    assert mocks.resolve.await_count == 0


def test_invalid_share_token_without_session_is_401(api):
    client, mocks = api
    response = _hit(
        client,
        mocks,
        "GET",
        f"/api/e-invoice/{INV_B}/xml",
        params={"t": "1.not-a-valid-signature"},
    )
    assert response.status_code == 401, response.text
    _no_secret(response)
    _mocks_idle(mocks)
