"""Teklif onayı, proje ve herkese açık takip kiracı dalgası 11.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna, ağa ve gerçek
SMS/e-posta/WhatsApp gönderimine bağlanmaz. Değer, filtre, şirket
kimliği, tutar veya belge içeriği loglanmaz.
"""
from __future__ import annotations

import asyncio
import copy
import hashlib
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import server  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
QUOTE = "quote-shared"
PROJ = "proj-shared"
SURVEY = "survey-shared"
CONTACT = "contact-shared"
INV = "inv-shared"
PO = "po-shared"
RECIPE = "recipe-shared"
TOKEN_A = "a" * 32
TOKEN_B = "b" * 32
PHONE_A = "5550000001"
PHONE_B = "5550000002"

_REMOVED = (
    ("server.py", "_project_production_order_fields", "production_orders", "find_one"),
    ("server.py", "_project_production_order_fields", "recipes", "find_one"),
    ("server.py", "_project_production_order_fields", "work_orders", "find"),
    ("server.py", "_project_statement", "bank_transactions", "find"),
    ("server.py", "_project_statement", "contacts", "find_one"),
    ("server.py", "_project_statement", "invoices", "find"),
    ("server.py", "convert_quote_to_project", "projects", "find_one"),
    ("server.py", "convert_quote_to_project", "projects", "update_one"),
    ("server.py", "convert_quote_to_project", "quotes", "update_one"),
    ("server.py", "convert_quote_to_project", "surveys", "find_one"),
    ("server.py", "convert_quote_to_project", "surveys", "update_one"),
    ("server.py", "invoice_project", "invoices", "find_one"),
    ("server.py", "invoice_project", "projects", "update_one"),
    ("server.py", "invoice_project", "quotes", "find"),
    ("server.py", "invoice_project", "quotes", "update_one"),
    ("server.py", "list_projects", "expenses", "find"),
    ("server.py", "list_projects", "invoices", "find"),
    ("server.py", "list_projects", "quotes", "find"),
    ("server.py", "public_project", "projects", "update_one"),
    ("server.py", "public_project", "quotes", "find"),
    ("server.py", "public_project", "surveys", "find"),
    ("server.py", "public_project", "work_orders", "find"),
    ("server.py", "public_project_quote", "quotes", "find"),
    ("server.py", "public_quote", "quotes", "update_one"),
    ("server.py", "public_quote_respond", "quotes", "update_one"),
    ("server.py", "send_project_tracking", "contacts", "find_one"),
    ("server.py", "send_project_tracking", "projects", "update_one"),
    ("server.py", "send_quote_approval", "contacts", "find_one"),
    ("server.py", "send_quote_approval", "quotes", "update_one"),
)
_KEPT = (
    ("server.py", "public_project", "projects", "find_one"),
    ("server.py", "public_project_quote", "projects", "find_one"),
    ("server.py", "public_project_statement_pdf", "projects", "find_one"),
    ("server.py", "public_quote", "quotes", "find_one"),
    ("server.py", "public_quote_respond", "quotes", "find_one"),
)
_NOTES = (
    "# tenant-ok değil: oturumsuz müşteri onay sayfası; teklif yalnız approval.token (uuid4 hex) ile bulunur, şirket token'dan çıkar. Sonraki tüm sorgular q['company_id'] ile daraltılır.",
    "# tenant-ok değil: oturumsuz müşteri kabul/ret yanıtı; teklif yalnız approval.token (uuid4 hex) ile bulunur, token kanıttır. Sonraki tüm sorgular q['company_id'] ile daraltılır.",
    "# tenant-ok değil: oturumsuz proje takip sayfası; tracking.token (≥16 karakter) ile bulunur, şirket p['company_id']'den çözülür.",
    "# tenant-ok değil: oturumsuz proje takip sayfası; tracking.token (≥16 karakter) ile bulunur, şirket p['company_id']'den çözülür. Proje token'ı şart, teklif kalemleri p['company_id'] ile daraltılır.",
    "# tenant-ok değil: oturumsuz proje takip sayfası; tracking.token (≥16 karakter) ile bulunur, şirket p['company_id']'den çözülür. Ekstre _project_statement içinde p['company_id'] ile daraltılır.",
)
_B_MARKERS = (
    "CariB",
    "TeklifB",
    "ProjeB",
    "AdresB",
    "AdimB",
    "IstasyonB",
    "FTRB7771",
    "FirmaB",
    "OdemeB",
    "KalemB",
    "9999",
    "7777",
)
_SCOPED = ("production_orders", "recipes", "work_orders")


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


