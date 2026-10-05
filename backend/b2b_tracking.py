"""B2B portal kargo takip kartı: sipariş teslim durumunu shipment'tan üstün tut."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional
from zoneinfo import ZoneInfo

import warehouse_ship as wship

PUBLIC_TRACKING_URLS = {
    "yurtici": "https://www.yurticikargo.com/tr/online-servisler/gonderi-sorgula?code={n}",
    "aras": "https://kargotakip.araskargo.com.tr/mainpage.aspx?code={n}",
    "mng": "https://kargotakip.mngkargo.com.tr/?takipNo={n}",
    "ptt": "https://gonderitakip.ptt.gov.tr/Track/Verify?q={n}",
    "surat": "https://suratkargo.com.tr/KargoTakip/?kargotakipno={n}",
    "hepsijet": "https://www.hepsijet.com/gonderi-takibi/{n}",
    "trendyolexpress": "https://www.trendyolexpress.com/kargo-takip?trackingNumber={n}",
    "ups": "https://www.ups.com/track?loc=tr_TR&tracknum={n}",
}
SHIPMENT_STEPS = ["created", "picked_up", "in_transit", "out_for_delivery", "delivered"]
ORDER_DELIVERED = frozenset({"delivered", "completed"})
ORDER_RETURNED = frozenset({"returned", "partially_returned"})
ORDER_SHIPPED_LIKE = frozenset({"shipped", "delivered", "completed", "in_transit"})


def resolve_tracking_status(order: Optional[dict], shipment: Optional[dict] = None) -> str:
    """Sipariş teslim/iade edildiyse kart onu gösterir; aksi halde shipment adımı."""
    o = order or {}
    sh = shipment or {}
    ost = str(o.get("order_status") or "").strip().lower()
    sh_status = str(sh.get("status") or "").strip().lower()
    if ost in ORDER_RETURNED or sh_status == "returned":
        return "returned"
    if ost in ORDER_DELIVERED or sh_status == "delivered":
        return "delivered"
    if sh_status in SHIPMENT_STEPS:
        return sh_status
    num = sh.get("tracking_number") or o.get("cargo_tracking_number")
    if num or ost == "shipped":
        return "in_transit"
    return "created"


def build_b2b_tracking(order: dict, shipment: Optional[dict] = None) -> Optional[Dict[str, Any]]:
    """Portal için canlı kargo bilgisi: takip linki, durum adımı ve tahmini teslim."""
    o = order or {}
    sh = shipment or {}
    num = sh.get("tracking_number") or o.get("cargo_tracking_number")
    ost = str(o.get("order_status") or "").strip().lower()
    if not num and ost not in ORDER_SHIPPED_LIKE:
        return None
    carrier_code = sh.get("carrier_code") or o.get("cargo_carrier") or ""
    carrier = wship.carrier_label(order=o, shipment=sh)
    url = (
        sh.get("tracking_url")
        or o.get("cargo_tracking_url")
        or (PUBLIC_TRACKING_URLS.get(carrier_code, "").format(n=num) if num else None)
    )
    status = resolve_tracking_status(o, sh)
    eta = sh.get("estimated_delivery")
    shipped_at = (
        (sh.get("created_at") or o.get("shipped_at") or o.get("updated_at") or o.get("order_date") or "")[:10]
    )
    delivered_at = sh.get("delivered_at") or o.get("delivered_at")
    if status == "delivered" and not delivered_at:
        delivered_at = (o.get("updated_at") or o.get("order_date") or "")[:10] or None
    if not eta and status != "delivered" and shipped_at:
        try:
            eta = (datetime.strptime(shipped_at, "%Y-%m-%d") + timedelta(days=3)).strftime("%Y-%m-%d")
        except ValueError:
            eta = None
    today = datetime.now(timezone.utc).astimezone(ZoneInfo("Europe/Istanbul")).strftime("%Y-%m-%d")
    return {
        "carrier": carrier,
        "tracking_number": num,
        "tracking_url": url,
        "status": status,
        "step": SHIPMENT_STEPS.index(status) if status in SHIPMENT_STEPS else (0 if status != "returned" else -1),
        "steps": SHIPMENT_STEPS,
        "estimated_delivery": eta,
        "delivered_at": delivered_at,
        "shipped_at": shipped_at or None,
        "is_late": bool(eta and status != "delivered" and eta < today),
        "events": (sh.get("events") or [])[-5:],
    }
