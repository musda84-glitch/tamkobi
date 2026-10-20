"""server.py kiracı dalgası 1. Bellek içi MemDB.

Canlı veritabanına ve 8021'deki sunucuya bağlanmaz.
Değer, filtre, şirket kimliği veya kayıt içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

os.environ.setdefault("JWT_SECRET", "test-tenant-isolation-server-wave1-jwt-secret-not-default")
os.environ.setdefault("TAMKOBI_BACKGROUND_JOBS", "0")
os.environ.setdefault("REACT_APP_BACKEND_URL", "http://127.0.0.1:9")

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import cheques  # noqa: E402
import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
CNT = "cnt-a"
RECIPE = "rec-dup"
EXP = "exp-dup"
NOTE_DUP = "note-dup"

_REMOVED = (
    ("server.py", "apply_contact_terms", "contacts", "update_one"),
    ("server.py", "apply_contact_terms", "invoices", "find"),
    ("server.py", "apply_contact_terms", "invoices", "update_one"),
    ("server.py", "clear_notifications", "notifications", "delete_many"),
    ("server.py", "contact_aging", "invoices", "find"),
    ("server.py", "convert_quote_to_invoice", "contacts", "update_one"),
    ("server.py", "convert_quote_to_invoice", "quotes", "update_one"),
    ("server.py", "convert_survey_to_quote", "quotes", "update_one"),
    ("server.py", "convert_survey_to_quote", "surveys", "update_one"),
    ("server.py", "create_contact_balance_installments", "installments", "count_documents"),
    ("server.py", "create_contact_balance_installments", "installments", "delete_many"),
    ("server.py", "delete_contact_balance_installments", "installments", "count_documents"),
    ("server.py", "delete_contact_balance_installments", "installments", "delete_many"),
    ("server.py", "get_contact_overview", "bank_transactions", "find"),
    ("server.py", "get_contact_overview", "cheques", "find"),
    ("server.py", "get_contact_overview", "contacts", "update_one"),
    ("server.py", "get_contact_overview", "expenses", "find"),
    ("server.py", "get_contact_overview", "invoices", "find"),
    ("server.py", "get_contact_overview", "mail_logs", "find"),
    ("server.py", "get_contact_overview", "partner_transactions", "find"),
    ("server.py", "get_contact_overview", "projects", "find"),
    ("server.py", "get_contact_overview", "quotes", "find"),
    ("server.py", "get_contact_overview", "sms_logs", "find"),
    ("server.py", "get_contact_overview", "surveys", "find"),
    ("server.py", "get_contact_overview", "whatsapp_logs", "find"),
    ("server.py", "get_contact_statement", "bank_transactions", "find"),
    ("server.py", "get_contact_statement", "invoices", "find"),
    ("server.py", "list_contact_balance_installments", "installments", "find"),
    ("server.py", "notification_target_status", "notifications", "find_one"),
    ("server.py", "read_all_notifications", "notifications", "update_many"),
    ("server.py", "read_notification", "notifications", "update_one"),
    ("server.py", "update_contact", "contacts", "find_one"),
    ("server.py", "update_contact", "contacts", "update_one"),
    ("server.py", "update_product", "products", "find_one"),
    ("server.py", "update_product", "products", "update_one"),
    ("server.py", "update_project", "projects", "find_one"),
    ("server.py", "update_project", "projects", "update_one"),
    ("server.py", "update_project", "recipes", "find_one"),
    ("server.py", "update_purchase_order_status", "purchase_orders", "find_one"),
    ("server.py", "update_purchase_order_status", "purchase_orders", "update_one"),
    ("server.py", "update_quote", "quotes", "find_one"),
    ("server.py", "update_quote", "quotes", "update_one"),
    ("server.py", "update_survey", "surveys", "find_one"),
    ("server.py", "update_survey", "surveys", "update_one"),
)


def _run(coro):
    return asyncio.run(coro)


def _user(company_id):
    uid = "user-" + company_id
    return {
        "_id": uid,
        "id": uid,
        "name": "Kullanici",
        "role": "admin",
        "is_active": True,
        "is_super_admin": False,
        "company_ids": [company_id],
        "active_company_id": company_id,
    }


class _Coll(MemColl):
    async def delete_many(self, query=None):
        query = _split_field_ops(query or {})
        kept = []
        removed = 0
        for doc in self.docs:
            if match_query(doc, query):
                removed += 1
            else:
                kept.append(doc)
        self.docs[:] = kept
        return SimpleNamespace(deleted_count=removed)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True):
        query = _split_field_ops(query or {})
        for i, doc in enumerate(self.docs):
            if match_query(doc, query):
                before = copy.deepcopy(doc)
                self.docs[i] = apply_update(doc, update, query)
                return copy.deepcopy(self.docs[i] if return_document else before)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created)


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


def _bind():
    db = _DB()
    prev = (server.db, cheques._db)
    server.db = db
    cheques._db = db
    return db, prev


def _restore(prev):
    server.db, cheques._db = prev


def _note(doc_id, company_id, read=False):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "type": "license",
        "title": doc_id,
        "message": doc_id,
        "is_read": read,
        "created_at": "2026-10-20T08:00:00+00:00",
    }


def _contact(doc_id, company_id, balance):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "name": doc_id,
        "balance": balance,
        "opening_balance": 0,
        "cheque_bond_balance": 15.0 if company_id == CO_A else 90.0,
        "payment_term_days": 0,
        "late_fee_rate": 0,
    }


def _invoice(doc_id, company_id, contact_id, status, total, due):
    return {
        "_id": doc_id,
        "company_id": company_id,
        "contact_id": contact_id,
        "invoice_number": doc_id,
        "invoice_type": "sales",
        "status": status,
        "payment_status": "unpaid",
        "grand_total": total,
        "paid_amount": 0,
        "issue_date": "2026-10-01",
        "due_date": due,
        "effects_applied": status == "approved",
    }


def _seed(db, other=True):
    db.contacts.docs.append(_contact(CNT, CO_A, 40.0))
    db.notifications.docs.append(_note("note-a", CO_A))
    db.notifications.docs.append(_note(NOTE_DUP, CO_A))
    db.quotes.docs.append({
        "_id": "quote-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "contact_name": CNT,
        "quote_number": "TKF-A",
        "title": "Teklif A",
        "items": [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 40, "vat_rate": 20}],
        "subtotal": 40,
        "vat_total": 8,
        "grand_total": 48,
        "status": "draft",
        "notes": "",
        "images": [],
    })
    db.surveys.docs.append({
        "_id": "survey-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "survey_number": "KSF-A",
        "status": "planned",
        "notes": "not-a",
        "measurements": [],
        "images": ["img-a"],
    })
    db.recipes.docs.append({
        "_id": RECIPE,
        "company_id": CO_A,
        "name": "A tarif",
        "steps": [{"no": 1, "name": "A adim", "station": "A"}],
    })
    db.projects.docs.append({
        "_id": "proj-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "name": "Proje A",
        "project_number": "PRJ-A",
        "recipe_id": RECIPE,
        "status": "planning",
    })
    db.invoices.docs.append(_invoice("inv-a", CO_A, CNT, "approved", 40, "2026-10-15"))
    db.bank_transactions.docs.append({
        "_id": "tx-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "type": "inflow",
        "amount": 0,
        "date": "2026-10-02",
        "source": "manual",
    })
    db.installments.docs.append({
        "_id": "inst-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "invoice_id": None,
        "status": "pending",
        "no": 1,
        "amount": 40,
        "paid_amount": 0,
        "due_date": "2026-11-01",
    })
    db.cheques.docs.append({
        "_id": "ch-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "status": "open",
        "direction": "received",
        "instrument": "cheque",
        "amount": 15,
        "number": "CEK-A",
        "due_date": "2026-12-01",
    })
    db.expenses.docs.append({
        "_id": EXP,
        "company_id": CO_A,
        "contact_id": CNT,
        "payment_status": "unpaid",
        "total": 5,
        "date": "2026-10-03",
    })
    db.bank_transactions.docs.append({
        "_id": "tx-exp-a",
        "company_id": CO_A,
        "contact_id": CNT,
        "expense_id": EXP,
        "type": "outflow",
        "amount": 5,
        "source": "expense",
        "date": "2026-10-03",
    })
    for coll, doc_id in (
        ("partner_transactions", "pt-a"),
        ("sms_logs", "sms-a"),
        ("mail_logs", "mail-a"),
        ("whatsapp_logs", "wa-a"),
    ):
        db[coll].docs.append({
            "_id": doc_id,
            "company_id": CO_A,
            "contact_id": CNT,
            "type": "withdrawal",
            "amount": 0,
            "created_at": "2026-10-20T09:00:00+00:00",
        })
    db.purchase_orders.docs.append({
        "_id": "po-a",
        "company_id": CO_A,
        "order_status": "draft",
        "order_number": "PO-A",
    })
    db.products.docs.append({
        "_id": "prod-a",
        "company_id": CO_A,
        "name": "Urun A",
        "sku": "SKU-A",
    })
    if not other:
        return
    db.contacts.docs.append(_contact(CNT, CO_B, 77.0))
    db.contacts.docs.append(_contact("cnt-b", CO_B, 5.0))
    db.notifications.docs.append(_note("note-b", CO_B))
    db.notifications.docs.append(_note(NOTE_DUP, CO_B))
    db.quotes.docs.append({
        "_id": "quote-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "quote_number": "TKF-B",
        "title": "Teklif B",
        "items": [],
        "subtotal": 1,
        "vat_total": 0,
        "grand_total": 1,
        "status": "draft",
    })
    db.surveys.docs.append({
        "_id": "survey-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "survey_number": "KSF-B",
        "status": "planned",
        "notes": "not-b",
        "measurements": [],
    })
    db.recipes.docs.insert(0, {
        "_id": RECIPE,
        "company_id": CO_B,
        "name": "B tarif",
        "steps": [{"no": 1, "name": "B adim", "station": "B"}],
    })
    db.projects.docs.append({
        "_id": "proj-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "name": "Proje B",
        "recipe_id": RECIPE,
        "status": "planning",
    })
    db.invoices.docs.append(_invoice("inv-b", CO_B, CNT, "draft", 999, "2026-12-31"))
    db.bank_transactions.docs.append({
        "_id": "tx-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "type": "inflow",
        "amount": 0,
        "date": "2026-10-02",
        "source": "manual",
    })
    db.installments.docs.append({
        "_id": "inst-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "invoice_id": None,
        "status": "paid",
        "no": 1,
        "amount": 70,
        "paid_amount": 70,
        "due_date": "2026-09-01",
    })
    db.cheques.docs.append({
        "_id": "ch-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "status": "open",
        "direction": "received",
        "instrument": "cheque",
        "amount": 90,
        "number": "CEK-B",
        "due_date": "2026-12-01",
    })
    db.expenses.docs.append({
        "_id": EXP,
        "company_id": CO_B,
        "contact_id": CNT,
        "payment_status": "paid",
        "total": 80,
        "date": "2026-10-03",
    })
    db.bank_transactions.docs.append({
        "_id": "tx-exp-b",
        "company_id": CO_B,
        "contact_id": CNT,
        "expense_id": EXP,
        "type": "outflow",
        "amount": 80,
        "source": "expense",
        "date": "2026-10-03",
    })
    for coll, doc_id in (
        ("partner_transactions", "pt-b"),
        ("sms_logs", "sms-b"),
        ("mail_logs", "mail-b"),
        ("whatsapp_logs", "wa-b"),
    ):
        db[coll].docs.append({
            "_id": doc_id,
            "company_id": CO_B,
            "contact_id": CNT,
            "type": "withdrawal",
            "amount": 0,
            "created_at": "2026-10-20T09:00:00+00:00",
        })
    db.purchase_orders.docs.append({
        "_id": "po-b",
        "company_id": CO_B,
        "order_status": "draft",
        "order_number": "PO-B",
    })
    db.products.docs.append({
        "_id": "prod-b",
        "company_id": CO_B,
        "name": "Urun B",
        "sku": "SKU-B",
    })


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


def _doc(db, coll, doc_id, company_id):
    for row in db._cols[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
    return None


def _ids(node, found=None):
    found = found if found is not None else set()
    if isinstance(node, dict):
        if node.get("id"):
            found.add(str(node["id"]))
        if node.get("_id"):
            found.add(str(node["_id"]))
        for value in node.values():
            _ids(value, found)
    elif isinstance(node, list):
        for item in node:
            _ids(item, found)
    return found


_B_IDS = {
    "note-b", NOTE_DUP, "quote-b", "survey-b", "proj-b", "inv-b", "tx-b",
    "inst-b", "ch-b", "tx-exp-b", "pt-b", "sms-b", "mail-b", "wa-b",
    "po-b", "prod-b", "cnt-b", "expense-virt-" + EXP, "cheque-virt-ch-b",
}


async def _expect(coro, detail):
    with pytest.raises(HTTPException) as exc:
        await coro
    assert exc.value.status_code == 404
    assert exc.value.detail == detail


def test_cross_tenant_root_ids_are_404():
    db, prev = _bind()
    try:
        _seed(db)
        user = _user(CO_A)
        before = _digest(db, CO_B)

        async def run():
            await _expect(server.read_notification("note-b", user), "Bildirim bulunamadı.")
            await _expect(server.notification_target_status("note-b", user), "Bildirim bulunamadı.")
            await _expect(server.update_quote("quote-b", {"title": "dis"}, user), "Teklif bulunamadı.")
            await _expect(server.convert_quote_to_invoice("quote-b", {}, user), "Teklif bulunamadı.")
            await _expect(server.update_project("proj-b", {"name": "dis"}, user), "Proje bulunamadı.")
            await _expect(server.update_survey("survey-b", {"notes": "dis"}, user), "Keşif bulunamadı.")
            await _expect(server.convert_survey_to_quote("survey-b", user), "Keşif bulunamadı.")
            await _expect(server.update_contact("cnt-b", {"name": "dis"}, user), "Cari hesap bulunamadı.")
            await _expect(server.get_contact_statement("cnt-b", user), "Cari hesap bulunamadı.")
            await _expect(server.contact_aging("cnt-b", user), "Cari hesap bulunamadı.")
            await _expect(server.apply_contact_terms("cnt-b", {"payment_term_days": 9}, user), "Cari hesap bulunamadı.")
            await _expect(server.list_contact_balance_installments("cnt-b", user), "Cari hesap bulunamadı.")
            await _expect(server.create_contact_balance_installments("cnt-b", {"count": 2, "total": 10}, user), "Cari hesap bulunamadı.")
            await _expect(server.delete_contact_balance_installments("cnt-b", user), "Cari hesap bulunamadı.")
            await _expect(server.get_contact_overview("cnt-b", user), "Cari hesap bulunamadı.")
            await _expect(
                server.update_purchase_order_status("po-b", {"order_status": "sent"}, user),
                "Verilen sipariş bulunamadı.",
            )
            await _expect(server.update_product("prod-b", {"name": "dis"}, user), "Ürün bulunamadı.")

        _run(run())
        assert _digest(db, CO_B) == before
        assert _doc(db, "notifications", "note-b", CO_B)["is_read"] is False
    finally:
        _restore(prev)


def test_shared_keys_do_not_leak_or_change():
    db, prev = _bind()
    try:
        _seed(db)
        user = _user(CO_A)
        before = _digest(db, CO_B)

        async def run():
            read = await server.read_notification(NOTE_DUP, user)
            assert read == {"status": "success"}
            marked = await server.read_all_notifications(user=user)
            assert marked["status"] == "success"
            assert marked["updated"] == 1
            cleared = await server.clear_notifications(user=user)
            assert cleared["status"] == "success"
            assert cleared["deleted"] == 2

            statement = await server.get_contact_statement(CNT, user)
            aging = await server.contact_aging(CNT, user)
            overview = await server.get_contact_overview(CNT, user)
            listed = await server.list_contact_balance_installments(CNT, user)
            applied = await server.apply_contact_terms(
                CNT, {"payment_term_days": 14, "late_fee_rate": 1, "apply_to_open_invoices": True}, user,
            )
            created = await server.create_contact_balance_installments(
                CNT, {"count": 2, "total": 40, "first_due_date": "2026-11-01"}, user,
            )
            deleted = await server.delete_contact_balance_installments(CNT, user)
            project = await server.update_project("proj-a", {"refresh_production_steps": True}, user)
            return statement, aging, overview, listed, applied, created, deleted, project

        statement, aging, overview, listed, applied, created, deleted, project = _run(run())
        assert _digest(db, CO_B) == before
        assert _doc(db, "notifications", NOTE_DUP, CO_B)["is_read"] is False
        assert _doc(db, "notifications", "note-b", CO_B)["is_read"] is False
        assert _doc(db, "invoices", "inv-b", CO_B)["due_date"] == "2026-12-31"
        assert _doc(db, "installments", "inst-b", CO_B)["status"] == "paid"
        assert _doc(db, "contacts", CNT, CO_B)["balance"] == 77.0
        assert _doc(db, "contacts", CNT, CO_A)["cheque_bond_balance"] == 15.0
        assert applied["updated_invoices"] == 1
        assert deleted == {"status": "success"}
        assert len(created) == 2
        assert {row["id"] for row in listed} == {"inst-a"}
        assert {row["id"] for row in statement["invoices"]} == {"inv-a"}
        assert {row["id"] for row in statement["payments"]} == {"tx-a", "tx-exp-a"}
        assert [row["invoice_id"] for row in aging["rows"]] == ["inv-a"]
        assert project["recipe_name"] == "A tarif"
        assert project["production_steps"][0]["name"] == "A adim"
        leaked = _ids(statement) | _ids(aging) | _ids(overview) | _ids(listed) | _ids(created)
        assert leaked.isdisjoint(_B_IDS)
        assert "inv-b" not in _ids(overview["invoices"])
        assert "tx-exp-b" not in _ids(overview["payments"])
        assert "ch-b" not in _ids(overview["cheques"])
    finally:
        _restore(prev)


def test_same_company_responses():
    db, prev = _bind()
    try:
        _seed(db, other=False)
        user = _user(CO_A)

        async def run():
            read = await server.read_notification("note-a", user)
            target = await server.notification_target_status("note-a", user)
            quote = await server.update_quote("quote-a", {"title": "Guncel"}, user)
            contact = await server.update_contact(CNT, {"name": "Cari Yeni", "company_id": CO_B}, user)
            survey = await server.update_survey("survey-a", {"notes": "yeni not"}, user)
            project = await server.update_project("proj-a", {"name": "Proje Yeni"}, user)
            po = await server.update_purchase_order_status("po-a", {"order_status": "sent"}, user)
            product = await server.update_product("prod-a", {"name": "Urun Yeni"}, user)
            converted = await server.convert_quote_to_invoice("quote-a", {"due_date": "2026-11-01"}, user)
            surveyed = await server.convert_survey_to_quote("survey-a", user)
            return read, target, quote, contact, survey, project, po, product, converted, surveyed

        read, target, quote, contact, survey, project, po, product, converted, surveyed = _run(run())
        assert read == {"status": "success"}
        assert _doc(db, "notifications", "note-a", CO_A)["is_read"] is True
        assert target["exists"] is True
        assert quote["title"] == "Guncel"
        assert quote["id"] == "quote-a"
        assert contact["name"] == "Cari Yeni"
        assert contact["company_id"] == CO_A
        assert survey["notes"] == "yeni not"
        assert project["name"] == "Proje Yeni"
        assert po["order_status"] == "sent"
        assert product["name"] == "Urun Yeni"
        assert converted["status"] == "success"
        assert converted["invoice"]["grand_total"] == 48
        assert "TKF-A" in converted["message"]
        assert _doc(db, "quotes", "quote-a", CO_A)["status"] == "accepted"
        assert _doc(db, "contacts", CNT, CO_A)["balance"] == 88.0
        assert surveyed["status"] == "success"
        assert "KSF-A" in surveyed["message"]
        assert _doc(db, "surveys", "survey-a", CO_A)["status"] == "quoted"
        assert surveyed["quote"]["company_id"] == CO_A
    finally:
        _restore(prev)


def test_read_notification_anonymous_is_401():
    db, prev = _bind()
    router = server.app.router
    saved_up = list(router.on_startup)
    saved_down = list(router.on_shutdown)
    router.on_startup.clear()
    router.on_shutdown.clear()
    try:
        _seed(db, other=False)
        client = TestClient(server.app)
        response = client.post("/api/notifications/note-a/read")
        assert response.status_code == 401
        assert _doc(db, "notifications", "note-a", CO_A)["is_read"] is False
    finally:
        router.on_startup[:] = saved_up
        router.on_shutdown[:] = saved_down
        _restore(prev)


def test_product_without_company_keeps_skip_branch(caplog):
    db, prev = _bind()
    try:
        _seed(db, other=False)
        db.products.docs.append({"_id": "prod-blank", "name": "Bos", "sku": "SKU-0"})
        caplog.set_level(logging.WARNING, logger="TamKobiERP")
        out = _run(server.update_product("prod-blank", {"name": "Bos2", "category": "Yeni"}, _user(CO_A)))
        assert out["name"] == "Bos2"
        assert out["category"] == "Yeni"
        assert db.product_categories.docs == []
        assert any("kayıtta firma bilgisi yok" in rec.message for rec in caplog.records)
    finally:
        _restore(prev)


def test_wave1_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 44
    kept = ("server.py", "create_contact_balance_installments", "installments", "insert_many")
    assert base[kept] == 1
    assert ("server.py", "delete_notification", "notifications", "delete_one") in base
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0
    assert "temiz" in proc.stdout
