"""Per-contact B2B portal settings resolve over company defaults."""
import statement_share
import server


def test_resolve_b2b_settings_company_only():
    company = {"b2b_settings": {"allow_orders": False, "min_order_amount": 500}}
    s = server.resolve_b2b_settings(company, None)
    assert s["allow_orders"] is False
    assert s["min_order_amount"] == 500
    assert s["show_prices"] is True


def test_resolve_b2b_settings_contact_overrides():
    company = {"b2b_settings": {"allow_orders": True, "show_prices": True, "min_order_amount": 100}}
    contact = {"b2b_portal_settings": {"allow_orders": False, "welcome_note": "Bayi özel", "min_order_amount": 0}}
    s = server.resolve_b2b_settings(company, contact)
    assert s["allow_orders"] is False
    assert s["show_prices"] is True
    assert s["welcome_note"] == "Bayi özel"
    assert s["min_order_amount"] == 0


def test_contact_b2b_portal_view():
    company = {"b2b_settings": {"enabled": True, "login_method": "both", "allow_ai_cart": False}}
    contact = {
        "_id": "cnt_x",
        "b2b_enabled": True,
        "b2b_token": "tok",
        "b2b_discount": 12,
        "b2b_login_email": "a@b.com",
        "b2b_password_hash": "x",
        "b2b_portal_settings": {"allow_ai_cart": True, "show_installments": False},
    }
    v = server.contact_b2b_portal_view(contact, company)
    assert v["b2b_enabled"] is True
    assert v["settings"]["allow_ai_cart"] is True
    assert v["settings"]["show_installments"] is False
    assert v["company_defaults"]["allow_ai_cart"] is False
    assert v["has_password"] is True
    assert v["login_method"] == "both"


def test_b2b_statement_row_adds_only_gib_fields():
    rows = statement_share.statement_rows([{
        "invoice_number": "SF-1",
        "invoice_type": "sales",
        "grand_total": 10,
        "issue_date": "2026-10-01",
        "status": "approved",
        "einvoice_state": "sent",
        "e_type": "e_invoice",
        "gib_uuid": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        "gib_status": "İletildi",
        "company_id": "co-1",
    }], [])
    published = server._b2b_public_statement_row(rows[0])
    assert published["gib"] == "sent" and published["e_type"] == "e_invoice"
    assert published["balance"] == 10
    extra = set(published) - {"date", "doc", "debit", "credit", "balance", "kind"}
    assert extra == {"gib", "e_type"}
    poisoned = server._b2b_public_statement_row({
        **rows[0],
        "gib_uuid": "foreign-ettn",
        "gib_status": "İletildi",
        "company_id": "co-other",
        "_id": "inv-foreign",
    })
    blob = str(poisoned)
    assert "foreign-ettn" not in blob and "co-other" not in blob and "inv-foreign" not in blob
    assert "gib_uuid" not in poisoned and "gib_status" not in poisoned
    assert set(poisoned) == {"date", "doc", "debit", "credit", "balance", "kind", "gib", "e_type"}