class _Req:
    def __init__(self):
        self.client = SimpleNamespace(host="198.51.100.10")
        self.headers = {"user-agent": "wave11"}
        self.method = "POST"
        self.url = SimpleNamespace(path="/api/public")
        self.query_params = {}


class _Coll(MemColl):
    def find(self, query=None, projection=None):
        self.db.calls.append((self.name, "find"))
        return super().find(query, projection)

    async def find_one(self, query=None, projection=None, sort=None):
        self.db.calls.append((self.name, "find_one"))
        return await super().find_one(query, projection, sort)

    async def find_one_and_update(self, query, update, upsert=False, return_document=True):
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                before = copy.deepcopy(doc)
                self.docs[index] = apply_update(doc, update, query)
                return copy.deepcopy(self.docs[index] if return_document else before)
        if not upsert:
            return None
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return copy.deepcopy(created)


class _DB(MemDB):
    def __init__(self):
        super().__init__()
        self.calls = []

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


def _doc(db, coll, doc_id, company_id):
    for row in db[coll].docs:
        if row.get("_id") == doc_id and row.get("company_id") == company_id:
            return row
    return None


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


def _forbid(value):
    if hasattr(value, "body"):
        raw = value.body
        text = raw.decode("latin-1", "ignore") if isinstance(raw, (bytes, bytearray)) else str(raw)
    else:
        text = json.dumps(value, ensure_ascii=False, default=str)
    for marker in _B_MARKERS:
        assert marker not in text


def _bind():
    db = _DB()
    prev = server.db
    server.db = db
    return db, prev


def _restore(prev):
    server.db = prev


def _companies(db):
    _add(db, "companies", {"_id": CO_B, "name": "FirmaB", "phone": "555", "email": "b@firma.test"})
    _add(db, "companies", {"_id": CO_A, "name": "FirmaA", "phone": "444", "email": "a@firma.test"})


def _quote(company_id, **extra):
    doc = {
        "_id": QUOTE,
        "company_id": company_id,
        "contact_id": CONTACT,
        "contact_name": "CariB" if company_id == CO_B else "CariA",
        "quote_number": "TKFB" if company_id == CO_B else "TKFA",
        "title": "TeklifB" if company_id == CO_B else "TeklifA",
        "items": [{
            "name": "KalemB" if company_id == CO_B else "KalemA",
            "quantity": 1,
            "unit": "Adet",
            "unit_price": 9999 if company_id == CO_B else 100,
            "vat_rate": 20,
        }],
        "grand_total": 9999 if company_id == CO_B else 100,
        "status": "draft",
        "approval": {"token": TOKEN_B if company_id == CO_B else TOKEN_A, "status": "pending", "view_count": 0, "sent_count": 0},
        "created_at": "2026-01-02T00:00:00+00:00" if company_id == CO_B else "2026-01-01T00:00:00+00:00",
    }
    doc.update(extra)
    return doc


def _project(company_id, **extra):
    doc = {
        "_id": PROJ,
        "company_id": company_id,
        "name": "ProjeB" if company_id == CO_B else "ProjeA",
        "project_number": "PRJB" if company_id == CO_B else "PRJA",
        "contact_id": CONTACT,
        "contact_name": "CariB" if company_id == CO_B else "CariA",
        "status": "planning",
        "budget": 9999 if company_id == CO_B else 100,
        "tracking": {"token": TOKEN_B if company_id == CO_B else TOKEN_A, "view_count": 0, "sent_count": 0},
        "created_at": "2026-01-02T00:00:00+00:00" if company_id == CO_B else "2026-01-01T00:00:00+00:00",
    }
    doc.update(extra)
    return doc


