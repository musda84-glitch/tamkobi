"""Personelim self-service: /api/personnel/me is open to linked employees (RBAC skip)."""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from rbac import SKIP_PREFIXES, module_for_path  # noqa: E402
from saas import PANEL_MODULE_FROM  # noqa: E402


def test_personnel_me_skipped_from_rbac():
    assert any(p.startswith("/api/personnel/me") for p in SKIP_PREFIXES)
    assert any(p.startswith("/api/personnel/bonuses/self") for p in SKIP_PREFIXES)
    assert any(p.startswith("/api/personnel/attendance/intraday-leave-request") for p in SKIP_PREFIXES)


def test_personelim_aliases_mesai_license():
    assert PANEL_MODULE_FROM.get("/personelim") == "/mesai"
    assert "/mesai" not in PANEL_MODULE_FROM  # mesai stays first-class


def test_personnel_me_module_map_is_personnel_prefix():
    # Without skip, prefix map would classify under /personnel; skip bypasses that.
    assert module_for_path("/api/personnel/me") == "/personnel"
    assert module_for_path("/api/personnel/employees") == "/personnel"
