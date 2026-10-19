"""Personel, depo, reçete ve teklif PDF: body/path id'leri kiracı şirketinde aranır.

Bellek içi MemDB. Canlı veritabanına ve 8021'e bağlanmaz.
"""
from __future__ import annotations

import ast
import asyncio
import copy
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from starlette.requests import Request

os.environ.setdefault("JWT_SECRET", "test-tenant-personnel-stock-body-ids-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import attendance  # noqa: E402
import auth_utils  # noqa: E402
import saas_docs  # noqa: E402
import server  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402
from models import Recipe, RecipeItem, Warehouse, WarehouseTransfer  # noqa: E402
from mysql_store import match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"

B_COLS = (
    "employees",
    "leave_requests",
    "bonus_payments",
    "attendance",
    "bank_accounts",
    "bank_transactions",
    "partners",
    "partner_transactions",
    "products",
    "warehouses",
    "warehouse_transfers",
    "recipes",
)

_SCOPED_FIND_COLS = {"employees", "bank_accounts", "partners", "products", "quotes"}


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin", super_admin=False):
    ids = list(company_ids)
    uid = "user-" + "-".join(ids) + ("-sa" if super_admin else "")
    return {
        "_id": uid,
        "id": uid,
        "email": uid + "@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": super_admin,
        "company_ids": ids,
        "active_company_id": active if active is not None else (ids[0] if ids else ""),
    }


class _Coll(MemColl):
    """MemColl'da olmayan upsert / atomik güncelleme / silme. dashboard_memdb değişmez."""

    async def update_one(self, query, update, upsert=False):
        result = await super().update_one(query, update, upsert=False)
        if upsert and getattr(result, "matched_count", 0) == 0:
            doc = new_upsert_doc(update, query)
            self.docs.append(copy.deepcopy(doc))
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=doc.get("_id"))
        return result

    async def update_one_atomic(self, query, update, upsert=False):
        return await self.update_one(query, update, upsert=upsert)

    async def delete_one(self, query=None):
        query = query or {}
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def delete_many(self, query=None):
        query = query or {}
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)

    async def create_index(self, *args, **kwargs):
        return None


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _bind(state):
    db = _DB()
    prev = {
        "server": server.db,
        "attendance_db": attendance._db,
        "attendance_user": attendance._current_user,
        "saas": saas_docs._db,
        "token_user": auth_utils.get_user_from_token,
    }
    server.db = db
    attendance._db = db
    saas_docs._db = db

    async def _current(request):
        return state["user"]

    async def _from_token(token, db_, *args, **kwargs):
        return state["user"]

    attendance._current_user = _current
    auth_utils.get_user_from_token = _from_token
    return db, prev


def _restore(prev):
    server.db = prev["server"]
    attendance._db = prev["attendance_db"]
    attendance._current_user = prev["attendance_user"]
    saas_docs._db = prev["saas"]
    auth_utils.get_user_from_token = prev["token_user"]


def _request(token="tok"):
    headers = []
    if token:
        headers.append((b"authorization", f"Bearer {token}".encode()))
    return Request({
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": "/",
        "raw_path": b"/",
        "query_string": b"",
        "headers": headers,
        "client": ("127.0.0.1", 1234),
        "server": ("test", 80),
    })