def _contact(company_id):
    return {
        "_id": CONTACT,
        "company_id": company_id,
        "name": "CariB" if company_id == CO_B else "CariA",
        "phone": PHONE_B if company_id == CO_B else PHONE_A,
        "email": "b@cari.test" if company_id == CO_B else "a@cari.test",
        "balance": 9999 if company_id == CO_B else 10,
    }


def _stub_send(monkeypatch):
    box = {"sms": [], "mail": [], "wa": []}

    async def sms(company_id, recipients, message, context, ref_id):
        box["sms"].append({"recipients": recipients, "message": message, "context": context})
        return {"status": "sent", "sent": 1, "failed": 0, "simulated": False, "message": "ok"}

    async def account(company_id, user_id=None):
        return {"email": "from@firma.test"}

    async def mail(**kwargs):
        box["mail"].append(kwargs)
        return {"_id": "mail-1"}

    async def wa(req):
        box["wa"].append({"phone": req.get("phone")})
        return {"status": "simulated", "message_info": "ok", "wa_link": "https://wa.me/905550000001"}

    async def no_push(*_args, **_kwargs):
        return {"sent": 0}

    monkeypatch.setattr(server, "_send_sms_to", sms)
    monkeypatch.setattr(server, "_mail_account", account)
    monkeypatch.setattr(server, "_send_tracked_mail", mail)
    monkeypatch.setattr(server, "wa_send", wa)
    monkeypatch.setattr("notify.dispatch_push", no_push)
    return box


