"""Ortak hesabından cari ödeme/tahsilat düzenlenebilir; silince cari bakiyesi geri alınır."""
from server import _contact_balance_delta_for_partner_tx, _assert_editable_tx
from fastapi import HTTPException


def test_contact_delta_tahsilat_and_odeme():
    assert _contact_balance_delta_for_partner_tx({
        "contact_id": "c1", "type": "withdrawal", "amount": 100,
    }) == -100.0
    assert _contact_balance_delta_for_partner_tx({
        "contact_id": "c1", "type": "capital_in", "amount": 511304,
    }) == 511304.0
    assert _contact_balance_delta_for_partner_tx({
        "type": "capital_in", "amount": 50,
    }) == 0.0
    assert _contact_balance_delta_for_partner_tx({
        "contact_id": "c1", "type": "salary", "amount": 10,
    }) == 0.0


def test_bank_tx_partner_mirror_still_locked():
    """Banka defterindeki ortak nakit yansıması hâlâ banka API’sinden kilitli."""
    try:
        _assert_editable_tx({"source": "partner", "_id": "bt1"})
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400
