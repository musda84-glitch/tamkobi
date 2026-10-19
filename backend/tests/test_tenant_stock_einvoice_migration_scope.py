"""Stok, e-Fatura kesme ve veri aktarımı uçları oturum firmasıyla sınırlıdır.

Başka firmanın product_id / invoice_id / order_id / upload_id değeri 404 döner;
body'de üye olunmayan company_id 403 döner. Bellek içi koleksiyon
dashboard_memdb.MemDB kullanır. Canlı veritabanına, 8021'e, GİB'e ve AI
servisine bağlanmaz.
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

os.environ.setdefault("JWT_SECRET", "test-tenant-stock-einvoice-migration-scope-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import e_invoice  # noqa: E402
import migration  # noqa: E402
import server  # noqa: E402
from dashboard_memdb import MemColl, MemDB  # noqa: E402
from mysql_store import match_query  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CO_C = "co_c"
_NAME_MAP = {"name": "Cari Adı"}
_NOT_FOUND = "Yükleme bulunamadı; dosyayı tekrar yükleyin."


class _MemColl(MemColl):
    async def delete_one(self, query):
        query = query or {}
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs.pop(i)
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)


class _MemDB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _MemColl(name, self)
            self._cols[name] = coll
        return coll


def _run(coro):
    return asyncio.run(coro)


def _user(*company_ids, active=None, role="admin", super_admin=False):
    ids = list(company_ids)
    return {
        "_id": "user-" + "-".join(ids or ["sa"]),
        "id": "user-" + "-".join(ids or ["sa"]),
        "email": "user@example.com",
        "name": "Kullanıcı",
        "role": role,
        "is_active": True,
        "is_super_admin": super_admin,
        "company_ids": ids,
        "active_company_id": active if active is not None else (ids[0] if ids else None),
    }


def _bind():
    db = _MemDB()
    prev = {
        "server": server.db,
        "einv": e_invoice._db,
        "mig": migration._db,
        "convert": e_invoice._deps.get("convert_order"),
    }
    server.db = db
    e_invoice._db = db
    migration._db = db

    async def _convert(*_args, **_kwargs):
        raise AssertionError("convert_order çağrılmamalı")

    e_invoice._deps["convert_order"] = _convert
    return db, prev


def _restore(prev):
    server.db = prev["server"]
    e_invoice._db = prev["einv"]
    migration._db = prev["mig"]
    if prev["convert"] is None:
        e_invoice._deps.pop("convert_order", None)
    else:
        e_invoice._deps["convert_order"] = prev["convert"]


def _snap(db):
    return {name: copy.deepcopy(coll.docs) for name, coll in db._cols.items()}


def _owned(db, company_id):
    rows = []
    for name, coll in sorted(db._cols.items()):
        for doc in coll.docs:
            if doc.get("company_id") == company_id:
                rows.append((name, copy.deepcopy(doc)))
    return rows


async def _seed(db):
    await db.products.insert_one({
        "_id": "prod_a", "company_id": CO_A, "name": "A ürün",
        "stock_quantity": 10, "track_stock": True, "warehouse_id": "main_warehouse",
    })
    await db.products.insert_one({
        "_id": "prod_a_var", "company_id": CO_A, "name": "A varyant",
        "stock_quantity": 10, "track_stock": True,
        "variants": [
            {"variant_id": "va1", "name": "Kırmızı", "stock": 4},
            {"variant_id": "va2", "name": "Mavi", "stock": 6},
        ],
    })
    await db.products.insert_one({
        "_id": "prod_b", "company_id": CO_B, "name": "B ürün",
        "stock_quantity": 7, "track_stock": True,
    })
    await db.products.insert_one({
        "_id": "prod_b_var", "company_id": CO_B, "name": "B varyant",
        "stock_quantity": 9, "track_stock": True,
        "variants": [
            {"variant_id": "vb1", "name": "Siyah", "stock": 3},
            {"variant_id": "vb2", "name": "Beyaz", "stock": 6},
        ],
    })
    await db.products.insert_one({
        "_id": "prod_c", "company_id": CO_C, "name": "C ürün",
        "stock_quantity": 4, "track_stock": True, "warehouse_id": "main_warehouse",
    })
    await db.products.insert_one({
        "_id": "prod_bare", "name": "Şirketsiz ürün", "stock_quantity": 3, "track_stock": True,
    })
    await db.warehouses.insert_one({"_id": "wh_a", "company_id": CO_A, "name": "A depo"})
    await db.warehouses.insert_one({"_id": "wh_b", "company_id": CO_B, "name": "B depo"})
    await db.warehouses.insert_one({"_id": "wh_bare", "name": "Şirketsiz depo"})
    await db.stock_lots.insert_one({
        "_id": "lot_b", "company_id": CO_B, "product_id": "prod_b", "quantity": 1,
    })
    await db.stock_movements.insert_one({
        "_id": "mov_b", "company_id": CO_B, "product_id": "prod_b", "change": 1,
    })
    await db.invoices.insert_one({
        "_id": "inv_a", "company_id": CO_A, "status": "approved", "invoice_type": "sales",
        "invoice_number": "A-1", "e_type": "e_archive",
    })
    await db.invoices.insert_one({
        "_id": "inv_a_draft", "company_id": CO_A, "status": "draft", "invoice_type": "sales",
        "invoice_number": "A-D", "e_type": "e_archive",
    })
    await db.invoices.insert_one({
        "_id": "inv_a_irs", "company_id": CO_A, "status": "draft", "invoice_type": "dispatch",
        "invoice_number": "IRS-A", "e_type": "e_dispatch",
    })
    await db.invoices.insert_one({
        "_id": "inv_b", "company_id": CO_B, "status": "approved", "invoice_type": "sales",
        "invoice_number": "B-1", "e_type": "e_archive",
    })
    await db.invoices.insert_one({
        "_id": "inv_c", "company_id": CO_C, "status": "approved", "invoice_type": "sales",
        "invoice_number": "C-1", "e_type": "e_archive",
    })
    await db.orders.insert_one({
        "_id": "ord_a", "company_id": CO_A, "invoice_id": "inv_a", "order_number": "SA-1",
    })
    await db.orders.insert_one({
        "_id": "ord_b", "company_id": CO_B, "invoice_id": "inv_b", "order_number": "SB-1",
    })
    await db.orders.insert_one({
        "_id": "ord_c", "company_id": CO_C, "invoice_id": "inv_c", "order_number": "SC-1",
    })
    await db.contacts.insert_one({
        "_id": "cnt_a", "company_id": CO_A, "name": "A Cari", "tax_number_or_id": "2222222222",
    })
    await db.contacts.insert_one({
        "_id": "cnt_b", "company_id": CO_B, "name": "B Cari", "tax_number_or_id": "1111111111",
    })
    for cid, uid in ((CO_A, "up_a"), (CO_B, "up_b"), (CO_C, "up_c")):
        await db.migration_uploads.insert_one({
            "_id": uid,
            "company_id": cid,
            "entity": "contacts",
            "source": "other",
            "filename": f"{uid}.xlsx",
            "columns": ["Cari Adı"],
            "rows": [{"Cari Adı": f"Yeni {cid}"}],
            "created_at": "2026-01-01T00:00:00+00:00",
        })
    await db.migration_uploads.insert_one({
        "_id": "up_a_upd",
        "company_id": CO_A,
        "entity": "contacts",
        "source": "other",
        "filename": "upd.xlsx",
        "columns": ["Cari Adı", "VKN"],
        "rows": [{"Cari Adı": "A Cari Yeni", "VKN": "2222222222"}],
        "created_at": "2026-01-01T00:00:00+00:00",
    })


def _lot(product_id, **extra):
    body = {"product_id": product_id, "quantity": 2, "lot_number": "L-1", "tracking_type": "lot"}
    body.update(extra)
    return body


def _patch_issue(monkeypatch):
    calls = []

    async def fake(invoice_id, **_kwargs):
        calls.append(invoice_id)
        return {
            "status": "success",
            "einvoice_state": "sent",
            "invoice_id": invoice_id,
            "message": "ok",
            "e_type": "e_archive",
        }

    monkeypatch.setattr(e_invoice, "issue_invoice", fake)
    return calls


def _patch_ai(monkeypatch):
    calls = []

    async def fake(_label, _fields, columns, _rows):
        calls.append(list(columns))
        return {"mapping": {"name": columns[0] if columns else None}, "notes": "sahte"}

    monkeypatch.setattr("ai_service.ai_map_columns", fake)
    return calls


def test_other_company_stock_lot_is_not_found():
    """A kullanıcısı B ürününe lot yazamaz; company_id=B ise 403."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        before = _snap(db)
        with pytest.raises(HTTPException) as denied:
            await server.create_stock_lot(_lot("prod_b"), user)
        assert denied.value.status_code == 404
        assert "bulunamadı" in denied.value.detail
        assert _snap(db) == before

        with pytest.raises(HTTPException) as forbidden:
            await server.create_stock_lot(_lot("prod_b", company_id=CO_B), user)
        assert forbidden.value.status_code == 403
        assert "erişiminiz yok" in forbidden.value.detail
        assert _snap(db) == before

        with pytest.raises(HTTPException) as own_but_foreign_company:
            await server.create_stock_lot(_lot("prod_a", company_id=CO_B), user)
        assert own_but_foreign_company.value.status_code == 403
        assert _snap(db) == before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_warehouse_is_not_found():
    """A ürünü + B depo kimliği 404; kayıtsız sabit id ve aynı firma deposu yazılır."""
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        before = _snap(db)
        b_before = _owned(db, CO_B)
        with pytest.raises(HTTPException) as foreign:
            await server.create_stock_lot(_lot("prod_a", warehouse_id="wh_b"), user)
        assert foreign.value.status_code == 404
        assert foreign.value.detail == "Depo bulunamadı."
        assert _snap(db) == before

        with pytest.raises(HTTPException) as bare:
            await server.create_stock_lot(_lot("prod_a", warehouse_id="wh_bare"), user)
        assert bare.value.status_code == 404
        assert bare.value.detail == "Depo bulunamadı."
        assert _snap(db) == before

        fixed = await server.create_stock_lot(_lot("prod_a", warehouse_id="main_warehouse", company_id=CO_A), user)
        assert fixed["company_id"] == CO_A
        assert fixed["warehouse_id"] == "main_warehouse"
        assert fixed["product_id"] == "prod_a"
        assert fixed["quantity"] == 2
        prod = await db.products.find_one({"_id": "prod_a"})
        assert prod["stock_quantity"] == 12
        lot = await db.stock_lots.find_one({"product_id": "prod_a", "warehouse_id": "main_warehouse"})
        assert lot["company_id"] == CO_A
        assert lot["quantity"] == 2
        mov = await db.stock_movements.find_one({"product_id": "prod_a", "lot_id": lot["_id"]})
        assert mov["company_id"] == CO_A
        assert mov["change"] == 2

        own_wh = await server.create_stock_lot(_lot("prod_a", warehouse_id="wh_a", lot_number="L-2", quantity=1), user)
        assert own_wh["warehouse_id"] == "wh_a"
        assert own_wh["company_id"] == CO_A
        prod = await db.products.find_one({"_id": "prod_a"})
        assert prod["stock_quantity"] == 13
        assert _owned(db, CO_B) == b_before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_stock_lot_rejects_blank_company_product():
    db, prev = _bind()

    async def run():
        await _seed(db)
        before = _snap(db)
        with pytest.raises(HTTPException) as denied:
            await server.create_stock_lot(_lot("prod_bare"), _user(CO_A))
        assert denied.value.status_code == 404
        assert "bulunamadı" in denied.value.detail
        assert _snap(db) == before
        bare = await db.products.find_one({"_id": "prod_bare"})
        assert bare["stock_quantity"] == 3
        assert "company_id" not in bare

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_quick_adjust_is_not_found():
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        before = _snap(db)
        for body in (
            {"product_id": "prod_b", "quantity_change": 5},
            {"product_id": "prod_b_var", "variant_id": "vb1", "quantity_change": 3},
        ):
            with pytest.raises(HTTPException) as denied:
                await server.quick_stock_adjust(body, user)
            assert denied.value.status_code == 404
            assert denied.value.detail == "Ürün bulunamadı."
        with pytest.raises(HTTPException) as forbidden:
            await server.quick_stock_adjust({"product_id": "prod_b", "quantity_change": 5, "company_id": CO_B}, user)
        assert forbidden.value.status_code == 403
        assert "erişiminiz yok" in forbidden.value.detail
        assert _snap(db) == before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_quick_adjust_same_company_updates_stock_and_movement():
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        b_before = _owned(db, CO_B)
        plain = await server.quick_stock_adjust(
            {"product_id": "prod_a", "quantity_change": 5, "reason": "Sayım"},
            user,
        )
        assert plain == {"status": "success", "new_stock": 15, "new_variant_stock": None}
        prod = await db.products.find_one({"_id": "prod_a"})
        assert prod["stock_quantity"] == 15
        mov = await db.stock_movements.find_one({"product_id": "prod_a"})
        assert mov["company_id"] == CO_A
        assert mov["change"] == 5
        assert mov["new_stock"] == 15
        assert mov["reason"] == "Sayım"

        varied = await server.quick_stock_adjust(
            {"product_id": "prod_a_var", "variant_id": "va1", "quantity_change": 3},
            user,
        )
        assert varied == {"status": "success", "new_stock": 13, "new_variant_stock": 7}
        prod_v = await db.products.find_one({"_id": "prod_a_var"})
        assert prod_v["stock_quantity"] == 13
        assert prod_v["variants"][0]["stock"] == 7
        assert prod_v["variants"][1]["stock"] == 6
        mov_v = await db.stock_movements.find_one({"product_id": "prod_a_var"})
        assert mov_v["company_id"] == CO_A
        assert mov_v["change"] == 3
        assert mov_v["new_stock"] == 13
        assert mov_v["variant_id"] == "va1"
        assert mov_v["variant_name"] == "Kırmızı"
        assert _owned(db, CO_B) == b_before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_einvoice_does_not_issue(monkeypatch):
    calls = _patch_issue(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        before = _snap(db)
        cases = (
            e_invoice.InvoiceCreateRequest(invoice_id="inv_b"),
            e_invoice.InvoiceCreateRequest(order_id="ord_b"),
            e_invoice.InvoiceCreateRequest(invoice_id="inv_a", order_id="ord_b"),
        )
        for payload in cases:
            with pytest.raises(HTTPException) as denied:
                await e_invoice.api_create_einvoice(payload, user)
            assert denied.value.status_code == 404
            assert "bulunamadı" in denied.value.detail
        for payload in (
            e_invoice.InvoiceCreateRequest(invoice_id="inv_b", company_id=CO_B),
            e_invoice.InvoiceCreateRequest(order_id="ord_b", company_id=CO_B),
            e_invoice.InvoiceCreateRequest(company_id=CO_B, invoice_id="inv_a"),
        ):
            with pytest.raises(HTTPException) as forbidden:
                await e_invoice.api_create_einvoice(payload, user)
            assert forbidden.value.status_code == 403
            assert "erişiminiz yok" in forbidden.value.detail
        assert calls == []
        assert _snap(db) == before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_einvoice_same_company_issues_and_keeps_draft_conflict(monkeypatch):
    calls = _patch_issue(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        b_before = _owned(db, CO_B)

        with pytest.raises(HTTPException) as draft:
            await e_invoice.api_create_einvoice(e_invoice.InvoiceCreateRequest(invoice_id="inv_a_draft"), user)
        assert draft.value.status_code == 409
        assert draft.value.detail == "Önce Faturalaştırın"
        assert calls == []

        issued = await e_invoice.api_create_einvoice(
            e_invoice.InvoiceCreateRequest(invoice_id="inv_a", company_id=CO_A),
            user,
        )
        assert calls == ["inv_a"]
        assert issued["invoice_id"] == "inv_a"
        assert issued["company_id"] == CO_A
        assert issued["status"] == "success"

        ordered = await e_invoice.api_create_einvoice(
            e_invoice.InvoiceCreateRequest(order_id="ord_a", company_id=CO_A),
            user,
        )
        assert calls == ["inv_a", "inv_a"]
        assert ordered["invoice_id"] == "inv_a"
        assert ordered["company_id"] == CO_A
        order = await db.orders.find_one({"_id": "ord_a"})
        assert order["is_invoiced"] is True
        assert order["company_id"] == CO_A

        both = await e_invoice.api_create_einvoice(
            e_invoice.InvoiceCreateRequest(invoice_id="inv_a", order_id="ord_a", company_id=CO_A),
            user,
        )
        assert calls[-1] == "inv_a"
        assert both["company_id"] == CO_A

        await e_invoice.api_create_einvoice(e_invoice.InvoiceCreateRequest(invoice_id="inv_a_irs"), user)
        assert calls[-1] == "inv_a_irs"
        assert _owned(db, CO_B) == b_before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_other_company_migration_does_not_write(monkeypatch):
    ai_calls = _patch_ai(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        before = _snap(db)
        for call in (
            migration.migration_ai_map({"upload_id": "up_b"}, user),
            migration.migration_preview({"upload_id": "up_b", "mapping": _NAME_MAP}, user),
            migration.migration_import({"upload_id": "up_b", "mapping": _NAME_MAP, "on_duplicate": "update"}, user),
        ):
            with pytest.raises(HTTPException) as denied:
                await call
            assert denied.value.status_code == 404
            assert denied.value.detail == _NOT_FOUND
        for call in (
            migration.migration_ai_map({"upload_id": "up_b", "company_id": CO_B}, user),
            migration.migration_preview({"upload_id": "up_a", "mapping": _NAME_MAP, "company_id": CO_B}, user),
            migration.migration_import({"upload_id": "up_b", "mapping": _NAME_MAP, "company_id": CO_B}, user),
        ):
            with pytest.raises(HTTPException) as forbidden:
                await call
            assert forbidden.value.status_code == 403
            assert "erişiminiz yok" in forbidden.value.detail
        assert ai_calls == []
        assert _snap(db) == before
        assert await db.migration_uploads.find_one({"_id": "up_b"})

    try:
        _run(run())
    finally:
        _restore(prev)


def test_migration_same_company_previews_and_imports(monkeypatch):
    ai_calls = _patch_ai(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        b_before = _owned(db, CO_B)

        mapped = await migration.migration_ai_map({"upload_id": "up_a"}, user)
        assert ai_calls == [["Cari Adı"]]
        assert mapped["mapping"]["name"] == "Cari Adı"
        assert await db.migration_uploads.find_one({"_id": "up_a"})

        preview = await migration.migration_preview({"upload_id": "up_a", "mapping": _NAME_MAP}, user)
        assert preview["total"] == 1
        assert preview["valid"] == 1
        assert preview["invalid"] == 0
        assert preview["new"] == 1
        assert preview["existing"] == 0
        assert await db.migration_uploads.find_one({"_id": "up_a"})
        assert not any(d.get("name") == "Yeni co_a" for d in db.contacts.docs)

        imported = await migration.migration_import(
            {"upload_id": "up_a", "mapping": _NAME_MAP, "on_duplicate": "skip"},
            user,
        )
        assert imported["status"] == "success"
        assert imported["inserted"] == 1
        assert imported["updated"] == 0
        assert await db.migration_uploads.find_one({"_id": "up_a"}) is None
        assert await db.migration_uploads.find_one({"_id": "up_b"})
        created = [d for d in db.contacts.docs if d.get("name") == "Yeni co_a"]
        assert len(created) == 1
        assert created[0]["company_id"] == CO_A
        batch = await db.migration_batches.find_one({"_id": imported["batch_id"]})
        assert batch["company_id"] == CO_A

        updated = await migration.migration_import(
            {
                "upload_id": "up_a_upd",
                "mapping": {"name": "Cari Adı", "tax_number_or_id": "VKN"},
                "on_duplicate": "update",
            },
            user,
        )
        assert updated["updated"] == 1
        assert updated["inserted"] == 0
        cnt = await db.contacts.find_one({"_id": "cnt_a"})
        assert cnt["name"] == "A Cari Yeni"
        assert cnt["company_id"] == CO_A
        assert await db.migration_uploads.find_one({"_id": "up_a_upd"}) is None
        assert await db.contacts.find_one({"_id": "cnt_b"}) == next(d for d in b_before if d[1]["_id"] == "cnt_b")[1]
        assert _owned(db, CO_B) == b_before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_import_update_filter_skips_other_company_id(monkeypatch):
    """existing_id başka firmadaysa update filtresi o kayda yazmaz."""
    _patch_ai(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A)
        b_before = _owned(db, CO_B)

        async def poisoned(_upload, _mapping):
            return [{
                "row": 2,
                "data": {"name": "Hacked"},
                "existing_id": "cnt_b",
                "errors": [],
                "label": "B Cari",
            }], []

        monkeypatch.setattr(migration, "_transform", poisoned)
        out = await migration.migration_import(
            {"upload_id": "up_a", "mapping": _NAME_MAP, "on_duplicate": "update"},
            user,
        )
        assert out["updated"] == 0
        assert out["inserted"] == 0
        assert out["skipped"] == 1
        cnt_b = await db.contacts.find_one({"_id": "cnt_b"})
        assert cnt_b["name"] == "B Cari"
        assert cnt_b["company_id"] == CO_B
        assert await db.migration_uploads.find_one({"_id": "up_a"}) is None
        assert _owned(db, CO_B) == b_before

    try:
        _run(run())
    finally:
        _restore(prev)


def test_multi_company_user_reaches_own_companies_only(monkeypatch):
    calls = _patch_issue(monkeypatch)
    _patch_ai(monkeypatch)
    db, prev = _bind()

    async def run():
        await _seed(db)
        user = _user(CO_A, CO_C, active=CO_A)
        b_before = _owned(db, CO_B)

        lot = await server.create_stock_lot(_lot("prod_c", lot_number="C-1"), user)
        assert lot["company_id"] == CO_C
        prod_c = await db.products.find_one({"_id": "prod_c"})
        assert prod_c["stock_quantity"] == 6
        mov = await db.stock_movements.find_one({"product_id": "prod_c"})
        assert mov["company_id"] == CO_C

        adjusted = await server.quick_stock_adjust({"product_id": "prod_c", "quantity_change": 1}, user)
        assert adjusted == {"status": "success", "new_stock": 7, "new_variant_stock": None}

        issued = await e_invoice.api_create_einvoice(e_invoice.InvoiceCreateRequest(invoice_id="inv_c"), user)
        assert calls == ["inv_c"]
        assert issued["company_id"] == CO_C

        ordered = await e_invoice.api_create_einvoice(e_invoice.InvoiceCreateRequest(order_id="ord_c"), user)
        assert calls == ["inv_c", "inv_c"]
        assert ordered["company_id"] == CO_C

        preview = await migration.migration_preview({"upload_id": "up_c", "mapping": _NAME_MAP}, user)
        assert preview["valid"] == 1
        imported = await migration.migration_import({"upload_id": "up_c", "mapping": _NAME_MAP}, user)
        assert imported["inserted"] == 1
        created = [d for d in db.contacts.docs if d.get("name") == "Yeni co_c"]
        assert len(created) == 1 and created[0]["company_id"] == CO_C
        assert await db.migration_uploads.find_one({"_id": "up_c"}) is None

        with pytest.raises(HTTPException) as invoice_mismatch:
            await e_invoice.api_create_einvoice(
                e_invoice.InvoiceCreateRequest(invoice_id="inv_c", company_id=CO_A),
                user,
            )
        assert invoice_mismatch.value.status_code == 403
        assert invoice_mismatch.value.detail == "Fatura bu firmaya ait değil."

        with pytest.raises(HTTPException) as foreign_order:
            await e_invoice.api_create_einvoice(
                e_invoice.InvoiceCreateRequest(order_id="ord_b", company_id=CO_A),
                user,
            )
        assert foreign_order.value.status_code == 404

        with pytest.raises(HTTPException) as own_mismatch:
            await e_invoice.api_create_einvoice(
                e_invoice.InvoiceCreateRequest(order_id="ord_c", company_id=CO_A),
                user,
            )
        assert own_mismatch.value.status_code == 403
        assert own_mismatch.value.detail == "Sipariş bu firmaya ait değil."

        for call in (
            server.create_stock_lot(_lot("prod_b"), user),
            server.quick_stock_adjust({"product_id": "prod_b", "quantity_change": 1}, user),
            e_invoice.api_create_einvoice(e_invoice.InvoiceCreateRequest(invoice_id="inv_b"), user),
            migration.migration_import({"upload_id": "up_b", "mapping": _NAME_MAP}, user),
        ):
            with pytest.raises(HTTPException) as denied:
                await call
            assert denied.value.status_code == 404
            assert "bulunamadı" in denied.value.detail

        assert await db.migration_uploads.find_one({"_id": "up_b"})
        assert _owned(db, CO_B) == b_before
        assert calls == ["inv_c", "inv_c"]

    try:
        _run(run())
    finally:
        _restore(prev)


def test_super_admin_still_reaches_every_company():
    db, prev = _bind()

    async def run():
        await _seed(db)
        admin = _user(super_admin=True)
        out = await server.create_stock_lot(_lot("prod_b", quantity=1, lot_number="SA"), admin)
        assert out["company_id"] == CO_B
        prod = await db.products.find_one({"_id": "prod_b"})
        assert prod["stock_quantity"] == 8
        movs = [d for d in db.stock_movements.docs if d.get("product_id") == "prod_b" and d.get("_id") != "mov_b"]
        assert len(movs) == 1
        assert movs[0]["company_id"] == CO_B
        assert movs[0]["change"] == 1

    try:
        _run(run())
    finally:
        _restore(prev)


_BODY_ROOTS = {"req", "payload", "body"}
_ROUTES = {
    "server.py": ["create_stock_lot", "quick_stock_adjust"],
    "e_invoice.py": ["api_create_einvoice"],
    "migration.py": ["migration_ai_map", "migration_preview", "migration_import"],
}
_USER_DEP = {
    "create_stock_lot": "get_current_user",
    "quick_stock_adjust": "get_current_user",
    "api_create_einvoice": "_user_dep",
    "migration_ai_map": "_user_dep",
    "migration_preview": "_user_dep",
    "migration_import": "_user_dep",
}


def _depends_target(node):
    if not isinstance(node, ast.Call):
        return None
    fn = node.func
    is_depends = (isinstance(fn, ast.Name) and fn.id == "Depends") or (
        isinstance(fn, ast.Attribute) and fn.attr == "Depends"
    )
    if not is_depends or not node.args:
        return None
    arg = node.args[0]
    if isinstance(arg, ast.Name):
        return arg.id
    if isinstance(arg, ast.Attribute):
        return arg.attr
    return None


def _user_dependency(fn: ast.AST):
    args = fn.args
    defaults = [None] * (len(args.args) - len(args.defaults)) + list(args.defaults)
    for arg, default in zip(args.args, defaults):
        if arg.arg == "user":
            return _depends_target(default)
    for arg, default in zip(args.kwonlyargs, args.kw_defaults):
        if arg.arg == "user":
            return _depends_target(default)
    return None


def _references_body(node: ast.AST, tainted: set) -> bool:
    for child in ast.walk(node):
        if isinstance(child, ast.Name) and (child.id in _BODY_ROOTS or child.id in tainted):
            return True
    return False


def _tainted_names(fn: ast.AST) -> set:
    assigns = []
    for node in ast.walk(fn):
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            assigns.append((node.targets[0].id, node.value))
        elif isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.value is not None:
            assigns.append((node.target.id, node.value))
    tainted = set()
    changed = True
    while changed:
        changed = False
        for name, value in assigns:
            if name in tainted:
                continue
            if _references_body(value, tainted):
                tainted.add(name)
                changed = True
    return tainted


def _call_attr(node: ast.Call):
    fn = node.func
    if isinstance(fn, ast.Attribute):
        return fn.attr
    if isinstance(fn, ast.Name):
        return fn.id
    return None


def _unscoped_body_id_writes(fn: ast.AST):
    """{"_id": req/payload/body} filtreli, company_id'siz find_one/update_one satırları."""
    tainted = _tainted_names(fn)
    literals = {}
    for node in ast.walk(fn):
        if (
            isinstance(node, ast.Assign)
            and len(node.targets) == 1
            and isinstance(node.targets[0], ast.Name)
            and isinstance(node.value, ast.Dict)
        ):
            literals[node.targets[0].id] = node.value
    bad = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call) or _call_attr(node) not in {"find_one", "update_one"}:
            continue
        if not node.args:
            continue
        arg = node.args[0]
        if isinstance(arg, ast.Dict):
            literal = arg
        elif isinstance(arg, ast.Name):
            literal = literals.get(arg.id)
        else:
            literal = None
        if literal is None:
            continue
        keys = []
        id_val = None
        for key, value in zip(literal.keys, literal.values):
            if isinstance(key, ast.Constant) and isinstance(key.value, str):
                keys.append(key.value)
                if key.value == "_id":
                    id_val = value
        if "_id" in keys and "company_id" not in keys and id_val is not None and _references_body(id_val, tainted):
            bad.append(node.lineno)
    return bad


def test_route_functions_scope_body_ids():
    """Bu PR'daki 6 rota user alır; body id'li find_one/update_one company_id taşır."""
    missing = []
    unscoped = []
    for filename, names in _ROUTES.items():
        tree = ast.parse((_BACKEND / filename).read_text(encoding="utf-8"))
        found = {}
        for node in ast.walk(tree):
            if isinstance(node, ast.AsyncFunctionDef) and node.name in names:
                found.setdefault(node.name, node)
        for name in names:
            fn = found.get(name)
            if fn is None:
                missing.append(f"{filename}:{name}")
                continue
            if _user_dependency(fn) != _USER_DEP[name]:
                missing.append(f"{filename}:{name} user={_user_dependency(fn)}")
            for lineno in _unscoped_body_id_writes(fn):
                unscoped.append(f"{filename}:{name}:{lineno}")
    assert not missing, missing
    assert not unscoped, unscoped
