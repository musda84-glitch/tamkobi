"""Self-service advance request helpers (no live API)."""
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from fastapi import HTTPException  # noqa: E402

from attendance import bonus_counts_as_advance, parse_advance_self  # noqa: E402


def test_parse_advance_self_requires_amount():
    with pytest.raises(HTTPException) as exc:
        parse_advance_self({"amount": 0})
    assert exc.value.status_code == 400


def test_parse_advance_self_normalizes():
    out = parse_advance_self({"amount": "1250,50", "note": "  maaş avansı  ", "period": "2026-09"})
    assert out == {"amount": 1250.5, "note": "maaş avansı", "period": "2026-09"}


def test_parse_advance_self_rejects_bad_period():
    with pytest.raises(HTTPException):
        parse_advance_self({"amount": 100, "period": "2026/09"})


def test_bonus_counts_as_advance():
    assert bonus_counts_as_advance({"type": "advance", "status": "paid"})
    assert bonus_counts_as_advance({"type": "advance", "status": "approved", "source": "self"})
    assert not bonus_counts_as_advance({"type": "advance", "status": "pending", "source": "self"})
    assert not bonus_counts_as_advance({"type": "advance", "status": "rejected"})
    assert not bonus_counts_as_advance({"type": "bonus", "status": "paid"})
    assert bonus_counts_as_advance({"type": "advance", "status": "pending"})  # yönetici kaydı
