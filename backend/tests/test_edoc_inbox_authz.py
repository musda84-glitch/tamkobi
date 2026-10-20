"""Gelen e-belge kutusu: GET uçları modül view ister; yeniden okuma edit ister.

Middleware GET isteklerinde modül bakmaz. Bu dosya uçların kendi 403'ünü ölçer.
Boş liste ile gizleme yok. Canlı sunucu ve 8021 yok.
"""
from __future__ import annotations

import copy
import inspect
import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, HTTPException, Request
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock

os.environ.setdefault("JWT_SECRET", "test-edoc-inbox-authz-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import edocs  # noqa: E402
import rbac  # noqa: E402
from auth_utils import session_token  # noqa: E402
from mysql_store import match_query  # noqa: E402

COMPANY = "comp1"
DENIED = "Bu işlem için yetkiniz yok."
READS = (
    "/api/edocs/inbox",
    "/api/edocs/inbox/doc1/xml",
    "/api/edocs/inbox/doc1/xml/download",
    "/api/edocs/inbox/doc1/pdf",
)


class MemCursor:
    def __init__(self, docs):
        self._docs = list(docs)

    def sort(self, key, direction=1):
        self._docs.sort(key=lambda doc: str(doc.get(key) or ""), reverse=int(direction) < 0)
        return self

    async def to_list(self, length=None):
        rows = self._docs if length is None else self._docs[: int(length)]
        return [copy.deepcopy(row) for row in rows]


class MemColl:
    def __init__(self):
        self.docs = []

    def find(self, query=None, projection=None):
        return MemCursor([doc for doc in self.docs if match_query(doc, query or {})])

    async def find_one(self, query=None, projection=None):
        for doc in self.docs:
            if match_query(doc, query or {}):
                return copy.deepcopy(doc)
        return None

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def delete_one(self, query):
        for index, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs.pop(index)
                return None
        return None


class MemDB:
    def __init__(self):
        self.incoming_edocs = MemColl()
        self.incoming_edoc_xml = MemColl()


def _user(role, *, superadmin=False):
    return {
        "_id": f"usr-{role}",
        "id": f"usr-{role}",
        "role": role,
        "is_super_admin": superadmin,
        "company_ids": [COMPANY],
        "active_company_id": COMPANY,
    }


_USERS = {
    "personel": _user("personel"),
    "advisor": _user("advisor"),
    "admin": _user("admin"),
    "owner": _user("owner"),
    "editor": _user("accountant"),
    "ghost": _user("ghost"),
    "empty": _user("empty"),
    "bare": _user("bare"),
    "boom": _user("boom"),
}


def _role_doc(user, company_id=None):
    assert company_id == COMPANY
    role = str((user or {}).get("role") or "")
    if role in ("admin", "owner"):
        raise AssertionError("admin/owner rol belgesi çözmemeli")
    if role == "boom":
        raise RuntimeError("rol belgesi okunamadı")
    if role == "ghost":
        return None
    if role == "empty":
        return {}
    if role == "bare":
        return {"code": "ghost", "name": "Yok"}
    if role == "advisor":
        return {"code": "advisor", "permissions": {"/edoc-inbox": "view"}}
    if role == "accountant":
        return {"code": "accountant", "permissions": {"/edoc-inbox": "edit"}}
    if role == "personel":
        return {"code": "personel", "permissions": {"/edoc-inbox": "none", "/": "view"}}
    raise AssertionError(role)


@pytest.fixture
def client(monkeypatch):
    db = MemDB()
    db.incoming_edocs.docs.append({
        "_id": "doc1",
        "company_id": COMPANY,
        "status": "pending",
        "number": "ABC1",
        "uuid": "11111111-2222-3333-4444-555555555555",
        "kind": "invoice",
        "source": "ubl_xml",
        "lines": [{"name": "Kalem", "quantity": 1}],
        "supplier": {"name": "Tedarik", "tax_id": "1111111111"},
        "grand_total": 10,
        "received_at": "2026-10-01T00:00:00",
    })
    db.incoming_edoc_xml.docs.append({
        "_id": "doc1",
        "company_id": COMPANY,
        "xml": "<Invoice>secret</Invoice>",
    })

    async def user_from_token(token):
        user = _USERS.get(token)
        if not user:
            raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
        return user

    async def current_user(request: Request):
        token = session_token(request)
        if not token:
            raise HTTPException(status_code=401, detail="Giriş yapmanız gerekiyor.")
        return await user_from_token(token)

    async def role_for(user, company_id=None):
        return _role_doc(user, company_id)

    edocs.init(db, {"user_from_token": user_from_token}, current_user)
    monkeypatch.setattr(edocs.rbac, "role_for", role_for)
    monkeypatch.setattr(edocs, "_fetch_incoming_edoc_pdf", AsyncMock(return_value=b"%PDF-1.4"))
    app = FastAPI()
    app.include_router(edocs.router)
    with TestClient(app) as test_client:
        yield test_client


def _headers(token):
    return {"Authorization": f"Bearer {token}"}


def _denied(response):
    assert response.status_code == 403, response.text
    assert response.json()["detail"] == DENIED
    assert "items" not in response.json()


def test_personnel_cannot_read_inbox_xml_or_pdf(client):
    for path in READS:
        _denied(client.get(path, params={"company_id": COMPANY}, headers=_headers("personel")))


def test_missing_role_document_is_forbidden(client):
    for token in ("ghost", "empty", "bare", "boom"):
        _denied(client.get("/api/edocs/inbox", params={"company_id": COMPANY}, headers=_headers(token)))
        _denied(client.get("/api/edocs/inbox/doc1/xml", params={"company_id": COMPANY}, headers=_headers(token)))
        _denied(client.get("/api/edocs/inbox/doc1/pdf", params={"company_id": COMPANY}, headers=_headers(token)))


def test_advisor_view_can_read_inbox_xml_and_pdf(client):
    headers = _headers("advisor")
    inbox = client.get("/api/edocs/inbox", params={"company_id": COMPANY}, headers=headers)
    assert inbox.status_code == 200, inbox.text
    assert [row["id"] for row in inbox.json()["items"]] == ["doc1"]
    assert inbox.json()["counts"]["pending"] == 1

    xml = client.get("/api/edocs/inbox/doc1/xml", params={"company_id": COMPANY}, headers=headers)
    assert xml.status_code == 200, xml.text
    assert xml.json()["xml"] == "<Invoice>secret</Invoice>"

    download = client.get("/api/edocs/inbox/doc1/xml/download", params={"company_id": COMPANY}, headers=headers)
    assert download.status_code == 200, download.text
    assert b"secret" in download.content

    pdf = client.get("/api/edocs/inbox/doc1/pdf", params={"company_id": COMPANY}, headers=headers)
    assert pdf.status_code == 200, pdf.text
    assert pdf.content.startswith(b"%PDF")


def test_admin_and_owner_read_without_role_document(client):
    for token in ("admin", "owner"):
        inbox = client.get("/api/edocs/inbox", params={"company_id": COMPANY}, headers=_headers(token))
        assert inbox.status_code == 200, inbox.text
        assert inbox.json()["items"][0]["id"] == "doc1"
        xml = client.get("/api/edocs/inbox/doc1/xml", params={"company_id": COMPANY}, headers=_headers(token))
        assert xml.status_code == 200, xml.text
        pdf = client.get("/api/edocs/inbox/doc1/pdf", params={"company_id": COMPANY}, headers=_headers(token))
        assert pdf.status_code == 200, pdf.text


def test_reparse_and_cleanup_need_edit_not_view(client):
    headers = _headers("advisor")
    for path in ("/api/edocs/inbox/reparse", "/api/edocs/inbox/cleanup"):
        _denied(client.post(path, params={"company_id": COMPANY}, headers=headers))
    editor = _headers("editor")
    reparse = client.post("/api/edocs/inbox/reparse", params={"company_id": COMPANY}, headers=editor)
    assert reparse.status_code == 200, reparse.text
    assert reparse.json()["fixed"] == 0
    cleanup = client.post("/api/edocs/inbox/cleanup", params={"company_id": COMPANY}, headers=editor)
    assert cleanup.status_code == 200, cleanup.text
    assert cleanup.json()["deleted"] == 0


def test_sync_einvoice_incoming_stays_on_invoice_edit():
    """POST senkron middleware'de /invoices edit ister; gelen kutu view kontrolüne bağlanmaz."""
    import server

    source = inspect.getsource(server.sync_einvoice_incoming)
    assert "_require_inbox_view" not in source
    assert "require_inbox_company" not in source
    path = "/api/einvoice/incoming/sync"
    assert rbac.module_for_path(path) == "/invoices"
    personel = {"/edoc-inbox": "none", "/invoices": "none"}
    assert rbac.mutation_allowed("/invoices", path, personel, "POST") is False
    assert rbac.mutation_allowed("/invoices", path, {"/invoices": "edit"}, "POST") is True