def test_send_quote_approval_stays_in_company(monkeypatch):
    box = _stub_send(monkeypatch)
    db, prev = _bind()
    try:
        _companies(db)
        _add(db, "contacts", _contact(CO_B))
        _add(db, "contacts", _contact(CO_A))
        _add(db, "quotes", _quote(CO_A))
        _add(db, "quotes", _quote(CO_B, approval={"token": TOKEN_B, "status": "pending", "view_count": 0, "sent_count": 4}))
        before = _digest(db, CO_B)
        out = _run(server.send_quote_approval(QUOTE, {"channels": ["sms"]}, _Req(), _user(CO_A)))
        _forbid(out)
        assert "/teklif/" in out["link"]
        assert out["link"].endswith(TOKEN_A)
        assert out["status"] == "success"
        assert box["sms"][0]["recipients"][0]["phone"] == PHONE_A
        assert _doc(db, "quotes", QUOTE, CO_A)["status"] == "sent"
        assert _doc(db, "quotes", QUOTE, CO_B)["approval"]["sent_count"] == 4
        assert _doc(db, "contacts", CONTACT, CO_B)["phone"] == PHONE_B
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_convert_updates_own_project_only():
    db, prev = _bind()
    try:
        _add(db, "quotes", _quote(CO_A, project_id=PROJ, grand_total=120, title="TeklifA"))
        _add(db, "quotes", _quote(CO_B, project_id=PROJ))
        _add(db, "projects", _project(CO_B))
        _add(db, "projects", _project(CO_A))
        before = _digest(db, CO_B)
        out = _run(server.convert_quote_to_project(QUOTE, _user(CO_A)))
        _forbid(out)
        assert out["updated"] is True
        assert out["project"]["name"] == "TeklifA"
        assert out["project"]["project_number"] == "PRJA"
        assert _doc(db, "projects", PROJ, CO_A)["name"] == "TeklifA"
        assert _doc(db, "projects", PROJ, CO_B)["name"] == "ProjeB"
        assert _doc(db, "projects", PROJ, CO_B)["budget"] == 9999
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_convert_creates_project_without_other_survey():
    db, prev = _bind()
    try:
        _add(db, "quotes", _quote(CO_A, survey_id=SURVEY, project_id=None))
        _add(db, "quotes", _quote(CO_B, survey_id=SURVEY))
        _add(db, "surveys", {
            "_id": SURVEY, "company_id": CO_B, "address": "AdresB", "survey_number": "KSFB", "project_id": None,
        })
        _add(db, "surveys", {
            "_id": SURVEY, "company_id": CO_A, "address": "AdresA", "survey_number": "KSFA", "project_id": None,
        })
        before = _digest(db, CO_B)
        out = _run(server.convert_quote_to_project(QUOTE, _user(CO_A)))
        _forbid(out)
        assert out["status"] == "success"
        assert out["project"]["address"] == "AdresA"
        assert _doc(db, "quotes", QUOTE, CO_A)["status"] == "accepted"
        assert _doc(db, "quotes", QUOTE, CO_B)["status"] == "draft"
        assert _doc(db, "surveys", SURVEY, CO_B)["project_id"] is None
        assert _doc(db, "surveys", SURVEY, CO_A)["project_id"] == out["project"]["id"]
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_list_projects_light_and_full_ignore_other_company():
    db, prev = _bind()
    try:
        _add(db, "projects", _project(CO_B, status="completed"))
        _add(db, "projects", _project(CO_A, status="completed"))
        _add(db, "quotes", _quote(CO_B, project_id=PROJ, grand_total=9999, invoice_id="inv-b"))
        _add(db, "quotes", _quote(CO_A, project_id=PROJ, grand_total=100, invoice_id=None))
        _add(db, "expenses", {"_id": "exp-b", "company_id": CO_B, "project_id": PROJ, "total": 7777, "description": "MasrafB"})
        _add(db, "expenses", {"_id": "exp-a", "company_id": CO_A, "project_id": PROJ, "total": 10, "description": "MasrafA"})
        _add(db, "invoices", {
            "_id": "inv-b", "company_id": CO_B, "project_id": PROJ, "invoice_type": "purchase",
            "invoice_number": "FTRB7771", "grand_total": 9999, "status": "approved",
        })
        _add(db, "invoices", {
            "_id": "inv-a", "company_id": CO_A, "project_id": PROJ, "invoice_type": "sales",
            "invoice_number": "FTRA", "grand_total": 40, "status": "approved",
        })
        before = _digest(db, CO_B)
        user = _user(CO_A)
        light = _run(server.list_projects(light=True, user=user))
        full = _run(server.list_projects(light=False, user=user))
        _forbid(light)
        _forbid(full)
        assert len(light) == 1 and light[0]["name"] == "ProjeA"
        assert light[0]["quoted_total"] == 100
        assert light[0]["expense_total"] == 10
        assert light[0]["purchase_invoice_total"] == 0
        assert len(full) == 1
        assert full[0]["quoted_total"] == 100
        assert full[0]["expense_total"] == 10
        assert full[0]["purchase_invoice_total"] == 0
        assert full[0]["invoiced_total"] == 40
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_invoice_project_does_not_use_other_invoice_or_quotes():
    db, prev = _bind()
    try:
        _companies(db)
        _add(db, "contacts", _contact(CO_B))
        _add(db, "contacts", _contact(CO_A))
        _add(db, "projects", _project(CO_A, status="completed", invoice_id=INV, budget=0))
        _add(db, "projects", _project(CO_B, status="completed", invoice_id=INV, budget=9999))
        _add(db, "invoices", {
            "_id": INV, "company_id": CO_B, "invoice_number": "FTRB7771", "grand_total": 9999,
            "contact_name": "CariB", "status": "draft",
        })
        _add(db, "invoices", {
            "_id": INV, "company_id": CO_A, "invoice_number": "FTRA", "grand_total": 40,
            "contact_name": "CariA", "status": "draft",
        })
        before = _digest(db, CO_B)
        exists = _run(server.invoice_project(PROJ, {}, _user(CO_A)))
        _forbid(exists)
        assert exists["status"] == "exists"
        assert exists["invoice"]["invoice_number"] == "FTRA"
        assert _digest(db, CO_B) == before

        _doc(db, "projects", PROJ, CO_A)["invoice_id"] = None
        _add(db, "quotes", _quote(CO_B, project_id=PROJ, status="sent"))
        _add(db, "quotes", _quote(CO_A, project_id=PROJ, status="sent", grand_total=100))
        before = _digest(db, CO_B)
        created = _run(server.invoice_project(PROJ, {}, _user(CO_A)))
        _forbid(created)
        assert created["status"] == "success"
        names = [item["name"] for item in created["invoice"]["items"]]
        assert names == ["KalemA"]
        assert _doc(db, "quotes", QUOTE, CO_A)["status"] == "accepted"
        assert _doc(db, "quotes", QUOTE, CO_B)["status"] == "sent"
        assert _doc(db, "projects", PROJ, CO_B).get("invoice_id") == INV
        assert _doc(db, "invoices", INV, CO_B)["invoice_number"] == "FTRB7771"
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_send_project_tracking_uses_own_contact(monkeypatch):
    box = _stub_send(monkeypatch)
    db, prev = _bind()
    try:
        _companies(db)
        _add(db, "contacts", _contact(CO_B))
        _add(db, "contacts", _contact(CO_A))
        _add(db, "projects", _project(CO_A))
        _add(db, "projects", _project(CO_B, tracking={"token": TOKEN_B, "view_count": 0, "sent_count": 3}))
        before = _digest(db, CO_B)
        out = _run(server.send_project_tracking(PROJ, {"channels": ["sms"]}, _Req(), _user(CO_A)))
        _forbid(out)
        assert out["status"] == "success"
        assert out["token"] == TOKEN_A
        assert "/proje/" in out["link"]
        assert box["sms"][0]["recipients"][0]["phone"] == PHONE_A
        assert _doc(db, "projects", PROJ, CO_A)["tracking"]["sent_count"] == 1
        assert _doc(db, "projects", PROJ, CO_B)["tracking"]["sent_count"] == 3
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_production_fields_closed_and_foreign_steps_empty():
    """company_id yoksa sorgu yok. Başka şirketin üretim emri adım döndürmez."""
    db, prev = _bind()
    try:
        _add(db, "production_orders", {
            "_id": PO, "company_id": CO_B, "order_code": "URTB", "recipe_id": RECIPE,
            "finished_product_name": "UrunB", "status": "open",
        })
        _add(db, "work_orders", {
            "_id": "wo-b", "company_id": CO_B, "order_id": PO, "step_no": 1, "step_name": "AdimB", "station": "IstasyonB",
        })
        _add(db, "recipes", {"_id": RECIPE, "company_id": CO_B, "name": "ReceteB", "steps": [{"name": "AdimB", "station": "IstasyonB"}]})
        db.calls.clear()
        closed = _run(server._project_production_order_fields({"production_order_id": PO, "show_production_steps": True}, None))
        assert closed["production_order_id"] is None
        assert closed["production_order_code"] is None
        assert closed["recipe_name"] is None
        assert closed["production_steps"] == []
        assert closed["show_production_steps"] is True
        assert not [call for call in db.calls if call[0] in _SCOPED]

        blank = _run(server._project_production_order_fields({"production_order_id": PO}, CO_A))
        assert blank["production_steps"] == []
        assert blank["production_order_id"] is None
        assert blank["recipe_name"] is None
        _forbid(blank)

        _add(db, "production_orders", {
            "_id": PO, "company_id": CO_A, "order_code": "URTA", "recipe_id": RECIPE,
            "finished_product_name": "UrunA", "status": "open",
        })
        _add(db, "recipes", {"_id": RECIPE, "company_id": CO_A, "name": "ReceteA", "steps": [{"name": "AdimA", "station": "IstasyonA"}]})
        own = _run(server._project_production_order_fields({"production_order_id": PO}, CO_A))
        assert [step["name"] for step in own["production_steps"]] == ["AdimA"]
        _forbid(own)

        _add(db, "work_orders", {
            "_id": "wo-a", "company_id": CO_A, "order_id": PO, "step_no": 1, "step_name": "AdimAis", "station": "IstasyonA",
        })
        stepped = _run(server._project_production_order_fields({"production_order_id": PO}, CO_A))
        assert [step["name"] for step in stepped["production_steps"]] == ["AdimAis"]
        _forbid(stepped)
        assert _doc(db, "work_orders", "wo-b", CO_B)["step_name"] == "AdimB"
    finally:
        _restore(prev)


