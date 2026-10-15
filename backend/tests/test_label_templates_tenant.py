"""Etiket şablonları: oturum zorunlu, company_id yalnızca erişilen firmadan."""
from __future__ import annotations

import asyncio
import inspect
from unittest.mock import MagicMock, patch

from fastapi import HTTPException
from fastapi.routing import APIRoute

import rbac
import server


OWN = "co_mine"
OTHER = "co_other"
USER = {
    "_id": "u_mine",
    "company_ids": [OWN],
    "active_company_id": OWN,
    "is_super_admin": False,
    "role": "admin",
}
SUPER = {
    "_id": "u_sa",
    "company_ids": [],
    "active_company_id": OWN,
    "is_super_admin": True,
    "role": "admin",
}


class _Coll:
    def __init__(self, docs):
        self.docs = {d["_id"]: dict(d) for d in docs}
        self.finds = []

    def find(self, q):
        self.finds.append(dict(q))
        rows = [dict(d) for d in self.docs.values() if all(d.get(k) == v for k, v in q.items())]

        class _Cursor:
            def sort(self, key, direction=1):
                rows.sort(key=lambda d: d.get(key) or "", reverse=direction < 0)
                return self

            async def to_list(self, n):
                return [dict(d) for d in rows[:n]]

        return _Cursor()

    async def find_one(self, q):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                return dict(d)
        return None

    async def insert_one(self, doc):
        self.docs[doc["_id"]] = dict(doc)

    async def update_one(self, q, upd):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                d.update(upd.get("$set") or {})
                return

    async def update_many(self, q, upd):
        for d in self.docs.values():
            if all(d.get(k) == v for k, v in q.items()):
                d.update(upd.get("$set") or {})

    async def delete_one(self, q):
        for _id, d in list(self.docs.items()):
            if all(d.get(k) == v for k, v in q.items()):
                del self.docs[_id]
                return


class _DB:
    def __init__(self, docs):
        self.label_templates = _Coll(docs)

    def __getitem__(self, name):
        return getattr(self, name)


def _seed():
    return _DB([
        {"_id": "tpl_own", "company_id": OWN, "name": "Benim", "is_default": True, "created_at": "2026-01-01"},
        {"_id": "tpl_own_2", "company_id": OWN, "name": "İkinci", "is_default": False, "created_at": "2026-01-02"},
        {"_id": "tpl_other", "company_id": OTHER, "name": "Yabancı", "is_default": True, "created_at": "2026-01-01"},
    ])


def _run(coro):
    try:
        return 200, asyncio.run(coro)
    except HTTPException as exc:
        return exc.status_code, exc.detail


class _Req:
    def __init__(self, path, method="GET"):
        self.url = MagicMock(path=path)
        self.method = method
        self.headers = {}
        self.cookies = {}
        self.query_params = {}
        self.scope = {"query_string": b""}


def test_label_template_routes_require_login():
    paths = {
        ("GET", "/api/label-templates"),
        ("POST", "/api/label-templates"),
        ("PUT", "/api/label-templates/{tpl_id}"),
        ("DELETE", "/api/label-templates/{tpl_id}"),
    }
    seen = set()
    for route in server.app.routes:
        if not isinstance(route, APIRoute):
            continue
        for method in route.methods or ():
            key = (method, route.path)
            if key not in paths:
                continue
            calls = []

            def walk(dep):
                if getattr(dep, "call", None):
                    calls.append(dep.call)
                for sub in dep.dependencies:
                    walk(sub)

            walk(route.dependant)
            assert server.get_current_user in calls, key
            seen.add(key)
    assert seen == paths

    sig = inspect.signature(server.list_label_templates)
    assert sig.parameters["company_id"].default is None


def test_unauthenticated_label_templates_401():
    prev = rbac._db
    rbac._db = MagicMock()
    mw = rbac.PermissionAndAuditMiddleware(app=MagicMock())

    async def call_next(_req):
        raise AssertionError("tokensız istek uç noktaya ulaşmamalı")

    try:
        cases = [
            ("GET", "/api/label-templates"),
            ("POST", "/api/label-templates"),
            ("PUT", "/api/label-templates/tpl_other"),
            ("DELETE", "/api/label-templates/tpl_other"),
        ]
        for method, path in cases:
            resp = asyncio.run(mw.dispatch(_Req(path, method), call_next))
            assert resp.status_code == 401, method
    finally:
        rbac._db = prev


