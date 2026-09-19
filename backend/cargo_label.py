"""Pazaryerinden gelen veya kargo entegrasyonuyla oluşturulan resmi etiket."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional
from urllib.parse import urlparse

MARKETPLACE_CHANNELS = {
    "trendyol", "hepsiburada", "n11", "amazon", "ciceksepeti", "pazarama",
    "pttavm", "shopify", "shopphp", "trendyol_market", "trendyol_yemek",
}

_URL_KEYS = ("cargo_label_url", "label_url", "labelUrl", "labelURL", "common_label_url")


def pick_stored_label_url(*sources: Optional[Dict[str, Any]]) -> str:
    for src in sources:
        if not src:
            continue
        for key in _URL_KEYS:
            raw = str(src.get(key) or "").strip()
            if _usable_label_ref(raw):
                return raw
    return ""


def _usable_label_ref(raw: str) -> bool:
    if not raw:
        return False
    if raw.startswith("data:"):
        return True
    if raw.startswith("/"):
        return True
    try:
        parsed = urlparse(raw)
    except ValueError:
        return False
    return parsed.scheme in ("http", "https") and bool(parsed.netloc)


def label_kind(order: Dict[str, Any], shipment: Optional[Dict[str, Any]], url: str) -> str:
    if not url:
        return "thermal"
    ship_url = pick_stored_label_url(shipment) if shipment else ""
    if shipment and url == ship_url:
        return "created"
    if order.get("cargo_shipment_id") or order.get("source") == "cargo":
        return "created"
    if str(order.get("channel") or "").lower() in MARKETPLACE_CHANNELS:
        return "marketplace"
    return "created" if shipment else "order"


def extract_provider_label(payload: Any) -> Dict[str, str]:
    """Trendyol / Geliver etiket gövdesinden URL veya base64 PDF çıkarır."""
    if not isinstance(payload, dict):
        return {}
    nested = payload.get("data") if isinstance(payload.get("data"), dict) else {}
    url = pick_stored_label_url(payload, nested)
    if url:
        return {"label_url": url}
    for key in ("label", "labelBase64", "base64", "pdf", "content"):
        blob = payload.get(key) or nested.get(key)
        if isinstance(blob, str) and len(blob) > 40:
            return {"pdf_base64": blob.split(",")[-1]}
    return {}


@dataclass
class ResolvedCargoLabel:
    label_url: str = ""
    pdf_base64: str = ""
    source: str = "thermal"
    cargo_tracking_number: str = ""
    cargo_barcode: str = ""
    cargo_carrier: str = ""
    cargo_carrier_name: str = ""

    def as_json(self) -> Dict[str, Any]:
        return {
            "label_url": self.label_url or None,
            "has_file": bool(self.label_url or self.pdf_base64),
            "source": self.source,
            "cargo_tracking_number": self.cargo_tracking_number or None,
            "cargo_barcode": self.cargo_barcode or None,
            "cargo_carrier": self.cargo_carrier or None,
            "cargo_carrier_name": self.cargo_carrier_name or None,
        }


def resolve_from_docs(
    order: Dict[str, Any],
    shipment: Optional[Dict[str, Any]] = None,
    provider: Optional[Dict[str, str]] = None,
) -> ResolvedCargoLabel:
    url = pick_stored_label_url(order, shipment, provider)
    pdf_b64 = (provider or {}).get("pdf_base64") or ""
    source = label_kind(order, shipment, url or ("data:" if pdf_b64 else ""))
    if pdf_b64 and source == "thermal":
        source = "marketplace" if str(order.get("channel") or "").lower() in MARKETPLACE_CHANNELS else "created"
    return ResolvedCargoLabel(
        label_url=url,
        pdf_base64=pdf_b64,
        source=source,
        cargo_tracking_number=str(order.get("cargo_tracking_number") or (shipment or {}).get("tracking_number") or ""),
        cargo_barcode=str(order.get("cargo_barcode") or (shipment or {}).get("barcode") or ""),
        cargo_carrier=str(order.get("cargo_carrier") or (shipment or {}).get("carrier_code") or ""),
        cargo_carrier_name=str(order.get("cargo_carrier_name") or (shipment or {}).get("carrier_name") or ""),
    )
