import asyncio
from pathlib import Path

import pytest

from cheque_extract import (
    extract_cheque_file,
    normalize_cheque_draft,
    parse_cheque_text,
    public_cheque_match,
    session_token_from_headers,
)


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


def test_public_cheque_match_drops_tokens_and_balance():
    assert public_cheque_match(None) is None
    out = public_cheque_match({
        "_id": "c1",
        "name": "ERSAY HOME",
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
        "name": "ERSAY HOME",
        "tax_number_or_id": "1111111111",
        "phone": "0555",
        "email": "a@b.com",
    }
    assert "b2b_token" not in out
    assert "balance" not in out
    assert "address" not in out


def test_cheque_extract_handler_requires_session_and_company():
    src = (Path(__file__).resolve().parents[1] / "server.py").read_text()
    start = src.index("async def ai_cheque_extract(")
    chunk = src[start:src.index("@api_router.post(\"/ai/invoice-extract/confirm\")")]
    assert "user: dict = Depends(get_current_user)" in chunk
    assert "_require_request_token(request)" in chunk
    assert "saas._require_company_access(user, company_id)" in chunk
    assert "public_cheque_match(match)" in chunk


def test_session_token_from_headers_requires_bearer_or_cookie():
    assert session_token_from_headers("", "") is None
    assert session_token_from_headers("Bearer", "") is None
    assert session_token_from_headers("Bearer   ", "") is None
    assert session_token_from_headers("Bearer tok-1", "") == "tok-1"
    assert session_token_from_headers("", "cookie-tok") == "cookie-tok"
    assert session_token_from_headers("Bearer tok-1", "cookie-tok") == "tok-1"


def test_extract_cheque_file_rejects_empty_and_unknown():
    with pytest.raises(ValueError, match="boş"):
        asyncio.run(extract_cheque_file(b"", "a.jpg", "image/jpeg"))
    with pytest.raises(ValueError, match="JPEG"):
        asyncio.run(extract_cheque_file(b"xx", "note.docx", "application/msword"))
