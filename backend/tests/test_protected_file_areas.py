"""Hassas dosya alanları: tokensız GET kapanır; görsel alanlar açık kalır.

Bellek içi koleksiyon. Canlı veritabanına ve 8021 portuna bağlanmaz.
"""
from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

os.environ.setdefault("JWT_SECRET", "test-protected-file-areas-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import rbac  # noqa: E402
import server  # noqa: E402
import signed_links  # noqa: E402
from dashboard_memdb import MemDB  # noqa: E402

PDF = b"%PDF-1.4\nprotected-file-body\n"
APP = "tamkobi"


def _run(coro):
    return asyncio.run(coro)


def _storage(area: str, company: str = "compA", name: str = "x.pdf") -> str:
    return f"{APP}/accounts/{company}/{area}/{name}"


def _api(storage: str) -> str:
    return f"/api/files/{storage}"


def _legacy(entity: str, company: str = "compA", name: str = "x.pdf") -> str:
    return f"{APP}/{entity}/{company}/{name}"


@pytest.mark.parametrize(
    "area",
    ["purchase_invoices", "sales_invoices", "edocs", "expenses", "support"],
)
def test_sensitive_areas_are_not_public(area):
    path = _api(_storage(area))
    assert rbac.file_public_area(path) is False
    assert rbac.file_public_area(_storage(area)) is False
    assert rbac.is_public_api_path(path, "GET", None) is False
    assert rbac.is_public_api_path(path, "HEAD", None) is False
    assert rbac.is_public_api_path(path, "POST", None) is False


@pytest.mark.parametrize("area", ["products", "company", "quotes", "projects"])
def test_visual_areas_stay_public(area):
    path = _api(_storage(area, name="photo.webp"))
    assert rbac.file_public_area(path) is True
    assert rbac.is_public_api_path(path, "GET", None) is True
    assert rbac.is_public_api_path(path, "HEAD") is True
    assert rbac.is_public_api_path(path, "POST") is False


@pytest.mark.parametrize(
    "area",
    ["contacts", "employees", "partners", "surveys", "recipes", "misc"],
)
def test_other_areas_unchanged_public(area):
    assert rbac.is_public_api_path(_api(_storage(area, name="a.webp")), "GET") is True


@pytest.mark.parametrize(
    "entity",
    ["expense", "purchase_invoice", "sales_invoice", "edoc", "e_invoice", "einvoice", "support_ticket"],
)
def test_legacy_entity_paths_for_sensitive_areas_are_closed(entity):
    assert rbac.is_public_api_path(_api(_legacy(entity)), "GET", None) is False


@pytest.mark.parametrize("entity", ["products", "product", "quote", "employee", "partner_photo", "company"])
def test_legacy_visual_entity_paths_stay_open(entity):
    assert rbac.is_public_api_path(_api(_legacy(entity, name="a.webp")), "GET") is True


def test_odd_file_path_without_area_stays_public():
    assert rbac.is_public_api_path("/api/files/x/y.jpg", "GET") is True
    assert rbac.is_public_api_path("/api/files/upload", "POST") is False


def test_sensitive_file_valid_share_token_is_public(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-protected-file-areas-jwt-secret-not-default")
    storage = _storage("expenses", name="fis.pdf")
    path = _api(storage)
    assert rbac.is_public_api_path(path, "GET", None) is False
    assert rbac.is_public_api_path(path, "GET", "bad") is False
    tok = signed_links.make_doc_share_token(storage, "files")
    assert rbac.is_public_api_path(path, "GET", tok) is True
    assert rbac.is_public_api_path(path, "POST", tok) is False
    expired = signed_links.make_doc_share_token(storage, "files", ttl_sec=-30)
    assert rbac.is_public_api_path(path, "GET", expired) is False


def test_signed_invoice_pdf_and_xml_still_public_with_token(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-protected-file-areas-jwt-secret-not-default")
    pdf = signed_links.make_doc_share_token("inv1", "invoices-pdf")
    xml = signed_links.make_doc_share_token("doc1", "e-invoice-xml")
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "GET") is False
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "GET", pdf) is True
    assert rbac.is_public_api_path("/api/invoices/inv1/pdf", "POST", pdf) is False
    assert rbac.is_public_api_path("/api/e-invoice/doc1/xml", "GET", xml) is True
    assert rbac.is_public_api_path("/api/e-invoice/doc1/xml", "GET", "1.dead") is False


def test_notify_signs_sensitive_file_and_leaves_product_open(monkeypatch):
    monkeypatch.setenv("JWT_SECRET", "test-protected-file-areas-jwt-secret-not-default")
    import event_notify

    product = _storage("products", name="a.webp")
    expense = _storage("expenses", name="fis.pdf")
    pub = event_notify._sign_file_url(f"https://app.example/api/files/{product}", product)
    priv = event_notify._sign_file_url(f"https://app.example/api/files/{expense}", expense)
    assert pub == f"https://app.example/api/files/{product}"
    assert "t=" not in pub
    assert priv.startswith(f"https://app.example/api/files/{expense}?")
    token = priv.split("t=", 1)[1]
    assert signed_links.verify_doc_share_token(expense, "files", token) is True


class _Req:
    def __init__(self, storage: str, *, bearer=None, cookie=None):
        self.headers = {}
        if bearer:
            self.headers["Authorization"] = f"Bearer {bearer}"
        self.cookies = {"access_token": cookie} if cookie else {}
        self.url = SimpleNamespace(path=_api(storage))
        self.method = "GET"
        self.query_params = {}
        self.client = None


def _user(uid, companies, *, superadmin=False):
    return {
        "_id": uid,
        "email": f"{uid}@example.com",
        "role": "admin",
        "is_active": True,
        "is_super_admin": superadmin,
        "company_ids": list(companies),
        "active_company_id": companies[0] if companies else None,
    }


def _token(uid, *, superadmin=False):
    return auth_utils.create_access_token(
        uid, f"{uid}@example.com", "admin", is_super_admin=superadmin,
    )


@pytest.fixture
def files_db(monkeypatch):
    mem = MemDB()
    monkeypatch.setattr(server, "db", mem)
    state = {"calls": [], "payload": PDF, "ctype": "application/pdf", "error": None}

    def _get(path):
        state["calls"].append(path)
        if state["error"] is not None:
            raise state["error"]
        return state["payload"], state["ctype"]

    monkeypatch.setattr(server, "get_object", _get)
    return mem, state


def _insert_file(mem, storage, company, content_type="application/pdf"):
    _run(mem.files.insert_one({
        "_id": "f-" + storage,
        "storage_path": storage,
        "company_id": company,
        "content_type": content_type,
        "is_deleted": False,
    }))


def _serve(storage, *, bearer=None, cookie=None, t=None, w=None, fmt=None):
    return _run(server.serve_file(
        storage,
        _Req(storage, bearer=bearer, cookie=cookie),
        w=w,
        fmt=fmt,
        t=t,
    ))


def _expect_404(storage, **kw):
    with pytest.raises(HTTPException) as exc:
        _serve(storage, **kw)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Dosya bulunamadı."


def test_legacy_expense_path_anonymous_is_404(files_db):
    mem, state = files_db
    storage = _legacy("expense", company="compA", name="fis.pdf")
    _insert_file(mem, storage, "compA")
    _expect_404(storage)
    assert state["calls"] == []


def test_sensitive_file_anonymous_is_404_and_does_not_read_storage(files_db):
    mem, state = files_db
    storage = _storage("expenses", name="fis.pdf")
    _insert_file(mem, storage, "compA")
    _expect_404(storage, w=64)
    assert state["calls"] == []


def test_sensitive_file_missing_record_is_404(files_db):
    _mem, state = files_db
    storage = _storage("sales_invoices", name="f.pdf")
    tok = signed_links.make_doc_share_token(storage, "files")
    _expect_404(storage)
    _expect_404(storage, t=tok)
    assert state["calls"] == []


def test_sensitive_file_other_company_is_404_own_company_is_served(files_db):
    mem, state = files_db
    storage = _storage("purchase_invoices", company="compB", name="al.pdf")
    _insert_file(mem, storage, "compB")
    _run(mem.users.insert_one(_user("ua", ["compA"])))
    _run(mem.users.insert_one(_user("ub", ["compB"])))
    _expect_404(storage, bearer=_token("ua"))
    assert state["calls"] == []
    resp = _serve(storage, bearer=_token("ub"))
    assert resp.status_code == 200
    assert resp.body == PDF
    assert resp.media_type == "application/pdf"
    assert state["calls"] == [storage]


def test_sensitive_file_cookie_session_serves_own_company(files_db):
    mem, _state = files_db
    storage = _storage("expenses", company="compA", name="fis.pdf")
    _insert_file(mem, storage, "compA")
    _run(mem.users.insert_one(_user("ua", ["compA"])))
    resp = _serve(storage, cookie=_token("ua"))
    assert resp.status_code == 200
    assert resp.body == PDF


def test_sensitive_file_super_admin_serves_other_company(files_db):
    mem, _state = files_db
    storage = _storage("edocs", company="compB", name="ubl.xml")
    _insert_file(mem, storage, "compB")
    _run(mem.users.insert_one(_user("sa", [], superadmin=True)))
    resp = _serve(storage, bearer=_token("sa", superadmin=True))
    assert resp.status_code == 200
    assert resp.body == PDF


def test_sensitive_file_share_token_serves_expired_and_bad_are_404(files_db):
    mem, state = files_db
    storage = _storage("support", company="compA", name="ek.pdf")
    _insert_file(mem, storage, "compA")
    good = signed_links.make_doc_share_token(storage, "files")
    expired = signed_links.make_doc_share_token(storage, "files", ttl_sec=-60)
    resp = _serve(storage, t=good)
    assert resp.status_code == 200
    assert resp.body == PDF
    _expect_404(storage, t=expired)
    _expect_404(storage, t="nope")
    _expect_404(storage, t="123.deadbeef")
    assert state["calls"] == [storage]


def test_public_product_file_anonymous_is_served(files_db):
    mem, state = files_db
    storage = _storage("products", name="photo.webp")
    _insert_file(mem, storage, "compA", content_type="image/jpeg")
    state["payload"] = b"\xff\xd8\xff" + b"jpeg-bytes-not-html" * 2
    state["ctype"] = "image/jpeg"
    resp = _serve(storage)
    assert resp.status_code == 200
    assert resp.body == state["payload"]
    assert resp.media_type == "image/jpeg"
    assert state["calls"] == [storage]


def test_public_product_without_record_still_served(files_db):
    _mem, state = files_db
    storage = _storage("quotes", name="gorsel.webp")
    resp = _serve(storage)
    assert resp.status_code == 200
    assert resp.body == PDF


def test_public_html_body_still_404_and_storage_error_still_502(files_db):
    _mem, state = files_db
    storage = _storage("company", name="logo.png")
    state["payload"] = b"<!doctype html><html><body>nope</body></html>"
    state["ctype"] = "text/html"
    _expect_404(storage)
    state["payload"] = PDF
    state["ctype"] = "application/pdf"
    state["error"] = RuntimeError("disk")
    with pytest.raises(HTTPException) as exc:
        _serve(storage)
    assert exc.value.status_code == 502


def test_public_thumb_cache_still_hits_before_original(files_db):
    _mem, state = files_db
    storage = _storage("projects", name="foto.webp")
    state["payload"] = b"x" * 40
    state["ctype"] = "image/webp"
    resp = _serve(storage, w=128)
    assert resp.status_code == 200
    assert resp.headers["X-Image-Cache"] == "hit"
    assert state["calls"] and state["calls"][0] != storage


def test_middleware_sensitive_file_anonymous_401_public_passes():
    class FakeRequest:
        def __init__(self, path, token=None):
            self.url = MagicMock(path=path)
            self.method = "GET"
            self.headers = {}
            self.cookies = {}
            self.query_params = {"t": token} if token else {}
            self.scope = {"query_string": b""}

    mw = rbac.PermissionAndAuditMiddleware(app=MagicMock())
    rbac._db = MagicMock()
    sensitive = _api(_storage("expenses", name="fis.pdf"))

    async def denied(_req):
        raise AssertionError("call_next tokensız hassas dosyada çağrılmamalı")

    resp = _run(mw.dispatch(FakeRequest(sensitive), denied))
    assert resp.status_code == 401

    seen = {"ok": False}

    async def allow(_req):
        seen["ok"] = True
        return MagicMock(status_code=200)

    public = _api(_storage("products", name="a.webp"))
    resp = _run(mw.dispatch(FakeRequest(public), allow))
    assert seen["ok"] is True
    assert resp.status_code == 200

    tok = signed_links.make_doc_share_token(_storage("expenses", name="fis.pdf"), "files")
    seen["ok"] = False
    resp = _run(mw.dispatch(FakeRequest(sensitive, tok), allow))
    assert seen["ok"] is True
    assert resp.status_code == 200
