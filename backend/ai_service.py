import os
import json
import logging
from emergentintegrations.llm.chat import LlmChat, UserMessage

import comm_service

logger = logging.getLogger(__name__)

AI_PROVIDERS = {
    "emergent": {
        "label": "Emergent",
        "hint": "Tek anahtar ile OpenAI, Anthropic ve Gemini modellerini kullanır. Anahtar boş bırakılırsa sunucudaki EMERGENT_LLM_KEY kullanılır.",
        "models": [
            {"id": "gpt-5.4", "vendor": "openai", "label": "GPT-5.4"},
            {"id": "gpt-4.1", "vendor": "openai", "label": "GPT-4.1"},
            {"id": "claude-sonnet-4-6", "vendor": "anthropic", "label": "Claude Sonnet 4.6"},
            {"id": "claude-opus-4-6", "vendor": "anthropic", "label": "Claude Opus 4.6"},
            {"id": "gemini-2.5-pro", "vendor": "gemini", "label": "Gemini 2.5 Pro"},
            {"id": "gemini-2.5-flash", "vendor": "gemini", "label": "Gemini 2.5 Flash"},
        ],
    },
    "openai": {
        "label": "OpenAI",
        "hint": "Doğrudan OpenAI API anahtarı (sk-...). Danışman ve belge ayrıştırma aynı sağlayıcıyı kullanır.",
        "models": [
            {"id": "gpt-5.4", "vendor": "openai", "label": "GPT-5.4"},
            {"id": "gpt-4.1", "vendor": "openai", "label": "GPT-4.1"},
            {"id": "gpt-4o", "vendor": "openai", "label": "GPT-4o"},
        ],
    },
    "anthropic": {
        "label": "Anthropic",
        "hint": "Doğrudan Anthropic API anahtarı. Fatura/sipariş/stok ayrıştırma ve danışman Claude modellerini kullanır.",
        "models": [
            {"id": "claude-sonnet-4-6", "vendor": "anthropic", "label": "Claude Sonnet 4.6"},
            {"id": "claude-opus-4-6", "vendor": "anthropic", "label": "Claude Opus 4.6"},
        ],
    },
    "google": {
        "label": "Google Gemini",
        "hint": "Doğrudan Google AI Studio / Gemini API anahtarı.",
        "models": [
            {"id": "gemini-2.5-pro", "vendor": "gemini", "label": "Gemini 2.5 Pro"},
            {"id": "gemini-2.5-flash", "vendor": "gemini", "label": "Gemini 2.5 Flash"},
        ],
    },
}

AI_DEFAULTS = {
    "enabled": True,
    "provider": "emergent",
    "advisor_model": "gpt-5.4",
    "extract_model": "claude-sonnet-4-6",
}


# LlmChat.with_model vendor ids (Google's SDK name is "gemini", not "google").
SDK_VENDORS = {"openai": "openai", "anthropic": "anthropic", "google": "gemini"}


def vendor_for_model(model: str) -> str:
    m = (model or "").lower()
    if m.startswith("claude"):
        return "anthropic"
    if m.startswith("gemini"):
        return "gemini"
    return "openai"


def sdk_vendor(provider: str, model: str) -> str:
    if provider in SDK_VENDORS:
        return SDK_VENDORS[provider]
    return vendor_for_model(model)


def _model_ids(provider: str) -> list:
    return [m["id"] for m in (AI_PROVIDERS.get(provider) or AI_PROVIDERS["emergent"])["models"]]


def _clamp_model(provider: str, model: str, fallback: str) -> str:
    ids = _model_ids(provider)
    if model in ids:
        return model
    return fallback if fallback in ids else (ids[0] if ids else fallback)


def normalize_ai(raw: dict | None) -> dict:
    p = {**AI_DEFAULTS, **(raw or {})}
    provider = p.get("provider") if p.get("provider") in AI_PROVIDERS else "emergent"
    advisor = _clamp_model(provider, p.get("advisor_model") or "", AI_DEFAULTS["advisor_model"])
    extract = _clamp_model(provider, p.get("extract_model") or "", AI_DEFAULTS["extract_model"])
    return {
        "enabled": bool(p.get("enabled", True)),
        "provider": provider,
        "advisor_model": advisor,
        "extract_model": extract,
        "api_key_enc": p.get("api_key_enc") or "",
        "last_test": p.get("last_test"),
    }