async def _seed(db):
    for cid, tag, name in ((CO_A, "a", "A"), (CO_B, "b", "B"), (CO_C, "c", "C")):
        await db.companies.insert_one({"_id": cid, "name": f"Şirket {name}"})
        await db.employees.insert_one({
            "_id": f"emp_{tag}",
            "company_id": cid,
            "full_name": f"Personel {name}",
            "annual_leave_days": 14,
            "used_leave_days": 0,
        })
        await db.bank_accounts.insert_one({
            "_id": f"acc_{tag}",
            "company_id": cid,
            "type": "cash_box",
            "account_name": f"Kasa {name}",
            "currency": "TRY",
            "current_balance": 1000.0,
        })
        await db.partners.insert_one({
            "_id": f"partner_{tag}",
            "company_id": cid,
            "name": f"Ortak {name}",
            "balance": 500.0,
            "total_capital_in": 0.0,
            "total_withdrawn": 0.0,
            "total_profit_share": 0.0,
            "is_active": True,
        })
        await db.products.insert_one({
            "_id": f"prod_{tag}",
            "company_id": cid,
            "name": f"Ürün {name}",
            "unit": "Adet",
            "purchase_price": 10,
            "warehouse_id": f"wh_{tag}",
        })
        await db.products.insert_one({
            "_id": f"mat_{tag}",
            "company_id": cid,
            "name": f"Hammadde {name}",
            "unit": "Koli" if tag == "b" else "Adet",
            "purchase_price": 77 if tag == "b" else 4,
            "vat_rate": 20,
        })
        await db.warehouses.insert_one({
            "_id": f"wh_{tag}",
            "company_id": cid,
            "name": f"Depo {name}",
            "code": tag.upper(),
            "location": name,
        })
        await db.warehouses.insert_one({
            "_id": f"wh_{tag}2",
            "company_id": cid,
            "name": f"Depo {name} 2",
            "code": tag.upper() + "2",
            "location": name,
        })
        await db.bonus_payments.insert_one({
            "_id": f"bon_{tag}",
            "company_id": cid,
            "employee_id": f"emp_{tag}",
            "employee_name": f"Personel {name}",
            "type": "bonus",
            "type_label": "Prim",
            "period": "2026-10",
            "amount": 50,
            "status": "pending",
        })
        await db.quotes.insert_one({
            "_id": f"quo_{tag}",
            "company_id": cid,
            "quote_number": f"T-{name}",
            "items": [{
                "name": "Kalem",
                "quantity": 1,
                "unit": "Adet",
                "unit_price": 10,
                "vat_rate": 20,
                "total": 10,
            }],
            "subtotal": 10,
            "vat_total": 2,
            "grand_total": 12,
        })


def _snap(db, company_id):
    out = {}
    for name in B_COLS:
        rows = [copy.deepcopy(d) for d in db[name].docs if d.get("company_id") == company_id]
        rows.sort(key=lambda d: str(d.get("_id")))
        out[name] = rows
    return out


async def _expect(coro, status, detail=None):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == status
    if detail is not None:
        assert exc.value.detail == detail
    elif status == 404:
        assert "bulunamadı" in str(exc.value.detail).lower()
    return exc.value


def _doc(db, coll, doc_id):
    return next(d for d in db[coll].docs if d.get("_id") == doc_id)


def _leave(employee_id, **extra):
    body = {
        "employee_id": employee_id,
        "type": "annual",
        "start_date": "2026-10-20",
        "end_date": "2026-10-20",
        "days": 1,
        "reason": "izin",
    }
    body.update(extra)
    return body


def _warehouse(company_id, name="Yeni"):
    return Warehouse(company_id=company_id, name=name, code="Y", location="L")


def _transfer(company_id, product_id, source, target, name="Ürün"):
    return WarehouseTransfer(
        company_id=company_id,
        transfer_number="",
        source_warehouse_id=source,
        target_warehouse_id=target,
        product_id=product_id,
        product_name=name,
        quantity=2,
    )


def _recipe(company_id, finished_id, materials, name="Reçete"):
    return Recipe(
        company_id=company_id,
        name=name,
        finished_product_id=finished_id,
        finished_product_name=name,
        materials=materials,
    )


def _material(product_id, product_name, cost=0):
    return RecipeItem(
        product_id=product_id,
        product_name=product_name,
        quantity=2,
        unit="Adet",
        cost_per_unit=cost,
    )


