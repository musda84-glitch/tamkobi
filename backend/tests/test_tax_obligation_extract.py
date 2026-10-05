import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from tax_obligation_extract import (
    SOURCE_KINDS,
    due_date_for,
    extract_tax_file,
    guess_source_kind,
    map_obligation_kind,
    merge_tax_drafts,
    normalize_import_lines,
    normalize_tax_draft,
    parse_bordro,
    parse_mizan,
    parse_period,
    parse_tahakkuk,
    parse_tax_text,
)


BORDRO = """
MATEK YAZILIM
Aylık Bordro
Dönem: Eylül 2026
Personel sayısı: 4
Brüt Ücret: 180.000,00
SGK İşçi Payı: 25.200,00
İşsizlik İşçi: 1.800,00
Gelir Vergisi: 12.000,00
Damga Vergisi: 1.365,60
Net Ücret: 139.634,40
SGK İşveren: 27.900,00
İşsizlik İşveren: 3.600,00
İşveren Maliyeti: 211.500,00
"""

TAHAKKUK = """
GELİR İDARESİ BAŞKANLIĞI
TAHAKKUK FİŞİ
Vergi Türü: Katma Değer Vergisi
Dönem: 2026/09
Tahakkuk No: 2026/123456
Ödenecek Tutar: 18.450,00 TL
Son Ödeme Tarihi: 28.10.2026
"""

MIZAN = """
MİZAN 30.09.2026
Hesap Kodu  Hesap Adı  Borç  Alacak  Bakiye
100 Kasa  5.000,00  0,00  5.000,00 B
335 Personele Borçlar  0,00  139.634,40  139.634,40 A
360 Ödenecek Vergi ve Fonlar  0,00  18.450,00  18.450,00 A
361 Ödenecek Sosyal Güvenlik Kesintileri  0,00  58.500,00  58.500,00 A
"""


def test_period_from_filename_and_month_name():
    assert parse_period("", "matek bordro 2026-09.pdf") == "2026-09"
    assert parse_period("Dönem: Eylül 2026") == "2026-09"
    assert due_date_for("sgk", "2026-09") == "2026-10-26"
    assert due_date_for("kdv", "2026-09") == "2026-10-28"


def test_guess_kind_bordro_mizan_tahakkuk():
    assert guess_source_kind("matek bordro 2026-09.pdf", "") == "bordro"
    assert guess_source_kind("eylul-mizan.pdf", "") == "mizan"
    assert guess_source_kind("kdv-tahakkuk.pdf", "") == "tahakkuk"


def test_parse_bordro_payables():
    d = parse_bordro(BORDRO, "matek bordro 2026-09.pdf")
    assert d["period"] == "2026-09"
    assert d["summary"]["gross"] == 180000
    assert d["summary"]["net"] == 139634.40
    assert d["summary"]["employer_cost"] == 211500
    assert d["summary"]["count"] == 4
    kinds = {o["kind"]: o["amount"] for o in d["obligations"]}
    assert kinds["sgk"] == 58500  # 25200+1800+27900+3600
    assert kinds["gelir_vergisi"] == 12000
    assert kinds["damga"] == 1365.60
    assert kinds["personel"] == 139634.40


def test_parse_tahakkuk_kdv():
    d = parse_tahakkuk(TAHAKKUK)
    assert d["source_kind"] == "tahakkuk"
    assert d["period"] == "2026-09"
    assert d["obligations"][0]["kind"] == "kdv"
    assert d["obligations"][0]["amount"] == 18450
    assert d["obligations"][0]["due_date"] == "2026-10-28"


def test_parse_mizan_liability_accounts():
    d = parse_mizan(MIZAN)
    kinds = {o["kind"]: o["amount"] for o in d["obligations"]}
    assert kinds["personel"] == 139634.40
    assert kinds["vergi"] == 18450
    assert kinds["sgk"] == 58500
    assert "kasa" not in str(kinds).lower()


def test_filename_routes_parse_tax_text():
    d = parse_tax_text(BORDRO, "matek bordro 2026-09.pdf")
    assert d["source_kind"] == "bordro"
    lines = normalize_import_lines(d, [0, 1])
    assert len(lines) == 2
    assert all(x["amount"] > 0 for x in lines)


def test_map_obligation_kind():
    assert map_obligation_kind("SGK") == "sgk"
    assert map_obligation_kind("gv") == "gelir_vergisi"
    assert map_obligation_kind("Katma Değer") == "kdv"
    d = normalize_tax_draft({
        "source_kind": "bordro",
        "period": "2026-09",
        "title": "Matek Bordro",
        "summary": {"gross": "180.000,00", "net": 139634.4, "employer_cost": 211500, "count": 4},
        "obligations": [
            {"kind": "SGK primi", "amount": "58.500,00"},
            {"kind": "gv", "title": "Gelir vergisi", "amount": 12000},
            {"kind": "kdv", "amount": 0},
        ],
    }, "matek bordro 2026-09.pdf")
    kinds = {o["kind"]: o["amount"] for o in d["obligations"]}
    assert d["period"] == "2026-09"
    assert kinds["sgk"] == 58500
    assert kinds["gelir_vergisi"] == 12000
    assert "kdv" not in kinds
    assert d["summary"]["gross"] == 180000


def test_merge_tax_drafts_fills_heuristic_when_ai_empty():
    ai = normalize_tax_draft({"source_kind": "tahakkuk", "obligations": []})
    heur = parse_tahakkuk(TAHAKKUK)
    merged = merge_tax_drafts(ai, heur)
    assert merged["obligations"][0]["amount"] == 18450
    assert merged["obligations"][0]["kind"] == "kdv"


def test_extract_txt_file_falls_back_without_ai():
    import asyncio
    from unittest.mock import AsyncMock, patch

    with patch("tax_obligation_extract._ai_tax_from_text", new_callable=AsyncMock, side_effect=RuntimeError("no ai")):
        out = asyncio.run(extract_tax_file(TAHAKKUK.encode("utf-8"), "kdv.txt", "text/plain"))
    assert out["draft"]["obligations"][0]["amount"] == 18450


def test_extract_prefers_ai_lines():
    import asyncio
    from unittest.mock import AsyncMock, patch

    ai_draft = normalize_tax_draft({
        "source_kind": "tahakkuk",
        "period": "2026-09",
        "obligations": [{"kind": "kdv", "amount": 18450, "due_date": "2026-10-28"}],
    })
    with patch("tax_obligation_extract._ai_tax_from_text", new_callable=AsyncMock, return_value=ai_draft):
        out = asyncio.run(extract_tax_file(TAHAKKUK.encode("utf-8"), "kdv.txt", "text/plain"))
    assert out["source"].startswith("ai")
    assert out["draft"]["obligations"][0]["kind"] == "kdv"
