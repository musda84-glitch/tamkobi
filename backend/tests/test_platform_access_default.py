"""Yeni şirketlerde yönetim paneli erişimi varsayılan kapalı."""
from saas_extras import DEFAULT_ALLOW_PLATFORM_ACCESS, platform_access_allowed


def test_default_constant_is_closed():
    assert DEFAULT_ALLOW_PLATFORM_ACCESS is False


def test_platform_access_explicit_false():
    assert platform_access_allowed({"allow_platform_access": False}) is False


def test_platform_access_explicit_true():
    assert platform_access_allowed({"allow_platform_access": True}) is True


def test_platform_access_missing_field_legacy_open():
    """Eski şirketlerde alan yoksa açık kalsın (geri uyumluluk)."""
    assert platform_access_allowed({}) is True
    assert platform_access_allowed({"name": "X"}) is True


def test_platform_access_no_company_denied():
    assert platform_access_allowed(None) is False
