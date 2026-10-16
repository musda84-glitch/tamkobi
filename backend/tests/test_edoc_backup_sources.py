"""e-Belge yedeği resmi entegratör XML/PDF kullanır; ağ yok, entegratör mock."""
import asyncio
import io
import logging
import sys
import zipfile
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

for _p in ("/app/backend", "/workspace/backend"):
    if _p not in sys.path:
        sys.path.insert(0, _p)

import edoc_backup
from mysql_store import match_query

ETTN = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
OFFICIAL_XML = b"<?xml version='1.0'?><Invoice>OFFICIAL-XML</Invoice>"
OFFICIAL_PDF = b"%PDF-1.4 official-pdf-bytes"
STORED_XML = b"<Invoice>STORED-XML</Invoice>"
LEAK = (
    "https://einvoice.example/api/Invoice/GetInvoicePdf?key=abcPlusEq "
    "token=super-secret-token username=portal.admin password=s3cret"
)
D0, D1 = "2026-09-01", "2026-09-08"


def _inv(**kw):
    doc = {
        "_id": "inv1",
        "company_id": "comp_a",
        "invoice_type": "sales",
        "e_type": "e_archive",
        "status": "approved",
        "einvoice_state": "sent",
        "gib_status": "İletildi",
        "issue_date": "2026-09-05",
        "invoice_number": "TA-LOCAL-1",
        "gib_invoice_id": "GIB2026000009",
        "gib_uuid": ETTN,
        "contact_name": "Cari",
        "items": [{"name": "Kalem", "quantity": 1, "unit": "Adet", "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    doc.update(kw)
    return doc


class _Cursor:
    def __init__(self, rows):
        self.rows = list(rows)

    def sort(self, key, direction=1):
        self.rows.sort(key=lambda r: str(r.get(key) or ""), reverse=direction < 0)
        return self

    async def to_list(self, n=None):
        return list(self.rows if n is None else self.rows[:n])


class _Coll:
    def __init__(self, rows=None, honor_query=True):
        self.rows = list(rows or [])
        self.honor_query = honor_query
        self.inserts = []
        self.queries = []

    def find(self, query=None, projection=None):
        self.queries.append(query)
        rows = self.rows
        if self.honor_query:
            rows = [r for r in rows if match_query(r, query)]
        return _Cursor(rows)

    async def find_one(self, query=None, projection=None):
        self.queries.append(query)
        for row in self.rows:
            if not self.honor_query or match_query(row, query):
                return row
        return None

    async def insert_one(self, doc):
        self.inserts.append(doc)
        self.rows.append(dict(doc))

    async def update_one(self, *args, **kwargs):
        raise AssertionError("e-belge yedeği fatura yazmamalı")


class _Db:
    def __init__(self, invoices, xml_rows=None, honor_query=True):
        self.invoices = _Coll(invoices, honor_query=honor_query)
        self.companies = _Coll([{"_id": "comp_a", "name": "A A.Ş."}, {"_id": "comp_b", "name": "B A.Ş."}])
        self.contacts = _Coll([])
        self.outgoing_einvoice_xml = _Coll(xml_rows or [])
        self.edoc_backups = _Coll([])


def _run(coro):
    return asyncio.run(coro)


@pytest.fixture
def gap_off(monkeypatch):
    monkeypatch.setattr(edoc_backup, "FETCH_GAP_SECONDS", 0)


def _patch_fetch(monkeypatch, xml=None, pdf=None):
    xml_mock = AsyncMock(return_value=xml)
    pdf_mock = AsyncMock(return_value=pdf)
    monkeypatch.setattr("e_invoice.fetch_integrator_xml", xml_mock)
    monkeypatch.setattr("e_invoice.fetch_integrator_pdf", pdf_mock)
    return xml_mock, pdf_mock


def _zip(blob):
    return zipfile.ZipFile(io.BytesIO(blob))


def _manifest(blob):
    return _zip(blob).read("MANIFEST.txt").decode("utf-8")


def test_preview_integrator_count_requires_uuid_ettn():
    """Simüle GİB-… takip numarası önizlemede entegratör sayılmaz; UUID sayılır."""
    uuid_ettn = "bbbbbbbb-bbbb-cccc-dddd-eeeeeeeeeeee"
    rows = [
        _inv(_id="ok", gib_uuid=ETTN, gib_tracking_id=""),
        _inv(_id="track", gib_uuid="", gib_tracking_id=uuid_ettn, invoice_number="TR1", gib_invoice_id="GIBTR"),
        _inv(_id="sim", gib_uuid="", gib_tracking_id="GIB-202600000095", invoice_number="SIM1", gib_invoice_id="GIBSIM"),
        _inv(_id="bare", gib_uuid="", gib_tracking_id="", invoice_number="BARE1", gib_invoice_id=""),
    ]
    for row in rows:
        assert edoc_backup.invoice_in_scope(row), row["_id"]
    counts = edoc_backup._counts(rows)
    assert counts["invoice_count"] == 4
    assert counts["xml_count"] == counts["pdf_count"] == 4
    assert counts["integrator_count"] == 2
    assert counts["local_count"] == 2
    db = _Db(rows)
    edoc_backup.init(db)
    user = {
        "id": "u1", "company_ids": ["comp_a"], "active_company_id": "comp_a",
        "role": "admin", "is_super_admin": False,
    }
    preview = _run(edoc_backup.edocs_preview(company_id="comp_a", date_from=D0, date_to=D1, user=user))
    assert preview["integrator_count"] == 2
    assert preview["local_count"] == 2
    assert preview["invoice_count"] == 4


def test_query_matches_in_scope_documents():
    rows = [
        _inv(),
        _inv(_id="ex", e_type="e_export", invoice_number="IHR1", gib_invoice_id="GIBEXP1"),
        _inv(_id="in", invoice_type="purchase", direction="incoming", source="edoc_inbox", einvoice_state="received", invoice_number="GELEN1"),
        _inv(_id="src", invoice_type="purchase", source="edoc_inbox", einvoice_state="", invoice_number="KUTU1"),
    ]
    q = edoc_backup.invoice_query("comp_a", D0, D1)
    for row in rows:
        assert edoc_backup.invoice_in_scope(row), row["_id"]
        assert match_query(row, q), row["_id"]


@pytest.mark.parametrize("extra", [
    {"status": "draft", "einvoice_state": "draft"},
    {"einvoice_state": "error", "gib_status": "Hata: şema"},
    {"einvoice_state": "sent", "gib_status": "Hata: şema"},
    {"e_type": "paper"},
    {"invoice_type": "proforma", "e_type": "e_archive"},
    {"e_type": "expense_slip", "invoice_type": "purchase"},
    {"invoice_type": "dispatch", "e_type": "e_dispatch"},
    {"status": "cancelled"},
    {"payment_status": "cancelled"},
    {"gib_status": "İptal edildi"},
    {"einvoice_state": "queued"},
])
def test_out_of_scope_not_positive_match(extra):
    row = _inv(**extra)
    assert edoc_backup.invoice_in_scope(row) is False


def test_integrator_bytes_and_source(monkeypatch, gap_off):
    xml_mock, pdf_mock = _patch_fetch(monkeypatch, OFFICIAL_XML, OFFICIAL_PDF)
    db = _Db([_inv()])
    edoc_backup.init(db)
    blob, counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    zf = _zip(blob)
    assert zf.read("giden/xml/GIB2026000009.xml") == OFFICIAL_XML
    assert zf.read("giden/pdf/GIB2026000009.pdf") == OFFICIAL_PDF
    text = _manifest(blob)
    assert "kaynak=integrator" in text
    assert f"ettn={ETTN}" in text
    assert "_YEREL" not in text
    assert "TA-LOCAL-1" not in "\n".join(zf.namelist())
    assert counts["integrator_count"] == 2
    assert counts["local_count"] == 0
    xml_mock.assert_awaited()
    pdf_mock.assert_awaited()
    assert db.edoc_backups.inserts == []
    assert db.invoices.rows[0]["gib_uuid"] == ETTN


def test_none_then_stored_then_local(monkeypatch, gap_off):
    _patch_fetch(monkeypatch, None, None)
    stored = _inv(_id="stored1", invoice_number="ST1", gib_invoice_id="GIBST1", gib_uuid="")
    local = _inv(_id="local1", invoice_number="LOC1", gib_invoice_id="", gib_uuid="")
    incoming = _inv(
        _id="in1", invoice_type="purchase", direction="incoming", source="edoc_inbox",
        einvoice_state="received", gib_uuid="", gib_invoice_id="GIBIN", invoice_number="IN1",
    )
    db = _Db(
        [stored, local, incoming],
        xml_rows=[{"_id": "stored1", "xml": STORED_XML.decode()}, {"_id": "in1", "xml": STORED_XML.decode()}],
    )
    edoc_backup.init(db)
    blob, counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    zf = _zip(blob)
    assert zf.read("giden/xml/GIBST1.xml") == STORED_XML
    assert "giden/xml/LOC1_YEREL.xml" in zf.namelist()
    assert any(n.startswith("giden/pdf/GIBST1_YEREL") for n in zf.namelist())
    assert any(n.startswith("giden/pdf/LOC1_YEREL") for n in zf.namelist())
    assert zf.read("gelen/xml/GIBIN_YEREL.xml") != STORED_XML
    text = _manifest(blob)
    assert "kaynak=stored" in text
    assert "kaynak=local" in text
    assert "GIBST1.xml" in text and "_YEREL" not in text.split("GIBST1.xml")[0][-20:]
    assert counts["local_count"] >= 2
    assert counts["integrator_count"] == 0


def test_integrator_error_uses_stored_and_masks(monkeypatch, gap_off, caplog):
    err = HTTPException(status_code=502, detail=LEAK)

    async def boom(_invoice_id):
        raise err

    monkeypatch.setattr("e_invoice.fetch_integrator_xml", boom)
    monkeypatch.setattr("e_invoice.fetch_integrator_pdf", boom)
    row = _inv(_id="err1", gib_invoice_id="GIBERR1")
    db = _Db([row], xml_rows=[{"_id": "err1", "xml": STORED_XML}])
    edoc_backup.init(db)
    with caplog.at_level(logging.WARNING, logger="TamKobiERP"):
        blob, counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    zf = _zip(blob)
    assert zf.read("giden/xml/GIBERR1.xml") == STORED_XML
    assert any("GIBERR1_YEREL" in n and n.endswith(".pdf") for n in zf.namelist())
    text = _manifest(blob)
    assert "kaynak=stored" in text
    assert "kaynak=local" in text
    assert "hata=502" in text
    joined = text + "\n" + caplog.text
    for secret in ("abcPlusEq", "super-secret-token", "portal.admin", "s3cret", "einvoice.example"):
        assert secret not in joined
    assert counts["integrator_count"] == 0
    assert counts["local_count"] == 1


def test_error_without_stored_is_local_marker(monkeypatch, gap_off):
    async def boom(_invoice_id):
        raise HTTPException(status_code=404, detail="bulunamadı")

    monkeypatch.setattr("e_invoice.fetch_integrator_xml", boom)
    monkeypatch.setattr("e_invoice.fetch_integrator_pdf", AsyncMock(return_value=None))
    db = _Db([_inv(_id="miss", gib_invoice_id="GIBMISS", gib_uuid="")])
    edoc_backup.init(db)
    blob, _counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    names = _zip(blob).namelist()
    assert "giden/xml/GIBMISS_YEREL.xml" in names
    assert "giden/pdf/GIBMISS_YEREL.pdf" in names
    assert "kaynak=local" in _manifest(blob)
    assert "hata=404" in _manifest(blob)


def test_scope_folders_and_filename(monkeypatch, gap_off):
    _patch_fetch(monkeypatch, OFFICIAL_XML, OFFICIAL_PDF)
    rows = [
        _inv(_id="ok", gib_invoice_id="GIBOK", invoice_number="NO-OK"),
        _inv(_id="ok2", gib_invoice_id="GIBOK", invoice_number="NO-OK-2"),
        _inv(_id="gelen", invoice_type="purchase", direction="incoming", source="edoc_inbox",
             einvoice_state="received", gib_invoice_id="GIBGELEN", invoice_number="AL1"),
        _inv(_id="ihr", e_type="e_export", gib_invoice_id="GIBIHR", invoice_number="IHR1"),
        _inv(_id="draft", status="draft", einvoice_state="draft", gib_invoice_id="GIBDRAFT", invoice_number="DRAFT1"),
        _inv(_id="bad", einvoice_state="sent", gib_status="Hata: şema", gib_invoice_id="GIBBAD", invoice_number="BAD1"),
        _inv(_id="paper", e_type="paper", gib_invoice_id="GIBPAPER", invoice_number="PAPER1"),
        _inv(_id="pro", invoice_type="proforma", gib_invoice_id="GIBPRO", invoice_number="PRO1"),
        _inv(_id="slip", e_type="expense_slip", invoice_type="purchase", gib_invoice_id="GIBSLIP", invoice_number="SLIP1"),
        _inv(_id="irs", invoice_type="dispatch", e_type="e_dispatch", gib_invoice_id="GIBIRS", invoice_number="IRS1"),
        _inv(_id="iptal", status="cancelled", gib_invoice_id="GIBIPTAL", invoice_number="IPTAL1"),
        _inv(_id="other", company_id="comp_b", gib_invoice_id="GIBOTHER", invoice_number="OTHER1"),
        _inv(_id="old", issue_date="2026-08-01", gib_invoice_id="GIBOLD", invoice_number="OLD1"),
    ]
    db = _Db(rows, honor_query=False)
    edoc_backup.init(db)
    blob, counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    names = _zip(blob).namelist()
    joined = "\n".join(names)
    assert "giden/xml/GIBOK.xml" in names
    assert "giden/xml/GIBOK_2.xml" in names
    assert "gelen/xml/GIBGELEN.xml" in names
    assert "gelen/pdf/GIBGELEN.pdf" in names
    assert "giden/xml/GIBIHR.xml" in names
    for marker in ("DRAFT1", "BAD1", "PAPER1", "PRO1", "SLIP1", "IRS1", "IPTAL1", "OTHER1", "OLD1", "GIBDRAFT", "GIBOTHER", "GIBOLD"):
        assert marker not in joined
    assert counts["invoice_count"] == 4
    assert "NO-OK" not in joined


def test_concurrency_cap(monkeypatch, gap_off):
    state = {"cur": 0, "max": 0}

    async def slow(_invoice_id):
        state["cur"] += 1
        state["max"] = max(state["max"], state["cur"])
        await asyncio.sleep(0.12)
        state["cur"] -= 1
        return OFFICIAL_XML

    monkeypatch.setattr("e_invoice.fetch_integrator_xml", slow)
    monkeypatch.setattr("e_invoice.fetch_integrator_pdf", slow)
    rows = [_inv(_id=f"c{i}", gib_invoice_id=f"GIBC{i}", invoice_number=f"N{i}") for i in range(6)]
    db = _Db(rows)
    edoc_backup.init(db)
    _run(edoc_backup.build_zip("comp_a", D0, D1))
    assert state["max"] == 3


def test_timeout_does_not_drop_zip(monkeypatch, gap_off):
    monkeypatch.setattr(edoc_backup, "INVOICE_TIMEOUT_SECONDS", 0.05)

    async def xml(invoice_id):
        if invoice_id == "slow":
            await asyncio.sleep(2)
            return b"LATE"
        return OFFICIAL_XML

    async def pdf(_invoice_id):
        return OFFICIAL_PDF

    monkeypatch.setattr("e_invoice.fetch_integrator_xml", xml)
    monkeypatch.setattr("e_invoice.fetch_integrator_pdf", pdf)
    rows = [
        _inv(_id="slow", gib_invoice_id="GIBSLOW", invoice_number="SLOW1"),
        _inv(_id="fast", gib_invoice_id="GIBFAST", invoice_number="FAST1", gib_uuid=""),
    ]
    db = _Db(rows)
    edoc_backup.init(db)
    blob, counts = _run(edoc_backup.build_zip("comp_a", D0, D1))
    raw = b"".join(_zip(blob).read(n) for n in _zip(blob).namelist())
    assert b"LATE" not in raw
    names = _zip(blob).namelist()
    assert any("GIBSLOW_YEREL" in n for n in names)
    assert "giden/xml/GIBFAST.xml" in names
    assert "giden/pdf/GIBFAST.pdf" in names
    assert "hata=timeout" in _manifest(blob)
    assert counts["invoice_count"] == 2


def test_company_isolation_and_headers(monkeypatch, gap_off):
    _patch_fetch(monkeypatch, OFFICIAL_XML, OFFICIAL_PDF)
    rows = [
        _inv(_id="a1", company_id="comp_a", gib_invoice_id="GIBA", invoice_number="A1"),
        _inv(_id="b1", company_id="comp_b", gib_invoice_id="GIBB", invoice_number="B1"),
    ]
    db = _Db(rows, honor_query=False)
    edoc_backup.init(db)
    user_a = {
        "id": "u1", "company_ids": ["comp_a"], "active_company_id": "comp_a",
        "role": "admin", "is_super_admin": False,
    }
    with pytest.raises(HTTPException) as ei:
        _run(edoc_backup.edocs_export(company_id="comp_b", date_from=D0, date_to=D1, user=user_a))
    assert ei.value.status_code == 403
    assert db.edoc_backups.inserts == []

    preview = _run(edoc_backup.edocs_preview(company_id="comp_a", date_from=D0, date_to=D1, user=user_a))
    assert preview["invoice_count"] == 1
    assert preview["integrator_count"] == 1
    assert preview["local_count"] == 0
    assert preview["xml_count"] == preview["pdf_count"] == 1

    resp = _run(edoc_backup.edocs_export(company_id="comp_a", date_from=D0, date_to=D1, user=user_a))
    assert resp.headers["X-Xml-Count"] == "1"
    assert resp.headers["X-Pdf-Count"] == "1"
    assert resp.headers["X-Integrator-Count"] == "2"
    assert resp.headers["X-Local-Count"] == "0"
    names = _zip(resp.body).namelist()
    assert any("GIBA" in n for n in names)
    assert not any("GIBB" in n or "B1" in n for n in names)
    assert len(db.edoc_backups.inserts) == 1
    saved = db.edoc_backups.inserts[0]
    assert saved["company_id"] == "comp_a"
    assert saved["integrator_count"] == 2
    assert saved["local_count"] == 0
    assert saved["xml_count"] == 1


def test_active_company_when_query_omitted(monkeypatch, gap_off):
    seen = {}

    async def fake_zip(cid, d0, d1):
        seen["cid"] = cid
        return b"PK\x03\x04", {"invoice_count": 0, "xml_count": 0, "pdf_count": 0, "integrator_count": 0, "local_count": 0}

    monkeypatch.setattr(edoc_backup, "build_zip", fake_zip)
    user = {
        "id": "u1", "company_ids": ["comp_a"], "active_company_id": "comp_a",
        "role": "admin", "is_super_admin": False,
    }
    _run(edoc_backup.edocs_export(company_id=None, date_from=D0, date_to=D1, user=user))
    assert seen["cid"] == "comp_a"


def test_pace_spaces_calls(monkeypatch):
    monkeypatch.setattr(edoc_backup, "FETCH_GAP_SECONDS", 0.05)
    lock = asyncio.Lock()
    last = {"t": 0.0}

    async def twice():
        await edoc_backup._pace(lock, last)
        await edoc_backup._pace(lock, last)

    import time
    t0 = time.monotonic()
    _run(twice())
    assert time.monotonic() - t0 >= 0.04