def test_other_company_body_ids_do_not_write():
    """A kullanıcısı B kimlikleriyle yazamaz; B kayıtları birebir kalır."""
    state = {"user": None}
    db, prev = _bind(state)
    built = {"n": 0}
    real_pdf = saas_docs.build_quote_pdf

    def _pdf(*args, **kwargs):
        built["n"] += 1
        return real_pdf(*args, **kwargs)

    saas_docs.build_quote_pdf = _pdf

    async def run():
        await _seed(db)
        user = _user(CO_A)
        state["user"] = user
        before = _snap(db, CO_B)

        await _expect(server.create_leave(_leave("emp_b"), user), 404, "Çalışan bulunamadı.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_bonus({
            "employee_id": "emp_b", "type": "bonus", "amount": 100, "account_id": "acc_b",
        }, _request(), user), 404, "Çalışan bulunamadı.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_bonus({
            "employee_id": "emp_a", "type": "bonus", "amount": 100, "account_id": "acc_b",
        }, _request(), user), 404, "Kasa/Banka hesabı bulunamadı.")
        assert _snap(db, CO_B) == before
        assert not any(d.get("employee_id") == "emp_a" and d.get("type") == "bonus" and d.get("status") == "paid" for d in db.bonus_payments.docs)

        await _expect(server.create_bonus({
            "employee_id": "emp_a", "type": "bonus", "amount": 100, "partner_id": "partner_b",
        }, _request(), user), 404, "Ortak bulunamadı.")
        assert _snap(db, CO_B) == before

        await _expect(server.update_bonus("bon_a", {"account_id": "acc_b"}, _request(), user), 404, "Kasa/Banka hesabı bulunamadı.")
        assert _snap(db, CO_B) == before
        assert _doc(db, "bonus_payments", "bon_a")["status"] == "pending"

        await _expect(server.update_bonus("bon_a", {"partner_id": "partner_b"}, _request(), user), 404, "Ortak bulunamadı.")
        assert _snap(db, CO_B) == before
        assert _doc(db, "bonus_payments", "bon_a")["status"] == "pending"

        await _expect(server.upsert_attendance({
            "employee_id": "emp_b", "date": "2026-10-12", "status": "present",
            "check_in": "09:00", "check_out": "18:00",
        }, user), 404, "Çalışan bulunamadı.")
        assert _snap(db, CO_B) == before

        await _expect(attendance.assign_overtime({
            "employee_id": "emp_b", "date": "2026-10-13", "hours": 2, "note": "sızma",
        }, _request()), 404, "Personel bulunamadı.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_warehouse(_warehouse(CO_B, "Sızma"), user), 403, "Bu şirket hesabına erişiminiz yok.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_warehouse_transfer(
            _transfer(CO_A, "prod_b", "wh_a", "wh_a2", "Ürün B"), user,
        ), 404, "Ürün bulunamadı.")
        assert _snap(db, CO_B) == before
        assert _doc(db, "products", "prod_a")["warehouse_id"] == "wh_a"

        await _expect(server.create_warehouse_transfer(
            _transfer(CO_A, "prod_a", "wh_b", "wh_a2", "Ürün A"), user,
        ), 404, "Depo bulunamadı.")
        assert _snap(db, CO_B) == before
        assert _doc(db, "products", "prod_a")["warehouse_id"] == "wh_a"
        assert db.warehouse_transfers.docs == []

        await _expect(server.create_warehouse_transfer(
            _transfer(CO_B, "prod_b", "wh_b", "wh_b2", "Ürün B"), user,
        ), 403, "Bu şirket hesabına erişiminiz yok.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_recipe(
            _recipe(CO_B, "prod_b", [_material("mat_b", "Hammadde B")]), user,
        ), 403, "Bu şirket hesabına erişiminiz yok.")
        assert _snap(db, CO_B) == before

        await _expect(server.create_recipe(
            _recipe(CO_A, "prod_b", [_material("mat_a", "Hammadde A")]), user,
        ), 404, "Ürün bulunamadı.")
        assert _snap(db, CO_B) == before
        assert _doc(db, "products", "prod_b").get("has_recipe") is not True
        assert db.recipes.docs == []

        mixed = await server.create_recipe(
            _recipe(CO_A, "prod_a", [_material("mat_b", "Kalem")]), user,
        )
        line = mixed["materials"][0]
        assert mixed["company_id"] == CO_A
        assert line["product_name"] == "Kalem"
        assert line["product_name"] != "Hammadde B"
        assert float(line.get("cost_per_unit") or 0) == 0
        assert line.get("stock_unit") != "Koli"
        assert _snap(db, CO_B) == before

        built["n"] = 0
        await _expect(saas_docs.quote_pdf("quo_b", _request("tok")), 404, "Teklif bulunamadı.")
        assert built["n"] == 0
        assert _snap(db, CO_B) == before

        built["n"] = 0
        await _expect(saas_docs.quote_pdf("quo_b", _request(token=None)), 401, "Giriş yapmanız gerekiyor.")
        assert built["n"] == 0
        await _expect(saas_docs.quote_pdf("quo_a", _request(token=None)), 401, "Giriş yapmanız gerekiyor.")
        assert built["n"] == 0

    try:
        _run(run())
    finally:
        saas_docs.build_quote_pdf = real_pdf
        _restore(prev)


