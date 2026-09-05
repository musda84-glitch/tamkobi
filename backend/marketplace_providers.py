"""Pazaryeri entegrasyonları — Trendyol Seller API (gerçek) + diğer kanallar için simülasyon."""
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

TRENDYOL_BASE = "https://apigw.trendyol.com"
TY_STATUS = {"Created": "pending", "Picking": "approved", "Invoiced": "approved", "Shipped": "shipped", "AtCollectionPoint": "shipped", "Delivered": "delivered",
             "Cancelled": "cancelled", "UnDelivered": "returned", "Returned": "returned", "UnSupplied": "cancelled", "UnPacked": "pending"}
TY_CARRIER = {"Yurtiçi Kargo Marketplace": "yurtici", "Aras Kargo Marketplace": "aras", "MNG Kargo Marketplace": "mng", "PTT Kargo Marketplace": "ptt", "Sürat Kargo Marketplace": "surat",
              "Trendyol Express Marketplace": "trendyolexpress", "Horoz Lojistik Marketplace": "horoz", "UPS Kargo Marketplace": "ups", "CEVA Marketplace": "ceva", "Kolay Gelsin Marketplace": "kolaygelsin"}


def has_live_credentials(cfg: dict) -> bool:
    return bool(cfg.get("api_key") and cfg.get("api_secret") and cfg.get("supplier_id"))


class TrendyolClient:
    def __init__(self, cfg: dict):
        self.seller_id = str(cfg["supplier_id"]).strip()
        self.http = httpx.AsyncClient(base_url=cfg.get("base_url") or TRENDYOL_BASE, auth=(cfg["api_key"].strip(), cfg["api_secret"].strip()),
                                      headers={"User-Agent": f"{self.seller_id} - SelfIntegration", "storeFrontCode": cfg.get("storefront_code") or "TR", "Accept": "application/json"}, timeout=30.0)

    async def _call(self, method: str, path: str, **kw) -> Any:
        try:
            r = await self.http.request(method, path, **kw)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"Trendyol'a ulaşılamadı: {type(e).__name__}")
        if r.status_code == 401:
            raise HTTPException(status_code=401, detail="Trendyol: API Key / API Secret hatalı (401). Satıcı Paneli → Hesap Bilgilerim → Entegrasyon Bilgileri'nden kontrol edin.")
        if r.status_code == 403:
            raise HTTPException(status_code=403, detail="Trendyol: Erişim reddedildi (403). Satıcı ID doğru mu? IP kısıtı / User-Agent kontrol edin.")
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="Trendyol: İstek limiti aşıldı (50 istek/10 sn). Biraz sonra tekrar deneyin.")
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"Trendyol hata {r.status_code}: {r.text[:300]}")
        try:
            return r.json() if r.content else {}
        except ValueError:
            return {}

    async def close(self):
        await self.http.aclose()

    async def _paged(self, path: str, start: int, end: int, size: int, extra: Optional[dict] = None) -> List[dict]:
        out, page = [], 0
        while True:
            params = {"page": page, "size": size, "startDate": start, "endDate": end, **(extra or {})}
            data = await self._call("GET", path, params=params) or {}
            out.extend(data.get("content") or [])
            page += 1
            if page >= int(data.get("totalPages", 1) or 1) or page > 20:
                return out

    async def orders(self, days: int = 14, status: Optional[str] = None, size: int = 200) -> List[dict]:
        """Trendyol tarih aralığını en fazla 14 gün kabul eder → aralık 14 günlük parçalara bölünür."""
        end = int(datetime.now(timezone.utc).timestamp() * 1000)
        start_all = end - days * 86400000
        extra = {"orderByField": "PackageLastModifiedDate", "orderByDirection": "DESC"}
        if status:
            extra["status"] = status
        seen, out = set(), []
        cur_end = end
        while cur_end > start_all:
            cur_start = max(start_all, cur_end - 14 * 86400000 + 1)
            for p in await self._paged(f"/integration/order/sellers/{self.seller_id}/orders", cur_start, cur_end, size, extra):
                if p.get("id") not in seen:
                    seen.add(p.get("id"))
                    out.append(p)
            cur_end = cur_start - 1
        return out

    async def claims(self, days: int = 30) -> List[dict]:
        end = int(datetime.now(timezone.utc).timestamp() * 1000)
        start_all = end - days * 86400000
        seen, out = set(), []
        cur_end = end
        while cur_end > start_all:
            cur_start = max(start_all, cur_end - 14 * 86400000 + 1)
            for c in await self._paged(f"/integration/order/sellers/{self.seller_id}/claims", cur_start, cur_end, 200):
                if c.get("id") not in seen:
                    seen.add(c.get("id"))
                    out.append(c)
            cur_end = cur_start - 1
        return out

    async def questions(self, status: str = "WAITING_FOR_ANSWER") -> List[dict]:
        data = await self._call("GET", f"/integration/qna/sellers/{self.seller_id}/questions/filter", params={"sellerId": self.seller_id, "page": 0, "size": 200, "status": status, "orderByField": "CreatedDate", "orderByDirection": "DESC"})
        return (data or {}).get("content") or []

    async def answer(self, question_id: str, text: str) -> Any:
        return await self._call("POST", f"/integration/qna/sellers/{self.seller_id}/questions/{question_id}/answers", json={"text": text})

    async def approve_claim(self, claim_id: str, line_ids: List[str]) -> Any:
        return await self._call("PUT", f"/integration/order/sellers/{self.seller_id}/claims/{claim_id}/items/approve", json={"claimLineItemIdList": line_ids, "params": {}})

    async def set_package_status(self, package_id: str, status: str, lines: List[dict], invoice_number: Optional[str] = None) -> Any:
        body: Dict[str, Any] = {"status": status, "lines": lines, "params": {}}
        if invoice_number:
            body["params"]["invoiceNumber"] = invoice_number
        return await self._call("PUT", f"/integration/order/sellers/{self.seller_id}/shipment-packages/{package_id}", json=body)

    async def products(self, size: int = 200, approved: Optional[bool] = None) -> List[dict]:
        """Satıcının Trendyol ürün listesi (barkod, başlık, satış/liste fiyatı, stok, onay durumu)."""
        out, page = [], 0
        while True:
            params: Dict[str, Any] = {"page": page, "size": size}
            if approved is not None:
                params["approved"] = str(approved).lower()
            data = await self._call("GET", f"/integration/product/sellers/{self.seller_id}/products", params=params) or {}
            out.extend(data.get("content") or [])
            page += 1
            if page >= int(data.get("totalPages", 1) or 1) or page > 50:
                return out

    async def update_price_inventory(self, items: List[dict]) -> Any:
        """items: [{barcode, quantity?, salePrice?, listPrice?}] → batchRequestId."""
        return await self._call("POST", f"/integration/inventory/sellers/{self.seller_id}/products/price-and-inventory", json={"items": items})


