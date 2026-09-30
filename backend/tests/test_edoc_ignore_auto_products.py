"""Gelen e-belge: dikkate alma + eşleşmeyen stok kartı otomatik oluşturma."""
from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import edocs  # noqa: E402


def _run(coro):
    return asyncio.get_event_loop().run_until_complete(coro)


def test_ensure_products_for_unmatched_creates_and_links():
    doc = {
        "_id": "ed1",
        "company_id": "c1",
        "lines": [
            {"name": "Vida M8", "quantity": 10, "unit_price": 2, "vat_rate": 20, "total": 20},
            {"name": "Somun", "quantity": 5, "unit_price": 1, "vat_rate": 20, "total": 5, "product_id": "p_exist"},
        ],
    }
    fake_db = MagicMock()
    fake_db.incoming_edocs.update_one = AsyncMock()
    edocs.init(fake_db, {
        "create_product": AsyncMock(return_value={"product": {"id": "p_new", "name": "Vida M8"}}),
    })
    n = _run(edocs.ensure_products_for_unmatched(doc))
    assert n == 1
    assert doc["lines"][0]["product_id"] == "p_new"
    assert doc["lines"][0].get("auto_created") is True
    assert doc["lines"][1]["product_id"] == "p_exist"
    assert doc["matched_lines"] == 2
    fake_db.incoming_edocs.update_one.assert_awaited()


def test_ignore_edoc_moves_to_ignored():
    fake_db = MagicMock()
    fake_db.incoming_edocs.update_one = AsyncMock(return_value=MagicMock(matched_count=1))
    edocs.init(fake_db, {})
    out = _run(edocs.ignore_edoc("ed_ign", {"reason": "İlgisiz"}))
    assert out["status"] == "success"
    assert "dikkate" in out["message"].lower()
    args = fake_db.incoming_edocs.update_one.await_args.args
    assert args[0] == {"_id": "ed_ign", "status": "pending"}
    assert args[1]["$set"]["status"] == "ignored"
    assert args[1]["$set"]["ignore_reason"] == "İlgisiz"


def test_ignore_edoc_rejects_non_pending():
    fake_db = MagicMock()
    fake_db.incoming_edocs.update_one = AsyncMock(return_value=MagicMock(matched_count=0))
    edocs.init(fake_db, {})
    with pytest.raises(HTTPException) as e:
        _run(edocs.ignore_edoc("ed_x", {}))
    assert e.value.status_code == 400


def test_approve_auto_create_products_before_unmatched_check():
    doc = {
        "_id": "ed2",
        "company_id": "c1",
        "status": "pending",
        "kind": "invoice",
        "number": "GF1",
        "contact_id": "cnt1",
        "contact_name": "Tedarikçi A",
        "supplier": {"tax_id": "1111111111", "name": "Tedarikçi A"},
        "lines": [{"name": "Kalem", "quantity": 1, "unit_price": 10, "vat_rate": 20, "total": 10}],
        "subtotal": 10,
        "vat_total": 2,
        "grand_total": 12,
        "source": "isnet",
        "profile": "TEMELFATURA",
    }
    fake_db = MagicMock()
    fake_db.incoming_edocs.find_one = AsyncMock(side_effect=[doc, {**doc, "lines": [{**doc["lines"][0], "product_id": "p1", "product_name": "Kalem"}]}])
    fake_db.incoming_edocs.update_one = AsyncMock()
    fake_db.invoices.insert_one = AsyncMock()
    fake_db.contacts.update_one = AsyncMock()
    fake_db.products.update_one = AsyncMock()
    edocs.init(fake_db, {
        "create_product": AsyncMock(return_value={"product": {"id": "p1", "name": "Kalem"}}),
    })
    with patch("edocs.ensure_products_for_unmatched", AsyncMock(return_value=1)) as mock_ens:
        out = _run(edocs.approve_inbox_document("ed2", {"auto_create_products": True, "update_stock": True, "allow_unmatched": False}))
    mock_ens.assert_awaited()
    assert out["status"] == "success"
    assert out.get("invoice_id")
    # status approved
    set_calls = [c.args[1]["$set"] for c in fake_db.incoming_edocs.update_one.await_args_list if "$set" in (c.args[1] if len(c.args) > 1 else {})]
    assert any(s.get("status") == "approved" for s in set_calls)