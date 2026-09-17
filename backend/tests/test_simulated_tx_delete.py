"""Simüle banka hareketleri silinebilir; canlı bank_sync kilitli kalır."""
from server import _assert_editable_tx
from fastapi import HTTPException


def test_simulated_bank_sync_is_editable():
    _assert_editable_tx({"source": "bank_sync", "is_simulated": True, "_id": "1"})


def test_live_bank_sync_still_locked():
    try:
        _assert_editable_tx({"source": "bank_sync", "is_simulated": False, "_id": "1"})
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400
        assert "silinemez" in e.detail.lower() or "düzenlenemez" in e.detail.lower()


def test_partner_still_locked():
    try:
        _assert_editable_tx({"source": "partner", "is_simulated": True, "_id": "1"})
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 400
