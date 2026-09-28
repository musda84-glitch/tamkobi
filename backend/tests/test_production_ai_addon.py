"""AI üretim danışmanı — eklenti kapalıyken 403, açıkken özet döner."""
import os
import sys

import pytest
import requests

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from conftest import API, TEST_COMPANY_ID  # noqa: E402
import addons


def test_production_addon_in_catalog():
    assert "ai.production" in addons.ADDON_KEYS
    assert addons.addon_for_path("/api/ai/production-summary") == "ai.production"


def test_production_summary_gated_when_off():
    # Varsayılan kapalı → RBAC/addon guard 403 (veya oturumsuz 401/403)
    r = requests.get(f"{API}/ai/production-summary", params={"company_id": TEST_COMPANY_ID}, timeout=30)
    assert r.status_code in (401, 403), r.text
