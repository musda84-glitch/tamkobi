"""Sabah özeti e-postası: tablo tabanlı HTML ve düz metin alternatifi.

WhatsApp / önizleme metni pricing.render_text'te kalır. Bu modül yalnız
notify_outbox'a yazılan HTML ve düz metin gövdesini üretir.
Sayı biçimi event_notify._fmt_number / _fmt_money üzerinden gider.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence, Tuple

import event_notify
import notify_email_layout

esc = notify_email_layout.esc
button_html = notify_email_layout.button_html

LOW_STOCK_FETCH = 500
LOW_STOCK_KEEP = 10
_DEFAULT_MIN = 5


def fmt_int(x) -> str:
    """Ondalıksız adet. 3.0 → 3, binlik ayırıcı nokta."""
    return event_notify._fmt_number(x, 0)


def fmt_try(x) -> str:
    """TR para: 5208.33 → 5.208,33 ₺."""
    return event_notify._fmt_money(x, "TRY")


def fmt_min(raw) -> str:
    """min yoksa build_summary $ifNull varsayılanı (5)."""
    if raw is None or raw == "":
        return fmt_int(_DEFAULT_MIN)
    return fmt_int(raw)


def _as_float(val, default: float = 0.0) -> float:
    try:
        if val is None or val == "":
            return float(default)
        return float(val)
    except (TypeError, ValueError):
        return float(default)


def _as_int(val) -> int:
    return int(round(_as_float(val, 0.0)))


def raw_min(item: dict):
    if "min" in item:
        return item.get("min")
    return item.get("min_stock_alert")


def stock_sort_key(item: dict) -> Tuple[int, float, str]:
    """stock/min artan. min yoksa 5. min ≤ 0 en sona."""
    qty = _as_float(item.get("qty", item.get("stock_quantity")), 0.0)
    raw = raw_min(item)
    name = str(item.get("name") or "")
    if raw is None or raw == "":
        mn = float(_DEFAULT_MIN)
    else:
        mn = _as_float(raw, float(_DEFAULT_MIN))
    if mn <= 0:
        return (1, qty, name)
    return (0, qty / mn, name)


def _channels(s: Dict[str, Any]) -> List[Tuple[str, int, float]]:
    rows = []
    for ch, info in (s.get("orders_by_channel") or {}).items():
        if not isinstance(info, dict):
            continue
        rows.append((str(ch), _as_int(info.get("count")), _as_float(info.get("total"), 0.0)))
    rows.sort(key=lambda row: (-row[2], row[0]))
    return rows


def _low_count(s: Dict[str, Any]) -> int:
    raw = s.get("low_stock_count")
    if raw is None or raw == "":
        return len(s.get("low_stock") or [])
    return _as_int(raw)


def _low_items(s: Dict[str, Any]) -> List[dict]:
    items = [p for p in (s.get("low_stock") or []) if isinstance(p, dict)]
    items.sort(key=stock_sort_key)
    return items[:LOW_STOCK_KEEP]


def _kpi_card(label: str, primary: str, secondary: str = "", lines: Optional[Sequence[str]] = None) -> str:
    bits = [
        '<div class="tk-muted" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;'
        f'line-height:16px;color:#64748b;">{esc(label)}</div>',
        '<div class="tk-text" style="font-family:Arial,Helvetica,sans-serif;font-size:20px;'
        f'line-height:26px;font-weight:bold;color:#0f172a;padding-top:4px;">{esc(primary)}</div>',
    ]
    if secondary:
        bits.append(
            '<div class="tk-text" style="font-family:Arial,Helvetica,sans-serif;font-size:14px;'
            f'line-height:20px;color:#059669;padding-top:2px;">{esc(secondary)}</div>'
        )
    for line in lines or ():
        if not line:
            continue
        bits.append(
            '<div class="tk-text" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;'
            f'line-height:18px;color:#334155;padding-top:4px;">{line}</div>'
        )
    inner = "".join(bits)
    return (
        '<table role="presentation" class="tk-card" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'bgcolor="#f8fafc" style="width:100%;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">'
        f'<tr><td style="padding:12px 14px;">{inner}</td></tr></table>'
    )


def _kpi_grid(cards: Sequence[str]) -> str:
    if not cards:
        return ""
    rows = []
    for index in range(0, len(cards), 2):
        pair = list(cards[index:index + 2])
        cells = []
        for col, card in enumerate(pair):
            if len(pair) == 2:
                pad = "0 6px 12px 0" if col == 0 else "0 0 12px 6px"
                width = "50%"
            else:
                pad = "0 0 12px 0"
                width = "100%"
            cells.append(
                f'<td class="tk-stack" width="{width}" valign="top" style="width:{width};padding:{pad};">{card}</td>'
            )
        rows.append("<tr>" + "".join(cells) + "</tr>")
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;">'
        + "".join(rows)
        + "</table>"
    )


def _stock_table(items: Sequence[dict], extra: int) -> str:
    if not items and extra <= 0:
        return ""
    head = (
        "<tr>"
        + "".join(
            '<td class="tk-muted" style="font-family:Arial,Helvetica,sans-serif;font-size:12px;'
            'line-height:16px;color:#64748b;font-weight:bold;padding:6px 4px;border-bottom:1px solid #e2e8f0;">'
            f"{esc(label)}</td>"
            for label in ("Ürün", "Kod", "Mevcut", "Min")
        )
        + "</tr>"
    )
    body = []
    for item in items:
        sku = item.get("sku") or "-"
        cells = (
            esc(item.get("name") or ""),
            esc(sku),
            esc(fmt_int(item.get("qty"))),
            esc(fmt_min(raw_min(item))),
        )
        tds = "".join(
            '<td class="tk-text" style="font-family:Arial,Helvetica,sans-serif;font-size:13px;'
            'line-height:18px;color:#0f172a;padding:6px 4px;border-bottom:1px solid #e2e8f0;'
            f'word-break:break-word;">{cell}</td>'
            for cell in cells
        )
        body.append(f'<tr class="tk-stock-row">{tds}</tr>')
    extra_row = ""
    if extra > 0:
        extra_row = (
            '<tr><td class="tk-muted" colspan="4" style="font-family:Arial,Helvetica,sans-serif;'
            'font-size:13px;line-height:18px;color:#64748b;padding:8px 4px 0;">'
            f"{esc(f've {fmt_int(extra)} ürün daha')}</td></tr>"
        )
    return (
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" '
        'style="width:100%;border-collapse:collapse;">'
        + head
        + "".join(body)
        + extra_row
        + "</table>"
    )


def _orders_card(s: Dict[str, Any]) -> str:
    total = _as_int(s.get("orders_total"))
    if total <= 0:
        return ""
    lines = [
        f"{esc(ch)}: {esc(fmt_int(count))} sipariş · {esc(fmt_try(amount))}"
        for ch, count, amount in _channels(s)
    ]
    return _kpi_card(
        "Yeni siparişler",
        f"{fmt_int(total)} adet",
        fmt_try(s.get("orders_amount")),
        lines,
    )


def _ship_card(s: Dict[str, Any]) -> str:
    pending = _as_int(s.get("pending_shipments"))
    if pending <= 0:
        return ""
    return _kpi_card("Kargo bekleyen", fmt_int(pending), "sipariş")


def _stock_card(s: Dict[str, Any]) -> str:
    count = _low_count(s)
    if count <= 0:
        return ""
    return _kpi_card("Kritik stok", fmt_int(count), "ürün")


def _overdue_card(s: Dict[str, Any]) -> str:
    count = _as_int(s.get("overdue_count"))
    if count <= 0:
        return ""
    lines = []
    claims = _as_int(s.get("open_claims"))
    if claims > 0:
        lines.append(esc(f"Açık iade/talep: {fmt_int(claims)}"))
    return _kpi_card(
        "Vadesi geçen alacak",
        f"{fmt_int(count)} fatura",
        fmt_try(s.get("overdue_total")),
        lines,
    )


def _claims_card(s: Dict[str, Any]) -> str:
    """Alacak kartı yoksa açık talep kendi kartında durur."""
    if _as_int(s.get("overdue_count")) > 0:
        return ""
    claims = _as_int(s.get("open_claims"))
    if claims <= 0:
        return ""
    return _kpi_card("Açık iade/talep", fmt_int(claims))


def _heading(company_name: str, s: Dict[str, Any]) -> str:
    return f"{company_name} — Sabah Özeti {s.get('date') or ''}"


def render_summary_html(s, company_name, stock_link, logo_url_abs: str = "") -> str:
    cards = [
        card for card in (
            _orders_card(s),
            _ship_card(s),
            _stock_card(s),
            _overdue_card(s),
            _claims_card(s),
        ) if card
    ]
    parts = []
    grid = _kpi_grid(cards)
    if grid:
        parts.append(grid)
    low_count = _low_count(s)
    if low_count > 0:
        items = _low_items(s)
        extra = low_count - LOW_STOCK_KEEP if low_count > LOW_STOCK_KEEP else 0
        table = _stock_table(items, extra)
        if table:
            parts.append('<div style="height:8px;line-height:8px;font-size:0;">&nbsp;</div>' + table)
        if extra > 0:
            button = button_html(stock_link, "Stok sayfasında gör →")
            if button:
                parts.append(button)
    body = ""
    if parts:
        body = '<tr><td style="padding:0 0 8px;">' + "".join(parts) + "</td></tr>"
    heading = _heading(company_name, s)
    return notify_email_layout.render_layout(
        company_name=company_name,
        logo_url_abs=logo_url_abs or "",
        title=heading,
        summary=heading,
        body_html=body,
    )


def _text_lines(s: Dict[str, Any]) -> List[str]:
    lines: List[str] = []
    orders = _as_int(s.get("orders_total"))
    if orders > 0:
        lines.append(f"Yeni siparişler: {fmt_int(orders)} adet · {fmt_try(s.get('orders_amount'))}")
        for ch, count, amount in _channels(s):
            lines.append(f"• {ch}: {fmt_int(count)} sipariş · {fmt_try(amount)}")
    pending = _as_int(s.get("pending_shipments"))
    if pending > 0:
        lines.append(f"Kargo bekleyen sipariş: {fmt_int(pending)}")
    low_count = _low_count(s)
    if low_count > 0:
        lines.append(f"Kritik stok: {fmt_int(low_count)} ürün")
        for item in _low_items(s):
            sku = item.get("sku") or "-"
            lines.append(
                f"• {item.get('name') or ''} ({sku}): {fmt_int(item.get('qty'))} / min {fmt_min(raw_min(item))}"
            )
        if low_count > LOW_STOCK_KEEP:
            lines.append(f"ve {fmt_int(low_count - LOW_STOCK_KEEP)} ürün daha")
    overdue = _as_int(s.get("overdue_count"))
    if overdue > 0:
        lines.append(
            f"Vadesi geçen alacak: {fmt_int(overdue)} fatura · {fmt_try(s.get('overdue_total'))}"
        )
    claims = _as_int(s.get("open_claims"))
    if claims > 0:
        lines.append(f"Açık iade/talep: {fmt_int(claims)}")
    return lines


def render_summary_text(s, company_name, stock_link) -> str:
    heading = _heading(company_name, s)
    link = stock_link if _low_count(s) > 0 else ""
    return notify_email_layout.render_layout_text(
        company_name=company_name,
        title=heading,
        summary=heading,
        lines=_text_lines(s),
        link=link,
    )
