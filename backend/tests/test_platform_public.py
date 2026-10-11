"""Merkezi yasal / destek iletişim alanları — env + platform ayarı."""
import os
from unittest import mock

import platform_public as pp


def test_merge_seller_from_settings():
    st = {
        "legal_name": "Örnek Yazılım A.Ş.",
        "legal_address": "Örnek Mah. No:1",
        "legal_city": "İstanbul",
        "legal_tax_number": "1234567890",
        "legal_tax_office": "Kadıköy",
        "legal_mersis": "0123456789012345",
        "legal_iban": "TR00 0000 0000 0000 0000 0000 00",
        "legal_bank_name": "Örnek Bank",
        "legal_phone": "+90 212 000 00 00",
        "legal_email": "destek@ornek.example",
        "support_email": "destek@ornek.example",
        "brand_name": "TamKobi",
    }
    s = pp.merge_seller({}, st)
    assert s["name"] == "Örnek Yazılım A.Ş."
    assert s["tax_number"] == "1234567890"
    assert s["mersis"] == "0123456789012345"
    assert s["iban"].startswith("TR")
    assert s["email"] == "destek@ornek.example"
    assert "—" not in (s["name"], s["address"], s["tax_number"], s["phone"])


def test_merge_seller_env_fallback():
    with mock.patch.dict(os.environ, {
        "PLATFORM_LEGAL_NAME": "Env Ünvan",
        "PLATFORM_LEGAL_ADDRESS": "Env Adres",
        "PLATFORM_LEGAL_TAX_NUMBER": "9988776655",
        "PLATFORM_SUPPORT_EMAIL": "env@ornek.example",
        "PLATFORM_SUPPORT_PHONE": "02120000000",
        "PLATFORM_LEGAL_MERSIS": "111",
        "PLATFORM_LEGAL_IBAN": "TR11",
    }, clear=False):
        s = pp.merge_seller({}, {})
        assert s["name"] == "Env Ünvan"
        assert s["address"] == "Env Adres"
        assert s["tax_number"] == "9988776655"
        assert s["email"] == "env@ornek.example"


def test_platform_seller_ignores_demo_company_name():
    demo = {"_id": "comp_nexus_main_01", "name": "Demo Nexus A.Ş.", "tax_number": "111"}
    s = pp.merge_seller(demo, {"brand_name": "TamKobi"}, use_company_party=False)
    assert s["name"] == "TamKobi"
    assert s["name"] != "Demo Nexus A.Ş."
    assert s["tax_number"] == "—"


def test_platform_doc_ignores_demo_legal_texts():
    from legal_docs import render_platform_doc

    demo = {
        "_id": "comp_nexus_main_01",
        "name": "Demo Nexus A.Ş.",
        "legal_texts": {"kvkk": "DEMO ÖZEL METİN ASLA GÖRÜNMEMELİ"},
    }
    doc = render_platform_doc("kvkk", demo, "TamKobi", {"brand_name": "TamKobi", "legal_name": "Resmi Ünvan A.Ş."})
    assert doc["customized"] is False
    assert "DEMO ÖZEL METİN" not in doc["text"]
    assert "Resmi Ünvan A.Ş." in doc["text"]
    assert doc["seller"]["name"] == "Resmi Ünvan A.Ş."


def test_public_contact_whatsapp_no_phone_fallback():
    c = pp.public_contact({"support_email": "a@b.com", "support_phone": "05321112233", "support_whatsapp": ""})
    assert c["support_email"] == "a@b.com"
    assert c["support_phone"] == "05321112233"
    assert c["support_whatsapp"] == ""
    assert pp.normalize_whatsapp("0532 111 22 33").startswith("90")
    assert pp.normalize_whatsapp("") == ""


def test_no_invented_placeholders_when_empty():
    """Boş ayarda uydurma şirket bilgisi yok; eksik alanlar '—' kalır."""
    with mock.patch.dict(os.environ, {}, clear=True):
        s = pp.merge_seller({}, {"brand_name": "TamKobi"})
        assert s["name"] == "TamKobi"
        assert s["address"] == "—"
        assert s["tax_number"] == "—"
        assert s["mersis"] == "—"
        assert s["iban"] == "—"
