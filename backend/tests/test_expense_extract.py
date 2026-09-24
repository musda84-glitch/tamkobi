import asyncio

import pytest

from expense_extract import extract_expense_file, guess_category, normalize_expense_draft, parse_expense_text


def test_parse_expense_slip_amount_vat_and_category():
    draft = parse_expense_text(
        "SHELL ISTANBUL\nFiş No: 44821\nTarih: 21.09.2026\nKDV %20\nGenel Toplam: 1.035,84 ₺\nAçıklama: Motorin"
    )
    assert draft["amount"] == 1035.84
    assert draft["vat_rate"] == 20
    assert draft["vat_included"] is True
    assert draft["date"] == "2026-09-21"
    assert draft["document_no"] == "44821"
    assert draft["category"] == "Yakıt"
    assert "Motorin" in draft["description"]


def test_guess_category_from_merchant():
    assert guess_category("Yemek çeki Starbucks") == "Yemek"
    assert guess_category("Yurtiçi Kargo") == "Kargo / Nakliye"
    assert guess_category("bilinmeyen dükkan") == "Diğer"


def test_normalize_unknown_category():
    d = normalize_expense_draft({"amount": "100,5", "category": "xyz", "description": ""})
    assert d["category"] == "Diğer"
    assert d["amount"] == 100.5
    assert d["description"] == "Masraf fişi"
    assert d["vat_included"] is True


def test_extract_expense_file_rejects_empty_and_unknown():
    with pytest.raises(ValueError, match="boş"):
        asyncio.run(extract_expense_file(b"", "a.jpg", "image/jpeg"))
    with pytest.raises(ValueError, match="JPEG"):
        asyncio.run(extract_expense_file(b"xx", "note.docx", "application/msword"))