def _ms(v) -> Optional[str]:
    try:
        return datetime.fromtimestamp(int(v) / 1000, tz=timezone.utc).isoformat()
    except (TypeError, ValueError):
        return None


def map_trendyol_order(pkg: dict, company_id: str, channel: str) -> dict:
    """Trendyol shipment package → Nexus sipariş belgesi."""
    addr = pkg.get("shipmentAddress") or {}
    inv = pkg.get("invoiceAddress") or {}
    lines = pkg.get("lines") or []
    items = [{"product_name": l.get("productName"), "sku": l.get("merchantSku") or l.get("sku"), "barcode": l.get("barcode"), "quantity": l.get("quantity", 1), "unit_price": float(l.get("price") or 0),
              "total": round(float(l.get("price") or 0) * int(l.get("quantity") or 1), 2), "line_id": l.get("id"), "order_line_id": l.get("orderLineId"), "line_status": l.get("orderLineItemStatusName"), "vat_rate": l.get("vatBaseAmount") and 20} for l in lines]
    ty_status = pkg.get("shipmentPackageStatus") or pkg.get("status") or "Created"
    return {"company_id": company_id, "channel": channel, "order_number": str(pkg.get("orderNumber")), "external_id": str(pkg.get("id")), "shipment_package_id": pkg.get("id"),
            "customer_name": f"{pkg.get('customerFirstName', '')} {pkg.get('customerLastName', '')}".strip() or addr.get("fullName"), "customer_email": pkg.get("customerEmail"),
            "customer_phone": addr.get("phone"), "shipping_address": addr.get("fullAddress") or " ".join(filter(None, [addr.get("address1"), addr.get("neighborhood"), addr.get("district")])),
            "city": addr.get("city"), "district": addr.get("district"), "invoice_address": inv.get("fullAddress"), "tax_number": inv.get("taxNumber"), "items": items,
            "total_amount": float(pkg.get("totalPrice") or pkg.get("grossAmount") or 0), "discount_total": float(pkg.get("totalDiscount") or 0), "currency": pkg.get("currencyCode") or "TRY",
            "order_status": TY_STATUS.get(ty_status, "pending"), "marketplace_status": ty_status, "cargo_carrier": TY_CARRIER.get(pkg.get("cargoProviderName"), (pkg.get("cargoProviderName") or "").split(" ")[0].lower() or None),
            "cargo_carrier_name": pkg.get("cargoProviderName"), "cargo_tracking_number": str(pkg.get("cargoTrackingNumber") or "") or None, "cargo_tracking_url": pkg.get("cargoTrackingLink"),
            "cargo_barcode": pkg.get("cargoSenderNumber") or str(pkg.get("cargoTrackingNumber") or "") or None, "estimated_delivery": _ms(pkg.get("estimatedDeliveryEndDate")),
            "order_date": _ms(pkg.get("orderDate")) or datetime.now(timezone.utc).isoformat(), "marketplace_updated_at": _ms(pkg.get("lastModifiedDate")), "is_invoiced": ty_status in ("Invoiced", "Shipped", "Delivered"),
            "source": "marketplace_sync", "raw_status": ty_status}


