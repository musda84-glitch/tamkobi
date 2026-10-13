"""Unit tests for first-run wizard progress merge (skip / detect / dismiss)."""
from onboarding import (
    STEP_KEYS,
    apply_action,
    company_info_done,
    detect_steps,
    einvoice_done,
    merge_status,
    normalize_onboarding,
)


def test_company_and_einvoice_detection():
    assert company_info_done({"name": "Acme", "tax_number": "1234567890"}) is True
    assert company_info_done({"name": "Acme", "tax_number": "123"}) is False
    assert einvoice_done({"status": "configured"}) is True
    assert einvoice_done({"company_tax_id": "1234567890", "alias": "urn:mail:x"}) is True
    assert einvoice_done({"status": "simulated"}) is False


def test_detect_all_empty():
    d = detect_steps(company={}, einvoice={}, contact_count=0, product_count=0, invoice_count=0)
    assert d == {k: False for k in STEP_KEYS}


def test_merge_skips_and_progress():
    detected = {k: False for k in STEP_KEYS}
    detected["company"] = True
    stored = {"skipped_steps": ["logo", "einvoice"], "completed_steps": []}
    st = merge_status(stored, detected)
    assert st["progress_percent"] == 50
    assert st["show_wizard"] is True
    by = {s["key"]: s for s in st["steps"]}
    assert by["company"]["done"] is True and by["company"]["detected"] is True
    assert by["logo"]["skipped"] is True and by["logo"]["done"] is True
    assert by["contact"]["done"] is False
    assert "contact" in st["remaining"]


def test_dismiss_hides_wizard_even_if_incomplete():
    detected = {k: False for k in STEP_KEYS}
    stored = apply_action({}, action="dismiss")
    st = merge_status(stored, detected)
    assert st["dismissed"] is True
    assert st["show_wizard"] is False
    assert st["all_done"] is True  # skip-all counts as done
    assert st["progress_percent"] == 100


def test_reopen_clears_skips():
    stored = apply_action({}, action="dismiss")
    nxt = apply_action(stored, action="reopen")
    assert nxt["dismissed_at"] is None
    assert nxt["skipped_steps"] == []
    st = merge_status(nxt, {k: False for k in STEP_KEYS})
    assert st["show_wizard"] is True
    assert st["progress_percent"] == 0


def test_complete_and_unskip():
    stored = apply_action({}, action="skip", step="contact")
    stored = apply_action(stored, action="complete", step="product")
    assert "contact" in stored["skipped_steps"]
    assert "product" in stored["completed_steps"]
    stored = apply_action(stored, action="unskip", step="contact")
    assert "contact" not in stored["skipped_steps"]
    try:
        apply_action({}, action="skip", step="nope")
        assert False
    except ValueError:
        pass


def test_normalize_junk_keys():
    n = normalize_onboarding({"completed_steps": ["company", "company", "nope"], "skipped_steps": "logo"})
    assert n["completed_steps"] == ["company"]
    assert n["skipped_steps"] == ["logo"]
