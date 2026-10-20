"""E-fatura çekirdeği, irsaliye bağlama ve e-belge yedeği kiracı dalgası 5.

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

import pytest
from fastapi import HTTPException

_BACKEND = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND))
sys.path.insert(0, str(_BACKEND / "docker" / "stubs"))

import auth_utils  # noqa: E402
import dispatch_invoice  # noqa: E402
import e_invoice  # noqa: E402
import edoc_backup  # noqa: E402
import signed_links  # noqa: E402
import tenant_scope_allowlist as allowlist  # noqa: E402
from dashboard_memdb import MemColl, MemDB, _split_field_ops  # noqa: E402
from mysql_store import apply_update, match_query, new_upsert_doc  # noqa: E402

CO_A = "co_a"
CO_B = "co_b"
INV = "inv-shared"
DISP = "disp-shared"
ORDER = "order-shared"
ETTN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
_JWT = "wave5-einvoice-isolation-jwt-secret-32b"

_REMOVED = (
    ("dispatch_invoice.py", "_claim_dispatch", "invoices", "update_one"),
    ("dispatch_invoice.py", "_release_one", "invoices", "update_one"),
    ("dispatch_invoice.py", "find_existing_invoice_for_dispatch", "invoices", "find_one"),
    ("dispatch_invoice.py", "find_existing_invoice_for_dispatch", "orders", "find_one"),
    ("dispatch_invoice.py", "link_dispatch_to_invoice", "invoices", "find_one"),
    ("dispatch_invoice.py", "link_dispatch_to_invoice", "invoices", "update_one"),
    ("dispatch_invoice.py", "link_dispatch_to_invoice", "orders", "update_one"),
    ("dispatch_invoice.py", "load_ok", "invoices", "find_one"),
    ("dispatch_invoice.py", "merge_loaded_dispatches", "invoices", "delete_one"),
    ("dispatch_invoice.py", "merge_loaded_dispatches", "invoices", "find_one"),
    ("dispatch_invoice.py", "merge_loaded_dispatches", "invoices", "update_one"),
    ("dispatch_invoice.py", "merge_loaded_dispatches", "orders", "update_one"),
    ("dispatch_invoice.py", "release_invoice_dispatches", "invoices", "find_one"),
    ("e_invoice.py", "_refresh_qnb_status", "invoices", "find_one"),
    ("e_invoice.py", "_refresh_qnb_status", "invoices", "update_one"),
    ("e_invoice.py", "_remember_isnet_document", "invoices", "update_one"),
    ("e_invoice.py", "api_einvoice_status", "e_invoices", "find_one"),
    ("e_invoice.py", "api_einvoice_status", "invoices", "find_one"),
    ("e_invoice.py", "api_einvoice_status", "outgoing_einvoice_xml", "find_one"),
    ("e_invoice.py", "api_einvoice_xml", "outgoing_einvoice_xml", "find_one"),
    ("e_invoice.py", "apply_issue_stamp", "invoices", "find_one"),
    ("e_invoice.py", "apply_issue_stamp", "invoices", "update_one"),
    ("e_invoice.py", "fetch_integrator_pdf", "invoices", "find_one"),
    ("e_invoice.py", "fetch_integrator_xml", "invoices", "find_one"),
    ("e_invoice.py", "finalize_create_result", "invoices", "find_one"),
    ("e_invoice.py", "finalize_create_result", "orders", "update_one"),
    ("e_invoice.py", "record_e_invoice", "e_invoices", "find_one"),
    ("e_invoice.py", "record_e_invoice", "invoices", "find_one"),
    ("e_invoice.py", "refresh_one_invoice_status", "invoices", "find_one"),
    ("e_invoice.py", "refresh_one_invoice_status", "invoices", "update_one"),
    ("e_invoice.py", "resolve_gib_document_url", "invoices", "find_one"),
    ("e_invoice.py", "resolve_gib_document_url", "invoices", "update_one"),
    ("e_invoice.py", "store_outgoing_xml", "outgoing_einvoice_xml", "update_one"),
    ("edoc_backup.py", "_list_invoices", "invoices", "find"),
    ("edoc_backup.py", "_stored_xml", "outgoing_einvoice_xml", "find_one"),
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


class _Req:
    def __init__(self, token="", session=False):
        self.query_params = {"t": token} if token else {}
        self.headers = {"Authorization": "Bearer tok"} if session else {}
        self.cookies = {}


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


def _invoice(company_id, mark, **extra):
    doc = {
        "_id": INV,
        "company_id": company_id,
        "invoice_type": "sales",
        "e_type": "e_archive",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_uuid": ETTN,
        "gib_status": mark + "-status",
        "gib_invoice_id": "NO-" + mark,
        "invoice_number": "SF-" + mark,
        "issue_date": "2026-10-05",
        "order_id": ORDER,
        "integrator": "",
        "mark": mark,
    }
    doc.update(extra)
    return doc


def _dispatch(company_id, mark, **extra):
    doc = {
        "_id": DISP,
        "company_id": company_id,
        "invoice_type": "dispatch",
        "invoice_number": "IRS-" + mark,
        "status": "draft",
        "dispatch_status": "draft",
        "contact_id": "ct",
        "currency": "TRY",
        "items": [{"name": "Kalem-" + mark, "quantity": 1, "unit_price": 10, "total": 10}],
        "mark": mark,
    }
    doc.update(extra)
    return doc


def _order(company_id, mark, **extra):
    doc = {
        "_id": ORDER,
        "company_id": company_id,
        "invoice_id": None,
        "is_invoiced": False,
        "mark": mark,
    }
    doc.update(extra)
    return doc


def _seed_pair(db, *, invoices=True, dispatches=True, orders=True, xml=False, track=False, b_first=True):
    order = (CO_B, CO_A) if b_first else (CO_A, CO_B)
    for cid in order:
        mark = "B" if cid == CO_B else "A"
        if invoices:
            _add(db, "invoices", _invoice(cid, mark))
        if dispatches:
            _add(db, "invoices", _dispatch(cid, mark))
        if orders:
            _add(db, "orders", _order(cid, mark))
        if xml:
            _add(db, "outgoing_einvoice_xml", {
                "_id": INV,
                "company_id": cid,
                "xml": "<Invoice>" + mark + "-MARK</Invoice>",
                "scenario": mark,
                "byte_len": 8,
            })
        if track:
            _add(db, "e_invoices", {
                "_id": "einv_" + INV,
                "company_id": cid,
                "invoice_number": "SF-" + mark,
                "status": mark,
            })


def _bind_einvoice(db):
    prev = (e_invoice._db, dict(e_invoice._deps))
    e_invoice.init(db, {"password_fn": lambda _settings: "x"})
    return prev


def _unbind_einvoice(prev):
    e_invoice._db = prev[0]
    e_invoice._deps.clear()
    e_invoice._deps.update(prev[1])


def test_dispatch_same_id_stays_in_own_company():
    db = _DB()
    _seed_pair(db)
    before = _digest(db, CO_B)

    async def run():
        disp_a = _doc(db, "invoices", DISP, CO_A)
        disp_a["invoice_id"] = INV
        found = await dispatch_invoice.find_existing_invoice_for_dispatch(db, disp_a)
        linked_foreign = await dispatch_invoice.link_dispatch_to_invoice(
            db, _doc(db, "invoices", DISP, CO_A), _doc(db, "invoices", INV, CO_B),
        )
        linked = await dispatch_invoice.link_dispatch_to_invoice(
            db, _doc(db, "invoices", DISP, CO_A), _doc(db, "invoices", INV, CO_A),
        )
        return found, linked_foreign, linked

    found, linked_foreign, linked = _run(run())
    assert found["invoice_number"] == "SF-A"
    assert found["company_id"] == CO_A
    assert linked_foreign["company_id"] == CO_B
    assert linked_foreign.get("dispatch_id") is None
    assert linked["dispatch_id"] == DISP
    assert linked["company_id"] == CO_A
    assert _doc(db, "invoices", DISP, CO_A)["dispatch_status"] == "invoiced"
    assert _doc(db, "invoices", DISP, CO_B)["dispatch_status"] == "draft"
    assert _doc(db, "invoices", INV, CO_B).get("dispatch_id") is None
    assert _digest(db, CO_B) == before


def test_find_existing_uses_own_order_not_other_company():
    db = _DB()
    _seed_pair(db)
    for cid in (CO_A, CO_B):
        _doc(db, "invoices", INV, cid).pop("order_id", None)
    _doc(db, "orders", ORDER, CO_A)["invoice_id"] = INV
    _doc(db, "orders", ORDER, CO_B)["invoice_id"] = "inv-other"
    before = _digest(db, CO_B)
    disp = _doc(db, "invoices", DISP, CO_A)
    disp["order_id"] = ORDER
    found = _run(dispatch_invoice.find_existing_invoice_for_dispatch(db, disp))
    assert found["invoice_number"] == "SF-A"
    assert found["company_id"] == CO_A
    assert _digest(db, CO_B) == before


def test_merge_and_release_do_not_touch_other_company():
    db = _DB()
    _seed_pair(db, invoices=False)
    before = _digest(db, CO_B)

    disp_a = _doc(db, "invoices", DISP, CO_A)
    disp_a["order_id"] = ORDER

    async def create_invoice(spec):
        doc = {
            "_id": "sf-new",
            "company_id": spec["company_id"],
            "invoice_type": "sales",
            "invoice_number": "SF-NEW",
            "status": "draft",
            "items": spec["items"],
        }
        db.invoices.docs.append(doc)
        return {"id": "sf-new", "invoice_number": "SF-NEW"}

    async def run():
        fresh = await dispatch_invoice.merge_loaded_dispatches(
            db,
            [_doc(db, "invoices", DISP, CO_A)],
            company_id=CO_A,
            products={},
            create_invoice=create_invoice,
        )
        return fresh

    fresh = _run(run())
    assert fresh["company_id"] == CO_A
    assert fresh["dispatch_id"] == DISP
    assert _doc(db, "invoices", DISP, CO_A)["dispatch_status"] == "invoiced"
    assert _doc(db, "invoices", DISP, CO_B)["dispatch_status"] == "draft"
    assert _doc(db, "orders", ORDER, CO_A)["invoice_id"] == "sf-new"
    assert _doc(db, "orders", ORDER, CO_B)["invoice_id"] is None
    assert _digest(db, CO_B) == before

    _doc(db, "invoices", "sf-new", CO_A)["dispatch_ids"] = [DISP]
    _doc(db, "invoices", DISP, CO_B)["converted_invoice_id"] = "sf-new"
    _doc(db, "invoices", DISP, CO_B)["dispatch_status"] = "invoiced"
    before_release = _digest(db, CO_B)
    _run(dispatch_invoice.release_invoice_dispatches(db, _doc(db, "invoices", "sf-new", CO_A)))
    assert _doc(db, "invoices", DISP, CO_A)["dispatch_status"] == "draft"
    assert _doc(db, "invoices", DISP, CO_A).get("converted_invoice_id") is None
    assert _doc(db, "invoices", DISP, CO_B)["dispatch_status"] == "invoiced"
    assert _doc(db, "invoices", DISP, CO_B)["converted_invoice_id"] == "sf-new"
    assert _digest(db, CO_B) == before_release


def test_blank_dispatch_company_does_not_query():
    boom = _Boom()

    async def run():
        missing = await dispatch_invoice.find_existing_invoice_for_dispatch(boom, {"_id": DISP})
        untouched = await dispatch_invoice.link_dispatch_to_invoice(
            boom, {"_id": DISP}, {"_id": INV, "company_id": CO_A},
        )
        await dispatch_invoice.release_invoice_dispatches(boom, {"_id": INV, "dispatch_id": DISP})
        claimed = await dispatch_invoice._claim_dispatch(boom, {"_id": DISP}, "", "sf", "SF")
        await dispatch_invoice._release_one(boom, DISP, INV, "draft", company_id="")
        return missing, untouched, claimed

    missing, untouched, claimed = _run(run())
    assert missing is None
    assert untouched["_id"] == INV
    assert claimed is False


def test_status_xml_and_track_stay_in_company():
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, xml=True, track=True, b_first=False)
    _add(db, "outgoing_einvoice_xml", db.outgoing_einvoice_xml.docs.pop(0))
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)
    try:
        body = _run(e_invoice.api_einvoice_status(INV, _user(CO_A)))
    finally:
        _unbind_einvoice(prev)
    assert body["invoice_number"] == "SF-A"
    assert body["einvoice_state"] == "sent"
    assert body["has_xml"] is True
    assert body["xml_meta"]["scenario"] == "A"
    assert body["e_invoice_track"]["invoice_number"] == "SF-A"
    assert "B-MARK" not in json.dumps(body, default=str)
    assert "SF-B" not in json.dumps(body, default=str)
    assert _digest(db, CO_B) == before


def test_status_foreign_first_row_is_404():
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, b_first=True)
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)
    try:
        with pytest.raises(HTTPException) as exc:
            _run(e_invoice.api_einvoice_status(INV, _user(CO_A)))
    finally:
        _unbind_einvoice(prev)
    assert exc.value.status_code == 404
    assert exc.value.detail == "Fatura bulunamadı."
    assert _digest(db, CO_B) == before


def test_refresh_qnb_updates_only_own_invoice(monkeypatch):
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, b_first=True)
    for cid, mark in ((CO_B, "B"), (CO_A, "A")):
        row = _doc(db, "invoices", INV, cid)
        row["integrator"] = "qnb_efinans"
        row["gib_status"] = mark + "-status"
        _add(db, "einvoice_settings", {
            "_id": "set-" + mark,
            "company_id": cid,
            "provider": "qnb_efinans",
            "status": "configured",
        })
    before = _digest(db, CO_B)

    async def _query(_settings, _password, _invoice):
        return {"ok": True, "einvoice_state": "accepted", "gib_status": "QNB-A", "belge_no": "NO-A"}

    monkeypatch.setattr(e_invoice.qnb_efinans, "query_status", _query)
    prev = _bind_einvoice(db)
    try:
        out = _run(e_invoice.refresh_one_invoice_status(INV, company_id=CO_A))
    finally:
        _unbind_einvoice(prev)
    assert out["updated"] is True
    assert out["invoice"]["company_id"] == CO_A
    assert out["invoice"]["gib_status"] == "QNB-A"
    assert _doc(db, "invoices", INV, CO_B)["gib_status"] == "B-status"
    assert _digest(db, CO_B) == before


def test_refresh_and_gib_url_miss_other_company():
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, b_first=True)
    _doc(db, "invoices", INV, CO_A)["gib_document_url"] = "https://stored.example/a"
    _doc(db, "invoices", INV, CO_A)["integrator"] = "qnb_efinans"
    _doc(db, "invoices", INV, CO_B)["gib_document_url"] = "https://stored.example/b"
    _doc(db, "invoices", INV, CO_B)["integrator"] = "qnb_efinans"
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)
    try:
        async def run():
            with pytest.raises(HTTPException) as missing:
                await e_invoice.refresh_one_invoice_status(INV, company_id="")
            info = await e_invoice.resolve_gib_document_url(INV, company_id=CO_A)
            with pytest.raises(HTTPException) as other:
                await e_invoice.resolve_gib_document_url("missing-inv", company_id=CO_A)
            return missing.value, info, other.value

        missing, info, other = _run(run())
    finally:
        _unbind_einvoice(prev)
    assert missing.status_code == 404
    assert other.status_code == 404
    assert info["url"] == "https://stored.example/a"
    assert info["provider"] == "qnb_efinans"
    assert _digest(db, CO_B) == before


def test_xml_session_and_share_link_return_own_archive(monkeypatch):
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, xml=True, b_first=False)
    db.outgoing_einvoice_xml.docs.reverse()
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)

    async def _as_user(_token, _db, **_kwargs):
        return _user(CO_A)

    monkeypatch.setattr(auth_utils, "get_user_from_token", _as_user)
    monkeypatch.setattr(auth_utils, "session_token", lambda _request: "tok")
    try:
        session_body = _run(e_invoice.api_einvoice_xml(INV, _Req(session=True)))
        monkeypatch.setattr(auth_utils, "session_token", lambda _request: None)
        with pytest.raises(HTTPException) as no_session:
            _run(e_invoice.api_einvoice_xml(INV, _Req()))
        monkeypatch.setenv("JWT_SECRET", _JWT)
        token = signed_links.make_doc_share_token(INV, "e-invoice-xml")
        share_body = _run(e_invoice.api_einvoice_xml(INV, _Req(token=token)))
    finally:
        _unbind_einvoice(prev)
    assert session_body.body == b"<Invoice>A-MARK</Invoice>"
    assert b"B-MARK" not in session_body.body
    assert no_session.value.status_code == 401
    assert share_body.body == b"<Invoice>A-MARK</Invoice>"
    assert b"B-MARK" not in share_body.body
    assert _digest(db, CO_B) == before


def test_finalize_record_and_store_xml_skip_other_company():
    db = _DB()
    _seed_pair(db, dispatches=False, xml=True, track=True, b_first=True)
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)
    try:
        async def run():
            out = await e_invoice.finalize_create_result(
                {"status": "success", "einvoice_state": "sent", "e_type": "e_archive"},
                INV,
                order_id=ORDER,
                company_id=CO_A,
            )
            await e_invoice.store_outgoing_xml(INV, CO_A, b"<Invoice>A-NEW</Invoice>", {"scenario": "A"})
            return out

        out = _run(run())
    finally:
        _unbind_einvoice(prev)
    assert out["invoice_number"] == "SF-A"
    assert out["company_id"] == CO_A
    assert _doc(db, "orders", ORDER, CO_A)["is_invoiced"] is True
    assert _doc(db, "orders", ORDER, CO_A)["invoice_id"] == INV
    assert _doc(db, "orders", ORDER, CO_B)["is_invoiced"] is False
    assert _doc(db, "orders", ORDER, CO_B)["invoice_id"] is None
    tracks = [row for row in db.e_invoices.docs if row.get("company_id") == CO_A]
    assert tracks and tracks[-1]["invoice_number"] == "SF-A"
    assert _doc(db, "e_invoices", "einv_" + INV, CO_B)["invoice_number"] == "SF-B"
    stored_a = [row for row in db.outgoing_einvoice_xml.docs if row.get("company_id") == CO_A and "A-NEW" in row.get("xml", "")]
    assert stored_a
    assert "A-NEW" not in _doc(db, "outgoing_einvoice_xml", INV, CO_B)["xml"]
    assert _digest(db, CO_B) == before


def test_edoc_backup_lists_and_reads_only_own_company():
    db = _DB()
    _seed_pair(db, dispatches=False, orders=False, xml=True, b_first=True)
    prev = edoc_backup._db
    edoc_backup.init(db)
    try:
        rows = _run(edoc_backup._list_invoices(CO_A, "2026-10-01", "2026-10-20"))
        own = _run(edoc_backup._stored_xml(INV, company_id=CO_A))
        blank = _run(edoc_backup._stored_xml(INV, company_id=""))
        empty = _run(edoc_backup._list_invoices("", "2026-10-01", "2026-10-20"))
    finally:
        edoc_backup._db = prev
    assert [row["invoice_number"] for row in rows] == ["SF-A"]
    assert own == b"<Invoice>A-MARK</Invoice>"
    assert blank is None
    assert empty == []


def test_apply_issue_stamp_requires_company_and_stays_in_tenant():
    with pytest.raises(TypeError):
        _run(e_invoice.apply_issue_stamp(INV, {"_id": INV, "status": "draft"}, stamp_now=True))

    db = _DB()
    _seed_pair(db, dispatches=False, orders=False)
    for cid in (CO_A, CO_B):
        row = _doc(db, "invoices", INV, cid)
        row["status"] = "draft"
        row["einvoice_state"] = "draft"
        row.pop("gib_uuid", None)
    before = _digest(db, CO_B)
    prev = _bind_einvoice(db)
    try:
        stamped = _run(e_invoice.apply_issue_stamp(
            INV,
            _doc(db, "invoices", INV, CO_A),
            company_id=CO_A,
            issue_date="2026-10-19",
            issue_time="11:22:33",
        ))
    finally:
        _unbind_einvoice(prev)
    assert stamped["issue_date"] == "2026-10-19"
    assert stamped["issue_time"] == "11:22:33"
    assert stamped["company_id"] == CO_A
    assert _doc(db, "invoices", INV, CO_A)["issue_date"] == "2026-10-19"
    assert _doc(db, "invoices", INV, CO_B)["issue_date"] == "2026-10-05"
    assert _digest(db, CO_B) == before

    boom = _Boom()
    prev = _bind_einvoice(boom)
    try:
        blank = _run(e_invoice.apply_issue_stamp(
            INV,
            {"_id": INV, "status": "draft", "issue_date": "2020-01-01"},
            company_id="",
            issue_date="2026-10-19",
            issue_time="11:22:33",
        ))
    finally:
        _unbind_einvoice(prev)
    assert blank["issue_date"] == "2026-10-19"
    assert blank["issue_time"] == "11:22:33"
    assert blank["_id"] == INV


def test_blank_einvoice_company_does_not_query():
    boom = _Boom()
    prev = _bind_einvoice(boom)
    try:
        async def run():
            pdf = await e_invoice.fetch_integrator_pdf(INV, company_id="")
            xml = await e_invoice.fetch_integrator_xml(INV, company_id="")
            with pytest.raises(HTTPException) as gib:
                await e_invoice.resolve_gib_document_url(INV, company_id="")
            await e_invoice.store_outgoing_xml(INV, "", b"<Invoice/>")
            await e_invoice.record_e_invoice(company_id="", invoice_id=INV)
            skipped = await e_invoice.finalize_create_result({"status": "success"}, INV, company_id="")
            return pdf, xml, gib.value, skipped

        pdf, xml, gib, skipped = _run(run())
    finally:
        _unbind_einvoice(prev)
    assert pdf is None
    assert xml is None
    assert gib.status_code == 404
    assert skipped["invoice_id"] == INV
    assert skipped["status"] == "success"


def test_wave5_baseline_keys_removed():
    base = allowlist.TENANT_SCOPE_BASELINE
    present = [key for key in _REMOVED if key in base]
    assert present == []
    assert len(_REMOVED) == 35
    assert not any(key[0] == "server.py" for key in _REMOVED)
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
