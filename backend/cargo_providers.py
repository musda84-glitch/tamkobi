"""Live cargo provider clients. Currently: Geliver (kargo pazaryeri) REST API v1.

Uses the official Geliver Python SDK for HTTP transport:
https://github.com/GeliverApp/geliver-python  (`pip install geliver`)
"""
from __future__ import annotations

import asyncio
import logging
import os
import re
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

import comm_service

logger = logging.getLogger("TamKobiERP")

# Official default: https://api.geliver.io/api/v1
GELIVER_BASE = os.environ.get("GELIVER_BASE_URL", "https://api.geliver.io/api/v1").rstrip("/")
SECRET_FIELDS = ("api_key", "api_secret", "api_password")
# 1 = resmi geliver SDK (varsayılan); 0 = yalnızca ham httpx
USE_GELIVER_SDK = os.environ.get("GELIVER_USE_SDK", "1").lower() not in {"0", "false", "no"}

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
    raw = str(value).strip()
    try:
        return str(comm_service.decrypt(raw) or "").strip()
    except Exception:
        # Encrypted blob that no longer decrypts (key rotated / wrong env) — never send ciphertext to Geliver.
        if comm_service.looks_like_fernet_token(raw):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Kayıtlı Geliver API token okunamadı (şifreleme anahtarı değişmiş olabilir). "
                    "Kargo → Geliver ayarlarında API Token alanına app.geliver.io → API Tokens’tan "
                    "yeni tokenu yapıştırıp Kaydet / Bağlantıyı Test Et yapın."
                ),
            )
        return raw


def normalize_package_opts(
    opts: Optional[dict] = None,
    config: Optional[dict] = None,
    order: Optional[dict] = None,
) -> Dict[str, Any]:
    """Carrier-agnostic package fields: package_count, desi, weight, L×W×H (cm).

    Used by Geliver and future carriers. Desi ≈ (L×W×H)/3000. Missing dims are
    inferred from desi (cube); missing desi is inferred from dims. Multi-package
    values are per-parcel; callers may multiply for totals.
    """
    opts = opts or {}
    config = config or {}
    order = order or {}

    def _num(*keys: str, default: Optional[float] = None) -> Optional[float]:
        for source in (opts, config):
            for key in keys:
                raw = source.get(key)
                if raw is None or raw == "":
                    continue
                try:
                    return float(raw)
                except (TypeError, ValueError):
                    continue
        return default

    try:
        package_count = int(opts.get("package_count") or opts.get("parcel_count") or config.get("default_package_count") or 1)
    except (TypeError, ValueError):
        package_count = 1
    package_count = max(1, min(package_count, 50))

    order_desi = 0.0
    order_weight = 0.0
    dim_candidates = []
    package_from_items = None
    for it in order.get("items") or []:
        try:
            qty = float(it.get("quantity") or 1)
        except (TypeError, ValueError):
            qty = 1.0
        try:
            order_desi += float(it.get("desi") or 0) * qty
        except (TypeError, ValueError):
            pass
        try:
            order_weight += float(it.get("weight") or 0) * qty
        except (TypeError, ValueError):
            pass
        try:
            L, W, H = float(it.get("length") or 0), float(it.get("width") or 0), float(it.get("height") or 0)
            if L > 0 and W > 0 and H > 0:
                dim_candidates.append((L, W, H))
        except (TypeError, ValueError):
            pass
        try:
            pc_it = int(it.get("package_count") or 0)
            if pc_it > 0:
                package_from_items = (package_from_items or 0) + pc_it
        except (TypeError, ValueError):
            pass

    desi = _num("desi")
    if desi is None and order_desi > 0:
        desi = order_desi
    if desi is None:
        desi = _num("default_desi")

    length = _num("length", "default_length")
    width = _num("width", "default_width")
    height = _num("height", "default_height")
    weight = _num("weight", "default_weight")
    if weight is None and order_weight > 0:
        weight = order_weight

    # Ölçüler: tüm kalemlerde aynı ölçü varsa stok kartından kullan
    if not (length and width and height) and dim_candidates:
        if len(dim_candidates) == len(order.get("items") or []) and len({d for d in dim_candidates}) == 1:
            length, width, height = dim_candidates[0]

    if package_count <= 1 and package_from_items and package_from_items > 1 and not opts.get("package_count") and not opts.get("parcel_count"):
        package_count = max(1, min(package_from_items, 50))

    if desi and not (length and width and height):
        side = round((max(float(desi), 0.1) * 3000) ** (1 / 3), 1)
        length = length or side
        width = width or side
        height = height or side
    elif length and width and height and not desi:
        desi = round((float(length) * float(width) * float(height)) / 3000.0, 2)

    if weight is None and desi:
        weight = float(desi)
    if weight is None:
        weight = 1.0
    if length is None:
        length = 10.0
    if width is None:
        width = 10.0
    if height is None:
        height = 10.0
    if desi is None:
        desi = round((float(length) * float(width) * float(height)) / 3000.0, 2)

    return {
        "package_count": package_count,
        "desi": round(float(desi), 2),
        "length": round(float(length), 1),
        "width": round(float(width), 1),
        "height": round(float(height), 1),
        "weight": round(float(weight), 2),
        "total_desi": round(float(desi) * package_count, 2),
        "total_weight": round(float(weight) * package_count, 2),
    }


