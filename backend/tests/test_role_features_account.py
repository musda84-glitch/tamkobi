"""Unit tests for role feature defaults (account_companies, export_personal_data)."""
import rbac


def test_feature_keys_include_account_and_export():
    keys = {k for k, _, _ in rbac.FEATURES}
    assert "account_companies" in keys
    assert "export_personal_data" in keys
    assert "sevk_open_order" in keys
    assert "sevk_draft_invoice" in keys


def test_personel_defaults_hide_companies_and_export():
    feats = rbac.role_features({"code": "personel", "features": {}})
    assert feats["account_companies"] is False
    assert feats["export_personal_data"] is False
    assert feats["view_prices"] is False


def test_production_defaults_hide_prices():
    feats = rbac.role_features({"code": "production", "features": {}})
    assert feats["view_prices"] is False


def test_manager_defaults_allow_companies_and_export():
    feats = rbac.role_features({"code": "manager", "features": {}})
    assert feats["account_companies"] is True
    assert feats["export_personal_data"] is True
    assert feats["view_prices"] is True


def test_saved_false_overrides_default():
    feats = rbac.role_features({"code": "manager", "features": {"account_companies": False, "export_personal_data": False}})
    assert feats["account_companies"] is False
    assert feats["export_personal_data"] is False


def test_personel_can_be_granted_prices_and_export():
    feats = rbac.role_features({
        "code": "personel",
        "features": {"export_personal_data": True, "account_companies": True, "view_prices": True},
    })
    assert feats["export_personal_data"] is True
    assert feats["account_companies"] is True
    assert feats["view_prices"] is True


def test_admin_always_all_true():
    feats = rbac.role_features({"code": "admin", "features": {"export_personal_data": False}})
    assert all(feats.values())


def test_mask_money_hides_line_incl_prices():
    out = rbac.mask_money({
        "grand_total": 250.0,
        "items": [{
            "quantity": 1,
            "unit_price": 227.27,
            "unit_price_incl": 250.0,
            "total": 227.27,
            "total_incl": 250.0,
            "product_name": "Duvar Rafı",
        }],
    })
    assert out["grand_total"] == 0
    assert out["items"][0]["unit_price"] == 0
    assert out["items"][0]["unit_price_incl"] == 0
    assert out["items"][0]["total"] == 0
    assert out["items"][0]["total_incl"] == 0
    assert out["items"][0]["product_name"] == "Duvar Rafı"
    assert out["items"][0]["quantity"] == 1


def test_mask_money_coerces_numeric_strings():
    out = rbac.mask_money({"unit_price": "227,27", "total_incl": "250.00", "sku": "DRC"})
    assert out["unit_price"] == 0
    assert out["total_incl"] == 0
    assert out["sku"] == "DRC"