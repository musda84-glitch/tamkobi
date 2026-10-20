"""issue_invoice kiracı dalgası 7.

Bellek içi MemDB. Canlı veritabanına, 8021 portuna ve entegratör ağına bağlanmaz.
Değer, filtre, şirket kimliği, VKN veya belge içeriği loglanmaz.
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
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import e_invoice  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
INV = "inv-shared"
CONTACT = "contact-shared"
ORDER = "order-shared"

_REMOVED = (
    ("e_invoice.py", "issue_invoice", "contacts", "find_one"),
    ("e_invoice.py", "issue_invoice", "contacts", "update_one"),
    ("e_invoice.py", "issue_invoice", "invoices", "find_one"),
    ("e_invoice.py", "issue_invoice", "invoices", "update_one"),
)

_KEPT = (
    ("e_invoice.py", "_require_einvoice_access", "invoices", "find_one"),
    ("e_invoice.py", "migrate_mislabelled_paper_invoices", "invoices", "find"),
    ("e_invoice.py", "migrate_mislabelled_paper_invoices", "invoices", "update_one"),
    ("e_invoice.py", "refresh_outbound_statuses", "invoices", "find"),
)


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
        from tenant_scope import check

        check(self.name, "delete_one", query=query)
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                del self.docs[index]
                return SimpleNamespace(deleted_count=1)
        return SimpleNamespace(deleted_count=0)

    async def update_one(self, query, update, upsert=False):
        from tenant_scope import check

        check(self.name, "update_one", query=query, update=update, upsert=upsert)
        query = _split_field_ops(query or {})
        for index, doc in enumerate(self.docs):
            if match_query(doc, query):
                self.docs[index] = apply_update(doc, update, query)
                return SimpleNamespace(modified_count=1, matched_count=1, upserted_id=None)
        if not upsert:
            return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=None)
        created = new_upsert_doc(update, query)
        self.docs.append(created)
        return SimpleNamespace(modified_count=0, matched_count=0, upserted_id=created.get("_id"))


class _DB(MemDB):
    def __getattr__(self, name):
        if name.startswith("_"):
            raise AttributeError(name)
        coll = self._cols.get(name)
        if coll is None:
            coll = _Coll(name, self)
            self._cols[name] = coll
        return coll


class _Boom:
    def __getattr__(self, name):
        raise AssertionError("db")

    def __getitem__(self, name):
        raise AssertionError("db")


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


def _bind(db, deps=None):
    prev = (e_invoice._db, dict(e_invoice._deps))
    e_invoice.init(db, deps or {"password_fn": lambda _settings: "x"})
    return prev


def _unbind(prev):
    e_invoice._db = prev[0]
    e_invoice._deps.clear()
    e_invoice._deps.update(prev[1])


def _block_network(monkeypatch):
    async def _no(*_args, **_kwargs):
        raise AssertionError("network")

    for mod in (e_invoice.isnet, e_invoice.isnet_portal, e_invoice.qnb_efinans, e_invoice.n11faturam):
        for name in ("send_document", "lookup_user", "get_company_balance"):
            if hasattr(mod, name):
                monkeypatch.setattr(mod, name, _no)


def _invoice(company_id, mark, **extra):
    doc = {
        "_id": INV,
        "company_id": company_id,
        "invoice_type": "sales",
        "e_type": "paper",
        "status": "approved",
        "contact_id": CONTACT,
        "contact_name": "Cari " + mark,
        "contact_tax_id": "1234567890",
        "contact_tax_office": "Kadikoy" if mark == "A" else "Tuzla",
        "invoice_number": "SF-" + mark,
        "items": [{"name": "Kalem " + mark, "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 12}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
        "mark": mark,
    }
    doc.update(extra)
    return doc


def _contact(company_id, mark, **extra):
    doc = {
        "_id": CONTACT,
        "company_id": company_id,
        "name": "Cari " + mark,
        "type": "customer",
        "tax_number_or_id": "" if mark == "A" else "6320984412",
        "tax_office": "" if mark == "A" else "Tuzla",
        "balance": 3 if mark == "A" else 900,
        "is_e_invoice_user": False,
    }
    doc.update(extra)
    return doc


def _seed_pair(db, *, invoice_a=True):
    _add(db, "invoices", _invoice(CO_B, "B"))
    _add(db, "contacts", _contact(CO_B, "B"))
    if invoice_a:
        _add(db, "invoices", _invoice(CO_A, "A", contact_tax_id="1234567890"))
    _add(db, "contacts", _contact(CO_A, "A"))


def test_issue_invoice_requires_company_id():
    with pytest.raises(TypeError):
        _run(e_invoice.issue_invoice(INV, e_type="paper"))


def test_blank_company_does_not_touch_db():
    prev = _bind(_Boom())
    try:
        for value in ("", None, "   "):
            with pytest.raises(HTTPException) as exc:
                _run(e_invoice.issue_invoice(INV, company_id=value, e_type="paper"))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Fatura bulunamadı."
    finally:
        _unbind(prev)


def test_shared_id_issues_own_company_and_rejects_other(monkeypatch):
    _block_network(monkeypatch)
    db = _DB()
    _seed_pair(db)
    before = _digest(db, CO_B)
    prev = _bind(db)
    try:
        out = _run(e_invoice.issue_invoice(INV, company_id=CO_A, e_type="paper"))
    finally:
        _unbind(prev)
    assert out["einvoice_state"] == "paper"
    assert out["message"] == "Kağıt fatura olarak kesildi."
    assert out["invoice_id"] == INV
    own = _doc(db, "invoices", INV, CO_A)
    assert own["gib_status"] == "Kağıt Fatura (Matbu)"
    assert own["status"] == "approved"
    assert own["invoice_number"] == "SF-A"
    assert own["company_id"] == CO_A
    assert _doc(db, "contacts", CONTACT, CO_A)["tax_number_or_id"] == "1234567890"
    assert _doc(db, "contacts", CONTACT, CO_A)["tax_office"] == "Kadikoy"
    assert _doc(db, "contacts", CONTACT, CO_A)["balance"] == 3
    assert _doc(db, "invoices", INV, CO_B)["invoice_number"] == "SF-B"
    assert _doc(db, "invoices", INV, CO_B)["mark"] == "B"
    assert _doc(db, "contacts", CONTACT, CO_B)["tax_number_or_id"] == "6320984412"
    assert _doc(db, "contacts", CONTACT, CO_B)["balance"] == 900
    assert _digest(db, CO_B) == before

    db.invoices.docs = [
        row for row in db.invoices.docs
        if not (row.get("_id") == INV and row.get("company_id") == CO_A)
    ]
    before_miss = _digest(db, CO_B)
    prev = _bind(db)
    try:
        with pytest.raises(HTTPException) as missing:
            _run(e_invoice.issue_invoice(INV, company_id=CO_A, e_type="paper"))
    finally:
        _unbind(prev)
    assert missing.value.status_code == 404
    assert missing.value.detail == "Fatura bulunamadı."
    assert _doc(db, "invoices", INV, CO_B)["mark"] == "B"
    assert _digest(db, CO_B) == before_miss


def test_blank_company_on_seeded_db_writes_nothing(monkeypatch):
    _block_network(monkeypatch)
    db = _DB()
    _seed_pair(db)
    before_a = _digest(db, CO_A)
    before_b = _digest(db, CO_B)
    prev = _bind(db)
    try:
        for value in ("", None):
            with pytest.raises(HTTPException) as exc:
                _run(e_invoice.issue_invoice(INV, company_id=value, e_type="e_invoice"))
            assert exc.value.status_code == 404
            assert exc.value.detail == "Fatura bulunamadı."
    finally:
        _unbind(prev)
    assert _digest(db, CO_A) == before_a
    assert _digest(db, CO_B) == before_b


def test_contact_flag_update_stays_in_company(monkeypatch):
    _block_network(monkeypatch)
    db = _DB()
    _add(db, "contacts", _contact(CO_B, "B", tax_number_or_id="1234567890", is_e_invoice_user=False, e_invoice_alias="pk-b"))
    _add(db, "contacts", _contact(CO_A, "A", tax_number_or_id="1234567890", tax_office="Kadikoy", is_e_invoice_user=False))
    _add(db, "invoices", _invoice(CO_B, "B", e_type="e_archive", contact_tax_id="1234567890"))
    _add(db, "invoices", _invoice(CO_A, "A", e_type="auto", contact_tax_id="1234567890", contact_tax_office="Kadikoy"))
    before = _digest(db, CO_B)

    async def _lookup(_company_id, _tax, **_kwargs):
        return {
            "suggested_e_type": "e_archive",
            "is_e_invoice_user": True,
            "alias": "pk-a",
            "lookup_status": "mukellef",
        }

    monkeypatch.setattr(e_invoice, "resolve_buyer_mukellef", _lookup)
    monkeypatch.setattr(e_invoice, "build_and_store_xml", AsyncMock(return_value=b"<Invoice/>"))
    prev = _bind(db, {"consume_credits": AsyncMock(return_value=4), "password_fn": lambda _settings: "x"})
    try:
        out = _run(e_invoice.issue_invoice(INV, company_id=CO_A, e_type="auto"))
    finally:
        _unbind(prev)
    assert out["e_type"] == "e_archive"
    assert out["einvoice_state"] == "sent"
    assert out["invoice_id"] == INV
    own = _doc(db, "contacts", CONTACT, CO_A)
    assert own["is_e_invoice_user"] is True
    assert own["e_invoice_alias"] == "pk-a"
    assert own["balance"] == 3
    other = _doc(db, "contacts", CONTACT, CO_B)
    assert other["is_e_invoice_user"] is False
    assert other["e_invoice_alias"] == "pk-b"
    assert other["balance"] == 900
    assert _doc(db, "invoices", INV, CO_B)["invoice_number"] == "SF-B"
    assert _doc(db, "invoices", INV, CO_B)["mark"] == "B"
    assert _digest(db, CO_B) == before


def test_create_paths_pass_loaded_company_id(monkeypatch):
    _block_network(monkeypatch)
    db = _DB()
    _seed_pair(db)
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_A,
        "invoice_id": INV,
        "order_number": "SP-A",
        "is_invoiced": False,
    })
    _add(db, "orders", {
        "_id": ORDER,
        "company_id": CO_B,
        "invoice_id": INV,
        "order_number": "SP-B",
        "is_invoiced": False,
    })
    before = _digest(db, CO_B)
    deps = {"convert_order": AsyncMock(), "password_fn": lambda _settings: "x"}
    prev = _bind(db, deps)
    try:
        out = _run(e_invoice.create_from_order(
            ORDER,
            {"e_type": "paper", "company_id": ""},
            _user(CO_A),
        ))
    finally:
        _unbind(prev)
    assert out["einvoice_state"] == "paper"
    assert out["company_id"] == CO_A
    assert _doc(db, "invoices", INV, CO_A)["gib_status"] == "Kağıt Fatura (Matbu)"
    assert _doc(db, "orders", ORDER, CO_B)["is_invoiced"] is False
    assert _digest(db, CO_B) == before

    gone = _DB()
    _add(gone, "orders", {"_id": ORDER, "company_id": CO_A, "invoice_id": INV})
    _add(gone, "invoices", _invoice(CO_B, "B"))
    _add(gone, "contacts", _contact(CO_B, "B"))
    before_gone = _digest(gone, CO_B)
    prev = _bind(gone, deps)
    try:
        with pytest.raises(HTTPException) as missing:
            _run(e_invoice.create_from_order(ORDER, {"e_type": "paper"}, _user(CO_A)))
    finally:
        _unbind(prev)
    assert missing.value.status_code == 404
    assert missing.value.detail == "Fatura bulunamadı."
    assert _digest(gone, CO_B) == before_gone

    fresh = _DB()
    _add(fresh, "invoices", _invoice(CO_A, "A"))
    _add(fresh, "invoices", _invoice(CO_B, "B"))
    _add(fresh, "contacts", _contact(CO_A, "A"))
    _add(fresh, "contacts", _contact(CO_B, "B"))
    before_b = _digest(fresh, CO_B)
    prev = _bind(fresh)
    try:
        with pytest.raises(HTTPException) as forbidden:
            _run(e_invoice.api_create_einvoice(
                e_invoice.InvoiceCreateRequest(invoice_id=INV, company_id=CO_B, e_type="paper"),
                _user(CO_A),
            ))
        issued = _run(e_invoice.api_create_einvoice(
            e_invoice.InvoiceCreateRequest(invoice_id=INV, e_type="paper"),
            _user(CO_A),
        ))
    finally:
        _unbind(prev)
    assert forbidden.value.status_code == 403
    assert issued["einvoice_state"] == "paper"
    assert issued["company_id"] == CO_A
    assert _doc(fresh, "invoices", INV, CO_A)["gib_status"] == "Kağıt Fatura (Matbu)"
    assert _doc(fresh, "invoices", INV, CO_B)["invoice_number"] == "SF-B"
    assert _doc(fresh, "invoices", INV, CO_B)["mark"] == "B"
    assert _digest(fresh, CO_B) == before_b


def test_send_to_gib_and_dispatch_pass_document_company():
    import server

    inv = {
        "_id": INV,
        "company_id": CO_A,
        "status": "approved",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "effects_applied": True,
    }
    seen = {}

    async def fake_issue(invoice_id, *, company_id, e_type=None, scenario=None, stamp_now=False, issue_date=None, issue_time=None):
        seen["invoice_id"] = invoice_id
        seen["company_id"] = company_id
        seen["e_type"] = e_type
        seen["scenario"] = scenario
        seen["stamp_now"] = stamp_now
        seen["issue_date"] = issue_date
        seen["issue_time"] = issue_time
        return {"status": "success", "invoice_id": invoice_id, "message": "ok"}

    with patch.object(server.tenant_access, "get_tenant_doc", AsyncMock(return_value=inv)), patch.object(
        server.e_invoice, "issue_invoice", fake_issue
    ):
        out = _run(server.send_invoice_to_gib(
            INV,
            {
                "company_id": CO_B,
                "e_type": "e_archive",
                "scenario": "TEMEL",
                "stamp_now": True,
                "issue_date": "2026-10-20",
                "issue_time": "09:15:00",
            },
            _user(CO_A),
        ))
    assert out["status"] == "success"
    assert seen["invoice_id"] == INV
    assert seen["company_id"] == CO_A
    assert seen["e_type"] == "e_archive"
    assert seen["scenario"] == "TEMEL"
    assert seen["stamp_now"] is True
    assert seen["issue_date"] == "2026-10-20"
    assert seen["issue_time"] == "09:15:00"

    db = _DB()
    _add(db, "einvoice_settings", {
        "_id": "set-a",
        "company_id": CO_A,
        "provider": "isnet",
        "status": "configured",
        "e_dispatch_enabled": True,
    })
    doc = {
        "_id": INV,
        "company_id": CO_A,
        "invoice_type": "dispatch",
        "e_type": "e_dispatch",
        "status": "draft",
        "despatch_defaults": {"plate": "34ABC123"},
    }
    dispatch_seen = {}

    async def fake_dispatch(invoice_id, *, company_id, e_type=None, **kwargs):
        dispatch_seen["invoice_id"] = invoice_id
        dispatch_seen["company_id"] = company_id
        dispatch_seen["e_type"] = e_type
        dispatch_seen["extra"] = kwargs
        return {"status": "success", "message": "ok"}

    previous = server.db
    server.db = db
    try:
        with patch.object(server.e_invoice, "issue_invoice", fake_dispatch):
            sent = _run(server._send_dispatch_to_isnet_if_configured(doc))
    finally:
        server.db = previous
    assert sent["sent"] is True
    assert dispatch_seen["invoice_id"] == INV
    assert dispatch_seen["company_id"] == CO_A
    assert dispatch_seen["e_type"] == "e_dispatch"
    assert dispatch_seen["extra"] == {}


def test_wave7_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 4
    assert all(key[0] == "e_invoice.py" and key[1] == "issue_invoice" for key in _REMOVED)
    for key in _KEPT:
        assert key in base
    assert ("e_invoice.py", "refresh_outbound_statuses", "invoices", "update_one") not in base
    script = _BACKEND / "scripts" / "tenant_scope_baseline.py"
    proc = subprocess.run(
        [sys.executable, str(script), "--check"],
        cwd=str(_BACKEND.parent),
        capture_output=True,
        text=True,
        timeout=60,
    )
    assert proc.returncode == 0, proc.stdout + proc.stderr
    assert "temiz" in proc.stdout
