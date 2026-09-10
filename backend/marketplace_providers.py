"""Pazaryeri entegrasyonları — Trendyol Seller API (gerçek) + diğer kanallar için simülasyon."""
import uuid
import xml.etree.ElementTree as ET
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

    async def batch_status(self, batch_request_id: str) -> Any:
        return await self._call("GET", f"/integration/product/sellers/{self.seller_id}/products/batch-requests/{batch_request_id}")


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


# ---------------- ShopPHP (REST: auth_email + auth_key=md5(email+md5(password))) ----------------
import hashlib

SHOPPHP_STATUS = {"1": "pending", "2": "approved", "3": "preparing", "51": "shipped", "81": "completed", "89": "returned", "90": "cancelled", "91": "cancelled"}


def has_shopphp_credentials(cfg: dict) -> bool:
    return bool(cfg.get("store_url") and cfg.get("api_key") and cfg.get("api_secret"))


# Gövdede açıkça "başarısız" diyen alanlar. Kararsız bir yanıtı hata saymıyoruz;
# aksi halde tanımadığımız bir gövde şekli yüzünden çalışan gönderim hata görünür.
_ACK_FAIL_VALUES = {"0", "false", "error", "hata", "fail", "failed", "basarisiz", "başarısız"}
_ACK_FLAG_TAGS = ("success", "basarili", "başarılı", "result", "status", "durum", "sonuc", "sonuç")
_ACK_ERROR_TAGS = ("error", "errors", "hata", "hatamesaji", "hata_mesaji", "message", "mesaj")


def parse_rest_ack(body: str) -> Any:
    """
    Yazma uçlarının JSON olmayan (XML/metin) yanıtını okur.

    Mağaza dokümanındaki örnek yanıtı `simplexml_load_string` ile ayrıştırıyor,
    yani bu uçlar XML de dönebiliyor. Gövde XML ise etiketleri sözlüğe çevirip
    günlüğe okunur biçimde yazarız; yalnızca gövde açıkça başarısızlık
    bildirdiğinde hata fırlatırız (HTTP 200 + gövdede hata durumu).
    """
    text = (body or "").strip()
    if not text:
        return {"raw": ""}
    try:
        root = ET.fromstring(text)
    except ET.ParseError:
        return {"raw": text[:500]}
    flat: Dict[str, str] = {}
    for el in root.iter():
        if el is root and len(root):
            continue
        value = (el.text or "").strip()
        if value:
            flat.setdefault(el.tag.split("}")[-1].strip().lower(), value)
    for tag in _ACK_ERROR_TAGS:
        if flat.get(tag) and flat[tag].strip().lower() not in ("0", "", "ok", "success", "yok", "none"):
            raise HTTPException(status_code=502, detail=f"ShopPHP isteği reddetti: {flat[tag][:200]}")
    for tag in _ACK_FLAG_TAGS:
        if tag in flat and flat[tag].strip().lower() in _ACK_FAIL_VALUES:
            raise HTTPException(status_code=502, detail=f"ShopPHP isteği reddetti ({tag}={flat[tag]}).")
    return flat or {"raw": text[:500]}


