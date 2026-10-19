"""Banka logosu: scope=bank şirket dokümanı, scope=account yalnız hesap.

Bellek içi veritabanı ve TestClient. Canlı sunucuya ve MySQL'e bağlanmaz.
"""
from __future__ import annotations

import copy
import io
import os
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from PIL import Image

os.environ.setdefault("JWT_SECRET", "test-bank-logo-upload-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import addons  # noqa: E402
import attendance  # noqa: E402
import auth_utils  # noqa: E402
import company_audit  # noqa: E402
import rbac  # noqa: E402
import saas  # noqa: E402
import server  # noqa: E402
import storage_manager  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

COMP_A = "comp-logo-a"
COMP_B = "comp-logo-b"
IBAN_IS = "TR33 0006 4000 0011 2345 6789 01"
SVG = b"<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"


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


class MemColl:
    def __init__(self):
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
        for i, doc in enumerate(self.docs):
            if match_query(doc, query or {}):
                self.docs[i] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1)
        if upsert:
            self.docs.append(new_upsert_doc(update, query))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=self.docs[-1].get("_id"))
        return SimpleNamespace(modified_count=0, matched_count=0)

    async def count_documents(self, query=None):
        return sum(1 for doc in self.docs if match_query(doc, query or {}))

    async def delete_many(self, query=None):
        before = len(self.docs)
        self.docs = [d for d in self.docs if not match_query(d, query or {})]
        return SimpleNamespace(deleted_count=before - len(self.docs))


class MemDB:
    def __init__(self):
        self._cols = {}

    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = MemColl()
            self._cols[name] = coll
        return coll

    def __getitem__(self, name):
        return getattr(self, name)


def _user(uid, company_ids, active):
    return {
        "_id": uid,
        "id": uid,
        "email": f"{uid}@example.com",
        "name": uid,
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": list(company_ids),
        "active_company_id": active,
        "user_number": f"U-{uid}",
    }


def _auth(uid):
    token = auth_utils.create_access_token(uid, f"{uid}@example.com", "admin", is_super_admin=False)
    return {"Authorization": f"Bearer {token}"}


