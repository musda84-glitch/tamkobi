import asyncio
from pathlib import Path

import pytest

from expense_extract import (
    expense_draft_is_strong,
    extract_expense_file,
    extract_expense_from_image,
    extract_expense_from_text,
    guess_category,
    merge_expense_drafts,
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


def test_expense_draft_is_strong_needs_amount_plus_key_field():
    assert expense_draft_is_strong(None) is False
    assert expense_draft_is_strong({"amount": 0, "confidence": 0.9, "date": "2026-09-21"}) is False
    assert expense_draft_is_strong({"amount": 100, "confidence": 0.55, "category": "Diğer", "description": "Masraf fişi"}) is False
    assert expense_draft_is_strong({"amount": 100, "confidence": 0.55, "date": "2026-09-21"}) is True
    assert expense_draft_is_strong({"amount": 100, "confidence": 0.55, "category": "Yakıt"}) is True


def test_merge_expense_drafts_fills_empty_ai_fields():
    merged = merge_expense_drafts(
        {"amount": 80, "category": "Diğer", "description": "Masraf fişi", "confidence": 0.9},
        {"amount": 80, "date": "2026-09-21", "category": "Yemek", "description": "Öğle yemeği", "document_no": "88"},
    )
    assert merged["amount"] == 80
    assert merged["date"] == "2026-09-21"
    assert merged["category"] == "Yemek"
    assert merged["description"] == "Öğle yemeği"
    assert merged["document_no"] == "88"


def test_extract_expense_from_text_skips_ai_when_heuristic_is_strong(monkeypatch):
    async def boom(_text):
        raise AssertionError("AI should not run when regex already filled the slip")

    monkeypatch.setattr("expense_extract._ai_expense_from_text", boom)
    draft = asyncio.run(extract_expense_from_text(
        "SHELL ISTANBUL\nFiş No: 44821\nTarih: 21.09.2026\nKDV %20\nGenel Toplam: 1.035,84 ₺\nAçıklama: Motorin"
    ))
    assert draft["amount"] == 1035.84
    assert draft["document_no"] == "44821"
    assert draft["category"] == "Yakıt"


def test_extract_expense_from_text_uses_ai_when_heuristic_is_weak(monkeypatch):
    async def fake_ai(_text):
        return normalize_expense_draft({
            "amount": 80,
            "category": "Yemek",
            "description": "Öğle yemeği",
            "date": "2026-09-21",
            "confidence": 0.91,
        })

    monkeypatch.setattr("expense_extract._ai_expense_from_text", fake_ai)
    draft = asyncio.run(extract_expense_from_text("bu belgede net tutar satırı yok"))
    assert draft["amount"] == 80
    assert draft["category"] == "Yemek"
    assert draft["description"] == "Öğle yemeği"


def test_extract_expense_from_text_falls_back_when_ai_fails(monkeypatch):
    async def boom(_text):
        raise RuntimeError("provider down")

    monkeypatch.setattr("expense_extract._ai_expense_from_text", boom)
    draft = asyncio.run(extract_expense_from_text("Tutar: 250,00 TL"))
    assert draft["amount"] == 250.0


def test_extract_expense_from_image_uses_ai(monkeypatch):
    async def fake_ai(_data, _mime):
        return normalize_expense_draft({
            "amount": 1035.84,
            "category": "Yakıt",
            "description": "Motorin",
            "confidence": 0.8,
        })

    monkeypatch.setattr("expense_extract._ai_expense_from_image", fake_ai)
    draft = asyncio.run(extract_expense_from_image(b"jpeg-bytes", "image/jpeg"))
    assert draft["amount"] == 1035.84
    assert draft["category"] == "Yakıt"


def test_extract_expense_from_image_parses_notes_when_ai_amount_missing(monkeypatch):
    async def fake_ai(_data, _mime):
        return normalize_expense_draft({
            "amount": 0,
            "notes": "SHELL ISTANBUL Genel Toplam: 1.035,84 ₺ Tarih: 21.09.2026",
            "confidence": 0.2,
        })

    monkeypatch.setattr("expense_extract._ai_expense_from_image", fake_ai)
    draft = asyncio.run(extract_expense_from_image(b"jpeg-bytes", "image/jpeg"))
    assert draft["amount"] == 1035.84
    assert draft["date"] == "2026-09-21"


def test_extract_expense_from_image_raises_when_ai_empty(monkeypatch):
    async def boom(_data, _mime):
        raise RuntimeError("vision timeout")

    monkeypatch.setattr("expense_extract._ai_expense_from_image", boom)
    with pytest.raises(ValueError, match="tutar"):
        asyncio.run(extract_expense_from_image(b"jpeg-bytes", "image/jpeg"))