class ShopPHPClient:
    def __init__(self, cfg: dict):
        url = str(cfg["store_url"]).strip().rstrip("/")
        if not url.startswith("http"):
            url = "https://" + url
        self.base = url + "/rest"
        self.email = str(cfg["api_key"]).strip()
        pw_md5 = hashlib.md5(str(cfg["api_secret"]).encode("utf-8")).hexdigest()  # noqa: S324 — ShopPHP protokolü zorunlu kılar
        self.key = hashlib.md5((self.email + pw_md5).encode("utf-8")).hexdigest()  # noqa: S324
        self.client = httpx.AsyncClient(timeout=httpx.Timeout(30.0), headers={"Accept": "application/json", "User-Agent": "TamKobi/1.0"})

    def _auth(self) -> Dict[str, str]:
        return {"auth_email": self.email, "auth_key": self.key, "format": "json"}

    async def _call(self, method: str, path: str, data: Optional[dict] = None, expect_json: bool = True) -> Any:
        try:
            r = await self.client.request(method, f"{self.base}/{path.lstrip('/')}", params=self._auth() if method == "GET" else None, data={**self._auth(), **(data or {})} if method != "GET" else None)
        except httpx.HTTPError as e:
            raise HTTPException(status_code=502, detail=f"ShopPHP bağlantı hatası: {type(e).__name__}")
        if r.status_code in (401, 403):
            raise HTTPException(status_code=400, detail="ShopPHP kimlik doğrulama başarısız: REST API kullanıcı e-postası/parolası, bayi grubunda 'Rest API kullanabilir' izni ve IP listesi kontrol edin.")
        if r.status_code >= 400:
            raise HTTPException(status_code=502, detail=f"ShopPHP {path}: HTTP {r.status_code}")
        try:
            return r.json()
        except ValueError:
            # Listeleri ayrıştırmak için JSON şart; yazma uçları XML de döndürebilir.
            if expect_json:
                raise HTTPException(status_code=502, detail="ShopPHP JSON yerine XML/metin döndürdü; mağazada REST API JSON formatını etkinleştirin.")
            return parse_rest_ack(r.text)

    async def orders(self, days: int = 14) -> List[dict]:
        end = datetime.now(timezone.utc); start = end - timedelta(days=days)
        data = await self._call("GET", f"orders/date/{start.strftime('%Y-%m-%d')}_{end.strftime('%Y-%m-%d')}")
        if isinstance(data, dict):
            for k in ("orders", "siparisler", "data", "result", "items"):
                if isinstance(data.get(k), list):
                    return data[k]
            return [v for v in data.values() if isinstance(v, dict)] if data else []
        return data if isinstance(data, list) else []

    async def set_price_stock(self, product_id: Any, price: Optional[float] = None, stock: Optional[int] = None) -> Any:
        d: Dict[str, Any] = {"ID": product_id}
        if price is not None:
            d["fiyat"] = price
        if stock is not None:
            d["stok"] = stock
        return await self._call("POST", "setProduct/priceAndStock", d)

    async def set_order_status(self, order_no: Any, status: int) -> Any:
        """
        Mağaza dokümanındaki durum güncelleme ucu: sipariş no ve durum gövdede
        `no` + `status` olarak gider (`updateOrder`'ın yoldaki no + `sdurum`
        biçiminden farklı). Örn. status=51 → "Kargoya teslim edildi".
        """
        return await self._call("POST", "setOrderStatus", {"no": order_no, "status": status}, expect_json=False)

    async def update_order(self, order_no: Any, status: Optional[int] = None, cargo_firm: Optional[str] = None, tracking: Optional[str] = None, invoice_no: Optional[str] = None) -> Any:
        d = {k: v for k, v in {"sdurum": status, "kargoFirma": cargo_firm, "kargoSeriNo": tracking, "faturaNo": invoice_no}.items() if v not in (None, "")}
        return await self._call("POST", f"updateOrder/no/{order_no}", d, expect_json=False)

    async def close(self):
        await self.client.aclose()


def _g(d: dict, *keys, default=None):
    low = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        v = low.get(k.lower())
        if v not in (None, ""):
            return v
    return default


