import asyncio
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from password_reset import (
    ERP_FORGOT_MSG,
    ERP_FORGOT_SMS_MSG,
    FORGOT_SMS_MIN_SECONDS,
    finalize_forgot_mail_result,
    finalize_forgot_sms_result,
    forgot_channel,
    generic_forgot_response,
    login_next,
    mask_email,
    mask_phone,
    normalize_email,
    pad_forgot_duration,
    password_error,
    PUBLIC_FORGOT_KEYS,
    redirect_after_reset,
    reset_link,
    reset_path,
    reset_row_error,
    sms_reset_message,
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
    assert set(out.keys()) == set(PUBLIC_FORGOT_KEYS)


def test_finalize_forgot_never_exposes_reset_link():
    """E-posta gitmezse reset_url/token istemciye verilmez (güvenlik)."""
    dirty = {
        "status": "ok",
        "message": ERP_FORGOT_MSG,
        "reset_url": "https://evil/sifre/tok",
        "reset_token": "tok",
    }
    failed = finalize_forgot_mail_result(dirty, mail_status="failed", mail_detail="SMTP down")
    assert "reset_url" not in failed
    assert "reset_token" not in failed
    assert "mail_status" not in failed
    assert "detail" not in failed
    assert failed["status"] == "ok"
    assert failed["channel"] == "email"
    assert failed["message"] == ERP_FORGOT_MSG

    sent = finalize_forgot_mail_result(
        {"status": "ok", "message": ERP_FORGOT_MSG, "reset_token": "x"},
        mail_status="sent",
        mail_detail="a@b.com adresine gönderildi.",
    )
    assert "reset_token" not in sent
    assert "mail_status" not in sent
    assert "detail" not in sent
    assert sent == failed


def test_forgot_sms_channel_helpers():
    assert forgot_channel("SMS") == "sms"
    assert forgot_channel(None) == "email"
    assert mask_phone("05551234567") == "•••4567"
    sms_out = generic_forgot_response("sms")
    assert sms_out["message"] == ERP_FORGOT_SMS_MSG
    assert sms_out["channel"] == "sms"
    assert "baglantiniz" in sms_reset_message(name="Ayşe", link="https://a/sifre/t")
    failed = finalize_forgot_sms_result(
        {"status": "ok", "reset_token": "x", "reset_url": "y"},
        sms_status="failed",
        sms_detail="netgsm err",
    )
    assert "reset_token" not in failed
    assert "sms_status" not in failed
    assert "detail" not in failed
    assert failed == sms_out


def test_pad_forgot_duration_helper():
    assert 1.0 <= FORGOT_SMS_MIN_SECONDS <= 1.5
    slept = []

    async def _sleep(s):
        slept.append(s)

    async def _run():
        with patch("password_reset.asyncio.sleep", _sleep), \
             patch("password_reset.time.monotonic", return_value=10.5):
            await pad_forgot_duration(10.0, min_seconds=1.2)

    asyncio.run(_run())
    assert len(slept) == 1
    assert abs(slept[0] - 0.7) < 1e-9