def test_same_company_behavior_unchanged():
    """A kimlikleriyle izin, prim, puantaj, depo, reçete ve PDF bugünkü sonucu verir."""
    state = {"user": None}
    db, prev = _bind(state)

    async def run():
        await _seed(db)
        user = _user(CO_A)
        state["user"] = user
        before_b = _snap(db, CO_B)

        await _expect(server.create_leave(_leave("emp_a", start_date="2026-11-01", end_date="2026-12-31", days=40), user), 400)
        created = await server.create_leave(_leave("emp_a"), user)
        assert created["status"] == "pending"
        assert created["company_id"] == CO_A
        assert created["employee_id"] == "emp_a"
        assert created["days"] == 1
        stored_leave = _doc(db, "leave_requests", created["id"])
        assert stored_leave["company_id"] == CO_A

        paid = await server.create_bonus({
            "employee_id": "emp_a", "type": "bonus", "amount": 100, "account_id": "acc_a", "period": "2026-10",
        }, _request(), user)
        assert paid["status"] == "paid"
        assert paid["company_id"] == CO_A
        assert paid["amount"] == 100
        assert _doc(db, "bank_accounts", "acc_a")["current_balance"] == pytest.approx(-100)
        txs = [t for t in db.bank_transactions.docs if t.get("account_id") == "acc_a"]
        assert len(txs) == 1
        assert txs[0]["type"] == "outflow"
        assert txs[0]["amount"] == 100
        assert txs[0]["company_id"] == CO_A

        via_partner = await server.create_bonus({
            "employee_id": "emp_a", "type": "bonus", "amount": 80, "partner_id": "partner_a", "period": "2026-10",
        }, _request(), user)
        assert via_partner["status"] == "paid"
        assert "Ortak" in (via_partner.get("account_name") or "")
        partner = _doc(db, "partners", "partner_a")
        assert partner["balance"] == pytest.approx(420)
        assert partner["total_withdrawn"] == pytest.approx(80)
        ptxs = [t for t in db.partner_transactions.docs if t.get("partner_id") == "partner_a"]
        assert len(ptxs) == 1
        assert ptxs[0]["type"] == "withdrawal"
        assert ptxs[0]["company_id"] == CO_A

        updated = await server.update_bonus("bon_a", {"account_id": "acc_a", "amount": 40}, _request(), user)
        assert updated["status"] == "paid"
        assert updated["amount"] == 40
        assert _doc(db, "bank_accounts", "acc_a")["current_balance"] == pytest.approx(-140)
        assert _doc(db, "bonus_payments", "bon_a")["status"] == "paid"

        rec = await server.upsert_attendance({
            "employee_id": "emp_a",
            "date": "2026-10-12",
            "status": "present",
            "check_in": "09:00",
            "check_out": "18:00",
        }, user)
        assert rec["employee_id"] == "emp_a"
        assert rec["company_id"] == CO_A
        assert rec["status"] == "present"
        assert rec.get("check_in") == "09:00"
        assert rec.get("check_out") == "18:00"
        att = [d for d in db.attendance.docs if d.get("employee_id") == "emp_a" and d.get("date") == "2026-10-12"]
        assert len(att) == 1
        assert att[0]["company_id"] == CO_A

        ot = await attendance.assign_overtime({
            "employee_id": "emp_a", "date": "2026-10-13", "hours": 2, "note": "teslim",
        }, _request())
        assert ot["status"] == "success"
        assert ot["record"]["assigned_overtime_hours"] == 2
        assert ot["record"]["company_id"] == CO_A
        assert ot["record"]["employee_id"] == "emp_a"

        wh = await server.create_warehouse(_warehouse(CO_A, "Depo yeni"), user)
        assert wh["company_id"] == CO_A
        assert _doc(db, "warehouses", wh["id"])["company_id"] == CO_A

        tr = await server.create_warehouse_transfer(
            _transfer(CO_A, "prod_a", "wh_a", "wh_a2", "Ürün A"), user,
        )
        assert tr["company_id"] == CO_A
        assert tr["product_id"] == "prod_a"
        assert _doc(db, "products", "prod_a")["warehouse_id"] == "wh_a2"
        assert any(d.get("company_id") == CO_A and d.get("product_id") == "prod_a" for d in db.warehouse_transfers.docs)

        # Kayıtsız depo kimliği (main_warehouse) bugünkü gibi kabul edilir.
        virtual = await server.create_warehouse_transfer(
            _transfer(CO_A, "prod_a", "main_warehouse", "wh_a2", "Ürün A"), user,
        )
        assert virtual["company_id"] == CO_A
        assert virtual["source_warehouse_id"] == "main_warehouse"

        bom = await server.create_recipe(
            _recipe(CO_A, "prod_a", [_material("mat_a", "Hammadde A")], "BOM A"), user,
        )
        assert bom["company_id"] == CO_A
        assert bom["materials"][0]["cost_per_unit"] == pytest.approx(4)
        assert bom["material_cost"] == pytest.approx(8)
        assert bom["total_estimated_cost"] == pytest.approx(8)
        assert _doc(db, "products", "prod_a")["has_recipe"] is True

        pdf = await saas_docs.quote_pdf("quo_a", _request("tok"))
        assert pdf.media_type == "application/pdf"
        assert pdf.body.startswith(b"%PDF")

        assert _snap(db, CO_B) == before_b

    try:
        _run(run())
    finally:
        _restore(prev)