def map_shopphp_order(o: dict, company_id: str, channel: str) -> dict:
    """ShopPHP sipariş kaydını (sürüme göre Türkçe alan adları) ortak sipariş modeline çevirir."""
    lines = _g(o, "urunler", "products", "items", "kalemler", default=[]) or []
    items = []
    for ln in lines if isinstance(lines, list) else []:
        qty = float(_g(ln, "adet", "miktar", "quantity", default=1) or 1); price = float(str(_g(ln, "fiyat", "birimFiyat", "price", default=0) or 0).replace(",", "."))
        items.append({"product_id": str(_g(ln, "urunID", "urun_id", "productId", "ID", default="") or ""), "product_name": str(_g(ln, "urunAdi", "urun_adi", "ad", "name", "title", default="Ürün")), "sku": str(_g(ln, "stokKodu", "urunKodu", "kod", "sku", "code", default="") or ""),
                      "barcode": str(_g(ln, "barkod", "barcode", default="") or ""), "quantity": int(round(qty)) or 1, "unit_price": price, "total": round(qty * price, 2)})
    total = float(str(_g(o, "toplam", "genelToplam", "TOPLAM", "total", "tutar", default=sum(i["total"] for i in items)) or 0).replace(",", "."))
    status_no = str(_g(o, "durum", "DURUM_NO", "sdurum", "status", default="2") or "2")
    addr = _g(o, "teslimatAdresi", "adres", "address", default={}) or {}
    addr_text = addr if isinstance(addr, str) else " ".join(str(v) for v in addr.values() if v) if isinstance(addr, dict) else ""
    name = _g(o, "adSoyad", "musteri", "musteriAdi", "aliciAdi", "customer", "name", default=None) or (isinstance(addr, dict) and _g(addr, "adSoyad", "ad", default=None)) or "ShopPHP Müşterisi"
    raw_date = str(_g(o, "tarih", "siparisTarihi", "date", "created_at", default="") or "")
    try:
        order_date = datetime.fromisoformat(raw_date.replace(" ", "T")).replace(tzinfo=timezone.utc).isoformat() if raw_date else datetime.now(timezone.utc).isoformat()
    except ValueError:
        order_date = datetime.now(timezone.utc).isoformat()
    return {"company_id": company_id, "channel": channel, "order_number": str(_g(o, "no", "SIPARIS_NO", "siparisNo", "id", "ID", default=uuid.uuid4().hex[:8])), "external_id": str(_g(o, "no", "SIPARIS_NO", "id", "ID", default="") or ""),
            "customer_name": str(name), "customer_phone": str(_g(o, "telefon", "tel", "gsm", "phone", default="") or (isinstance(addr, dict) and _g(addr, "telefon", "tel", default="")) or ""), "customer_email": str(_g(o, "email", "eposta", "mail", default="") or ""),
            "shipping_address": addr_text or "-", "city": str(_g(o, "il", "sehir", "city", default="") or (isinstance(addr, dict) and _g(addr, "il", "sehir", default="")) or "-"), "items": items, "total_amount": round(total, 2), "currency": "TRY",
            "order_status": SHOPPHP_STATUS.get(status_no, "approved"), "marketplace_status": str(_g(o, "durumAdi", "durum_adi", "statusName", default=status_no)), "cargo_carrier_name": str(_g(o, "kargoFirma", "KargoFirma", "kargo", default="") or ""),
            "cargo_tracking_number": str(_g(o, "kargoSeriNo", "KargoTakipNo", "kargoTakip", default="") or ""), "payment_method": str(_g(o, "odeme", "odemeTipi", "payment", default="") or ""), "is_invoiced": False, "order_date": order_date,
            "is_simulated": False, "source": "marketplace_sync", "raw": {k: o[k] for k in list(o)[:40]}}


# ---------------- ShopPHP XML servisleri (xml.php?c=siparisler|shopphp|alter&xmlc=KOD) ----------------
import re as _re


def _xt(el, tag, default=""):
    n = el.find(tag) if el is not None else None
    return (n.text or "").strip() if n is not None and n.text else default


def _xf(el, tag, default=0.0) -> float:
    try:
        return float(_xt(el, tag, "").replace(",", ".") or default)
    except ValueError:
        return default


from urllib.parse import urlparse, parse_qs

XML_TYPE_MAP = {"siparisler": "orders", "shopphp": "products", "alter": "stock", "rss": "rss"}


