"""Platform e-Fatura / e-Arşiv XSLT tasarım birim testleri."""
import asyncio
import base64
import gzip
import io
import xml.etree.ElementTree as ET
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from PIL import Image

import einvoice_designs as ed
import ubl_export


class _MemCol:
    def __init__(self):
        self.rows = {}

    async def find_one(self, q):
        if "_id" in q:
            return self.rows.get(q["_id"])
        for row in self.rows.values():
            if all(row.get(k) == v for k, v in q.items()):
                return row
        return None

    async def insert_one(self, doc):
        self.rows[doc["_id"]] = dict(doc)

    async def update_one(self, q, upd):
        row = await self.find_one(q)
        if row:
            row.update(upd.get("$set") or {})

    async def update_many(self, q, upd):
        for row in self.rows.values():
            if all(row.get(k) == v for k, v in q.items()):
                row.update(upd.get("$set") or {})

    async def delete_one(self, q):
        rid = q.get("_id")
        if rid in self.rows:
            del self.rows[rid]

    def find(self, q):
        items = list(self.rows.values())
        m = MagicMock()

        async def to_list(_n):
            return sorted(items, key=lambda r: r.get("name") or "")

        m.sort.return_value.to_list = to_list
        return m


def _boot():
    col = _MemCol()
    ed.init({ed.COLLECTION: col})
    return col


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_validate_xslt_requires_stylesheet():
    with pytest.raises(HTTPException) as e:
        ed.validate_xslt("<html></html>")
    assert e.value.status_code == 400
    ok = ed.validate_xslt('<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>')
    assert "xsl:stylesheet" in ok


def test_builtin_files_exist():
    for spec in ed.BUILTIN:
        text = ed._read_builtin_xslt(spec["file"])
        assert "<xsl:stylesheet" in text
        assert "n1:Invoice" in text


def test_ensure_defaults_seeds_and_selects():
    col = _boot()
    _run(ed.ensure_defaults())
    assert len(col.rows) == 2
    inv = col.rows["einvoice_xslt_default_e_invoice"]
    arc = col.rows["einvoice_xslt_default_e_archive"]
    assert inv["is_selected"] and inv["kind"] == "e_invoice"
    assert arc["is_selected"] and arc["kind"] == "e_archive"
    _run(ed.ensure_defaults())
    assert len(col.rows) == 2


def test_copy_select_and_block_delete_selected():
    col = _boot()
    _run(ed.ensure_defaults())
    created = _run(ed.create_design({"copy_from_id": "einvoice_xslt_default_e_invoice", "name": "Özel e-Fatura"}, {}))
    assert created["kind"] == "e_invoice"
    assert created["is_builtin"] is False
    assert created["is_selected"] is False
    assert "<xsl:stylesheet" in created["xslt"]
    sel = _run(ed.select_design(created["id"], {}))
    assert sel["id"] == created["id"]
    assert next(i for i in sel["items"] if i["id"] == created["id"])["is_selected"] is True
    assert next(i for i in sel["items"] if i["id"] == "einvoice_xslt_default_e_invoice")["is_selected"] is False
    with pytest.raises(HTTPException) as e:
        _run(ed.delete_design(created["id"], {}))
    assert e.value.status_code == 400
    with pytest.raises(HTTPException) as e2:
        _run(ed.delete_design("einvoice_xslt_default_e_invoice", {}))
    assert "Varsayılan" in e2.value.detail
    xslt = _run(ed.selected_xslt("e_invoice"))
    assert created["xslt"][:40] in (xslt or "")
    assert col.rows[created["id"]]["is_selected"] is True


def test_layout_copy_and_update():
    col = _boot()
    _run(ed.ensure_defaults())
    created = _run(ed.create_design({
        "copy_from_id": "einvoice_xslt_default_e_invoice",
        "name": "Görsel",
        "layout": {"version": 1, "primary": "#112233", "blocks": [{"id": "header", "hidden": False}]},
    }, {}))
    assert created["layout"]["primary"] == "#112233"
    assert created["has_layout"] is True
    updated = _run(ed.update_design(created["id"], {"layout": {"accent": "#abcdef"}}, {}))
    assert updated["layout"]["accent"] == "#abcdef"
    copied = _run(ed.create_design({"copy_from_id": created["id"]}, {}))
    assert copied["layout"]["accent"] == "#abcdef"
    with pytest.raises(HTTPException):
        _run(ed.update_design(created["id"], {"layout": ["nope"]}, {}))


def _tiny_png_b64():
    buf = io.BytesIO()
    Image.new("RGB", (8, 8), (20, 80, 180)).save(buf, format="PNG")
    return base64.b64encode(buf.getvalue()).decode("ascii")


def test_gzip_xslt_roundtrip():
    xslt = '<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"/>'
    blob = ed.gzip_xslt_b64(xslt)
    assert gzip.decompress(base64.b64decode(blob)).decode("utf-8") == xslt


def test_prepare_xslt_converts_png_data_uri_to_jpeg():
    b64 = _tiny_png_b64()
    xslt = f'<img src="data:image/png;base64,{b64}"/>'
    out = ed.prepare_xslt_for_gib(xslt)
    assert "data:image/jpeg;base64," in out
    assert "data:image/png" not in out


def test_build_invoice_ubl_embeds_gzip_xslt():
    inv = {
        "_id": "inv_xslt",
        "invoice_number": "ABC2026000000001",
        "invoice_type": "sales",
        "e_type": "e_invoice",
        "issue_date": "2026-10-07",
        "items": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
    }
    seller = {"name": "Satıcı", "tax_number": "1234567801", "city": "İstanbul", "address": "Cad 1"}
    buyer = {"name": "Alıcı", "tax_number_or_id": "6320984412", "city": "Ankara"}
    xslt = '<xsl:stylesheet version="2.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform"><xsl:template match="/"/></xsl:stylesheet>'
    xml = ubl_export.build_invoice_ubl(inv, seller, buyer, send_ready=True, xslt=xslt)
    text = xml.decode("utf-8")
    assert "<cbc:DocumentType>XSLT</cbc:DocumentType>" in text
    assert 'filename="efatura.xslt"' in text
    ns = {
        "cac": "urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2",
        "cbc": "urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2",
        "n1": "urn:oasis:names:specification:ubl:schema:xsd:Invoice-2",
    }
    root = ET.fromstring(xml)
    payload = None
    for adr in root.findall("cac:AdditionalDocumentReference", ns):
        if (adr.findtext("cbc:DocumentType", default="", namespaces=ns) or "") == "XSLT":
            payload = adr.findtext("cac:Attachment/cbc:EmbeddedDocumentBinaryObject", default="", namespaces=ns)
    assert payload
    decoded = gzip.decompress(base64.b64decode(payload)).decode("utf-8")
    assert "<xsl:stylesheet" in decoded
