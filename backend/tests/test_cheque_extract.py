import asyncio
from pathlib import Path

import pytest

from cheque_extract import (
    cheque_draft_is_strong,
    extract_cheque_file,
    extract_cheque_from_image,
    extract_cheque_from_text,
    merge_cheque_drafts,
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


def test_cheque_draft_is_strong_needs_amount_plus_key_field():
    assert cheque_draft_is_strong(None) is False
    assert cheque_draft_is_strong({"amount": 0, "confidence": 0.9, "due_date": "2026-09-21"}) is False
    assert cheque_draft_is_strong({"amount": 100, "confidence": 0.55}) is False
    assert cheque_draft_is_strong({"amount": 100, "confidence": 0.55, "due_date": "2026-09-21"}) is True


def test_merge_cheque_drafts_fills_empty_ai_fields():
    merged = merge_cheque_drafts(
        {"amount": 7500, "instrument": "cheque", "confidence": 0.9},
        {"amount": 7500, "due_date": "2026-10-01", "bank_name": "Ziraat", "serial_no": "X1"},
    )
    assert merged["amount"] == 7500
    assert merged["due_date"] == "2026-10-01"
    assert merged["bank_name"] == "Ziraat"
    assert merged["serial_no"] == "X1"


def test_extract_cheque_from_text_skips_ai_when_heuristic_is_strong(monkeypatch):
    async def boom(_text):
        raise AssertionError("AI should not run when regex already filled the cheque")

    monkeypatch.setattr("cheque_extract._ai_cheque_from_text", boom)
    draft = asyncio.run(extract_cheque_from_text(
        "ALINAN ÇEK\nÇek No: 1234567\nBanka: Garanti BBVA\nTutar: 50.000,00 ₺\nVade: 21.09.2026"
    ))
    assert draft["amount"] == 50000.0
    assert draft["due_date"] == "2026-09-21"
    assert draft["serial_no"] == "1234567"


def test_extract_cheque_from_text_uses_ai_when_heuristic_is_weak(monkeypatch):
    async def fake_ai(_text):
        return normalize_cheque_draft({
            "instrument": "cheque",
            "direction": "received",
            "amount": 7500,
            "due_date": "2026-10-01",
            "serial_no": "X1",
            "confidence": 0.91,
        })

    monkeypatch.setattr("cheque_extract._ai_cheque_from_text", fake_ai)
    draft = asyncio.run(extract_cheque_from_text("bu belgede net tutar satırı yok"))
    assert draft["amount"] == 7500
    assert draft["due_date"] == "2026-10-01"
    assert draft["serial_no"] == "X1"


def test_extract_cheque_from_text_falls_back_when_ai_fails(monkeypatch):
    async def boom(_text):
        raise RuntimeError("provider down")

    monkeypatch.setattr("cheque_extract._ai_cheque_from_text", boom)
    draft = asyncio.run(extract_cheque_from_text("Tutar: 250,00 TL"))
    assert draft["amount"] == 250.0


def test_extract_cheque_from_image_uses_ai(monkeypatch):
    async def fake_ai(_data, _mime):
        return normalize_cheque_draft({
            "amount": 1200,
            "due_date": "2026-11-01",
            "bank_name": "Ziraat",
            "confidence": 0.8,
        })

    monkeypatch.setattr("cheque_extract._ai_cheque_from_image", fake_ai)
    draft = asyncio.run(extract_cheque_from_image(b"jpeg-bytes", "image/jpeg"))
    assert draft["amount"] == 1200
    assert draft["bank_name"] == "Ziraat"


def test_extract_cheque_from_image_parses_notes_when_ai_amount_missing(monkeypatch):
    async def fake_ai(_data, _mime):
        return normalize_cheque_draft({
            "amount": 0,
            "notes": "Tutar: 1.250,50 TL Vade: 18.10.2026 Banka: Garanti",
            "confidence": 0.2,
        })

    monkeypatch.setattr("cheque_extract._ai_cheque_from_image", fake_ai)
    draft = asyncio.run(extract_cheque_from_image(b"jpeg-bytes", "image/jpeg"))
    assert draft["amount"] == 1250.5
    assert draft["due_date"] == "2026-10-18"


def test_extract_cheque_from_image_raises_when_ai_empty(monkeypatch):
    async def boom(_data, _mime):
        raise RuntimeError("vision timeout")

    monkeypatch.setattr("cheque_extract._ai_cheque_from_image", boom)
    with pytest.raises(ValueError, match="tutar"):
        asyncio.run(extract_cheque_from_image(b"jpeg-bytes", "image/jpeg"))
