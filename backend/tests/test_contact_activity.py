"""Cari silme: işlem varsa 400; yoksa silinir. Aktif/pasif bayrağı."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from contact_activity import activity_block_message, activity_parts, contact_is_active


def test_empty_contact_can_delete():
    assert activity_block_message({}) == ""
    assert activity_block_message({}, balance=0) == ""
    assert activity_block_message({}, balance=0.001) == ""


def test_invoice_or_order_blocks_delete():
    msg = activity_block_message({"invoices": 2, "orders": 1})
    assert "silinemez" in msg
    assert "Pasife" in msg
    assert "2 fatura" in msg
    assert "1 sipariş" in msg


def test_open_balance_blocks_delete():
    msg = activity_block_message({}, balance=12.5)
    assert "açık bakiye" in msg
    assert activity_block_message({}, balance=-8.2)
    assert "silinemez" in activity_block_message({}, balance=-8.2)


def test_legacy_missing_flag_is_active():
    assert contact_is_active({}) is True
    assert contact_is_active({"is_active": True}) is True
    assert contact_is_active({"is_active": False}) is False


def test_activity_parts_order():
    assert activity_parts({"cheques": 1, "invoices": 3}) == ["3 fatura", "1 çek/senet"]


def test_contact_model_defaults_active():
    from models import Contact
    c = Contact(company_id="c1", type="customer", name="X", tax_number_or_id="1111111111")
    dumped = c.to_mongo()
    assert dumped.get("is_active") is True