def test_project_statement_scopes_contact_and_skips_without_company():
    db, prev = _bind()
    try:
        _add(db, "contacts", _contact(CO_B))
        _add(db, "contacts", _contact(CO_A))
        _add(db, "invoices", {
            "_id": "stb", "company_id": CO_B, "contact_id": CONTACT, "invoice_type": "sales",
            "invoice_number": "FTRB7771", "grand_total": 9999, "status": "approved", "issue_date": "2026-02-01",
        })
        _add(db, "invoices", {
            "_id": "sta", "company_id": CO_A, "contact_id": CONTACT, "invoice_type": "sales",
            "invoice_number": "FTRA", "grand_total": 40, "status": "approved", "issue_date": "2026-02-02",
        })
        _add(db, "bank_transactions", {
            "_id": "pay-b", "company_id": CO_B, "contact_id": CONTACT, "type": "inflow",
            "amount": 9999, "description": "OdemeB", "date": "2026-02-03",
        })
        _add(db, "bank_transactions", {
            "_id": "pay-a", "company_id": CO_A, "contact_id": CONTACT, "type": "inflow",
            "amount": 15, "description": "OdemeA", "date": "2026-02-04",
        })
        db.calls.clear()
        missing = _run(server._project_statement({"contact_id": CONTACT, "contact_name": "CariA"}, {"name": "FirmaA"}))
        assert missing is None
        assert not [call for call in db.calls if call[0] in ("contacts", "invoices", "bank_transactions")]

        view = _run(server._project_statement(_project(CO_A), {"name": "FirmaA"}))
        _forbid(view)
        assert view["contact"]["name"] == "CariA"
        docs = " ".join(row["doc"] for row in view["rows"])
        assert "FTRA" in docs
        assert "OdemeA" in docs
        assert view["balance"] != 9999
    finally:
        _restore(prev)


