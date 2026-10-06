"""Platform e-Fatura / e-Arşiv XSLT tasarım birim testleri."""
import asyncio
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

import einvoice_designs as ed


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