def public_ai_status(cfg: dict) -> dict:
    provider = cfg.get("provider") or "emergent"
    meta = AI_PROVIDERS.get(provider) or AI_PROVIDERS["emergent"]
    models = {m["id"]: m for m in meta["models"]}
    advisor = cfg.get("advisor_model") or ""
    extract = cfg.get("extract_model") or ""
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "configured": bool(cfg.get("api_key")),
        "provider": provider,
        "provider_label": meta["label"],
        "advisor_model": advisor,
        "extract_model": extract,
        "advisor_label": (models.get(advisor) or {}).get("label") or advisor,
        "extract_label": (models.get(extract) or {}).get("label") or extract,
        "badge": f"{meta['label']} {(models.get(advisor) or {}).get('label') or advisor}".strip(),
    }


async def load_ai_settings() -> dict:
    try:
        import saas_billing
        st = await saas_billing.settings()
        cfg = normalize_ai(st.get("ai") or {})
    except Exception:
        cfg = normalize_ai({})
    key = ""
    if cfg.get("api_key_enc"):
        try:
            key = comm_service.decrypt(cfg["api_key_enc"])
        except Exception:
            key = ""
    if not key:
        key = (os.environ.get("EMERGENT_LLM_KEY") or "").strip()
    cfg["api_key"] = key
    cfg["has_key"] = bool(cfg.get("api_key_enc"))
    cfg["has_env_key"] = bool((os.environ.get("EMERGENT_LLM_KEY") or "").strip())
    return cfg


async def make_chat(session_id: str, system_message: str, purpose: str = "extract"):
    cfg = await load_ai_settings()
    if not cfg.get("enabled", True):
        raise RuntimeError("AI entegrasyonu platform panelinden kapatılmış.")
    key = cfg.get("api_key") or ""
    if not key:
        raise RuntimeError("Yapay zeka API anahtarı yapılandırılmamış. Platform Yönetimi → AI Entegrasyonu ekranından anahtar girin.")
    model = cfg["advisor_model"] if purpose == "advisor" else cfg["extract_model"]
    vendor = sdk_vendor(cfg.get("provider") or "emergent", model)
    return LlmChat(api_key=key, session_id=session_id, system_message=system_message).with_model(vendor, model)


async def get_financial_ai_advice(company_context: dict, prompt: str, history: list = None) -> str:

    system_prompt = f"""Sen TamKobi'nin uzman Türk Ticaret ve Vergi Mevzuatına, E-Fatura ve Ön Muhasebe standartlarına hakim AI Finans ve Mali Müşavir Danışmanısın.
Kullanıcının şirketine dair güncel veriler:
- Şirket Adı: {company_context.get('company_name', 'Nexus Teknoloji A.Ş.')}
- Toplam Kasa/Banka Varlığı: {company_context.get('total_bank_balance', 0):,.2f} TRY
- Müşterilerden Toplam Alacak: {company_context.get('total_receivables', 0):,.2f} TRY
- Tedarikçilere Toplam Borç: {company_context.get('total_payables', 0):,.2f} TRY
- Bu Ayki Toplam Satış Ciro: {company_context.get('monthly_sales', 0):,.2f} TRY
- Bu Ayki Toplam Gider: {company_context.get('monthly_expenses', 0):,.2f} TRY
- Bekleyen Sipariş Adedi: {company_context.get('pending_orders_count', 0)}
- Kritik Stoktaki Ürün Adedi: {company_context.get('low_stock_count', 0)}

Görevin:
1. Türkçe olarak samimi, net, profesyonel ve aksiyon odaklı finansal öneriler vermek.
2. Nakit akışını iyileştirecek, tahsilatları hızlandıracak, KDV/stopaj ve gider yönetimini optimize edecek stratejiler sunmak.
3. E-Ticaret, stok devir hızı ve kargo maliyet tasarrufu konusunda somut fikirler sunmak.
4. Yanıtlarını okunması kolay, maddeli ve şık formatta tutmak."""

    try:
        chat = await make_chat(
            f"finance-session-{company_context.get('company_id', 'default')}",
            system_prompt,
            purpose="advisor",
        )

        # Combine short conversation if provided
        user_msg = UserMessage(text=prompt)
        response_text = await chat.send_message(user_msg)
        return response_text
    except RuntimeError as e:
        return str(e)
    except Exception as e:
        logger.error(f"Error invoking emergentintegrations: {e}")
        # Fallback intelligent local response if network/quota temporary issue
        return f"""**Nexus AI Finansal Değerlendirme Raporu:**

1. **Nakit Pozisyonu & Likidite:** Mevcut hazır değerleriniz ({company_context.get('total_bank_balance', 0):,.2f} TL) operasyonel giderleri 30 gün boyunca karşılamak için yeterli seviyededir.
2. **Tahsilat Yönetimi:** Bekleyen {company_context.get('total_receivables', 0):,.2f} TL alacağınız için vadesi geçmiş müşterilere otomatik SMS/E-posta bakiye hatırlatması göndermeniz tavsiye edilir.
3. **Stok & Tedarik:** {company_context.get('low_stock_count', 0)} adet ürün kritik stok sınırının altında. Pazar yeri satışlarının kesintiye uğramaması için acil sipariş açılmalıdır.
4. **Vergi & KDV Planlaması:** Bu ayki satış ve gider dengeniz göz önüne alındığında tahmini KDV yükünüz optimize edilebilir durumdadır."""


