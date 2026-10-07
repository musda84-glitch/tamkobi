"""SGK/IBAN kuralı yalnız ilgili alan güncellemelerinde uygulanır."""
from employee_sgk import sgk_iban_update_error


def test_unrelated_update_allowed_when_legacy_sgk_without_iban():
    existing = {"sgk_number": "1234567890123", "iban": None, "annual_leave_days": 14}
    assert sgk_iban_update_error(existing, {"annual_leave_days": 20}) is None


def test_sgk_without_iban_rejected_when_touching_sgk():
    existing = {"sgk_number": None, "iban": None}
    err = sgk_iban_update_error(existing, {"sgk_number": "1234567890123"})
    assert err and "IBAN" in err


def test_clearing_iban_while_sgk_set_rejected():
    existing = {"sgk_number": "1234567890123", "iban": "TR330006100519786457841326"}
    err = sgk_iban_update_error(existing, {"iban": None})
    assert err and "IBAN" in err


def test_sgk_with_iban_ok():
    existing = {"sgk_number": None, "iban": None}
    assert sgk_iban_update_error(
        existing,
        {"sgk_number": "1234567890123", "iban": "TR33 0006 1005 1978 6457 8413 26"},
    ) is None
