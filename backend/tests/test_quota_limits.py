"""Quota limit resolution (no live DB)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from saas import resolve_quota_limit, QUOTA_KEYS


def test_override_wins():
    plan = {"product_limit": 250, "contact_limit": 150, "storage_limit_mb": 512, "company_limit": 1, "user_limit": 2}
    lic = {"product_limit": 10, "contact_limit": None, "storage_limit_mb": 0}
    assert resolve_quota_limit(plan, lic, "product_limit") == 10
    assert resolve_quota_limit(plan, lic, "contact_limit") == 150
    assert resolve_quota_limit(plan, lic, "storage_limit_mb") == 0  # 0 = unlimited override
    assert resolve_quota_limit(plan, lic, "company_limit") == 1
    assert resolve_quota_limit(plan, lic, "user_limit") == 2


def test_blank_and_missing_inherit_plan():
    plan = {"product_limit": 250}
    assert resolve_quota_limit(plan, {}, "product_limit") == 250
    assert resolve_quota_limit(plan, {"product_limit": ""}, "product_limit") == 250
    assert resolve_quota_limit(plan, None, "product_limit") == 250
    assert resolve_quota_limit(None, None, "product_limit") == 0


def test_quota_keys():
    assert "product_limit" in QUOTA_KEYS
    assert "contact_limit" in QUOTA_KEYS
    assert "storage_limit_mb" in QUOTA_KEYS
    assert "company_limit" in QUOTA_KEYS