def shopphp_resolve(cfg: dict) -> dict:
    """Kullanıcı alanlara ister sadece xmlc kodu ister tam URL yapıştırsın; c= tipine göre sipariş/ürün/stok kodlarını ayır."""
    out: Dict[str, Optional[str]] = {"orders": None, "products": None, "stock": None, "rss": None, "store_url": None}
    store = str(cfg.get("store_url") or "").strip().rstrip("/")
    slots = (("api_key", "orders"), ("api_secret", "products"), ("supplier_id", "stock"))
    for field, default_kind in slots:
        raw = str(cfg.get(field) or "").strip()
        if not raw:
            continue
        if "xml.php" in raw or raw.startswith("http"):
            u = urlparse(raw if raw.startswith("http") else "https://" + raw)
            q = parse_qs(u.query)
            code = (q.get("xmlc") or [""])[0].strip()
            kind = XML_TYPE_MAP.get((q.get("c") or [""])[0].strip().lower(), default_kind)
            if not store and u.netloc:
                store = f"{u.scheme or 'https'}://{u.netloc}"
        else:
            code, kind = raw, default_kind
        if code and not out.get(kind):
            out[kind] = code
    out["store_url"] = (store if store.startswith("http") else ("https://" + store)) if store else None
    return out


def has_shopphp_credentials(cfg: dict) -> bool:  # noqa: F811 — XML modu REST'in yerine geçer
    r = shopphp_resolve(cfg)
    return bool(r["store_url"] and r["orders"])


def _shopphp_base(cfg: dict) -> str:
    return shopphp_resolve(cfg)["store_url"]


async def shopphp_xml(cfg: dict, c: str, key: str) -> ET.Element:
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90.0), headers={"User-Agent": "TamKobi/1.0"}) as client:
            r = await client.get(f"{_shopphp_base(cfg)}/xml.php", params={"c": c, "xmlc": key})
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"ShopPHP XML bağlantı hatası ({c}): {type(e).__name__}")
    if r.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ShopPHP XML ({c}): HTTP {r.status_code}")
    try:
        return ET.fromstring(r.content)
    except ET.ParseError:
        raise HTTPException(status_code=502, detail=f"ShopPHP XML ({c}) okunamadı; XML kodunu (xmlc) kontrol edin.")


async def shopphp_orders_xml(cfg: dict) -> List[dict]:
    root = await shopphp_xml(cfg, "siparisler", shopphp_resolve(cfg)["orders"])
    return root.findall(".//SIPARIS")


def map_shopphp_xml_order(s: ET.Element, company_id: str, channel: str) -> dict:
    items = []
    for ln in s.findall("SATIRLAR/SATIR"):
        qty = _xf(ln, "MIKTAR", 1) or 1; price = _xf(ln, "FIYAT")
        var = " / ".join(v for v in (_xt(ln, "VAR1"), _xt(ln, "VAR2")) if v)
        items.append({"product_id": _xt(ln, "URUN_ID"), "product_name": _xt(ln, "ADI") + (f" ({var})" if var else ""), "sku": _xt(ln, "VARKOD") or _xt(ln, "KOD"), "barcode": _xt(ln, "VARBARKOD") or _xt(ln, "UBARKOD"), "quantity": int(round(qty)), "unit_price": price, "total": round(qty * price, 2), "vat_rate": _xf(ln, "KDV", 20), "variant": var, "desi": _xf(ln, "DESI")})
    status_no = _xt(s, "DURUM_NO", "2")
    date = _xt(s, "TARIH"); time_ = _xt(s, "ZAMAN", "00:00:00")
    try:
        order_date = datetime.fromisoformat(f"{date}T{time_}").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        order_date = datetime.now(timezone.utc).isoformat()
    net, paid = _xf(s, "NET_TOPLAM"), _xf(s, "ODEME_TOPLAM")
    return {"company_id": company_id, "channel": channel, "order_number": _xt(s, "SIPARIS_NO"), "external_id": _xt(s, "SIPARIS_NO"), "customer_name": _xt(s, "TeslimAlici") or _xt(s, "FirmaUnvani") or "ShopPHP Müşterisi", "customer_email": _xt(s, "POSTA"),
            "customer_phone": _xt(s, "TeslimTelefon"), "customer_tax_id": _xt(s, "VergiNo") or _xt(s, "TeslimTCKNo"), "customer_tax_office": _xt(s, "VergiDairesi"), "customer_company": _xt(s, "FirmaUnvani"),
            "shipping_address": " ".join(x for x in (_xt(s, "TeslimAdresi"), _xt(s, "TeslimMahalle"), _xt(s, "TeslimIlce"), _xt(s, "TeslimIl")) if x) or "-", "city": _xt(s, "TeslimIl") or "-", "district": _xt(s, "TeslimIlce"),
            "billing_address": " ".join(x for x in (_xt(s, "FaturaAdresi"), _xt(s, "FaturaIlce"), _xt(s, "FaturaIl")) if x), "items": items, "total_amount": round(paid or net or sum(i["total"] for i in items), 2), "gross_total": round(net, 2), "discount_total": round(abs(_xf(s, "ISKONTO")) + _xf(s, "SEPETINDIRIM") + _xf(s, "PROMOSYON"), 2),
            "cargo_fee": _xf(s, "KARGO_UCRETI"), "currency": "TRY", "order_status": SHOPPHP_STATUS.get(status_no, "approved"), "marketplace_status": _xt(s, "ODEME_DURUM") or status_no, "payment_method": _xt(s, "ODEME_SEKLI"), "bank_name": _xt(s, "BANKA_ADI"),
            "cargo_carrier_name": _xt(s, "KargoFirma"), "cargo_tracking_number": _xt(s, "KargoTakipNo"), "cargo_barcode": _xt(s, "KargoBarkodNo"), "cargo_tracking_url": _xt(s, "KargoURL"), "customer_note": _xt(s, "Not"), "is_invoiced": False, "order_date": order_date, "is_simulated": False, "source": "marketplace_sync"}


