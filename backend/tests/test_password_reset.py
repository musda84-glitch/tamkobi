from datetime import datetime, timedelta, timezone

from password_reset import (
    ERP_FORGOT_MSG,
    generic_forgot_response,
    login_next,
    mask_email,
    normalize_email,
    password_error,
    redirect_after_reset,
    reset_link,
    reset_path,
    reset_row_error,
)


def test_normalize_and_mask_email():
    assert normalize_email("  Admin@TamKobi.com ") == "admin@tamkobi.com"
    assert mask_email("abdurrahman@firma.com") == "ab•••@firma.com"
    assert mask_email("a@x.com") == "a•••@x.com"
    assert mask_email("not-an-email") == ""


def test_login_next_and_links():
    assert login_next("sistem") == "sistem"
    assert login_next("panel") == "sistem"
    assert login_next("") == "login"
    assert reset_path("tok") == "/sifre/tok"
    assert reset_path("tok", "sistem") == "/sifre/tok?next=sistem"
    assert reset_link("https://tamkobi.com", "abc", "login") == "https://tamkobi.com/sifre/abc"
    assert reset_link("", "abc") == "/sifre/abc"
    assert redirect_after_reset("sistem") == "/sistem/giris"
    assert redirect_after_reset("login") == "/login"


def test_password_and_token_errors():
    assert password_error("12345") == "Şifre en az 6 karakter olmalı."
    assert password_error("123456") is None
    assert reset_row_error(None) == "Sıfırlama bağlantısı geçersiz."
    now = datetime(2026, 9, 22, tzinfo=timezone.utc)
    used = {"used_at": now.isoformat(), "expires_at": (now + timedelta(hours=1)).isoformat()}
    assert "kullanılmış" in (reset_row_error(used, now) or "")
    expired = {"used_at": None, "expires_at": (now - timedelta(minutes=1)).isoformat()}
    assert "süresi doldu" in (reset_row_error(expired, now) or "")
    ok = {"used_at": None, "expires_at": (now + timedelta(hours=1)).isoformat()}
    assert reset_row_error(ok, now) is None
    out = generic_forgot_response()
    assert out["message"] == ERP_FORGOT_MSG
    assert "reset_token" not in out