def geliver_token(config: dict) -> str:
    token = decrypt_secret(config.get("api_key"))
    if not token:
        raise HTTPException(status_code=400, detail="Geliver API token girilmemiş.")
    # Users sometimes paste "Bearer xxx" from curl samples.
    if token.lower().startswith("bearer "):
        token = token[7:].strip()
    return token


def _geliver_friendly_error(msg: str, *, status_code: int = 0, path: str = "") -> str:
    """Map opaque Geliver messages to actionable Turkish guidance."""
    low = (msg or "").lower()
    if status_code == 401 or "401" in low or "unauthorized" in low or "token" in low and ("geçersiz" in low or "invalid" in low):
        return (
            "Geliver API token geçersiz veya yetkisiz. "
            "app.geliver.io → API Tokens sayfasından yeni bir token alın; "
            "kullanıcı oturum anahtarı değil, API token kullanın. "
            f"(Geliver: {msg})"
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
        if path.startswith("/addresses"):
            hint += (
                " (Bağlantı testi / adres listesi — çoğu zaman token süresi dolmuş, "
                "yanlış organizasyon token’ı veya kayıtlı anahtarın yeniden girilmesi gerekir.)"
            )
        if path.startswith("/transactions"):
            hint += " (Etiket satın alma / teklif kabul adımında reddedildi — çoğu zaman bakiye veya canlı hesap kısıtı.)"
        return f"{hint} (Geliver: {msg})"
    if "bakiye" in low or "balance" in low or "insufficient" in low:
        return f"Geliver bakiyesi yetersiz: {msg}. app.geliver.io üzerinden bakiye yükleyin veya Test modunu kullanın."
    return f"Geliver hatası: {msg}"


def make_geliver_client(token: str):
    """Resmi GeliverClient (senkron). Testlerde / opsiyonel kapalıyken None dönmez — import hatası yükselir."""
    from geliver import ClientOptions, GeliverClient

    return GeliverClient(ClientOptions(token=token, base_url=GELIVER_BASE, timeout=45.0))


def _geliver_via_sdk(method: str, path: str, token: str, **kwargs: Any) -> Any:
    """Official SDK low-level request (sync)."""
    from geliver.client import GeliverError

    client = make_geliver_client(token)
    try:
        return client._request(
            method,
            path,
            params=kwargs.get("params"),
            json_body=kwargs.get("json"),
        )
    except GeliverError as e:
        status = int(e.status or 400)
        msg = e.additional_message or str(e) or "API error"
        raise HTTPException(
            status_code=502 if status >= 500 else 400,
            detail=_geliver_friendly_error(msg, status_code=status, path=path),
        ) from e
    finally:
        try:
            client._client.close()
        except Exception:
            pass


async def _geliver_via_httpx(method: str, path: str, token: str, **kwargs: Any) -> Any:
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
    # Paginated envelope: keep full body (SDK ile aynı)
    if isinstance(body, dict) and any(k in body for k in ("limit", "page", "totalRows", "totalPages")):
        return body
    return body.get("data", body) if isinstance(body, dict) else body


async def _geliver(method: str, path: str, token: str, **kwargs: Any) -> Any:
    """Geliver REST çağrısı — varsayılan resmi `geliver` SDK; yoksa/kapalıysa httpx."""
    if USE_GELIVER_SDK:
        try:
            return await asyncio.to_thread(_geliver_via_sdk, method, path, token, **kwargs)
        except HTTPException:
            raise
        except ImportError:
            logger.warning("geliver SDK yüklü değil; httpx yedeğine düşülüyor (pip install geliver)")
        except Exception as e:
            logger.warning("geliver SDK isteği başarısız (%s); httpx yedeği", e)
    return await _geliver_via_httpx(method, path, token, **kwargs)


def _geliver_address_items(data: Any) -> List[dict]:
    items = data.get("items") if isinstance(data, dict) else data
    if isinstance(data, dict) and not items and isinstance(data.get("data"), list):
        items = data["data"]
    return [a for a in (items or []) if isinstance(a, dict) and a.get("id")]


async def geliver_test(config: dict) -> Dict[str, Any]:
    token = geliver_token(config)
    # Unfiltered list first (original working path). Some accounts 403 on isRecipientAddress filter.
    try:
        data = await _geliver("GET", "/addresses", token, params={"limit": 50})
    except HTTPException as first:
        detail_l = str(first.detail or "").lower()
        if "yetki" not in detail_l and "403" not in detail_l and first.status_code not in (400, 403):
            raise
        # Retry once with explicit sender filter (SDK-style) in case bare list is blocked.
        try:
            data = await _geliver(
                "GET", "/addresses", token, params={"limit": 50, "isRecipientAddress": "false"}
            )
        except HTTPException:
            raise first
    items = _geliver_address_items(data)
    # Prefer sender-side addresses when the flag is present on items.
    senders = [
        a for a in items
        if a.get("isRecipientAddress") is False or a.get("isRecipientAddress") is None
    ]
    addresses = [
        {
            "id": a.get("id"),
            "name": a.get("name") or a.get("shortName") or "Adres",
            "city": a.get("cityName"),
            "district": a.get("districtName"),
            "phone": a.get("phone"),
            "zip": a.get("zip"),
        }
        for a in (senders or items)
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


def opt_flag(opts: Optional[dict], key: str, default: bool = False) -> bool:
    """JSON-safe bool: missing → default; false / 'false' / 0 stay false."""
    opts = opts or {}
    if key not in opts:
        return default
    v = opts[key]
    if isinstance(v, bool):
        return v
    if v is None:
        return default
    if isinstance(v, (int, float)):
        return bool(v)
    s = str(v).strip().lower()
    if s in {"1", "true", "yes", "on"}:
        return True
    if s in {"0", "false", "no", "off", ""}:
        return False
    return default


def _offer_amount_num(offer: Optional[dict]) -> Optional[float]:
    if not isinstance(offer, dict):
        return None
    raw = offer.get("totalAmount") or offer.get("amount") or offer.get("totalAmountLocal")
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def geliver_serialize_offer(
    offer: dict,
    *,
    cheapest_id: Optional[str] = None,
    fastest_id: Optional[str] = None,
) -> Dict[str, Any]:
    """UI-facing quote row. Purchase happens only via POST /transactions {offerID}."""
    oid = str(offer.get("id") or "")
    amount_num = _offer_amount_num(offer)
    service = str(offer.get("providerServiceCode") or offer.get("providerCode") or "").strip()
    return {
        "id": oid,
        "provider": str(offer.get("providerCode") or "").strip(),
        "service": service,
        "provider_account": str(offer.get("providerAccountName") or "").strip(),
        "amount": offer.get("totalAmount") or offer.get("amount"),
        "amount_num": amount_num,
        "currency": str(offer.get("currency") or "TRY"),
        "eta": str(
            offer.get("averageEstimatedTimeHumanReadible")
            or offer.get("estimatedArrivalTime")
            or offer.get("durationTerms")
            or ""
        ).strip(),
        "min_hours": offer.get("minEstimatedTime"),
        "max_hours": offer.get("maxEstimatedTime"),
        "rating": offer.get("rating"),
        "is_cheapest": bool(oid and oid == cheapest_id),
        "is_fastest": bool(oid and oid == fastest_id),
        "is_own_agreement": bool(offer.get("isProviderAccountOffer")),
    }


def geliver_collect_offers(shipment: Any) -> tuple[List[dict], Optional[dict], float]:
    """OfferList from GET/POST /shipments: list + cheapest + fastest, no purchase."""
    if not isinstance(shipment, dict):
        return [], None, 0.0
    offers_obj = shipment.get("offers") if isinstance(shipment.get("offers"), dict) else {}
    cheapest = offers_obj.get("cheapest") if isinstance(offers_obj.get("cheapest"), dict) else None
    fastest = offers_obj.get("fastest") if isinstance(offers_obj.get("fastest"), dict) else None
    raw_list = offers_obj.get("list") if isinstance(offers_obj.get("list"), list) else []
    by_id: Dict[str, dict] = {}
    for row in raw_list:
        if isinstance(row, dict) and row.get("id"):
            by_id[str(row["id"])] = row
    if isinstance(cheapest, dict) and cheapest.get("id"):
        by_id.setdefault(str(cheapest["id"]), cheapest)
    if isinstance(fastest, dict) and fastest.get("id"):
        by_id.setdefault(str(fastest["id"]), fastest)
    cheapest_id = str(cheapest["id"]) if isinstance(cheapest, dict) and cheapest.get("id") else None
    fastest_id = str(fastest["id"]) if isinstance(fastest, dict) and fastest.get("id") else None
    serialized = [
        geliver_serialize_offer(row, cheapest_id=cheapest_id, fastest_id=fastest_id)
        for row in by_id.values()
    ]
    serialized.sort(key=lambda x: (x.get("amount_num") is None, x.get("amount_num") if x.get("amount_num") is not None else 0))
    try:
        pct = float(offers_obj.get("percentageCompleted") or 0)
    except (TypeError, ValueError):
        pct = 0.0
    return serialized, cheapest if isinstance(cheapest, dict) and cheapest.get("id") else None, pct


async def geliver_refresh_quotes(config: dict, geliver_id: str) -> Dict[str, Any]:
    """Re-read a quote-only shipment (GET /shipments/{id}) — does not accept."""
    token = geliver_token(config)
    sid = str(geliver_id or "").strip()
    if not sid:
        raise HTTPException(status_code=400, detail="Geliver gönderi kimliği yok.")
    shipment = await _geliver("GET", f"/shipments/{sid}", token)
    offers, cheapest, pct = geliver_collect_offers(shipment)
    return {
        "geliver_id": sid,
        "offers": offers,
        "offer": cheapest,
        "percentage_completed": pct,
        "test": (shipment or {}).get("test") if isinstance(shipment, dict) else None,
        "raw": shipment,
        "accepted": False,
        "tracking_number": (shipment or {}).get("trackingNumber") if isinstance(shipment, dict) else None,
        "barcode": (shipment or {}).get("barcode") if isinstance(shipment, dict) else None,
        "label_url": ((shipment or {}).get("labelURL") or (shipment or {}).get("labelUrl")) if isinstance(shipment, dict) else None,
        "tracking_url": ((shipment or {}).get("trackingUrl") or (shipment or {}).get("trackingURL")) if isinstance(shipment, dict) else None,
    }


async def geliver_accept_offer(config: dict, offer_id: str, geliver_id: Optional[str] = None) -> Dict[str, Any]:
    """Purchase one quote: POST /transactions {offerID} (official SDK accept_offer)."""
    token = geliver_token(config)
    oid = str(offer_id or "").strip()
    if not oid:
        raise HTTPException(status_code=400, detail="Kargo teklifi seçilmedi.")
    tx = await _geliver("POST", "/transactions", token, json={"offerID": oid})
    sh = (tx.get("shipment") if isinstance(tx, dict) else None) or {}
    offer = (tx.get("offer") if isinstance(tx, dict) else None) or {}
    sid = sh.get("id") or geliver_id
    return {
        "geliver_id": sid,
        "accepted": True,
        "transaction": tx,
        "offer": offer if isinstance(offer, dict) else None,
        "offers": [],
        "raw": sh or tx,
        "tracking_number": sh.get("trackingNumber"),
        "barcode": sh.get("barcode"),
        "label_url": sh.get("labelURL") or sh.get("labelUrl"),
        "tracking_url": sh.get("trackingUrl") or sh.get("trackingURL"),
        "provider": (offer or {}).get("providerServiceCode") or (offer or {}).get("providerCode") or "",
        "price": (offer or {}).get("totalAmount") or (offer or {}).get("amount"),
        "test": sh.get("test") if isinstance(sh, dict) else None,
    }


async def geliver_create_shipment(config: dict, order: dict, opts: Optional[dict] = None) -> Dict[str, Any]:
    """Create shipment → wait for offers. With accept_offer (default True) buy cheapest.

    Quote-only: accept_offer=False returns offers.list/cheapest/fastest without POST /transactions.
    Accept: POST /transactions {offerID} (not /transactions/accept-offer).
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

    pkg = normalize_package_opts(opts, config, order)
    payload: Dict[str, Any] = {
        "test": test_mode,
        "senderAddressID": sender_id,
        "returnAddressID": sender_id,
        "length": str(pkg["length"]),
        "width": str(pkg["width"]),
        "height": str(pkg["height"]),
        "distanceUnit": "cm",
        "weight": str(pkg["weight"]),
        "massUnit": "kg",
        "desi": str(pkg["desi"]),
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
    if pkg["package_count"] > 1:
        # Additional identical parcels (per-package desi/weight/dims)
        payload["extraParcels"] = [
            {
                "length": str(pkg["length"]),
                "width": str(pkg["width"]),
                "height": str(pkg["height"]),
                "distanceUnit": "cm",
                "weight": str(pkg["weight"]),
                "massUnit": "kg",
                "desi": str(pkg["desi"]),
            }
            for _ in range(pkg["package_count"] - 1)
        ]
    if opts.get("provider_service_code"):
        payload["providerServiceCode"] = opts["provider_service_code"]

    shipment = await _geliver("POST", "/shipments", token, json=payload)
    sid = shipment.get("id") if isinstance(shipment, dict) else None
    accept_offer = opt_flag(opts, "accept_offer", True)
    chosen_id = str(opts.get("offer_id") or opts.get("offerID") or "").strip()

    offers_list, cheapest, pct_done = geliver_collect_offers(shipment)
    # Wait until quotes are ready (SDK polls percentageCompleted). Quote-only waits longer
    # so offers.list can fill; auto-accept can stop once cheapest exists.
    wait_rounds = 14 if not accept_offer else 10
    for _ in range(wait_rounds):
        if not sid:
            break
        if accept_offer and cheapest and cheapest.get("id") and pct_done >= 50:
            break
        if not accept_offer and offers_list and (pct_done >= 80 or len(offers_list) >= 2):
            break
        if pct_done >= 100:
            break
        await asyncio.sleep(1.0)
        shipment = await _geliver("GET", f"/shipments/{sid}", token)
        offers_list, cheapest, pct_done = geliver_collect_offers(shipment)

    offer = None
    if chosen_id:
        offer = next((o for o in offers_list if o.get("id") == chosen_id), None)
        # Prefer raw dict for accept payload id; serialized rows still have id.
        if offer:
            offer = {"id": chosen_id, **{k: v for k, v in (offer.items() if isinstance(offer, dict) else [])}}
    if not offer:
        offer = cheapest

    result: Dict[str, Any] = {
        "geliver_id": sid,
        "package": pkg,
        "test": test_mode,
        "raw": shipment,
        "offer": cheapest,
        "offers": offers_list,
        "percentage_completed": pct_done,
        "accepted": False,
        "tracking_number": (shipment or {}).get("trackingNumber") if isinstance(shipment, dict) else None,
        "barcode": (shipment or {}).get("barcode") if isinstance(shipment, dict) else None,
        "label_url": ((shipment or {}).get("labelURL") or (shipment or {}).get("labelUrl")) if isinstance(shipment, dict) else None,
        "tracking_url": ((shipment or {}).get("trackingUrl") or (shipment or {}).get("trackingURL")) if isinstance(shipment, dict) else None,
    }

    if offer and offer.get("id") and accept_offer:
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
            "provider": offer.get("service") or offer.get("providerServiceCode") or offer.get("providerCode") or "",
            "price": offer.get("amount") or offer.get("totalAmount") or offer.get("amount_num"),
        })
    elif accept_offer and sid and not (offer and offer.get("id")):
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
            cleaned = str(v).strip()
            if cleaned.lower().startswith("bearer "):
                cleaned = cleaned[7:].strip()
            out[k] = comm_service.encrypt(cleaned) if cleaned else None
            if not cleaned:
                out.pop(k, None)
        elif k in out:
            out.pop(k)
    return out


def has_live_credentials(config: dict) -> bool:
    return any(config.get(k) for k in SECRET_FIELDS) and config.get("is_active", True) and config.get("status") == "connected"
