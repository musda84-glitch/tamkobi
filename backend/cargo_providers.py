"""Live cargo provider clients. Currently: Geliver (kargo pazaryeri) REST API v1."""
import asyncio
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

import comm_service

GELIVER_BASE = os.environ.get("GELIVER_BASE_URL", "https://api.geliver.io/api/v1").rstrip("/")
SECRET_FIELDS = ("api_key", "api_secret", "api_password")

CITY_CODES = {"adana": "01", "adıyaman": "02", "afyonkarahisar": "03", "afyon": "03", "ağrı": "04", "amasya": "05", "ankara": "06", "antalya": "07", "artvin": "08", "aydın": "09", "balıkesir": "10",
              "bilecik": "11", "bingöl": "12", "bitlis": "13", "bolu": "14", "burdur": "15", "bursa": "16", "çanakkale": "17", "çankırı": "18", "çorum": "19", "denizli": "20", "diyarbakır": "21",
              "edirne": "22", "elazığ": "23", "erzincan": "24", "erzurum": "25", "eskişehir": "26", "gaziantep": "27", "giresun": "28", "gümüşhane": "29", "hakkari": "30", "hatay": "31", "ısparta": "32",
              "isparta": "32", "mersin": "33", "içel": "33", "istanbul": "34", "i̇stanbul": "34", "izmir": "35", "i̇zmir": "35", "kars": "36", "kastamonu": "37", "kayseri": "38", "kırklareli": "39",
              "kırşehir": "40", "kocaeli": "41", "konya": "42", "kütahya": "43", "malatya": "44", "manisa": "45", "kahramanmaraş": "46", "mardin": "47", "muğla": "48", "muş": "49", "nevşehir": "50",
              "niğde": "51", "ordu": "52", "rize": "53", "sakarya": "54", "samsun": "55", "siirt": "56", "sinop": "57", "sivas": "58", "tekirdağ": "59", "tokat": "60", "trabzon": "61", "tunceli": "62",
              "şanlıurfa": "63", "uşak": "64", "van": "65", "yozgat": "66", "zonguldak": "67", "aksaray": "68", "bayburt": "69", "karaman": "70", "kırıkkale": "71", "batman": "72", "şırnak": "73",
              "bartın": "74", "ardahan": "75", "iğdır": "76", "yalova": "77", "karabük": "78", "kilis": "79", "osmaniye": "80", "düzce": "81"}


def city_code(city: Optional[str]) -> str:
    key = (city or "").strip().lower().replace("i̇", "i")
    return CITY_CODES.get(key) or CITY_CODES.get(key.replace("ı", "i"), "34")


def normalize_phone_e164(phone: Optional[str]) -> str:
    p = comm_service.normalize_phone(phone or "") or ""
    digits = re.sub(r"\D", "", p)
    if digits.startswith("90") and len(digits) == 12:
        return "+" + digits
    if digits.startswith("0") and len(digits) == 11:
        return "+9" + digits
    if len(digits) == 10:
        return "+90" + digits
    return "+" + digits if digits else ""


def decrypt_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    try:
        return comm_service.decrypt(value)
    except Exception:
        return value


def geliver_token(config: dict) -> str:
    token = decrypt_secret(config.get("api_key"))
    if not token:
        raise HTTPException(status_code=400, detail="Geliver API token girilmemiş.")
    return token


async def _geliver(method: str, path: str, token: str, **kwargs: Any) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(base_url=GELIVER_BASE, timeout=30.0) as client:
            r = await client.request(method, path, headers=headers, **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Geliver'e bağlanılamadı: {str(e)[:120]}")
    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:300]}
    if r.is_error or (isinstance(body, dict) and body.get("result") is False):
        msg = body.get("message") or body.get("error") or body.get("raw") or r.reason_phrase if isinstance(body, dict) else str(body)[:200]
        if r.status_code == 401:
            msg = "Geliver API token geçersiz veya yetkisiz (401)."
        raise HTTPException(status_code=502 if r.status_code >= 500 else 400, detail=f"Geliver hatası: {msg}")
    return body.get("data", body) if isinstance(body, dict) else body


async def geliver_test(config: dict) -> Dict[str, Any]:
    token = geliver_token(config)
    data = await _geliver("GET", "/addresses", token, params={"limit": 50})
    items = data.get("items") if isinstance(data, dict) else data
    addresses = [{"id": a.get("id"), "name": a.get("name"), "city": a.get("cityName"), "district": a.get("districtName"), "phone": a.get("phone")} for a in (items or []) if isinstance(a, dict)]
    return {"ok": True, "message": f"Geliver bağlantısı doğrulandı. {len(addresses)} adres bulundu.", "addresses": addresses}


