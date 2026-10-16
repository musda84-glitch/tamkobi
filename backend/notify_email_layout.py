"""Bildirim e-postaları için ortak HTML/düz metin iskeleti.

İskelet sipariş e-postasındaki (_order_batch_html) tablo düzenidir.
body_html çağıran tarafından kaçışlanmış güvenli HTML olmalıdır;
dış metin bu modülde esc() ile kaçırılır, olduğu gibi gömülmez.
"""
from __future__ import annotations

import html
from typing import Iterable

import public_url

_FOOTER_NOTE = "Ayarlar Platform Yönetimi'nden yapılır"
_BUTTON_LABEL = "Uygulamada aç →"
_BAD_SCHEMES = ("javascript", "data", "cid", "vbscript")


def esc(val) -> str:
    return html.escape("" if val is None else str(val), quote=True)


def _scheme(raw: str) -> str:
    text = str(raw or "").strip().lower()
    if ":" not in text:
        return ""
    return text.split(":", 1)[0]


def usable_href(link: str) -> str:
    """Buton/metin linki. javascript: ve iç ağ adresleri boş döner."""
    raw = str(link or "").strip()
    if not raw:
        return ""
    if _scheme(raw) in _BAD_SCHEMES:
        return ""
    if public_url.is_invalid_public_base(raw):
        return ""
    return raw


def _usable_logo(url: str) -> str:
    raw = str(url or "").strip()
    if not raw:
        return ""
    if _scheme(raw) in _BAD_SCHEMES:
        return ""
    return raw


def button_html(href: str, label: str) -> str:
    """Yeşil (#059669), tablo tabanlı, Outlook (mso) uyumlu buton."""
    safe_href = usable_href(href)
    if not safe_href:
        return ""
    safe = esc(safe_href)
    text = esc(label)
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">'
        "<tr><td align=\"center\" style=\"padding:16px 0 0;\">"
        "<!--[if mso]>"
        f'<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="{safe}" '
        'style="height:48px;v-text-anchor:middle;width:240px;" arcsize="8%" stroke="f" fillcolor="#059669">'
        "<w:anchorlock/>"
        f'<center style="color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">{text}</center>'
        "</v:roundrect>"
        "<![endif]-->"
        "<!--[if !mso]><!-- -->"
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="width:100%;">'
        '<tr><td align="center" bgcolor="#059669" style="background-color:#059669;border-radius:6px;">'
        f'<a href="{safe}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:16px;line-height:20px;font-weight:bold;color:#ffffff;text-decoration:none;">{text}</a>'
        "</td></tr></table>"
        "<!--<![endif]-->"
        "</td></tr></table>"
    )


def message_body_html(message: str) -> str:
    """Tek bildirim gövdesi. Metin kaçışlı; satır sonu <br>."""
    msg = esc(message).replace("\n", "<br>")
    return (
        '<tr><td class="tk-text" style="padding:0 0 16px;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:14px;line-height:20px;color:#334155;">{msg}</td></tr>'
    )


def items_body_html(items: Iterable[str]) -> str:
    """Çok satırlı özet. Her madde kaçışlı <li>."""
    lis = []
    for item in items:
        text = esc(item).replace("\n", "<br>")
        if not text:
            continue
        lis.append(f'<li class="tk-text" style="margin:0 0 8px;">{text}</li>')
    if not lis:
        return ""
    inner = "".join(lis)
    return (
        '<tr><td style="padding:0 0 16px;">'
        '<ul class="tk-text" style="margin:0;padding:0 0 0 18px;font-family:Arial,Helvetica,sans-serif;'
        f'font-size:14px;line-height:20px;color:#334155;">{inner}</ul>'
        "</td></tr>"
    )


