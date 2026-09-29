"""Unit tests for role feature defaults (account_companies, export_personal_data)."""
import rbac


def test_feature_keys_include_account_and_export():
    keys = {k for k, _, _ in rbac.FEATURES}
    assert "account_companies" in keys
    assert "export_personal_data" in keys


def test_personel_defaults_hide_companies_and_export():
    feats = rbac.role_features({"code": "personel", "features": {}})
    assert feats["account_companies"] is False
    assert feats["export_personal_data"] is False
    assert feats["view_prices"] is True


def test_manager_defaults_allow_companies_and_export():
    feats = rbac.role_features({"code": "manager", "features": {}})
    assert feats["account_companies"] is True
    assert feats["export_personal_data"] is True


def test_saved_false_overrides_default():
    feats = rbac.role_features({"code": "manager", "features": {"account_companies": False, "export_personal_data": False}})
    assert feats["account_companies"] is False
    assert feats["export_personal_data"] is False


def test_personel_can_be_granted_export():
    feats = rbac.role_features({"code": "personel", "features": {"export_personal_data": True, "account_companies": True}})
    assert feats["export_personal_data"] is True
    assert feats["account_companies"] is True


def test_admin_always_all_true():
    feats = rbac.role_features({"code": "admin", "features": {"export_personal_data": False}})
    assert all(feats.values())