def test_multi_company_user_uses_member_company_only():
    """A ve C üyesi C kayıtlarıyla çalışır; B 404."""
    state = {"user": None}
    db, prev = _bind(state)

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_C, active=CO_C)
        state["user"] = user
        before_b = _snap(db, CO_B)

        leave = await server.create_leave(_leave("emp_c"), user)
        assert leave["company_id"] == CO_C
        await _expect(server.create_leave(_leave("emp_b"), user), 404, "Çalışan bulunamadı.")

        paid = await server.create_bonus({
            "employee_id": "emp_c", "type": "bonus", "amount": 25, "account_id": "acc_c",
        }, _request(), user)
        assert paid["status"] == "paid"
        assert paid["company_id"] == CO_C
        assert _doc(db, "bank_accounts", "acc_c")["current_balance"] == pytest.approx(-25)
        await _expect(server.create_bonus({
            "employee_id": "emp_b", "type": "bonus", "amount": 25, "account_id": "acc_b",
        }, _request(), user), 404, "Çalışan bulunamadı.")

        att = await server.upsert_attendance({
            "employee_id": "emp_c", "date": "2026-10-12", "status": "present", "check_in": "09:00",
        }, user)
        assert att["company_id"] == CO_C
        await _expect(server.upsert_attendance({
            "employee_id": "emp_b", "date": "2026-10-12", "status": "present",
        }, user), 404, "Çalışan bulunamadı.")

        ot = await attendance.assign_overtime({
            "employee_id": "emp_c", "date": "2026-10-14", "hours": 1,
        }, _request())
        assert ot["record"]["company_id"] == CO_C
        assert ot["record"]["assigned_overtime_hours"] == 1
        await _expect(attendance.assign_overtime({
            "employee_id": "emp_b", "date": "2026-10-14", "hours": 1,
        }, _request()), 404, "Personel bulunamadı.")

        wh = await server.create_warehouse(_warehouse(CO_C, "Depo C"), user)
        assert wh["company_id"] == CO_C
        await _expect(server.create_warehouse(_warehouse(CO_B, "Depo B yeni"), user), 403, "Bu şirket hesabına erişiminiz yok.")

        tr = await server.create_warehouse_transfer(
            _transfer(CO_C, "prod_c", "wh_c", "wh_c2", "Ürün C"), user,
        )
        assert tr["company_id"] == CO_C
        assert _doc(db, "products", "prod_c")["warehouse_id"] == "wh_c2"
        await _expect(server.create_warehouse_transfer(
            _transfer(CO_C, "prod_b", "wh_c", "wh_c2", "Ürün B"), user,
        ), 404, "Ürün bulunamadı.")

        bom = await server.create_recipe(
            _recipe(CO_C, "prod_c", [_material("mat_c", "Hammadde C")], "BOM C"), user,
        )
        assert bom["company_id"] == CO_C
        assert bom["materials"][0]["cost_per_unit"] == pytest.approx(4)
        assert _doc(db, "products", "prod_c")["has_recipe"] is True
        await _expect(server.create_recipe(
            _recipe(CO_C, "prod_b", [_material("mat_c", "Hammadde C")]), user,
        ), 404, "Ürün bulunamadı.")

        pdf = await saas_docs.quote_pdf("quo_c", _request("tok"))
        assert pdf.media_type == "application/pdf"
        assert pdf.body.startswith(b"%PDF")
        await _expect(saas_docs.quote_pdf("quo_b", _request("tok")), 404, "Teklif bulunamadı.")

        assert _snap(db, CO_B) == before_b

    try:
        _run(run())
    finally:
        _restore(prev)


def test_blank_company_employee_leave_is_404():
    """company_id'si boş çalışan get_tenant_doc sonrası da 404; izin yazılmaz."""
    state = {"user": None}
    db, prev = _bind(state)

    async def run():
        await _seed(db)
        user = _user(CO_A)
        state["user"] = user
        await db.employees.insert_one({
            "_id": "emp_blank",
            "company_id": None,
            "full_name": "Boş şirket",
            "annual_leave_days": 14,
        })
        await _expect(server.create_leave(_leave("emp_blank"), user), 404, "Çalışan bulunamadı.")
        assert not any(d.get("employee_id") == "emp_blank" for d in db.leave_requests.docs)

    try:
        _run(run())
    finally:
        _restore(prev)