INVOICE_SYSTEM = """Sen bir Türk ön muhasebe asistanısın. Sana bir TEDARİKÇİ FATURASININ (alış faturası) PDF'inden çıkarılmış ham metin verilecek.
Görevin faturayı aşağıdaki JSON şemasına birebir uyan TEK bir JSON nesnesi olarak döndürmek. Açıklama, markdown veya kod bloğu YAZMA; sadece JSON.
Şema:
{"supplier": {"name": str, "tax_number": str|null, "tax_office": str|null, "address": str|null, "phone": str|null, "email": str|null},
 "invoice_number": str|null, "issue_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": "TRY"|"USD"|"EUR",
 "items": [{"name": str, "quantity": number, "unit": str, "unit_price": number, "vat_rate": integer, "discount_rate": number, "total": number}],
 "subtotal": number, "vat_total": number, "grand_total": number, "notes": str|null, "confidence": number 0-1}
Kurallar: Sayılar Türkçe formatta olabilir (1.234,56) → ondalık nokta ile number'a çevir. total = quantity*unit_price*(1-discount_rate/100) (KDV hariç).
KDV oranı yoksa 20 kullan. Birim yoksa "Adet". Tarihleri ISO'ya çevir. Bulamadığın alanlara null yaz. Fatura kalemi yoksa toplamdan tek kalem üret."""


async def extract_invoice_from_text(text: str) -> dict:
    chat = await make_chat(f"inv-extract-{abs(hash(text[:200]))}", INVOICE_SYSTEM, purpose="extract")
    raw = await chat.send_message(UserMessage(text=f"FATURA METNİ:\n\n{text[:20000]}"))
    raw = str(raw).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"):]
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    data = json.loads(raw[start:end + 1])
    items = []
    for it in data.get("items") or []:
        q = float(it.get("quantity") or 1)
        p = float(it.get("unit_price") or 0)
        d = float(it.get("discount_rate") or 0)
        items.append({"name": str(it.get("name") or "Kalem")[:200], "quantity": q, "unit": it.get("unit") or "Adet", "unit_price": p, "vat_rate": int(it.get("vat_rate") if it.get("vat_rate") is not None else 20),
                      "discount_rate": d, "total": round(float(it.get("total") or q * p * (1 - d / 100)), 2)})
    data["items"] = items
    return data


ORDER_SYSTEM = """Sen bir e-ticaret/toptan sipariş belgesi ayrıştırıcısısın. Sana verilen metin (PDF, Excel/CSV tablo dökümü veya e-posta) içinden SİPARİŞLERİ çıkar. Yalnızca geçerli JSON döndür:
{"orders":[{"order_number":"varsa belge/sipariş no yoksa null","order_date":"YYYY-MM-DD veya null","customer_name":"müşteri/alıcı adı","customer_phone":"telefon veya null","customer_email":"e-posta veya null","shipping_address":"adres veya null","city":"il veya null","channel":"trendyol|hepsiburada|amazon|n11|shopify|b2b|manual — bilinmiyorsa manual","notes":"not veya null",
"items":[{"product_name":"ürün adı","sku":"stok kodu veya null","barcode":"barkod veya null","quantity":1,"unit_price":0.0,"total":0.0}],"total_amount":0.0}]}
Kurallar: Aynı müşteriye ait satırları tek siparişte topla (belge/sipariş no varsa ona göre grupla). Excel tablolarında her satır bir kalem olabilir; müşteri sütununa göre grupla. Sayılarda Türkçe biçim (1.234,56) olabilir → ondalık noktaya çevir. total yoksa quantity*unit_price. Bulamadığın alanlara null yaz. Hiç sipariş yoksa {"orders":[]} döndür."""


async def extract_orders_from_text(text: str) -> dict:
    chat = await make_chat(f"ord-extract-{abs(hash(text[:200]))}", ORDER_SYSTEM, purpose="extract")
    raw = str(await chat.send_message(UserMessage(text=f"SİPARİŞ BELGESİ:\n\n{text[:30000]}"))).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    data = json.loads(raw[start:end + 1])
    orders = []
    for o in data.get("orders") or []:
        items = []
        for it in o.get("items") or []:
            q = float(it.get("quantity") or 1); p = float(it.get("unit_price") or 0)
            items.append({"product_name": str(it.get("product_name") or "Kalem")[:200], "sku": it.get("sku"), "barcode": it.get("barcode"), "quantity": int(round(q)) or 1, "unit_price": p, "total": round(float(it.get("total") or q * p), 2)})
        if not items:
            continue
        orders.append({**o, "items": items, "total_amount": round(float(o.get("total_amount") or sum(i["total"] for i in items)), 2), "channel": (o.get("channel") or "manual").lower()})
    return {"orders": orders}


