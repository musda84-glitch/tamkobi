"""Mail open-tracking helpers."""
from datetime import datetime, timedelta, timezone

from mail_tracking import append_pixel, delivery_state, mark_opened, pixel_html, text_to_html, within_days


def test_pixel_is_hidden_and_points_at_public_gif():
    html = pixel_html("https://app.example", "log1")
    assert 'src="https://app.example/api/public/mail/open/log1.gif"' in html
    assert "width:1px" in html


def test_append_pixel_before_body_close():
    out = append_pixel("<html><body><p>Merhaba</p></body></html>", "https://app.example", "abc")
    assert out.index("mail/open/abc.gif") < out.lower().index("</body>")
    assert "Merhaba" in out


def test_append_pixel_skips_without_base():
    assert append_pixel("<p>x</p>", "", "abc") == "<p>x</p>"


def test_text_to_html_escapes():
    html = text_to_html("a <b>\nikinci")
    assert "&lt;b&gt;" in html
    assert "<p" in html


def test_mark_opened_sets_first_open_once():
    first = mark_opened({"status": "sent", "open_count": 0}, "2026-09-21T08:00:00+00:00")
    assert first["opened_at"] == "2026-09-21T08:00:00+00:00"
    assert first["open_count"] == 1
    again = mark_opened({"opened_at": first["opened_at"], "open_count": 1}, "2026-09-21T09:00:00+00:00")
    assert "opened_at" not in again
    assert again["open_count"] == 2
    assert again["last_opened_at"].startswith("2026-09-21T09")


def test_delivery_state():
    assert delivery_state({"status": "failed"}) == "failed"
    assert delivery_state({"status": "sent"}) == "sent"
    assert delivery_state({"status": "sent", "opened_at": "2026-01-01T00:00:00+00:00"}) == "opened"


def test_within_days():
    now = datetime(2026, 9, 21, tzinfo=timezone.utc)
    assert within_days((now - timedelta(days=10)).isoformat(), now=now)
    assert not within_days((now - timedelta(days=91)).isoformat(), now=now)
    assert not within_days("")
