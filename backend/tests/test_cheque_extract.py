import asyncio

import pytest

from cheque_extract import extract_cheque_file, normalize_cheque_draft, parse_cheque_text


def test_parse_cheque_text_fills_amount_vade_bank():
    draft = parse_cheque_text(
        "ALINAN ÇEK\nÇek No: 1234567\nBanka: Garanti BBVA\nŞube: Kadıköy\n"
        "Tutar: 50.000,00 ₺\nKeşide: 01.09.2026\nVade: 21.09.2026\nKeşideci: ERSAY HOME"
    )
    assert draft["instrument"] == "cheque"
    assert draft["direction"] == "received"
    assert draft["amount"] == 50000.0
    assert draft["serial_no"] == "1234567"
    assert draft["bank_name"] == "Garanti BBVA"
    assert draft["bank_branch"] == "Kadıköy"
    assert draft["due_date"] == "2026-09-21"
    assert draft["issue_date"] == "2026-09-01"
    assert draft["drawer_name"] == "ERSAY HOME"


def test_parse_cheque_text_promissory_issued():
    draft = parse_cheque_text("VERİLEN SENET\nToplam 1.250,50 TL\nVade tarihi 18.10.2026")
    assert draft["instrument"] == "promissory"
    assert draft["direction"] == "issued"
    assert draft["amount"] == 1250.5
    assert draft["due_date"] == "2026-10-18"


def test_normalize_cheque_draft_defaults():
    d = normalize_cheque_draft({"amount": "100,5", "instrument": "x"})
    assert d["instrument"] == "cheque"
    assert d["direction"] == "received"
    assert d["amount"] == 100.5


def test_extract_cheque_file_rejects_empty_and_unknown():
    with pytest.raises(ValueError, match="boş"):
        asyncio.run(extract_cheque_file(b"", "a.jpg", "image/jpeg"))
    with pytest.raises(ValueError, match="JPEG"):
        asyncio.run(extract_cheque_file(b"xx", "note.docx", "application/msword"))
