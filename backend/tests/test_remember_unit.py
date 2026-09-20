"""Stok birimi → firma birimler listesi senkronu (saf yardımcılar)."""


def normalize_unit_name(name):
    if name is None:
        return None
    n = str(name).strip()
    return n or None


def test_normalize_unit_name():
    assert normalize_unit_name("  Kg  ") == "Kg"
    assert normalize_unit_name("") is None
    assert normalize_unit_name("   ") is None
    assert normalize_unit_name(None) is None
    assert normalize_unit_name("Paket") == "Paket"