def _png(width, height):
    im = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    for x in range(width // 2, width):
        for y in range(height):
            im.putpixel((x, y), (20, 80, 160, 255))
    buf = io.BytesIO()
    im.save(buf, format="PNG")
    return buf.getvalue()


def _company(db, cid):
    return next(d for d in db.companies.docs if d["_id"] == cid)


def _account(db, aid):
    return next(d for d in db.bank_accounts.docs if d["_id"] == aid)


@pytest.fixture
def api():
    db = MemDB()
    db.users.docs.extend([
        _user("user-a", [COMP_A], COMP_A),
        _user("user-b", [COMP_B], COMP_B),
        _user("user-ab", [COMP_A, COMP_B], COMP_A),
    ])
    db.companies.docs.extend([
        {"_id": COMP_A, "name": "Firma A", "bank_logos": {"0205": "/api/files/keep-kuveyt.png"}},
        {"_id": COMP_B, "name": "Firma B", "bank_logos": {"0064": "/api/files/b-isbank.png"}},
    ])
    db.bank_accounts.docs.extend([
        {
            "_id": "accA", "company_id": COMP_A, "type": "bank", "bank_name": "Türkiye İş Bankası",
            "account_name": "Vadesiz A", "iban": IBAN_IS, "current_balance": 10,
        },
        {
            "_id": "accPlain", "company_id": COMP_A, "type": "bank", "bank_name": "Diğer",
            "account_name": "IBAN'sız", "current_balance": 0,
        },
        {
            "_id": "accB", "company_id": COMP_B, "type": "bank", "bank_name": "Türkiye İş Bankası",
            "account_name": "Vadesiz B", "iban": IBAN_IS, "current_balance": 20,
            "logo_url": "/api/files/b-account.png",
        },
    ])
    stored = []

    def fake_put(path, data, content_type):
        stored.append({"path": path, "data": data, "content_type": content_type})
        return {"path": path, "size": len(data)}

    prev = (server.db, rbac._db, saas._db, company_audit._db, attendance._db, storage_manager._db, addons._db)
    server.db = db
    rbac._db = db
    saas._db = db
    company_audit._db = db
    attendance._db = db
    storage_manager._db = db
    addons._db = db
    saas.invalidate()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    client = TestClient(server.app)
    entered = False
    try:
        with patch.object(server, "put_object", fake_put):
            client.__enter__()
            entered = True
            yield client, db, stored
    finally:
        if entered:
            client.__exit__(None, None, None)
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        server.db, rbac._db, saas._db, company_audit._db, attendance._db, storage_manager._db, addons._db = prev
        saas.invalidate()


def _post(client, aid, payload, content_type, name, *, scope, user="user-a", params=None):
    query = {"scope": scope}
    if params:
        query.update(params)
    return client.post(
        f"/api/banking/accounts/{aid}/logo",
        params=query,
        files={"file": (name, io.BytesIO(payload), content_type)},
        headers=_auth(user),
    )


def test_logo_routes_ignore_request_company_and_nexus_default():
    import inspect
    for fn in (server.upload_bank_account_logo, server.delete_bank_account_logo, server._bank_logo_context):
        assert "company_id" not in inspect.signature(fn).parameters
        src = inspect.getsource(fn)
        assert "comp_nexus_main_01" not in src
        assert "logger" not in src or "iban" not in src.lower()


def test_svg_gif_heic_pdf_and_mislabeled_svg_are_rejected(api):
    client, db, stored = api
    before_a = copy.deepcopy(_company(db, COMP_A))
    before_acc = copy.deepcopy(_account(db, "accA"))
    cases = [
        ("logo.svg", SVG, "image/svg+xml"),
        ("logo.png", SVG, "image/png"),
        ("logo.png", b"GIF89a" + b"\x00" * 16, "image/png"),
        ("logo.png", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 8, "image/heic"),
        ("logo.pdf", b"%PDF-1.4\n", "application/pdf"),
    ]
    for name, payload, ctype in cases:
        res = _post(client, "accA", payload, ctype, name, scope="bank")
        assert res.status_code == 400, (name, res.text)
        res_acc = _post(client, "accA", payload, ctype, name, scope="account")
        assert res_acc.status_code == 400, (name, res_acc.text)
    assert stored == []
    assert db.files.docs == []
    assert _company(db, COMP_A) == before_a
    assert _account(db, "accA") == before_acc
    assert _company(db, COMP_B)["bank_logos"]["0064"] == "/api/files/b-isbank.png"


def test_png_over_512kb_is_rejected(api):
    client, db, stored = api
    before = copy.deepcopy(_company(db, COMP_A))
    blob = _png(16, 16) + (b"\x00" * (512 * 1024))
    assert len(blob) > 512 * 1024
    res = _post(client, "accA", blob, "image/png", "big.png", scope="bank")
    assert res.status_code == 400, res.text
    assert stored == []
    assert db.files.docs == []
    assert _company(db, COMP_A) == before
    assert _account(db, "accA").get("logo_url") in (None, "")


def test_png_is_shrunk_and_bank_scope_writes_company_logo(api):
    client, db, stored = api
    res = _post(client, "accA", _png(300, 180), "image/png", "logo.png", scope="bank")
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["bank_code"] == "0064"
    assert body["scope"] == "bank"
    assert IBAN_IS.replace(" ", "") not in res.text
    url = body["url"]
    assert url.startswith("/api/files/")
    assert "/accounts/" + COMP_A + "/company/" in url
    assert _company(db, COMP_A)["bank_logos"]["0064"] == url
    assert _company(db, COMP_A)["bank_logos"]["0205"] == "/api/files/keep-kuveyt.png"
    assert _account(db, "accA").get("logo_url") in (None, "")
    assert _company(db, COMP_B)["bank_logos"]["0064"] == "/api/files/b-isbank.png"
    assert len(stored) == 1
    assert stored[0]["path"].endswith("." + (url.rsplit(".", 1)[-1]))
    assert f"/accounts/{COMP_A}/company/" in stored[0]["path"]
    im = Image.open(io.BytesIO(stored[0]["data"]))
    im.load()
    assert max(im.size) == 128
    assert "A" in im.mode
    assert im.getpixel((0, 0))[-1] < 40
    assert im.getpixel((im.size[0] - 1, im.size[1] // 2))[-1] > 200
    assert db.files.docs[0]["entity"] == "company"
    assert db.files.docs[0]["company_id"] == COMP_A
    declared_svg = _post(client, "accPlain", _png(40, 40), "image/svg+xml", "real.png", scope="account")
    assert declared_svg.status_code == 200, declared_svg.text


def test_account_scope_writes_only_logo_url(api):
    client, db, stored = api
    before = copy.deepcopy(_company(db, COMP_A)["bank_logos"])
    res = _post(client, "accA", _png(160, 90), "image/png", "one.png", scope="account")
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert _account(db, "accA")["logo_url"] == url
    assert _company(db, COMP_A)["bank_logos"] == before
    assert "0064" not in _company(db, COMP_A)["bank_logos"]
    missing = _post(client, "accPlain", _png(32, 32), "image/png", "x.png", scope="bank")
    assert missing.status_code == 400, missing.text
    assert _account(db, "accPlain").get("logo_url") in (None, "")
    assert len(stored) == 1


def test_other_company_account_is_not_found(api):
    client, db, stored = api
    before = copy.deepcopy(_company(db, COMP_B))
    before_acc = copy.deepcopy(_account(db, "accB"))
    posted = _post(client, "accB", _png(40, 40), "image/png", "x.png", scope="bank", user="user-a")
    assert posted.status_code == 404, posted.text
    deleted = client.delete(
        "/api/banking/accounts/accB/logo",
        params={"scope": "account"},
        headers=_auth("user-a"),
    )
    assert deleted.status_code == 404, deleted.text
    assert stored == []
    assert _company(db, COMP_B) == before
    assert _account(db, "accB") == before_acc


def test_query_company_id_does_not_retarget(api):
    client, db, _stored = api
    res = _post(
        client, "accA", _png(48, 48), "image/png", "logo.png",
        scope="bank", user="user-ab", params={"company_id": COMP_B},
    )
    assert res.status_code == 200, res.text
    url = res.json()["url"]
    assert _company(db, COMP_A)["bank_logos"]["0064"] == url
    assert _company(db, COMP_B)["bank_logos"]["0064"] == "/api/files/b-isbank.png"


def test_delete_unsets_bank_and_account_fields(api):
    client, db, _stored = api
    up_bank = _post(client, "accA", _png(80, 80), "image/png", "a.png", scope="bank")
    up_acc = _post(client, "accA", _png(80, 80), "image/png", "b.png", scope="account")
    assert up_bank.status_code == 200 and up_acc.status_code == 200
    assert _company(db, COMP_A)["bank_logos"]["0064"]
    assert _account(db, "accA")["logo_url"]
    keep = _company(db, COMP_A)["bank_logos"]["0205"]
    gone_acc = client.delete("/api/banking/accounts/accA/logo", params={"scope": "account"}, headers=_auth("user-a"))
    assert gone_acc.status_code == 200, gone_acc.text
    assert "logo_url" not in _account(db, "accA")
    assert _company(db, COMP_A)["bank_logos"]["0064"] == up_bank.json()["url"]
    gone_bank = client.delete("/api/banking/accounts/accA/logo", params={"scope": "bank"}, headers=_auth("user-a"))
    assert gone_bank.status_code == 200, gone_bank.text
    assert "0064" not in (_company(db, COMP_A).get("bank_logos") or {})
    assert _company(db, COMP_A)["bank_logos"]["0205"] == keep


def test_list_keeps_account_logo_and_company_bank_logos(api):
    client, db, _stored = api
    _run_upload = _post(client, "accA", _png(64, 64), "image/png", "bank.png", scope="bank")
    assert _run_upload.status_code == 200, _run_upload.text
    bank_url = _run_upload.json()["url"]
    account_url = "/api/files/account-override.png"
    db.bank_accounts.docs = [
        {**d, "logo_url": account_url} if d["_id"] == "accA" else d
        for d in db.bank_accounts.docs
    ]
    listed = client.get("/api/banking/accounts", headers=_auth("user-a"))
    assert listed.status_code == 200, listed.text
    row = next(a for a in listed.json() if a["id"] == "accA")
    assert row["logo_url"] == account_url
    assert _company(db, COMP_A)["bank_logos"]["0064"] == bank_url
    me = client.get("/api/auth/me", headers=_auth("user-a"))
    assert me.status_code == 200, me.text
    company = next(c for c in me.json()["companies"] if c["id"] == COMP_A)
    assert company["bank_logos"]["0064"] == bank_url
    assert company["bank_logos"]["0205"] == "/api/files/keep-kuveyt.png"
