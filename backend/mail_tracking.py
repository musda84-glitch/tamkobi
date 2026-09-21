"""Outbound mail delivery status (Bizimhesap-style gönderi durumu).

SMTP acceptance is recorded as sent. A 1×1 pixel records the first open.
"""
from datetime import datetime, timedelta, timezone
from html import escape
from typing import Optional

TRANSPARENT_GIF = (
    b"GIF89a\x01\x00\x01\x00\x80\x00\x00\x00\x00\x00\xff\xff\xff!"
    b"\xf9\x04\x01\x00\x00\x00\x00,\x00\x00\x00\x00\x01\x00\x01\x00"
    b"\x00\x02\x02D\x01\x00;"
)

CONTEXT_TR = {
    "manual": "Mesaj",
    "contact": "Cari",
    "invoice": "Fatura",
    "order": "Sipariş",
    "cargo": "Kargo",
    "quote": "Teklif",
    "quote_approval": "Teklif",
    "statement": "Hesap ekstresi",
    "dispatch": "İrsaliye",
    "project": "Proje",
    "project_tracking": "Proje takibi",
    "survey": "Keşif",
    "campaign": "Kampanya",
    "installment": "Taksit",
    "b2b_reset": "B2B şifre",
}

DELIVERY_DAYS = 90


def pixel_html(base_url: str, log_id: str) -> str:
    base = (base_url or "").rstrip("/")
    src = f"{base}/api/public/mail/open/{log_id}.gif"
    return (
        f'<img src="{src}" alt="" width="1" height="1" '
        'style="display:block;width:1px;height:1px;border:0;overflow:hidden" />'
    )


def text_to_html(body: str) -> str:
    lines = (body or "").splitlines() or [""]
    parts = "".join(f"<p style=\"margin:0 0 8px\">{escape(line) or '&nbsp;'}</p>" for line in lines)
    return f'<div style="font-family:Arial,sans-serif;font-size:14px;color:#0f172a">{parts}</div>'


def append_pixel(html: str, base_url: str, log_id: str) -> str:
    if not base_url or not log_id:
        return html or ""
    pix = pixel_html(base_url, log_id)
    raw = html or ""
    lower = raw.lower()
    idx = lower.rfind("</body>")
    if idx >= 0:
        return raw[:idx] + pix + raw[idx:]
    return raw + pix


def mark_opened(doc: dict, now_iso: str) -> dict:
    """Fields to persist when the tracking pixel is loaded."""
    fields = {
        "open_count": int((doc or {}).get("open_count") or 0) + 1,
        "last_opened_at": now_iso,
    }
    if not (doc or {}).get("opened_at"):
        fields["opened_at"] = now_iso
    return fields


def within_days(created_at: str, days: int = DELIVERY_DAYS, now: Optional[datetime] = None) -> bool:
    if not created_at:
        return False
    try:
        stamp = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
    except ValueError:
        return False
    if stamp.tzinfo is None:
        stamp = stamp.replace(tzinfo=timezone.utc)
    moment = now or datetime.now(timezone.utc)
    return stamp >= moment - timedelta(days=days)


def delivery_state(doc: dict) -> str:
    if (doc or {}).get("status") == "failed":
        return "failed"
    if (doc or {}).get("opened_at"):
        return "opened"
    return "sent"
