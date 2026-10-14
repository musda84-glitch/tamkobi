"""Şirket etiket yazıcısı varsayılanı."""
import asyncio

import pytest
from fastapi import HTTPException

from label_printer_settings import (
    empty_label_printer,
    load_company_label_printer,
    normalize_label_printer,
    save_company_label_printer,
)


class FakeCompanies:
    def __init__(self):
        self.docs = {}

    async def find_one(self, query, _projection=None):
        doc = self.docs.get(query.get("_id"))
        return dict(doc) if doc else None

    async def update_one(self, query, update):
        doc = self.docs.setdefault(query["_id"], {"_id": query["_id"]})
        doc.update(update.get("$set") or {})


class FakeDb:
    def __init__(self):
        self.companies = FakeCompanies()


def test_normalize_xp490b_defaults():
    doc = empty_label_printer()
    assert doc["name"] == "Xprinter XP-490B"
    assert doc["port"] == 9100
    assert doc["dpi"] == 203
    assert doc["width_mm"] == 100
    assert doc["height_mm"] == 50
    assert doc["gap_mm"] == 2
    assert doc["configured"] is False


def test_normalize_keeps_private_host_and_size():
    doc = normalize_label_printer({
        "name": " Depo ",
        "host": "192.168.1.117",
        "port": "9100",
        "width_mm": 80,
        "height_mm": 40,
        "gap_mm": 3,
        "dpi": 300,
    })
    assert doc["host"] == "192.168.1.117"
    assert doc["width_mm"] == 80
    assert doc["height_mm"] == 40
    assert doc["gap_mm"] == 3
    assert doc["dpi"] == 300
    assert doc["configured"] is True


def test_serial_baud_is_rejected():
    with pytest.raises(ValueError) as ei:
        normalize_label_printer({"host": "192.168.1.117", "port": 9600})
    assert "9100" in str(ei.value)
    assert "seri baud" in str(ei.value).lower() or "9600" in str(ei.value)


def test_save_and_load_company_default():
    db = FakeDb()
    db.companies.docs["c1"] = {"_id": "c1"}

    async def run():
        saved = await save_company_label_printer(db, "c1", {
            "name": "Atölye",
            "host": "192.168.1.117",
            "port": 9100,
            "width_mm": 100,
            "height_mm": 30,
            "gap_mm": 2,
            "dpi": 203,
        })
        loaded = await load_company_label_printer(db, "c1")
        return saved, loaded

    saved, loaded = asyncio.run(run())
    assert saved["host"] == "192.168.1.117"
    assert loaded["height_mm"] == 30
    assert loaded["configured"] is True


def test_save_requires_host_and_company():
    db = FakeDb()

    async def missing():
        await save_company_label_printer(db, "yok", {"host": "192.168.1.10"})

    with pytest.raises(HTTPException) as ei:
        asyncio.run(missing())
    assert ei.value.status_code == 404

    db.companies.docs["c1"] = {"_id": "c1"}

    async def no_host():
        await save_company_label_printer(db, "c1", {"port": 9100})

    with pytest.raises(HTTPException) as ei2:
        asyncio.run(no_host())
    assert ei2.value.status_code == 400
    assert "IP" in ei2.value.detail
