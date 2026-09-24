import asyncio
from pathlib import Path

import pytest

from expense_extract import (
    extract_expense_file,
    guess_category,
    normalize_expense_draft,
    parse_expense_text,
    public_expense_match,
    session_token_from_headers,
)


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


def test_public_expense_match_drops_tokens_and_balance():
    assert public_expense_match(None) is None
    out = public_expense_match({
        "_id": "c1",
        "name": "SHELL ISTANBUL",
        "tax_number_or_id": "1111111111",
        "phone": "0555",
        "email": "a@b.com",
        "address": "gizli adres",
        "balance": 12000,
        "b2b_token": "portal-secret",
        "b2b_password_hash": "hash",
        "password_hash": "hash",
    })
    assert out == {
        "id": "c1",
        "name": "SHELL ISTANBUL",
        "tax_number_or_id": "1111111111",
        "phone": "0555",
        "email": "a@b.com",
    }
    assert "b2b_token" not in out
    assert "balance" not in out
    assert "address" not in out


def test_session_token_from_headers_requires_bearer_or_cookie():
    assert session_token_from_headers("", "") is None
    assert session_token_from_headers("Bearer", "") is None
    assert session_token_from_headers("Bearer   ", "") is None
    assert session_token_from_headers("Bearer tok-1", "") == "tok-1"
    assert session_token_from_headers("", "cookie-tok") == "cookie-tok"
    assert session_token_from_headers("Bearer tok-1", "cookie-tok") == "tok-1"


def test_expense_extract_handler_requires_session_and_company():
    src = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    start = src.index("async def ai_expense_extract(")
    chunk = src[start:src.index("@api_router.post(\"/ai/invoice-extract/confirm\")")]
    assert "user: dict = Depends(get_current_user)" in chunk
    assert "_require_request_token(request)" in chunk
    assert "saas._require_company_access(user, company_id)" in chunk
    assert "public_expense_match(match)" in chunk


def test_extract_expense_file_rejects_empty_and_unknown():
    with pytest.raises(ValueError, match="boş"):
        asyncio.run(extract_expense_file(b"", "a.jpg", "image/jpeg"))
    with pytest.raises(ValueError, match="JPEG"):
        asyncio.run(extract_expense_file(b"xx", "note.docx", "application/msword"))
