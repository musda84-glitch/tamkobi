import asyncio

import pytest

from receipt_extract import extract_receipt_file, normalize_receipt_draft, parse_receipt_text, parse_tr_amount, parse_tr_date


def test_parse_tr_amount_tr_and_plain():
    assert parse_tr_amount("2.880,00") == 2880.0
    assert parse_tr_amount("1.250,50 ₺") == 1250.5
    assert parse_tr_amount("880,00 TL") == 880.0
    assert parse_tr_amount(1500) == 1500.0
    assert parse_tr_amount("") == 0.0


def test_parse_tr_date_dmy_and_iso():
    assert parse_tr_date("21.09.2026") == "2026-09-21"
    assert parse_tr_date("2026-09-21 makbuz") == "2026-09-21"
    assert parse_tr_date("") is None


def test_parse_receipt_text_inflow_amount_and_note():
    draft = parse_receipt_text(
        "TAHSİLAT MAKBUZU\nTutar: 2.880,00 ₺\nTarih: 21.09.2026\nAçıklama: Cari tahsilat POS"
    )
    assert draft["type"] == "inflow"
    assert draft["amount"] == 2880.0
    assert draft["date"] == "2026-09-21"
    assert draft["description"] == "Cari tahsilat POS"
    assert draft["confidence"] >= 0.5


def test_parse_receipt_text_outflow():
    draft = parse_receipt_text("TEDİYE / ÖDEME\nToplam 450,00 TL\nCariye ödeme")
    assert draft["type"] == "outflow"
    assert draft["amount"] == 450.0
    assert draft["description"] == "Cari ödeme"


def test_normalize_receipt_draft_defaults():
    d = normalize_receipt_draft({"type": "x", "amount": "100,5", "description": ""})
    assert d["type"] == "inflow"
    assert d["amount"] == 100.5
    assert d["description"] == "Cari tahsilat"


def test_extract_receipt_file_rejects_empty_and_unknown():
    with pytest.raises(ValueError, match="boş"):
        asyncio.run(extract_receipt_file(b"", "a.jpg", "image/jpeg"))
    with pytest.raises(ValueError, match="JPEG"):
        asyncio.run(extract_receipt_file(b"not-an-image", "note.docx", "application/msword"))