def render_layout(
    *,
    company_name,
    logo_url_abs: str = "",
    title,
    summary: str = "",
    body_html: str = "",
    button_link: str = "",
    button_label: str = _BUTTON_LABEL,
    footer_note: str = _FOOTER_NOTE,
    footer_extra: str = "",
) -> str:
    logo = _usable_logo(logo_url_abs)
    if logo:
        logo_html = (
            '<td width="48" valign="middle" style="width:48px;padding:0 12px 0 0;">'
            f'<img src="{esc(logo)}" width="40" height="40" alt="{esc(company_name)}" '
            'style="display:block;width:40px;height:40px;border:0;">'
            "</td>"
        )
    else:
        logo_html = ""
    settings_html = (
        '<span style="color:#059669;font-weight:bold;">'
        f"{esc(footer_note)}</span>"
    )
    button = button_html(button_link, button_label)
    button_row = f'<tr><td style="padding:0 0 16px;">{button}</td></tr>' if button else ""
    extra = esc(footer_extra) if footer_extra else ""
    return (
        '<!DOCTYPE html><html lang="tr"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        '<meta name="color-scheme" content="light dark">'
        '<meta name="supported-color-schemes" content="light dark">'
        f"<title>{esc(title)}</title>"
        "<style>"
        ":root{color-scheme:light dark;supported-color-schemes:light dark;}"
        "@media only screen and (max-width:600px){"
        ".tk-wrap{width:100% !important;}"
        ".tk-stack{display:block !important;width:100% !important;}"
        "}"
        "@media (prefers-color-scheme:dark){"
        ".tk-page{background-color:#0f172a !important;}"
        ".tk-card{background-color:#1e293b !important;}"
        ".tk-text{color:#f8fafc !important;}"
        ".tk-muted{color:#cbd5e1 !important;}"
        ".tk-bar{background-color:#064e3b !important;}"
        ".tk-line{border-color:#334155 !important;}"
        "}"
        "</style></head>"
        '<body class="tk-page" bgcolor="#f1f5f9" style="margin:0;padding:0;background-color:#f1f5f9;">'
        '<table role="presentation" class="tk-page" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'bgcolor="#f1f5f9" style="width:100%;background-color:#f1f5f9;">'
        '<tr><td align="center" style="padding:24px 12px;">'
        "<!--[if mso]><table role=\"presentation\" align=\"center\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\"><tr><td><![endif]-->"
        '<table role="presentation" class="tk-wrap" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;max-width:600px;">'
        '<tr><td class="tk-card" bgcolor="#ffffff" style="background-color:#ffffff;padding:20px 20px 8px;">'
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;"><tr>'
        f"{logo_html}"
        '<td class="tk-text" valign="middle" style="font-family:Arial,Helvetica,sans-serif;font-size:18px;'
        f'line-height:24px;font-weight:bold;color:#0f172a;">{esc(company_name)}</td>'
        "</tr></table></td></tr>"
        '<tr><td class="tk-bar tk-text" bgcolor="#ecfdf5" style="background-color:#ecfdf5;padding:12px 20px;'
        'font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:20px;color:#065f46;">'
        f"{esc(summary)}</td></tr>"
        '<tr><td style="height:16px;font-size:0;line-height:0;">&nbsp;</td></tr>'
        + (body_html or "")
        + button_row
        + '<tr><td class="tk-muted" style="padding:8px 0 0;font-family:Arial,Helvetica,sans-serif;font-size:12px;'
        'line-height:18px;color:#64748b;">'
        f"{settings_html}"
        f"{extra}"
        "</td></tr></table>"
        "<!--[if mso]></td></tr></table><![endif]-->"
        "</td></tr></table></body></html>"
    )


def render_layout_text(
    *,
    company_name,
    title,
    summary: str = "",
    lines: Iterable[str] = (),
    link: str = "",
    footer_note: str = _FOOTER_NOTE,
    footer_extra: str = "",
) -> str:
    parts = [str(company_name or ""), "", str(title or "")]
    if summary:
        parts.append(str(summary))
    parts.append("")
    for line in lines:
        text = str(line if line is not None else "")
        if text != "":
            parts.append(text)
    href = usable_href(link)
    if href:
        parts.append("")
        parts.append(href)
    parts.append("")
    if footer_note:
        parts.append(str(footer_note))
    extra = str(footer_extra or "").strip()
    if extra:
        parts.append(extra)
    return "\n".join(parts).strip()