def test_public_quote_and_respond_do_not_touch_other_row(monkeypatch):
    _stub_send(monkeypatch)
    db, prev = _bind()
    try:
        _companies(db)
        _add(db, "quotes", _quote(CO_B, approval={"token": TOKEN_B, "status": "pending", "view_count": 0, "sent_count": 0}))
        _add(db, "quotes", _quote(CO_A))
        before = _digest(db, CO_B)
        viewed = _run(server.public_quote(TOKEN_A))
        _forbid(viewed)
        assert viewed["title"] == "TeklifA"
        assert viewed["company"]["name"] == "FirmaA"
        assert _doc(db, "quotes", QUOTE, CO_A)["approval"]["view_count"] == 1
        assert _doc(db, "quotes", QUOTE, CO_B)["approval"]["view_count"] == 0

        answered = _run(server.public_quote_respond(TOKEN_A, {"decision": "accepted", "name": "Ali"}, _Req()))
        _forbid(answered)
        assert answered["status"] == "success"
        assert answered["quote"]["title"] == "TeklifA"
        assert _doc(db, "quotes", QUOTE, CO_A)["status"] == "accepted"
        assert _doc(db, "quotes", QUOTE, CO_B)["status"] == "draft"
        assert _digest(db, CO_B) == before

        bare = _quote(CO_A, approval={"token": "e" * 32, "view_count": 0})
        bare.pop("company_id")
        _add(db, "quotes", bare)
        with pytest.raises(HTTPException) as exc:
            _run(server.public_quote("e" * 32))
        assert exc.value.status_code == 404
        assert exc.value.detail == "Teklif bulunamadı veya link geçersiz."
        assert bare_row(db)["approval"]["view_count"] == 0
    finally:
        _restore(prev)