def map_trendyol_claim(c: dict, company_id: str, channel: str) -> dict:
    items = c.get("items") or []
    flat = []
    for it in items:
        for ci in it.get("claimItems") or []:
            flat.append({"claim_item_id": ci.get("id"), "order_line_id": ci.get("orderLineItemId"), "status": (ci.get("claimItemStatus") or {}).get("name"), "reason": (ci.get("customerClaimItemReason") or {}).get("name"),
                         "note": ci.get("customerNote"), "product_name": (it.get("orderLine") or {}).get("productName"), "barcode": (it.get("orderLine") or {}).get("barcode"), "price": (it.get("orderLine") or {}).get("price")})
    return {"company_id": company_id, "channel": channel, "external_id": str(c.get("id")), "order_number": str(c.get("orderNumber")), "customer_name": f"{c.get('customerFirstName', '')} {c.get('customerLastName', '')}".strip(),
            "claim_date": _ms(c.get("claimDate")), "cargo_tracking_number": str(c.get("cargoTrackingNumber") or "") or None, "cargo_provider": c.get("cargoProviderName"), "items": flat,
            "status": (flat[0]["status"] if flat else "Created"), "total": round(sum(float(x.get("price") or 0) for x in flat), 2), "kind": "return", "source": "marketplace_sync"}


def map_trendyol_question(q: dict, company_id: str, channel: str) -> dict:
    ans = q.get("answer") or {}
    return {"company_id": company_id, "channel": channel, "external_id": str(q.get("id")), "customer_id": q.get("customerId"), "product_name": q.get("productName"), "barcode": q.get("barcode") or q.get("productMainId"),
            "question": q.get("text"), "status": q.get("status"), "asked_at": _ms(q.get("creationDate")), "answer": ans.get("text"), "answered_at": _ms(ans.get("creationDate")), "public": q.get("public", True),
            "reject_reason": q.get("rejectedReason"), "source": "marketplace_sync"}


def simulated_orders(company_id: str, channel: str) -> List[dict]:
    """Kimlik bilgisi yoksa örnek veri (açıkça SİMÜLE işaretli)."""
    now = datetime.now(timezone.utc)
    return [{"company_id": company_id, "channel": channel, "order_number": f"{channel.upper()[:2]}-SIM-{uuid.uuid4().hex[:6].upper()}", "external_id": None, "customer_name": "Ayşe Gökmen", "customer_phone": "0533 888 77 66",
             "shipping_address": "Çankaya Mah. Atatürk Bulvarı No:105 D:12", "city": "Ankara", "items": [{"product_id": "prod_01", "product_name": "Nexus Akıllı Bluetooth Kulaklık Pro Max (ANC)", "sku": "NX-BT-PRO", "quantity": 1, "unit_price": 1899.0, "total": 1899.0}],
             "total_amount": 1899.0, "currency": "TRY", "order_status": "approved", "marketplace_status": "Picking", "cargo_carrier": "yurtici", "cargo_carrier_name": "Yurtiçi Kargo", "cargo_tracking_number": f"YK-{str(uuid.uuid4().int)[:10]}",
             "cargo_barcode": f"8690{str(uuid.uuid4().int)[:9]}", "is_invoiced": False, "order_date": now.isoformat(), "estimated_delivery": (now + timedelta(days=3)).isoformat(), "is_simulated": True, "source": "marketplace_sync"}]