def test_get_current_user_without_token_401():
    class Req:
        headers = {}
        cookies = {}
        url = MagicMock(path="/api/label-templates")
        method = "GET"

    status, _detail = _run(server.get_current_user(Req()))
    assert status == 401


def test_other_company_list_and_create_403():
    db = _seed()
    with patch.object(server, "db", db):
        status, _detail = _run(server.list_label_templates(OTHER, USER))
        assert status == 403
        status, _detail = _run(server.create_label_template({"company_id": OTHER, "name": "Sızma"}, USER))
        assert status == 403
    assert "tpl_other" in db.label_templates.docs
    assert all(d.get("name") != "Sızma" for d in db.label_templates.docs.values())
    assert all(q.get("company_id") != OTHER for q in db.label_templates.finds)


def test_other_company_template_update_delete_404():
    db = _seed()
    with patch.object(server, "db", db):
        status, detail = _run(server.update_label_template("tpl_other", {"name": "Ele geçirildi", "is_default": True}, USER))
        assert status == 404
        assert detail == "Şablon bulunamadı."
        status, detail = _run(server.delete_label_template("tpl_other", USER))
        assert status == 404
        assert detail == "Şablon bulunamadı."
    assert db.label_templates.docs["tpl_other"]["name"] == "Yabancı"
    assert db.label_templates.docs["tpl_other"]["is_default"] is True
    assert db.label_templates.docs["tpl_own"]["is_default"] is True


def test_own_company_crud_and_default_200():
    db = _seed()
    with patch.object(server, "db", db):
        status, rows = _run(server.list_label_templates(OWN, USER))
        assert status == 200
        assert {r["id"] for r in rows} == {"tpl_own", "tpl_own_2"}

        status, rows = _run(server.list_label_templates(None, USER))
        assert status == 200
        assert {r["id"] for r in rows} == {"tpl_own", "tpl_own_2"}

        status, created = _run(server.create_label_template({
            "company_id": OWN,
            "name": "Yeni",
            "width_mm": 50,
            "height_mm": 30,
            "is_default": True,
        }, USER))
        assert status == 200
        assert created["company_id"] == OWN
        assert created["is_default"] is True
        assert db.label_templates.docs["tpl_own"]["is_default"] is False
        assert db.label_templates.docs["tpl_other"]["is_default"] is True

        status, updated = _run(server.update_label_template(created["id"], {
            "name": "Güncel",
            "company_id": OTHER,
            "is_default": True,
        }, USER))
        assert status == 200
        assert updated["name"] == "Güncel"
        assert updated["company_id"] == OWN
        assert db.label_templates.docs["tpl_other"]["name"] == "Yabancı"

        status, deleted = _run(server.delete_label_template(created["id"], USER))
        assert status == 200
        assert deleted == {"status": "success"}
        assert created["id"] not in db.label_templates.docs


def test_omitted_company_does_not_fall_back_to_demo_company():
    db = _seed()
    with patch.object(server, "db", db):
        status, created = _run(server.create_label_template({"name": "Oturum"}, USER))
        assert status == 200
        assert created["company_id"] == OWN
        assert created["company_id"] != "comp_nexus_main_01"
    assert all(q.get("company_id") != "comp_nexus_main_01" for q in db.label_templates.finds)


def test_super_admin_may_target_another_company():
    db = _seed()
    with patch.object(server, "db", db):
        status, rows = _run(server.list_label_templates(OTHER, SUPER))
        assert status == 200
        assert [r["id"] for r in rows] == ["tpl_other"]
        status, updated = _run(server.update_label_template("tpl_other", {"name": "SA"}, SUPER))
        assert status == 200
        assert updated["name"] == "SA"
        assert updated["company_id"] == OTHER


def test_super_admin_without_company_does_not_use_demo_default():
    status, detail = _run(server.list_label_templates(None, {
        "is_super_admin": True,
        "company_ids": [],
        "active_company_id": "",
    }))
    assert status == 400
    assert "comp_nexus_main_01" not in str(detail)