async def shopphp_products_xml(cfg: dict) -> List[dict]:
    """c=shopphp ürün + varyasyon XML'i → pazaryeri ürün satırları (varyasyon başına bir satır)."""
    key = shopphp_resolve(cfg)["products"]
    if not key:
        raise HTTPException(status_code=400, detail="ShopPHP ürün XML kodu (xml.php?c=shopphp&xmlc=…) tanımlı değil. RSS (c=rss) beslemesi fiyat/stok içermez; ShopPHP panelinden 'shopphp' tipi XML kodunu ekleyin.")
    root = await shopphp_xml(cfg, "shopphp", key)
    rows = []
    for u in root.findall(".//urun"):
        pid, code, name = _xt(u, "urun_ID"), _xt(u, "urun_kod"), _re.sub(r"\s+", " ", _xt(u, "urun_ad"))
        price = _xf(u, "urun_fiyat_TL") or _xf(u, "urun_fiyat"); list_price = _xf(u, "urun_fiyat_piyasa") or price
        vat_raw = _xf(u, "urun_kdv", 0.2); vat = int(round(vat_raw * 100)) if vat_raw <= 1 else int(round(vat_raw))
        base = {"product_main_id": pid, "stock_code": code, "title": name, "brand": _xt(u, "urun_marka_ad"), "category": _xt(u, "urun_kategori_ad").replace("&amp;", "&"), "image": _xt(u, "urun_resim1"), "approved": _xt(u, "urun_aktif", "1") == "1", "on_sale": _xt(u, "urun_aktif", "1") == "1", "vat_rate": vat, "list_price": list_price}
        vars_ = u.findall("urun_varyasyonlari/varyasyon")
        if not vars_:
            rows.append({**base, "barcode": _xt(u, "urun_gtin") or code or pid, "sale_price": price, "quantity": int(_xf(u, "urun_stok"))})
        for v in vars_:
            var_name = " / ".join(f"{x.attrib.get('varyasyon', '')}" for x in v if x.tag.startswith("var") and x.attrib.get("varyasyon"))
            rows.append({**base, "title": f"{name} — {var_name}" if var_name else name, "barcode": _xt(v, "gtin") or _xt(v, "stok_kod") or f"{code}-{var_name}", "stock_code": _xt(v, "stok_kod") or code, "sale_price": round(price + _xf(v, "fiyat_fark"), 2), "quantity": int(_xf(v, "stok")), "image": _xt(v, "resim1") or base["image"], "variant": var_name})
    return rows
