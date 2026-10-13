"""Cari arama: 1000+ kayıt, kelime ortası, Türkçe katlama, ikisi-birden tipi."""
from contact_search import fold_tr, search_contacts
from contact_tax import contact_tax_patch, plan_sales_invoice_tax_backfill


def _row(i, **extra):
    base = {
        "_id": f"c{i}",
        "name": f"Cari {i:04d} Ltd",
        "type": "customer",
        "is_active": True,
        "company_title": "",
        "category": f"K{i:04d}",
        "tax_number_or_id": "",
        "phone": "",
        "email": "",
    }
    base.update(extra)
    return base


def test_fold_tr_maps_turkish_letters():
    assert fold_tr("ŞĞÜÖÇIİı") == "sguociii"
    assert fold_tr("İSTANBUL") == "istanbul"
    assert fold_tr("şırnak") == fold_tr("SIRNAK")


def test_last_contact_among_1001_is_found():
    contacts = [_row(i) for i in range(1001)]
    contacts[-1]["name"] = "ZZZ ERSAY HOME ÜRETİM TEDARİK"
    contacts[-1]["type"] = "both"
    res = search_contacts(contacts, "ersay", page=1, limit=20)
    assert res["total"] == 1
    assert res["items"][0]["_id"] == "c1000"
    assert res["items"][0]["type"] == "both"
    assert res["has_more"] is False


def test_mid_word_and_turkish_fold_match():
    contacts = [
        _row(1, name="ERSAY HOME ÜRETİM TEDARİK SANAYİ", type="both", company_title="Ersay Kısa"),
        _row(2, name="Şırnak Cam Sanayi", type="customer"),
        _row(3, name="Başka Firma", type="supplier", email="satis@ersay.com.tr"),
        _row(4, name="Kodlu", type="customer", category="ERSAY-01"),
        _row(5, name="Vergili", type="supplier", tax_number_or_id="3680486408"),
        _row(6, name="Telefoncu", type="customer", phone="0532 111 22 33"),
    ]
    assert search_contacts(contacts, "tedarik")["items"][0]["_id"] == "c1"
    assert search_contacts(contacts, "uretim")["items"][0]["_id"] == "c1"
    assert search_contacts(contacts, "ÜRETİM")["items"][0]["_id"] == "c1"
    assert search_contacts(contacts, "kisa")["items"][0]["_id"] == "c1"
    assert search_contacts(contacts, "sirnak")["items"][0]["_id"] == "c2"
    assert search_contacts(contacts, "ŞIRNAK")["items"][0]["_id"] == "c2"
    ersay_ids = {c["_id"] for c in search_contacts(contacts, "ersay", limit=20)["items"]}
    # name + email + cari kodu
    assert ersay_ids == {"c1", "c3", "c4"}
    assert search_contacts(contacts, "3680486408")["items"][0]["_id"] == "c5"
    assert search_contacts(contacts, "05321112233")["items"][0]["_id"] == "c6"


def test_customer_supplier_and_both_returned_inactive_hidden():
    contacts = [
        _row(1, name="Alpha ERSAY", type="customer"),
        _row(2, name="Beta ERSAY", type="supplier"),
        _row(3, name="Gamma ERSAY", type="both"),
        _row(4, name="Delta ERSAY", type="both", is_active=False),
        _row(5, name="Epsilon ERSAY", type="customer", is_active="false"),
    ]
    ids = [c["_id"] for c in search_contacts(contacts, "ersay")["items"]]
    assert ids == ["c1", "c2", "c3"]


def test_page_size_20_and_second_page():
    contacts = [_row(i, name=f"ERSAY kalem {i:04d}") for i in range(25)]
    page1 = search_contacts(contacts, "ersay", page=1, limit=20)
    page2 = search_contacts(contacts, "ersay", page=2, limit=20)
    assert page1["limit"] == 20
    assert len(page1["items"]) == 20
    assert page1["total"] == 25
    assert page1["has_more"] is True
    assert len(page2["items"]) == 5
    assert page2["has_more"] is False
    assert page1["items"][-1]["_id"] != page2["items"][0]["_id"]


