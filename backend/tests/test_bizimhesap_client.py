"""BizimHesap client helpers — no live API required."""
from fastapi import HTTPException

from migration import _bh_headers, _unwrap, BIZIMHESAP_KEY


def test_headers_include_key_token_and_firm():
    h = _bh_headers("tok-abc", "88522")
    assert h["Key"] == BIZIMHESAP_KEY
    assert h["Token"] == "tok-abc"
    assert h["FirmId"] == "88522"
    assert h["Accept"] == "application/json"


def test_headers_omit_empty_firm():
    h = _bh_headers("tok-abc", "")
    assert "FirmId" not in h


def test_unwrap_list_and_error_text():
    assert _unwrap([{"id": "1"}]) == [{"id": "1"}]
    try:
        _unwrap({"resultCode": 0, "errorText": "Hatalı token"})
        assert False, "expected HTTPException"
    except HTTPException as e:
        assert e.status_code == 502
        assert "Hatalı token" in e.detail