async def geliver_create_shipment(config: dict, order: dict, opts: dict) -> Dict[str, Any]:
    token = geliver_token(config)
    sender_id = (opts.get("sender_address_id") or config.get("sender_address_id") or "").strip()
    if not sender_id:
        raise HTTPException(status_code=400, detail="Geliver gönderici adres ID (senderAddressID) ayarlanmamış. Kargo Entegrasyon → Geliver → Ayarlar'dan seçin.")
    test_mode = bool(config.get("test_mode", True))
    items = [{"title": (it.get("product_name") or "Ürün")[:100], "quantity": int(it.get("quantity") or 1)} for it in order.get("items", [])] or [{"title": "Sipariş", "quantity": 1}]
    recipient = {"name": (order.get("customer_name") or "Müşteri")[:100], "phone": normalize_phone_e164(order.get("customer_phone")) or "+905000000000",
                 "address1": (order.get("shipping_address") or "-")[:250], "countryCode": "TR", "cityCode": city_code(order.get("city")), "districtName": (opts.get("district") or order.get("district") or order.get("city") or "Merkez")[:60]}
    if order.get("customer_email"):
        recipient["email"] = order["customer_email"]
    payload = {"test": test_mode, "senderAddressID": sender_id, "returnAddressID": sender_id,
               "length": str(opts.get("length") or config.get("default_length") or "10"), "width": str(opts.get("width") or config.get("default_width") or "10"), "height": str(opts.get("height") or config.get("default_height") or "10"),
               "distanceUnit": "cm", "weight": str(opts.get("weight") or config.get("default_weight") or "1"), "massUnit": "kg", "items": items, "recipientAddress": recipient,
               "productPaymentOnDelivery": False,
               "order": {"sourceCode": "API", "sourceIdentifier": "NexusHesap", "orderNumber": order.get("order_number", ""), "totalAmount": float(order.get("total_amount") or 0), "totalAmountCurrency": "TL"}}
    if opts.get("provider_service_code"):
        payload["providerServiceCode"] = opts["provider_service_code"]
    shipment = await _geliver("POST", "/shipments", token, json=payload)
    sid = shipment.get("id")
    offer = (shipment.get("offers") or {}).get("cheapest") if isinstance(shipment.get("offers"), dict) else None
    for _ in range(4):
        if offer or not sid:
            break
        await asyncio.sleep(1.2)
        shipment = await _geliver("GET", f"/shipments/{sid}", token)
        offers = shipment.get("offers") or {}
        offer = offers.get("cheapest") if isinstance(offers, dict) else None
    result: Dict[str, Any] = {"geliver_id": sid, "test": test_mode, "raw": shipment, "offer": offer, "accepted": False}
    if offer and offer.get("id") and opts.get("accept_offer", True):
        tx = await _geliver("POST", "/transactions/accept-offer", token, json={"offerID": offer["id"]})
        sh = tx.get("shipment") or {}
        result.update({"accepted": True, "transaction": tx, "tracking_number": sh.get("trackingNumber"), "barcode": sh.get("barcode"), "label_url": sh.get("labelURL"), "tracking_url": sh.get("trackingUrl"),
                       "provider": (offer.get("providerServiceCode") or offer.get("providerCode") or ""), "price": offer.get("totalAmount") or offer.get("amount")})
    return result


async def geliver_get_shipment(config: dict, geliver_id: str) -> Dict[str, Any]:
    token = geliver_token(config)
    s = await _geliver("GET", f"/shipments/{geliver_id}", token)
    return {"status": s.get("status") or s.get("statusCode"), "tracking_number": s.get("trackingNumber"), "barcode": s.get("barcode"), "label_url": s.get("labelURL"), "tracking_url": s.get("trackingUrl"), "raw": s}


def mask_config(doc: dict) -> dict:
    out = dict(doc)
    for k in SECRET_FIELDS:
        if out.get(k):
            out[k] = "••••••••"
            out[f"has_{k}"] = True
    return out


def encrypt_secrets(data: dict) -> dict:
    out = dict(data)
    for k in SECRET_FIELDS:
        v = out.get(k)
        if v and v != "••••••••":
            out[k] = comm_service.encrypt(v)
        elif k in out:
            out.pop(k)
    return out


def has_live_credentials(config: dict) -> bool:
    return any(config.get(k) for k in SECRET_FIELDS) and config.get("is_active", True) and config.get("status") == "connected"
