"""Live cargo provider clients. Currently: Geliver (kargo pazaryeri) REST API v1.

Aligned with the official Geliver Python SDK:
https://github.com/GeliverApp/geliver-python
"""
from __future__ import annotations

import asyncio
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

import comm_service

# Official default: https://api.geliver.io/api/v1
GELIVER_BASE = os.environ.get("GELIVER_BASE_URL", "https://api.geliver.io/api/v1").rstrip("/")
SECRET_FIELDS = ("api_key", "api_secret", "api_password")

CITY_CODES = {
    "adana": "01", "adıyaman": "02", "afyonkarahisar": "03", "afyon": "03", "ağrı": "04", "amasya": "05",
    "ankara": "06", "antalya": "07", "artvin": "08", "aydın": "09", "balıkesir": "10", "bilecik": "11",
    "bingöl": "12", "bitlis": "13", "bolu": "14", "burdur": "15", "bursa": "16", "çanakkale": "17",
    "çankırı": "18", "çorum": "19", "denizli": "20", "diyarbakır": "21", "edirne": "22", "elazığ": "23",
    "erzincan": "24", "erzurum": "25", "eskişehir": "26", "gaziantep": "27", "giresun": "28",
    "gümüşhane": "29", "hakkari": "30", "hatay": "31", "ısparta": "32", "isparta": "32", "mersin": "33",
    "içel": "33", "istanbul": "34", "i̇stanbul": "34", "izmir": "35", "i̇zmir": "35", "kars": "36",
    "kastamonu": "37", "kayseri": "38", "kırklareli": "39", "kırşehir": "40", "kocaeli": "41",
    "konya": "42", "kütahya": "43", "malatya": "44", "manisa": "45", "kahramanmaraş": "46", "mardin": "47",
    "muğla": "48", "muş": "49", "nevşehir": "50", "niğde": "51", "ordu": "52", "rize": "53", "sakarya": "54",
    "samsun": "55", "siirt": "56", "sinop": "57", "sivas": "58", "tekirdağ": "59", "tokat": "60",
    "trabzon": "61", "tunceli": "62", "şanlıurfa": "63", "uşak": "64", "van": "65", "yozgat": "66",
    "zonguldak": "67", "aksaray": "68", "bayburt": "69", "karaman": "70", "kırıkkale": "71", "batman": "72",
    "şırnak": "73", "bartın": "74", "ardahan": "75", "iğdır": "76", "yalova": "77", "karabük": "78",
    "kilis": "79", "osmaniye": "80", "düzce": "81",
}


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


def _geliver_friendly_error(msg: str, *, status_code: int = 0, path: str = "") -> str:
    """Map opaque Geliver messages to actionable Turkish guidance."""
    low = (msg or "").lower()
    if status_code == 401 or "401" in low or "unauthorized" in low or "token" in low and ("geçersiz" in low or "invalid" in low):
        return (
            "Geliver API token geçersiz veya yetkisiz. "
            "app.geliver.io → API Tokens sayfasından yeni bir token alın; "
            "kullanıcı oturum anahtarı değil, API token kullanın."
        )
    if "yetki" in low or "permission" in low or "forbidden" in low or status_code == 403:
        hint = (
            "Geliver: bu işlem için yetkiniz yok. Kontrol listesi: "
            "1) app.geliver.io bakiyesi yeterli mi? "
            "2) Token API Tokens sayfasından mı (tam yetkili)? "
            "3) Gönderici adresi bu hesaba mı ait? "
            "4) Canlı moddaysanız önce Test modunu açıp deneyin. "
            "5) Geliver panelinde mağaza/anlaşma aktif mi?"
        )
        if path.startswith("/transactions"):
            hint += " (Etiket satın alma / teklif kabul adımında reddedildi — çoğu zaman bakiye veya canlı hesap kısıtı.)"
        return hint
    if "bakiye" in low or "balance" in low or "insufficient" in low:
        return f"Geliver bakiyesi yetersiz: {msg}. app.geliver.io üzerinden bakiye yükleyin veya Test modunu kullanın."
    return f"Geliver hatası: {msg}"


