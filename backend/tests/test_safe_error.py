"""URL / kullanıcı adı / token maskeleme ve kısa HTTP detail."""
from __future__ import annotations

from safe_error import (
    as_text,
    looks_like_raw_body,
    mask_sensitive_text,
    provider_error_code,
    public_provider_detail,
)


def test_mask_sensitive_text_replaces_urls():
    raw = (
        "İşNet PDF HTTP 500: "
        "https://einvoice.example/api/Invoice/GetInvoicePdf?key=abcPlusEq%2F "
        "token=super-secret-token username=portal.admin"
    )
    out = mask_sensitive_text(raw)
    assert "https://" not in out
    assert "einvoice.example" not in out
    assert "abcPlusEq" not in out
    assert "[url]" in out
    assert "super-secret-token" not in out
    assert "[token]" in out
    assert "portal.admin" not in out
    assert "[user]" in out


def test_mask_sensitive_text_json_and_bearer_and_jwt():
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaabbbbbbbb.ccccccccdddddddd"
    raw = (
        '{"usercode": "netgsm_user", "token": "abc123xyz", '
        '"authorization": "Bearer ' + jwt + '"}'
    )
    out = mask_sensitive_text(raw)
    assert "netgsm_user" not in out
    assert "[user]" in out
    assert "abc123xyz" not in out
    assert "[token]" in out
    assert jwt not in out
    assert "Bearer [token]" in out or "[token]" in out


def test_mask_sensitive_text_xml_user_and_token():
    raw = (
        "<Login><UserName>isnet.demo</UserName>"
        "<Token>OPAQUE-SESSION-VALUE-12345</Token></Login>"
    )
    out = mask_sensitive_text(raw)
    assert "isnet.demo" not in out
    assert "OPAQUE-SESSION-VALUE-12345" not in out
    assert "[mask]" in out


def test_mask_sensitive_text_keeps_plain_turkish():
    msg = "Entegratör belgesi alınamadı. (kod: 401)"
    assert mask_sensitive_text(msg) == msg


def test_provider_error_code_from_json_xml_and_public():
    assert provider_error_code({"ErrorCode": "INV-401", "ErrorMessage": "kapalı"}) == "INV-401"
    assert provider_error_code({"code": "30", "description": "invalid auth"}) == "30"
    assert provider_error_code({"error": {"code": "40"}}) == "40"
    xml = "<Fault><faultcode>a:Server</faultcode><faultstring>boom</faultstring></Fault>"
    assert provider_error_code(xml) == "a:Server"
    assert provider_error_code("Entegratör PDF alınamadı. (kod: 5001)") == "5001"
    jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.aaaaaaaabbbbbbbb.ccccccccdddddddd"
    assert provider_error_code({"code": jwt}) == ""
    assert provider_error_code("no code here") == ""


def test_public_provider_detail_short_turkish_plus_code():
    raw = (
        "https://einvoice.example/pdf?token=leak "
        '{"ErrorCode":"401","ErrorMessage":"Oturum kapalı username=ali"}'
    )
    detail = public_provider_detail("Entegratör belgesi alınamadı.", raw)
    assert detail == "Entegratör belgesi alınamadı. (kod: 401)"
    assert "Oturum" not in detail
    assert "https://" not in detail
    assert "ali" not in detail
    assert public_provider_detail("SMS gönderilemedi.", None, code="30") == (
        "SMS gönderilemedi. (kod: 30)"
    )
    assert public_provider_detail("SMS gönderilemedi. (kod: 30)", None, code="30") == (
        "SMS gönderilemedi. (kod: 30)"
    )


def test_as_text_and_raw_body_detect():
    assert "40" in as_text({"code": "40"})
    assert looks_like_raw_body({"code": "40"})
    assert looks_like_raw_body("<Fault/>")
    assert looks_like_raw_body("https://einvoice.example/err")
    assert not looks_like_raw_body("SMS gönderilemedi.")
