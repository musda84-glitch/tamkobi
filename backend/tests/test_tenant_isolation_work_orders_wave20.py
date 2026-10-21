"""İş emri ve üretim emri yaşam döngüsü kiracı dalgası 20.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve ağa bağlanmaz.
Tutar, miktar, stok, fiyat, maliyet ve şirket kimliği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import rbac  # noqa: E402
import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
import trash  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
PO = "po-shared"
PROD = "prod-shared"
RECIPE = "rcp-shared"
WO = "wo-shared"
SECRET_NAME = "UrunB-Gizli"
SECRET_RECIPE = "ReceteB-Gizli"
SECRET_STEP = "GizliAdim"
SECRET_STOCK = 4242
SECRET_PRICE = 777

_REMOVED = (
    ("server.py", "assign_work_order", "work_orders", "update_one"),
    ("server.py", "cancel_production_order", "production_orders", "update_one"),
    ("server.py", "cancel_production_order", "work_orders", "find"),
    ("server.py", "decide_trash_work_order", "work_order_trash_requests", "update_many"),
    ("server.py", "decide_trash_work_order", "work_order_trash_requests", "update_one"),
    ("server.py", "decide_trash_work_order", "work_orders", "find_one"),
    ("server.py", "delete_production_order", "work_orders", "find"),
    ("server.py", "finish_work_order", "production_orders", "find_one"),
    ("server.py", "finish_work_order", "products", "find"),
    ("server.py", "finish_work_order", "products", "find_one"),
    ("server.py", "finish_work_order", "products", "update_one"),
    ("server.py", "finish_work_order", "recipes", "find_one"),
    ("server.py", "finish_work_order", "work_orders", "find_one"),
    ("server.py", "finish_work_order", "work_orders", "update_one"),
    ("server.py", "pause_work_order", "work_orders", "update_one"),
    ("server.py", "request_trash_work_order", "production_orders", "find_one"),
    ("server.py", "request_trash_work_order", "work_order_trash_requests", "find_one"),
    ("server.py", "start_production_order", "production_orders", "update_one"),
    ("server.py", "start_work_order", "production_orders", "update_one"),
    ("server.py", "start_work_order", "work_orders", "find_one"),
    ("server.py", "start_work_order", "work_orders", "update_one"),
)

_WIDE_SCHEDULE = {
    "start": "00:00",
    "end": "23:59",
    "break_minutes": 0,
    "work_days": [0, 1, 2, 3, 4, 5, 6],
    "exit_tolerance_minutes": 0,
    "timezone": "Europe/Istanbul",
}


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Yonetici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_one(self, query=None):
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return type("R", (), {"deleted_count": 1})()
        return type("R", (), {"deleted_count": 0})()

    async def delete_many(self, query=None):
        query = _split_field_ops(query or {})
        kept = []
        deleted = 0
        for doc in self.docs:
            if match_query(doc, query):
                deleted += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return type("R", (), {"deleted_count": deleted})()


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _add(db, coll, doc):
    db[coll].docs.append(copy.deepcopy(doc))


def _digest(db, company_id):
    payload = []
    for name in sorted(db._cols):
        rows = [copy.deepcopy(d) for d in db._cols[name].docs if d.get("company_id") == company_id]
        if not rows:
            continue
        rows.sort(key=lambda d: json.dumps(d, sort_keys=True, default=str))
        payload.append([name, rows])
    raw = json.dumps(payload, sort_keys=True, default=str).encode()
    return hashlib.sha256(raw).hexdigest()


def _bind(db):
    prev = {"server": server.db, "rbac": rbac._db, "trash": trash._db}
    server.db = db
    rbac._db = db
    trash._db = db
    return prev


def _restore(prev):
    server.db = prev["server"]
    rbac._db = prev["rbac"]
    trash._db = prev["trash"]


async def _own(db_arg, collection, doc_id, actor, **kwargs):
    """Aynı _id iki şirkette de varken çağıranın satırını yükle."""
    allowed = {str(item) for item in (actor.get("company_ids") or [])}
    for row in db_arg[collection].docs:
        if str(row.get("_id")) == str(doc_id) and str(row.get("company_id") or "") in allowed:
            return copy.deepcopy(row)
    raise HTTPException(status_code=404, detail=kwargs.get("not_found") or "Kayıt bulunamadı.")


def _row(db, coll, company_id, doc_id):
    for doc in db[coll].docs:
        if doc.get("_id") == doc_id and doc.get("company_id") == company_id:
            return doc
    return None


def _product(company_id, doc_id=PROD, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "UrunA" if company_id == CO_A else SECRET_NAME,
        "sku": "SKU-A" if company_id == CO_A else "SKU-B",
        "stock_quantity": 10 if company_id == CO_A else SECRET_STOCK,
        "purchase_price": 4 if company_id == CO_A else SECRET_PRICE,
        "unit": "Adet",
        "type": "raw_material",
    }
    row.update(extra)
    return row


def _recipe(company_id, doc_id=RECIPE, **extra):
    qty = 2 if company_id == CO_A else 9
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "name": "ReceteA" if company_id == CO_A else SECRET_RECIPE,
        "finished_product_id": PROD,
        "finished_product_name": "UrunA" if company_id == CO_A else SECRET_NAME,
        "target_quantity": 1,
        "unit": "Adet",
        "materials": [{
            "product_id": PROD,
            "product_name": "KalemA" if company_id == CO_A else SECRET_NAME,
            "quantity": qty,
            "unit": "Adet",
            "cost_per_unit": 4 if company_id == CO_A else SECRET_PRICE,
            "wastage_percent": 0,
            "steps": [{
                "no": 1,
                "name": "KesimA" if company_id == CO_A else SECRET_STEP,
                "station": "CNC",
                "duration_min": 1,
            }],
        }],
        "steps": [],
        "is_active": True,
    }
    row.update(extra)
    return row


def _po(company_id, **extra):
    row = {
        "_id": PO,
        "company_id": company_id,
        "status": "planned",
        "recipe_id": RECIPE,
        "planned_quantity": 1,
        "completed_quantity": 0,
        "order_code": "URT-A" if company_id == CO_A else "URT-B",
        "finished_product_id": PROD,
        "finished_product_name": "UrunA" if company_id == CO_A else SECRET_NAME,
    }
    row.update(extra)
    return row


def _wo(company_id, doc_id=WO, **extra):
    row = {
        "_id": doc_id,
        "company_id": company_id,
        "order_id": PO,
        "status": "ready",
        "step_no": 1,
        "step_name": "KesimA" if company_id == CO_A else SECRET_STEP,
        "station": "CNC",
        "planned_quantity": 1,
        "unit": "Adet",
        "order_code": "URT-A" if company_id == CO_A else "URT-B",
        "product_name": "UrunA" if company_id == CO_A else SECRET_NAME,
        "logs": [],
    }
    row.update(extra)
    return row


def _secrets(blob):
    text = blob if isinstance(blob, str) else json.dumps(blob, default=str)
    assert SECRET_NAME not in text
    assert SECRET_RECIPE not in text
    assert SECRET_STEP not in text
    assert str(SECRET_STOCK) not in text
    assert str(SECRET_PRICE) not in text


def _seed_shared(db):
    _add(db, "companies", {"_id": CO_A, "work_schedule": _WIDE_SCHEDULE})
    _add(db, "products", _product(CO_B))
    _add(db, "products", _product(CO_A))
    _add(db, "recipes", _recipe(CO_B))
    _add(db, "recipes", _recipe(CO_A))
    _add(db, "production_orders", _po(CO_B))
    _add(db, "production_orders", _po(CO_A))
    _add(db, "work_orders", _wo(CO_B))
    _add(db, "work_orders", _wo(CO_A))
    _add(db, "work_orders", _wo(CO_B, "wo-next-b", step_no=2, status="waiting", step_name=SECRET_STEP))
    _add(db, "work_orders", _wo(CO_A, "wo-next-a", step_no=2, status="waiting", step_name="MontajA"))
    _add(db, "work_order_trash_requests", {
        "_id": "req-shared",
        "company_id": CO_B,
        "work_order_id": WO,
        "order_id": PO,
        "status": "pending",
        "product_name": SECRET_NAME,
        "step_name": SECRET_STEP,
    })
    _add(db, "work_order_trash_requests", {
        "_id": "req-shared",
        "company_id": CO_A,
        "work_order_id": WO,
        "order_id": PO,
        "status": "pending",
        "product_name": "UrunA",
        "step_name": "KesimA",
    })
    _add(db, "work_orders", _wo(CO_A, "wo-approve", order_id=None, status="ready", step_name="KesimA", product_name="UrunA"))
    _add(db, "work_order_trash_requests", {
        "_id": "req-b-approve",
        "company_id": CO_B,
        "work_order_id": "wo-approve",
        "order_id": PO,
        "status": "pending",
        "product_name": SECRET_NAME,
        "step_name": SECRET_STEP,
    })
    _add(db, "work_order_trash_requests", {
        "_id": "req-approve",
        "company_id": CO_A,
        "work_order_id": "wo-approve",
        "order_id": PO,
        "status": "pending",
        "product_name": "UrunA",
        "step_name": "KesimA",
    })


def test_nine_endpoints_leave_other_company_unchanged(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _seed_shared(db)
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        started_po = _run(server.start_production_order(PO, user))
        assigned = _run(server.assign_work_order(WO, {"assigned_to": "op-a", "assigned_name": "Ali A"}, user=user))
        started_wo = _run(server.start_work_order(WO, {"operator_name": "Ali A"}, user=user))
        paused = _run(server.pause_work_order(WO, {"reason": "mola"}, user=user))
        rejected = _run(server.decide_trash_work_order("req-shared", {"status": "rejected", "note": "hayir"}, user))
        requested = _run(server.request_trash_work_order(WO, {"reason": "yanlis"}, user=user))
        approved = _run(server.decide_trash_work_order("req-approve", {"status": "approved"}, user))
        finished = _run(server.finish_work_order(WO, {"produced_qty": 2, "scrap_qty": 0}, user=user))

        blob = json.dumps(
            [started_po, assigned, started_wo, paused, requested, rejected, approved, finished],
            default=str,
        )
        _secrets(blob)
        assert started_po["status"] == "success"
        assert requested["already_pending"] is False
        assert requested["id"] != "req-b-approve"
        assert "MontajA" in finished["message"]
        assert _row(db, "production_orders", CO_B, PO)["status"] == "planned"
        assert _row(db, "production_orders", CO_B, PO)["finished_product_name"] == SECRET_NAME
        assert _row(db, "production_orders", CO_A, PO)["status"] == "in_production"
        assert _row(db, "work_orders", CO_B, WO)["status"] == "ready"
        assert _row(db, "work_orders", CO_B, WO)["step_name"] == SECRET_STEP
        assert _row(db, "work_orders", CO_A, WO)["status"] == "done"
        assert _row(db, "work_orders", CO_A, WO)["assigned_to"] == "op-a"
        assert _row(db, "work_orders", CO_B, "wo-next-b")["status"] == "waiting"
        assert _row(db, "work_orders", CO_A, "wo-next-a")["status"] == "ready"
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "products", CO_B, PROD)["purchase_price"] == SECRET_PRICE
        assert _row(db, "products", CO_A, PROD)["stock_quantity"] == 8
        assert _row(db, "products", CO_A, PROD)["name"] == "UrunA"
        assert _row(db, "recipes", CO_B, RECIPE)["name"] == SECRET_RECIPE
        assert _row(db, "work_order_trash_requests", CO_B, "req-shared")["status"] == "pending"
        assert _row(db, "work_order_trash_requests", CO_A, "req-shared")["status"] == "rejected"
        assert _row(db, "work_order_trash_requests", CO_B, "req-b-approve")["status"] == "pending"
        assert _row(db, "work_order_trash_requests", CO_A, "req-approve")["status"] == "approved"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)

    db = _DB()
    _add(db, "production_orders", _po(CO_B, status="planned"))
    _add(db, "production_orders", _po(CO_A, status="in_production"))
    _add(db, "work_orders", _wo(CO_B, "wo-b", status="ready"))
    _add(db, "work_orders", _wo(CO_B, "wo-b2", status="paused", step_no=2))
    _add(db, "work_orders", _wo(CO_A, "wo-a", status="in_progress"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        cancelled = _run(server.cancel_production_order(PO, user))
        _secrets(cancelled)
        assert cancelled["trashed_work_orders"] == 1
        assert "atölyeden kaldırıldı" in cancelled["message"]
        assert _row(db, "production_orders", CO_B, PO)["status"] == "planned"
        assert _row(db, "production_orders", CO_A, PO)["status"] == "cancelled"
        assert _row(db, "work_orders", CO_B, "wo-b")["status"] == "ready"
        assert _row(db, "work_orders", CO_B, "wo-b2")["step_name"] == SECRET_STEP
        assert _row(db, "work_orders", CO_A, "wo-a") is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)

    db = _DB()
    _add(db, "production_orders", _po(CO_A, status="planned"))
    _add(db, "production_orders", _po(CO_B, status="planned"))
    _add(db, "work_orders", _wo(CO_B, "wo-b"))
    _add(db, "work_orders", _wo(CO_B, "wo-b2", step_no=2))
    _add(db, "work_orders", _wo(CO_A, "wo-a"))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        deleted = _run(server.delete_production_order(PO, user))
        _secrets(deleted)
        assert deleted["status"] == "success"
        assert _row(db, "production_orders", CO_B, PO)["status"] == "planned"
        assert _row(db, "production_orders", CO_B, PO)["order_code"] == "URT-B"
        assert _row(db, "work_orders", CO_B, "wo-b")["status"] == "ready"
        assert _row(db, "work_orders", CO_B, "wo-b2")["step_name"] == SECRET_STEP
        assert _row(db, "work_orders", CO_A, "wo-a") is None
        assert _row(db, "production_orders", CO_A, PO) is None
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_trash_request_ignores_foreign_order_block(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "production_orders", _po(CO_B, status="completed", completed_quantity=4, finished_product_name=SECRET_NAME))
    _add(db, "production_orders", _po(CO_A, status="planned", completed_quantity=0))
    _add(db, "work_orders", _wo(CO_B, WO, status="ready"))
    _add(db, "work_orders", _wo(CO_A, WO, status="ready"))
    _add(db, "work_order_trash_requests", {
        "_id": "req-b",
        "company_id": CO_B,
        "work_order_id": WO,
        "order_id": PO,
        "status": "pending",
        "product_name": SECRET_NAME,
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.request_trash_work_order(WO, {"reason": "iptal"}, user=user))
        _secrets(out)
        assert out["already_pending"] is False
        assert out["status"] == "success"
        assert _row(db, "production_orders", CO_B, PO)["status"] == "completed"
        assert _row(db, "production_orders", CO_B, PO)["completed_quantity"] == 4
        assert _row(db, "work_order_trash_requests", CO_B, "req-b")["status"] == "pending"
        own = [row for row in db.work_order_trash_requests.docs if row.get("company_id") == CO_A]
        assert len(own) == 1
        assert own[0]["work_order_id"] == WO
        assert own[0]["status"] == "pending"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_finish_ignores_foreign_only_product_and_recipe(monkeypatch):
    monkeypatch.setattr(server.tenant_access, "get_tenant_doc", _own)
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B, "prod-b-only", stock_quantity=SECRET_STOCK, purchase_price=SECRET_PRICE, name=SECRET_NAME))
    _add(db, "recipes", _recipe(CO_B, "rcp-b-only", name=SECRET_RECIPE, finished_product_name=SECRET_NAME))
    _add(db, "production_orders", _po(
        CO_B, status="in_production", recipe_id="rcp-b-only", finished_product_name=SECRET_NAME,
    ))
    _add(db, "production_orders", _po(CO_A, status="planned", recipe_id="rcp-b-only", finished_product_name="UrunA"))
    _add(db, "work_orders", _wo(
        CO_A, "wo-mat", status="in_progress", step_no=1,
        material_product_id="prod-b-only", material_name="Kalem",
        materials=[{
            "product_id": "prod-b-only",
            "product_name": "Kalem",
            "needed": 3,
            "unit": "Adet",
        }],
    ))
    _add(db, "work_orders", _wo(CO_A, "wo-next", step_no=2, status="waiting", step_name="MontajA"))
    _add(db, "work_orders", _wo(
        CO_A, "wo-recipe", status="in_progress", order_id=PO, step_no=1,
        materials=[], material_product_id=None, material_name=None,
    ))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        mat = _run(server.finish_work_order("wo-mat", {"produced_qty": 3, "scrap_qty": 0}, user=user))
        recipe_finish = _run(server.finish_work_order("wo-recipe", {"produced_qty": 1, "scrap_qty": 0}, user=user))
        _secrets(mat)
        _secrets(recipe_finish)
        assert mat["status"] == "success"
        assert "MontajA" in mat["message"]
        assert _row(db, "products", CO_B, "prod-b-only")["stock_quantity"] == SECRET_STOCK
        assert _row(db, "products", CO_B, "prod-b-only")["purchase_price"] == SECRET_PRICE
        assert _row(db, "recipes", CO_B, "rcp-b-only")["name"] == SECRET_RECIPE
        assert _row(db, "production_orders", CO_B, PO)["status"] == "in_production"
        assert _row(db, "production_orders", CO_A, PO)["status"] == "planned"
        assert _row(db, "work_orders", CO_A, "wo-mat")["status"] == "done"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_blank_company_does_not_cross_tenants():
    user = _user(CO_A)
    db = _DB()
    _add(db, "products", _product(CO_B))
    _add(db, "recipes", _recipe(CO_B))
    _add(db, "production_orders", _po(CO_B, status="in_production", finished_product_name=SECRET_NAME))
    _add(db, "work_orders", _wo(CO_B, "wo-next-b", step_no=2, status="waiting", step_name=SECRET_STEP))
    _add(db, "work_orders", {
        "_id": "wo-blank",
        "order_id": PO,
        "status": "in_progress",
        "step_no": 1,
        "step_name": "KesimA",
        "station": "CNC",
        "planned_quantity": 1,
        "unit": "Adet",
        "material_product_id": PROD,
        "material_name": "Kalem",
        "materials": [{"product_id": PROD, "product_name": "Kalem", "needed": 4, "unit": "Adet"}],
        "logs": [],
    })
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        out = _run(server.finish_work_order("wo-blank", {"produced_qty": 4, "scrap_qty": 0}, user=user))
        _secrets(out)
        assert out["status"] == "success"
        assert _row(db, "products", CO_B, PROD)["stock_quantity"] == SECRET_STOCK
        assert _row(db, "products", CO_B, PROD)["purchase_price"] == SECRET_PRICE
        assert _row(db, "recipes", CO_B, RECIPE)["name"] == SECRET_RECIPE
        assert _row(db, "production_orders", CO_B, PO)["status"] == "in_production"
        assert _row(db, "work_orders", CO_B, "wo-next-b")["status"] == "waiting"
        blank = next(row for row in db.work_orders.docs if row.get("_id") == "wo-blank")
        assert blank["status"] == "in_progress"
        assert "company_id" not in blank
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_other_company_work_order_is_404():
    user = _user(CO_A)
    db = _DB()
    _add(db, "work_orders", _wo(CO_B, "wo-b-only", status="in_progress"))
    _add(db, "production_orders", _po(CO_B))
    prev = _bind(db)
    try:
        before = _digest(db, CO_B)
        calls = (
            lambda: server.assign_work_order("wo-b-only", {"assigned_to": "x", "assigned_name": "Ali"}, user=user),
            lambda: server.start_work_order("wo-b-only", {}, user=user),
            lambda: server.pause_work_order("wo-b-only", {}, user=user),
            lambda: server.finish_work_order("wo-b-only", {"produced_qty": 1}, user=user),
            lambda: server.request_trash_work_order("wo-b-only", {"reason": "yok"}, user=user),
        )
        for call in calls:
            with pytest.raises(HTTPException) as exc:
                _run(call())
            assert exc.value.status_code == 404
            assert exc.value.detail == "İş emri bulunamadı."
        assert _row(db, "work_orders", CO_B, "wo-b-only")["status"] == "in_progress"
        assert _row(db, "work_orders", CO_B, "wo-b-only")["step_name"] == SECRET_STEP
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave20_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 21
    assert len(set(_REMOVED)) == 21
    assert all(key[0] == "server.py" for key in _REMOVED)
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
