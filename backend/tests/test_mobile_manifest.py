"""Public mobile app contract: /api/mobile/manifest is unauthenticated and skipped by RBAC."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import SKIP_PREFIXES, module_for_path  # noqa: E402


def test_mobile_prefix_skipped_from_rbac():
    assert "/api/mobile" in SKIP_PREFIXES


def test_mobile_manifest_is_not_an_erp_module():
    assert module_for_path("/api/mobile/manifest") is None