def bare_row(db):
    for row in db.quotes.docs:
        if (row.get("approval") or {}).get("token") == "e" * 32:
            return row
    raise AssertionError("bare")


def test_public_project_hides_other_work_and_bumps_own_view():
    db, prev = _bind()
    try:
        _companies(db)
        _add(db, "projects", _project(
            CO_B, show_production_steps=True, production_order_id=PO,
            production_steps=[{"no": 1, "name": "AdimB", "station": "IstasyonB"}],
        ))
        _add(db, "projects", _project(
            CO_A, show_production_steps=True, production_order_id=PO,
            production_steps=[{"no": 1, "name": "AdimA", "station": "IstasyonA"}],
        ))
        _add(db, "quotes", _quote(CO_B, project_id=PROJ, quote_number="TKF1"))
        _add(db, "quotes", _quote(CO_A, project_id=PROJ, quote_number="TKF1"))
        _add(db, "surveys", {"_id": SURVEY, "company_id": CO_B, "project_id": PROJ, "address": "AdresB", "survey_number": "KSFB", "status": "done", "created_at": "2026-01-02"})
        _add(db, "surveys", {"_id": SURVEY, "company_id": CO_A, "project_id": PROJ, "address": "AdresA", "survey_number": "KSFA", "status": "done", "created_at": "2026-01-01"})
        _add(db, "work_orders", {
            "_id": "wo-b", "company_id": CO_B, "order_id": PO, "step_no": 1, "station": "IstasyonB",
            "status": "done", "finished_at": "2020-01-02T03:04:05+00:00",
        })
        _add(db, "work_orders", {
            "_id": "wo-a", "company_id": CO_A, "order_id": PO, "step_no": 1, "station": "IstasyonA",
            "status": "waiting",
        })
        _add(db, "contacts", _contact(CO_B))
        _add(db, "contacts", _contact(CO_A))
        _add(db, "invoices", {
            "_id": "stb", "company_id": CO_B, "contact_id": CONTACT, "invoice_type": "sales",
            "invoice_number": "FTRB7771", "grand_total": 9999, "status": "approved", "issue_date": "2026-02-01",
        })
        _add(db, "invoices", {
            "_id": "sta", "company_id": CO_A, "contact_id": CONTACT, "invoice_type": "sales",
            "invoice_number": "FTRA", "grand_total": 40, "status": "approved", "issue_date": "2026-02-02",
        })
        before = _digest(db, CO_B)
        view = _run(server.public_project(TOKEN_A))
        _forbid(view)
        assert view["name"] == "ProjeA"
        assert view["company"]["name"] == "FirmaA"
        assert [row["title"] for row in view["quotes"]] == ["TeklifA"]
        assert [row["address"] for row in view["surveys"]] == ["AdresA"]
        assert [step["station"] for step in view["production_steps"]] == ["IstasyonA"]
        assert view["production_steps"][0]["status"] == "waiting"
        assert "02.01.2020" not in json.dumps(view)
        assert view["statement"]["balance"] != 9999
        assert _doc(db, "projects", PROJ, CO_A)["tracking"]["view_count"] == 1
        assert _doc(db, "projects", PROJ, CO_B)["tracking"]["view_count"] == 0

        detail = _run(server.public_project_quote(TOKEN_A, "TKF1"))
        _forbid(detail)
        assert detail["title"] == "TeklifA"
        assert detail["company"]["name"] == "FirmaA"

        pdf = _run(server.public_project_statement_pdf(TOKEN_A))
        assert pdf.body.startswith(b"%PDF")
        _forbid(pdf)
        assert _digest(db, CO_B) == before
    finally:
        _restore(prev)


def test_wave11_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 29
    assert len(set(_REMOVED)) == 29
    for key in _KEPT:
        assert key in base
        assert base[key] == 1
    text = Path(server.__file__).read_text(encoding="utf-8")
    for note in _NOTES:
        assert note in text
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
