"""Shared report query + manager-insight helpers (no DB access)."""
from typing import Any, Dict, Optional


def issue_q(company_id: str, date_from: Optional[str], date_to: Optional[str], extra: Optional[dict] = None) -> dict:
    q: Dict[str, Any] = {"company_id": company_id, "status": {"$ne": "cancelled"}, **(extra or {})}
    if date_from or date_to:
        rng: Dict[str, Any] = {}
        if date_from:
            rng["$gte"] = date_from
        if date_to:
            rng["$lte"] = date_to
        q["issue_date"] = rng
    return q


def report_insights(kind: str, rows: list, totals: dict) -> list:
    out = []
    r = lambda v: round(float(v or 0), 2)
    if kind in ("sales", "purchases") and rows:
        top = rows[0]
        label = "satış" if kind == "sales" else "alış"
        out.append({"level": "info", "text": f"En yüksek {label}: {top.get('name')} ({r(top.get('gross')):,.2f} ₺).".replace(",", "X").replace(".", ",").replace("X", ".")})
        open_amt = r(totals.get("open"))
        if open_amt > 0:
            out.append({"level": "warn" if open_amt > r(totals.get("gross")) * 0.3 else "info",
                        "text": f"Açık bakiye {open_amt:,.2f} ₺ — tahsilat/ödeme planını kontrol edin.".replace(",", "X").replace(".", ",").replace("X", ".")})
    if kind == "aging":
        overdue = r(sum(totals.get(k, 0) for k in ("d1_30", "d31_60", "d61_90", "d90p")))
        hot = [row for row in rows if row.get("type") == "receivable" and row.get("d90p")]
        if overdue:
            out.append({"level": "warn", "text": f"Vadesi geçmiş alacak {overdue:,.2f} ₺.".replace(",", "X").replace(".", ",").replace("X", ".")})
        if hot:
            out.append({"level": "alert", "text": f"90+ gün: {hot[0]['name']} ({r(hot[0]['d90p']):,.2f} ₺) — öncelikli arama.".replace(",", "X").replace(".", ",").replace("X", ".")})
    if kind == "stock":
        if totals.get("critical"):
            out.append({"level": "alert", "text": f"{totals['critical']} üründe stok sıfır — satış kaçırma riski."})
        if totals.get("low"):
            out.append({"level": "warn", "text": f"{totals['low']} ürün kritik eşiğin altında."})
    if kind == "cashflow":
        net = r(totals.get("net"))
        proj = r(totals.get("projected"))
        out.append({"level": "info" if net >= 0 else "warn", "text": f"Dönem net nakit {net:,.2f} ₺; öngörülen kasa {proj:,.2f} ₺.".replace(",", "X").replace(".", ",").replace("X", ".")})
    if kind == "vat":
        p = r(totals.get("payable_vat"))
        out.append({"level": "warn" if p > 0 else "info", "text": ("Ödenecek KDV " if p > 0 else "Devreden KDV ") + f"{abs(p):,.2f} ₺.".replace(",", "X").replace(".", ",").replace("X", ".")})
    if kind == "profit":
        m = r(totals.get("net_margin"))
        out.append({"level": "info" if m >= 15 else "warn", "text": f"Net kâr marjı %{m:,.1f}.".replace(",", "X").replace(".", ",").replace("X", ".")})
        if rows and rows[-1].get("profit", 0) < 0:
            out.append({"level": "warn", "text": f"Zarar eden kalem: {rows[-1].get('name')}."})
    return out[:4]