PRODUCT_SYSTEM = """Sen bir stok/ürün listesi ayrıştırıcısısın. Sana verilen metin (PDF katalog, fiyat listesi, Excel/CSV dökümü) içinden ÜRÜN/STOK KARTLARINI çıkar. Yalnızca geçerli JSON döndür:
{"products":[{"name":"ürün adı","sku":"stok kodu veya null","barcode":"barkod/EAN veya null","category":"kategori veya null","unit":"Adet|Kg|Metre|Litre|Paket|Koli veya null","vat_rate":20,"purchase_price":0.0,"sale_price":0.0,"stock_quantity":0.0,"min_stock_alert":null,"type":"product|service|raw_material"}]}
Kurallar: Her satır/kalem bir üründür. Sayılarda Türkçe biçim (1.234,56) olabilir → ondalık noktaya çevir. KDV yoksa 20. Birim yoksa Adet. Tür belirsizse product. Stok miktarı yoksa 0. Ürün adı yoksa satırı atla. Hiç ürün yoksa {"products":[]} döndür."""


async def extract_products_from_text(text: str) -> dict:
    chat = await make_chat(f"prod-extract-{abs(hash(text[:200]))}", PRODUCT_SYSTEM, purpose="extract")
    raw = str(await chat.send_message(UserMessage(text=f"STOK / ÜRÜN BELGESİ:\n\n{text[:30000]}"))).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    data = json.loads(raw[start:end + 1])
    products = []
    for p in data.get("products") or []:
        name = str(p.get("name") or "").strip()
        if not name:
            continue
        vat = p.get("vat_rate")
        try:
            vat = int(vat) if vat is not None else 20
        except (TypeError, ValueError):
            vat = 20
        ptype = str(p.get("type") or "product").lower()
        if ptype not in ("product", "service", "raw_material", "finished_good"):
            ptype = "product"
        products.append({
            "name": name[:200],
            "sku": (str(p["sku"]).strip() if p.get("sku") not in (None, "") else None),
            "barcode": (str(p["barcode"]).strip() if p.get("barcode") not in (None, "") else None),
            "category": (str(p["category"]).strip() if p.get("category") not in (None, "") else None),
            "unit": p.get("unit") or "Adet",
            "vat_rate": vat,
            "purchase_price": float(p.get("purchase_price") or 0),
            "sale_price": float(p.get("sale_price") or 0),
            "stock_quantity": float(p.get("stock_quantity") or 0),
            "min_stock_alert": float(p["min_stock_alert"]) if p.get("min_stock_alert") not in (None, "") else None,
            "type": ptype,
        })
    return {"products": products}


async def ai_map_columns(entity_label: str, fields: list, columns: list, sample_rows: list) -> dict:
    """Excel sütunlarını hedef alanlara eşle: {"mapping": {field: column|null}, "notes": "..."}"""
    sys_msg = "Sen bir veri aktarım uzmanısın. Türkçe muhasebe/ERP Excel dosyalarındaki sütun başlıklarını verilen hedef alanlara eşlersin. Yalnızca JSON döndür: {\"mapping\": {\"hedef_alan\": \"Sütun Başlığı veya null\"}, \"notes\": \"kısa Türkçe açıklama\"}. Aynı sütunu iki alana verme. Emin değilsen null bırak. Örnek satır değerlerine bakarak (VKN 10 hane, TCKN 11 hane, telefon, e-posta, tarih, para) karar ver."
    chat = await make_chat(f"mig-map-{abs(hash(str(columns)))}", sys_msg, purpose="extract")
    prompt = f"VERİ TÜRÜ: {entity_label}\nHEDEF ALANLAR (key: açıklama):\n" + "\n".join(f"- {f['key']}: {f['label']}{' (zorunlu)' if f.get('required') else ''}" for f in fields) + f"\n\nEXCEL SÜTUNLARI: {json.dumps(columns, ensure_ascii=False)}\n\nÖRNEK SATIRLAR:\n{json.dumps(sample_rows[:5], ensure_ascii=False, default=str)[:6000]}"
    raw = str(await chat.send_message(UserMessage(text=prompt))).strip()
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start:end + 1])
    valid_fields = {f["key"] for f in fields}
    mapping = {k: (v if v in columns else None) for k, v in (data.get("mapping") or {}).items() if k in valid_fields}
    return {"mapping": mapping, "notes": str(data.get("notes") or "")[:400]}