def test_empty_query_returns_recent_active_contacts():
    contacts = [
        _row(1, name="Eski", updated_at="2020-01-01"),
        _row(2, name="Sipariş", type="both"),
        _row(3, name="Fatura", type="supplier"),
        _row(4, name="Pasif", type="customer", is_active=False),
    ]
    res = search_contacts(contacts, "", recent_ids=["c4", "c3", "c2"])
    assert [c["_id"] for c in res["items"]] == ["c3", "c2"]
    fallback = search_contacts(contacts, "   ", recent_ids=[])
    assert fallback["items"][0]["_id"] == "c1"


def test_contact_tax_patch_fills_only_blank_fields():
    empty = {"tax_number_or_id": "", "tax_office": None}
    patch = contact_tax_patch(empty, "3680 486 408", "Başakşehir")
    assert patch == {"tax_number_or_id": "3680486408", "tax_office": "Başakşehir"}
    filled = {"tax_number_or_id": "1234567890", "tax_office": "Kadıköy"}
    assert contact_tax_patch(filled, "3680486408", "Başakşehir") == {}
    assert contact_tax_patch(empty, "11111111111", "Perakende") == {}
    only_office = {"tax_number_or_id": "1234567890", "tax_office": ""}
    assert contact_tax_patch(only_office, "3680486408", "Başakşehir") == {"tax_office": "Başakşehir"}


def test_backfill_plan_uses_latest_sales_invoice_and_is_idempotent():
    contacts = [
        {"_id": "both1", "name": "ERSAY HOME", "tax_number_or_id": "", "tax_office": ""},
        {"_id": "has", "name": "Dolu", "tax_number_or_id": "9998887776", "tax_office": "Kadıköy"},
        {"_id": "retail", "name": "Perakende", "tax_number_or_id": "", "tax_office": ""},
    ]
    invoices = [
        {"invoice_type": "sales", "contact_id": "both1", "contact_tax_id": "1111111111", "contact_tax_office": "", "issue_date": "2024-01-01", "invoice_number": "E1"},
        {"invoice_type": "sales", "contact_id": "both1", "contact_tax_id": "3680486408", "contact_tax_office": "Eski VD", "issue_date": "2025-01-01", "invoice_number": "E2"},
        {"invoice_type": "sales", "contact_id": "both1", "contact_tax_id": "", "contact_tax_office": "Başakşehir", "issue_date": "2026-06-01", "invoice_number": "E3", "created_at": "2026-06-01"},
        {"invoice_type": "purchase", "contact_id": "both1", "contact_tax_id": "5555555555", "issue_date": "2026-07-01", "invoice_number": "A1"},
        {"invoice_type": "sales", "status": "cancelled", "contact_id": "both1", "contact_tax_id": "2222222222", "issue_date": "2026-08-01", "invoice_number": "X"},
        {"invoice_type": "sales", "contact_id": "has", "contact_tax_id": "3680486408", "contact_tax_office": "Başka", "issue_date": "2026-01-01", "invoice_number": "H1"},
        {"invoice_type": "sales", "contact_id": "retail", "contact_tax_id": "11111111111", "contact_tax_office": "Perakende", "issue_date": "2026-01-01", "invoice_number": "P1"},
        {"invoice_type": "dispatch", "contact_id": "both1", "contact_tax_id": "1010101010", "issue_date": "2026-09-01", "invoice_number": "D1"},
    ]
    plans = plan_sales_invoice_tax_backfill(contacts, invoices)
    assert len(plans) == 1
    assert plans[0]["contact_id"] == "both1"
    assert plans[0]["patch"]["tax_number_or_id"] == "3680486408"
    assert plans[0]["patch"]["tax_office"] == "Başakşehir"
    updated = dict(contacts[0])
    updated.update(plans[0]["patch"])
    again = plan_sales_invoice_tax_backfill([updated, contacts[1], contacts[2]], invoices)
    assert again == []
