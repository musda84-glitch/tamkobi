"""Banka hareket açıklaması: Türkçe alan adları + karşı taraf."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import bank_providers as bp


def test_norm_key_folds_turkish_letters():
    assert bp._norm_key("Açıklama") == "aciklama"
    assert bp._norm_key("İşlem_Açıklaması") == "islemaciklamasi"
    assert bp._norm_key("Açıklama") == bp._norm_key("aciklama")
    assert bp._norm_key("GönderenAdı") == bp._norm_key("gonderenAdi")


def test_ci_get_reads_turkish_aciklama():
    row = {"Açıklama": "SHELL ISTANBUL", "Tutar": "100,00"}
    assert bp._ci_get(row, "aciklama", "description") == "SHELL ISTANBUL"


def test_normalize_uses_turkish_description_and_counterparty():
    rows = bp._normalize_tx_rows({
        "hareketler": [
            {
                "fisNo": "F9",
                "tutar": "250,00",
                "borcAlacak": "B",
                "Açıklama": "POS Harcama",
                "GönderenAdı": "",
                "AlıcıAdı": "SHELL TR",
                "islemTarihi": "09.10.2026",
            },
        ],
    })
    assert len(rows) == 1
    assert "POS Harcama" in rows[0]["description"]
    assert "SHELL" in rows[0]["description"] or rows[0]["counterparty"] == "SHELL TR"
    assert rows[0]["counterparty"] == "SHELL TR"
    assert rows[0]["description"] != "Banka Hareketi"


def test_normalize_fallback_counterparty_when_no_description():
    rows = bp._normalize_tx_rows({
        "transactions": [
            {
                "transactionId": "X1",
                "amount": 80,
                "direction": "credit",
                "senderName": "AHMET YILMAZ",
                "transactionDate": "2026-10-09",
            },
        ],
    })
    assert rows[0]["description"] == "Gelen · AHMET YILMAZ"
    assert rows[0]["counterparty"] == "AHMET YILMAZ"
    assert "Banka Hareketi" not in rows[0]["description"]


def test_normalize_nested_detail_description():
    rows = bp._normalize_tx_rows({
        "items": [
            {
                "id": "N1",
                "amount": 12,
                "direction": "debit",
                "transactionDate": "2026-10-01",
                "transactionDetail": {"explanation": "Fatura ödemesi", "receiverName": "TEDAŞ"},
            },
        ],
    })
    assert "Fatura ödemesi" in rows[0]["description"]
    assert rows[0]["counterparty"] == "TEDAŞ"