def test_super_admin_still_follows_tenant_helpers():
    """Süper admin get_tenant_doc / resolve_company_id ile başka şirkete yazabilir."""
    state = {"user": None}
    db, prev = _bind(state)

    async def run():
        await _seed(db)
        sa = _user(CO_A, super_admin=True, active=CO_A)
        state["user"] = sa
        leave = await server.create_leave(_leave("emp_b"), sa)
        assert leave["company_id"] == CO_B
        assert leave["employee_id"] == "emp_b"
        wh = await server.create_warehouse(_warehouse(CO_B, "SA depo"), sa)
        assert wh["company_id"] == CO_B
        pdf = await saas_docs.quote_pdf("quo_b", _request("tok"))
        assert pdf.media_type == "application/pdf"

    try:
        _run(run())
    finally:
        _restore(prev)


def _fn_map(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    return {
        node.name: node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
    }


def _depends_on_current_user(fn: ast.AST) -> bool:
    args = fn.args.args
    defaults = fn.args.defaults
    offset = len(args) - len(defaults)
    for i, arg in enumerate(args):
        if arg.arg != "user":
            continue
        di = i - offset
        if di < 0 or not isinstance(defaults[di], ast.Call):
            return False
        call = defaults[di]
        fname = call.func.id if isinstance(call.func, ast.Name) else getattr(call.func, "attr", "")
        if fname != "Depends" or not call.args:
            return False
        dep = call.args[0]
        return isinstance(dep, ast.Name) and dep.id == "get_current_user"
    return False


def _calls_name(fn: ast.AST, name: str) -> bool:
    for node in ast.walk(fn):
        if isinstance(node, ast.Name) and node.id == name:
            return True
        if isinstance(node, ast.Attribute) and node.attr == name:
            return True
    return False


def _unscoped_body_id_find_ones(fn: ast.AST):
    """employees / bank_accounts / partners / products / quotes find_one.

    Filtre dict'i `_id` taşıyıp `company_id` taşımıyorsa satır. Teklif PDF'i
    kaydı okuyup user_may_access_company ile 404'ler; şirket önceden bilinmez.
    """
    quote_guarded = _calls_name(fn, "user_may_access_company")
    hits = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
            continue
        if node.func.attr != "find_one":
            continue
        recv = node.func.value
        if not isinstance(recv, ast.Attribute) or recv.attr not in _SCOPED_FIND_COLS:
            continue
        if not node.args or not isinstance(node.args[0], ast.Dict):
            continue
        keys = [k.value for k in node.args[0].keys if isinstance(k, ast.Constant)]
        if "_id" not in keys or "company_id" in keys:
            continue
        if recv.attr == "quotes" and quote_guarded:
            continue
        hits.append(node.lineno)
    return hits


def test_personnel_stock_body_id_queries_are_company_scoped():
    """İmzalar oturum kullanıcısı alır; hedef gövdelerde şirketsiz _id find_one kalmaz."""
    fns = {
        "server.py": _fn_map(_BACKEND / "server.py"),
        "attendance.py": _fn_map(_BACKEND / "attendance.py"),
        "saas_docs.py": _fn_map(_BACKEND / "saas_docs.py"),
    }
    for name in (
        "create_leave",
        "create_bonus",
        "upsert_attendance",
        "create_warehouse",
        "create_warehouse_transfer",
        "create_recipe",
    ):
        assert _depends_on_current_user(fns["server.py"][name]), name
    assert _calls_name(fns["saas_docs.py"]["quote_pdf"], "user_may_access_company")
    assert _calls_name(fns["attendance.py"]["assign_overtime"], "get_tenant_doc")
    watched = {
        "server.py": [
            "create_leave",
            "create_bonus",
            "upsert_attendance",
            "create_warehouse",
            "create_warehouse_transfer",
            "create_recipe",
            "_update_bonus_core",
        ],
        "attendance.py": ["assign_overtime"],
        "saas_docs.py": ["quote_pdf"],
    }
    missing = []
    for filename, names in watched.items():
        for name in names:
            for lineno in _unscoped_body_id_find_ones(fns[filename][name]):
                missing.append(f"{filename}:{name}:{lineno}")
    assert not missing, missing