async def _geliver(method: str, path: str, token: str, **kwargs: Any) -> Any:
    headers = {"Authorization": f"Bearer {token}", "Accept": "application/json", "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(base_url=GELIVER_BASE, timeout=45.0) as client:
            r = await client.request(method, path, headers=headers, **kwargs)
    except httpx.HTTPError as e:
        raise HTTPException(status_code=502, detail=f"Geliver'e bağlanılamadı: {str(e)[:120]}")
    try:
        body = r.json()
    except ValueError:
        body = {"raw": r.text[:300]}
    if r.is_error or (isinstance(body, dict) and body.get("result") is False):
        msg = (
            (body.get("message") or body.get("error") or body.get("additionalMessage") or body.get("raw") or r.reason_phrase)
            if isinstance(body, dict) else str(body)[:200]
        )
        raise HTTPException(
            status_code=502 if r.status_code >= 500 else 400,
            detail=_geliver_friendly_error(str(msg), status_code=r.status_code, path=path),
        )
    return body.get("data", body) if isinstance(body, dict) else body


async def geliver_test(config: dict) -> Dict[str, Any]:
    token = geliver_token(config)
    data = await _geliver("GET", "/addresses", token, params={"limit": 50, "isRecipientAddress": "false"})
    items = data.get("items") if isinstance(data, dict) else data
    if isinstance(data, dict) and not items and isinstance(data.get("data"), list):
        items = data["data"]
    addresses = [
        {
            "id": a.get("id"),
            "name": a.get("name") or a.get("shortName") or "Adres",
            "city": a.get("cityName"),
            "district": a.get("districtName"),
            "phone": a.get("phone"),
            "zip": a.get("zip"),
        }
        for a in (items or [])
        if isinstance(a, dict) and a.get("id")
    ]
    balance = None
    try:
        bal = await _geliver("GET", "/prices/balance", token)
        if isinstance(bal, dict):
            balance = bal.get("balance") or bal.get("amount") or bal.get("totalBalance") or bal
        else:
            balance = bal
    except HTTPException:
        # Balance endpoint may be unavailable for some accounts; connection still OK.
        pass
    msg = f"Geliver bağlantısı doğrulandı. {len(addresses)} adres bulundu."
    if balance is not None:
        msg += f" Bakiye: {balance}"
    if not bool(config.get("test_mode", True)):
        msg += " · CANLI mod açık — etiket ücreti bakiyeden düşer."
    return {"ok": True, "message": msg, "addresses": addresses, "balance": balance, "test_mode": bool(config.get("test_mode", True))}


async def geliver_create_shipment(config: dict, order: dict, opts: Optional[dict] = None) -> Dict[str, Any]:
    """Create shipment → wait for offers.cheapest → POST /transactions {offerID}.

    Fixes vs previous implementation (matched to geliver-python SDK):
    - accept offer: POST /transactions (not /transactions/accept-offer)
    - recipient requires cityName + zip (+ phone)
    - order.totalAmountCurrency = TRY (not TL); amounts as strings
    """
    opts = opts or {}
    token = geliver_token(config)
    sender_id = (opts.get("sender_address_id") or config.get("sender_address_id") or "").strip()
    if not sender_id:
        raise HTTPException(
            status_code=400,
            detail="Geliver gönderici adresi seçilmemiş. Kargo → Geliver → Bağlantıyı Test Et → adres seç → Kaydet.",
        )

    test_mode = bool(config.get("test_mode", True))
    city = (order.get("city") or opts.get("city") or "İstanbul").strip() or "İstanbul"
    district = (opts.get("district") or order.get("district") or city or "Merkez").strip()[:80]
    phone = normalize_phone_e164(order.get("customer_phone") or opts.get("customer_phone"))
    if not phone:
        raise HTTPException(status_code=400, detail="Alıcı telefonu zorunlu. Siparişe geçerli bir telefon ekleyin.")

    items = [
        {"title": (it.get("product_name") or it.get("name") or "Ürün")[:100], "quantity": int(it.get("quantity") or 1)}
        for it in (order.get("items") or [])
    ] or [{"title": "Sipariş", "quantity": 1}]

    recipient = {
        "name": (order.get("customer_name") or "Müşteri")[:100],
        "phone": phone,
        "address1": (order.get("shipping_address") or order.get("address") or "-")[:250],
        "countryCode": "TR",
        "cityName": city[:80],
        "cityCode": city_code(city),
        "districtName": district,
        "zip": str(opts.get("zip") or order.get("zip") or order.get("postal_code") or "34000")[:10],
    }
    if order.get("customer_email"):
        recipient["email"] = str(order["customer_email"])[:120]

    try:
        total_s = f"{float(order.get('total_amount') or opts.get('total_amount') or 0):.2f}"
    except (TypeError, ValueError):
        total_s = "0.00"

    payload: Dict[str, Any] = {
        "test": test_mode,
        "senderAddressID": sender_id,
        "returnAddressID": sender_id,
        "length": str(opts.get("length") or config.get("default_length") or "10.0"),
        "width": str(opts.get("width") or config.get("default_width") or "10.0"),
        "height": str(opts.get("height") or config.get("default_height") or "10.0"),
        "distanceUnit": "cm",
        "weight": str(opts.get("weight") or config.get("default_weight") or "1.0"),
        "massUnit": "kg",
        "items": items,
        "recipientAddress": recipient,
        "productPaymentOnDelivery": bool(opts.get("cod") or order.get("payment_type") == "cod"),
        "order": {
            "orderNumber": str(order.get("order_number") or order.get("id") or "")[:64],
            "sourceIdentifier": str(opts.get("source_identifier") or config.get("store_url") or "https://tamkobi.local")[:200],
            "sourceCode": "API",
            "totalAmount": total_s,
            "totalAmountCurrency": "TRY",
        },
    }
    if opts.get("provider_service_code"):
        payload["providerServiceCode"] = opts["provider_service_code"]

    shipment = await _geliver("POST", "/shipments", token, json=payload)
    sid = shipment.get("id") if isinstance(shipment, dict) else None

    def _pick_offer(sh: Any) -> tuple[Optional[dict], float]:
        if not isinstance(sh, dict):
            return None, 0.0
        offers = sh.get("offers") if isinstance(sh.get("offers"), dict) else {}
        cheapest = offers.get("cheapest") if offers else None
        pct = float(offers.get("percentageCompleted") or 0) if offers else 0.0
        if isinstance(cheapest, dict) and cheapest.get("id"):
            return cheapest, pct
        return None, pct

    offer, pct_done = _pick_offer(shipment)
    # Wait until offers are ready (SDK polls percentageCompleted); short timeout for UX.
    for _ in range(10):
        if (offer and offer.get("id") and pct_done >= 80) or not sid:
            break
        if offer and offer.get("id") and pct_done >= 50:
            # Cheapest already present — enough to accept for most accounts
            break
        await asyncio.sleep(1.0)
        shipment = await _geliver("GET", f"/shipments/{sid}", token)
        offer, pct_done = _pick_offer(shipment)

    result: Dict[str, Any] = {
        "geliver_id": sid,
        "test": test_mode,
        "raw": shipment,
        "offer": offer,
        "accepted": False,
        "tracking_number": (shipment or {}).get("trackingNumber") if isinstance(shipment, dict) else None,
        "barcode": (shipment or {}).get("barcode") if isinstance(shipment, dict) else None,
        "label_url": ((shipment or {}).get("labelURL") or (shipment or {}).get("labelUrl")) if isinstance(shipment, dict) else None,
        "tracking_url": ((shipment or {}).get("trackingUrl") or (shipment or {}).get("trackingURL")) if isinstance(shipment, dict) else None,
    }

    if offer and offer.get("id") and opts.get("accept_offer", True):
        # Official SDK: client.accept_offer(id) → POST /transactions {"offerID": id}
        try:
            tx = await _geliver("POST", "/transactions", token, json={"offerID": offer["id"]})
        except HTTPException as exc:
            detail = str(exc.detail or "")
            low = detail.lower()
            # Soft-fail: shipment exists; user can fund wallet / switch test mode and retry accept later
            if any(x in low for x in ("yetki", "yetkiniz", "unauthorized", "forbidden", "bakiye", "balance")):
                result["accept_error"] = detail
                result["message"] = (
                    f"Gönderi oluşturuldu ({sid}) fakat etiket alınamadı. {detail} "
                    "Kargo listesinden durumu yenileyebilir veya Geliver panelinden etiketi tamamlayabilirsiniz."
                )
                return result
            raise
        sh = (tx.get("shipment") if isinstance(tx, dict) else None) or {}
        result.update({
            "accepted": True,
            "transaction": tx,
            "tracking_number": sh.get("trackingNumber") or result.get("tracking_number"),
            "barcode": sh.get("barcode") or result.get("barcode"),
            "label_url": sh.get("labelURL") or sh.get("labelUrl") or result.get("label_url"),
            "tracking_url": sh.get("trackingUrl") or sh.get("trackingURL") or result.get("tracking_url"),
            "provider": offer.get("providerServiceCode") or offer.get("providerCode") or "",
            "price": offer.get("totalAmount") or offer.get("amount"),
        })
    elif opts.get("accept_offer", True) and sid and not (offer and offer.get("id")):
        raise HTTPException(
            status_code=502,
            detail=(
                "Geliver teklifi henüz hazır değil. Gönderici adresini, API token hesabını ve Geliver bakiyesini "
                "kontrol edin; Test modunu açık tutup tekrar deneyin."
            ),
        )
    return result


async def geliver_get_shipment(config: dict, geliver_id: str) -> Dict[str, Any]:
    token = geliver_token(config)
    s = await _geliver("GET", f"/shipments/{geliver_id}", token)
    return {
        "status": s.get("status") or s.get("statusCode"),
        "tracking_number": s.get("trackingNumber"),
        "barcode": s.get("barcode"),
        "label_url": s.get("labelURL") or s.get("labelUrl"),
        "tracking_url": s.get("trackingUrl") or s.get("trackingURL"),
        "raw": s,
    }


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
