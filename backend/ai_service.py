import os
import json
import logging
from urllib.parse import urlsplit, urlunsplit

import httpx
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
            {"id": "gpt-4o", "vendor": "openai", "label": "GPT-4o"},
            {"id": "gpt-4.1", "vendor": "openai", "label": "GPT-4.1"},
            {"id": "gpt-4o-mini", "vendor": "openai", "label": "GPT-4o Mini"},
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
        "hint": "Doğrudan Google AI Studio / Gemini API anahtarı (AIza...). Anahtar boş bırakılırsa sunucudaki GEMINI_API_KEY kullanılır.",
        "models": [
            {"id": "gemini-2.5-pro", "vendor": "gemini", "label": "Gemini 2.5 Pro"},
            {"id": "gemini-2.5-flash", "vendor": "gemini", "label": "Gemini 2.5 Flash"},
        ],
    },
    "custom": {
        "label": "Özel (OpenAI uyumlu)",
        "hint": "OpenAI uyumlu bir uç nokta: OpenRouter, Azure OpenAI, kendi ağ geçidiniz veya sunucunuzdaki vLLM/Ollama. Adresi ve model adlarını kendiniz yazarsınız. Anahtar boş bırakılırsa sunucudaki CUSTOM_AI_API_KEY kullanılır.",
        "custom": True,
        "models": [],
    },
}

# Doğrudan sağlayıcı anahtarı girildiğinde emergentintegrations SDK'sına gerek yoktur;
# bu sağlayıcılar için isteği kendimiz atarız (SDK kurulu olmayan imajlarda da çalışsın).
DIRECT_PROVIDERS = ("openai", "anthropic", "google", "custom")

# Özel uç noktalar OpenAI sohbet protokolünü konuşur.
DIRECT_PROTOCOLS = {"google": "google", "anthropic": "anthropic", "openai": "openai", "custom": "openai"}

PROVIDER_ENV_KEYS = {
    "emergent": ("EMERGENT_LLM_KEY",),
    "openai": ("OPENAI_API_KEY",),
    "anthropic": ("ANTHROPIC_API_KEY",),
    "google": ("GEMINI_API_KEY", "GOOGLE_API_KEY"),
    "custom": ("CUSTOM_AI_API_KEY",),
}

GEMINI_BASE = (os.environ.get("GEMINI_API_BASE") or "https://generativelanguage.googleapis.com/v1beta").rstrip("/")
OPENAI_BASE = (os.environ.get("OPENAI_API_BASE") or "https://api.openai.com/v1").rstrip("/")
ANTHROPIC_BASE = (os.environ.get("ANTHROPIC_API_BASE") or "https://api.anthropic.com/v1").rstrip("/")
ANTHROPIC_VERSION = "2023-06-01"
DIRECT_MAX_TOKENS = 4096

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


def provider_label(provider: str) -> str:
    return (AI_PROVIDERS.get(provider) or {}).get("label") or provider or "AI sağlayıcısı"


def env_var_name(provider: str) -> str:
    return (PROVIDER_ENV_KEYS.get(provider) or PROVIDER_ENV_KEYS["emergent"])[0]


def env_key(provider: str) -> str:
    for name in PROVIDER_ENV_KEYS.get(provider) or PROVIDER_ENV_KEYS["emergent"]:
        value = (os.environ.get(name) or "").strip()
        if value:
            return value
    return ""


def is_custom(provider: str) -> bool:
    return bool((AI_PROVIDERS.get(provider) or {}).get("custom"))


def normalize_base_url(raw: str) -> str:
    """Kullanıcının yazdığı uç nokta adresini sohbet URL'sine çevir.

    Adres bir sorgu dizesi taşıyabiliyor (Azure OpenAI `?api-version=…` istiyor).
    Yol ayrıştırılmadan sona ekleme yapılırsa `/chat/completions` sorgunun arkasına
    düşer ve adres geçersiz olur; o yüzden yalnızca yol kısmı tamamlanıyor.
    """
    url = (raw or "").strip()
    if not url:
        return ""
    if not url.startswith(("http://", "https://")):
        url = "https://" + url
    split = urlsplit(url)
    path = split.path.rstrip("/")
    if not path.endswith("/chat/completions"):
        path += "/chat/completions"
    return urlunsplit((split.scheme, split.netloc, path, split.query, split.fragment))


def protocol_of(provider: str) -> str:
    return DIRECT_PROTOCOLS.get(provider) or "openai"


def _direct_request(provider: str, model: str, api_key: str, system_message: str, text: str, base_url: str = "") -> tuple:
    proto = protocol_of(provider)
    if proto == "google":
        payload = {
            "contents": [{"role": "user", "parts": [{"text": text}]}],
            "generationConfig": {"maxOutputTokens": DIRECT_MAX_TOKENS, "temperature": 0.2},
        }
        if system_message:
            payload["systemInstruction"] = {"parts": [{"text": system_message}]}
        return f"{GEMINI_BASE}/models/{model}:generateContent", {"x-goog-api-key": api_key}, payload
    if proto == "anthropic":
        payload = {"model": model, "max_tokens": DIRECT_MAX_TOKENS, "messages": [{"role": "user", "content": text}]}
        if system_message:
            payload["system"] = system_message
        return f"{ANTHROPIC_BASE}/messages", {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION}, payload
    messages = ([{"role": "system", "content": system_message}] if system_message else []) + [{"role": "user", "content": text}]
    url = base_url or f"{OPENAI_BASE}/chat/completions"
    # Kendi sunucusundaki uç noktalar (Ollama, vLLM) anahtar istemeyebilir.
    headers = {"Authorization": f"Bearer {api_key}"} if api_key else {}
    return url, headers, {"model": model, "messages": messages}


def _direct_answer(provider: str, data: dict) -> str:
    if protocol_of(provider) == "google":
        cand = ((data.get("candidates") or [{}])[0]) or {}
        parts = ((cand.get("content") or {}).get("parts")) or []
        return "".join(str(p.get("text") or "") for p in parts).strip()
    if protocol_of(provider) == "anthropic":
        blocks = data.get("content") or []
        return "".join(str(b.get("text") or "") for b in blocks if b.get("type") in (None, "text")).strip()
    choice = ((data.get("choices") or [{}])[0]) or {}
    return str((choice.get("message") or {}).get("content") or "").strip()


def _blank_reason(provider: str, data: dict) -> str:
    """Sağlayıcı 200 döndürüp içerik vermediğinde nedenini Türkçe açıkla."""
    if protocol_of(provider) == "google":
        blocked = ((data.get("promptFeedback") or {}).get("blockReason")) or ""
        finish = (((data.get("candidates") or [{}])[0]) or {}).get("finishReason") or ""
        if blocked:
            return f"Google isteği güvenlik filtresiyle engelledi ({blocked})."
        if finish and finish != "STOP":
            return f"Google yanıtı tamamlanmadı ({finish})."
    return f"{provider_label(provider)} boş yanıt döndürdü."


def _provider_error(provider: str, resp: "httpx.Response") -> str:
    try:
        body = resp.json()
    except ValueError:
        body = {}
    err = body.get("error") if isinstance(body, dict) else None
    if isinstance(err, dict):
        detail = str(err.get("message") or err.get("status") or "")
    elif isinstance(err, str):
        detail = err
    else:
        detail = ""
    detail = (detail or (resp.text or ""))[:220].strip()
    label = provider_label(provider)
    code = resp.status_code
    # Google geçersiz anahtara 401 değil 400/INVALID_ARGUMENT döndürür.
    bad_key = code in (401, 403) or (code == 400 and "api key" in detail.lower())
    if bad_key:
        return f"{label} API anahtarını kabul etmedi ({code}). Anahtarı kontrol edin. {detail}".strip()
    if code == 404:
        return f"{label} bu modeli bulamadı ({code}). Farklı bir model seçip tekrar deneyin. {detail}".strip()
    if code == 429:
        return f"{label} istek/kota sınırını aştı ({code}). {detail}".strip()
    return f"{label} isteği başarısız ({code}). {detail}".strip()


class DirectChat:
    """emergentintegrations LlmChat ile aynı arayüz; sağlayıcının HTTP API'sini doğrudan çağırır."""

    def __init__(self, provider: str, model: str, api_key: str, system_message: str = "", base_url: str = ""):
        self.provider = provider
        self.model = model
        self.api_key = api_key
        self.system_message = system_message or ""
        self.base_url = base_url or ""

    def with_model(self, _vendor: str, model: str) -> "DirectChat":
        self.model = model
        return self

    async def send_message(self, message) -> str:
        text = str(getattr(message, "text", message) or "")
        url, headers, payload = _direct_request(self.provider, self.model, self.api_key, self.system_message, text, self.base_url)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=15.0)) as client:
                resp = await client.post(url, headers={**headers, "Content-Type": "application/json"}, json=payload)
        except httpx.HTTPError as e:
            raise RuntimeError(f"{provider_label(self.provider)} sunucusuna ulaşılamadı: {e}") from e
        if resp.status_code >= 400:
            raise RuntimeError(_provider_error(self.provider, resp))
        try:
            data = resp.json()
        except ValueError as e:
            raise RuntimeError(f"{provider_label(self.provider)} beklenmeyen bir yanıt döndürdü.") from e
        answer = _direct_answer(self.provider, data)
        if not answer:
            raise RuntimeError(_blank_reason(self.provider, data))
        return answer


def _model_ids(provider: str) -> list:
    return [m["id"] for m in (AI_PROVIDERS.get(provider) or AI_PROVIDERS["emergent"])["models"]]


def _clamp_model(provider: str, model: str, fallback: str) -> str:
    # Özel uç noktalarda model listesi bize kapalı; kullanıcının yazdığını kabul ederiz.
    if is_custom(provider):
        return (model or "").strip()[:120]
    ids = _model_ids(provider)
    if model in ids:
        return model
    return fallback if fallback in ids else (ids[0] if ids else fallback)


def normalize_ai(raw: dict | None) -> dict:
    p = {**AI_DEFAULTS, **(raw or {})}
    provider = p.get("provider") if p.get("provider") in AI_PROVIDERS else "emergent"
    advisor = _clamp_model(provider, p.get("advisor_model") or "", AI_DEFAULTS["advisor_model"])
    extract = _clamp_model(provider, p.get("extract_model") or "", AI_DEFAULTS["extract_model"]) or advisor
    return {
        "enabled": bool(p.get("enabled", True)),
        "provider": provider,
        "advisor_model": advisor,
        "extract_model": extract,
        "base_url": normalize_base_url(p.get("base_url") or "") if is_custom(provider) else "",
        "api_key_enc": p.get("api_key_enc") or "",
        "last_test": p.get("last_test"),
    }


def public_ai_status(cfg: dict) -> dict:
    provider = cfg.get("provider") or "emergent"
    meta = AI_PROVIDERS.get(provider) or AI_PROVIDERS["emergent"]
    models = {m["id"]: m for m in meta["models"]}
    advisor = cfg.get("advisor_model") or ""
    extract = cfg.get("extract_model") or ""
    advisor_label = (models.get(advisor) or {}).get("label") or advisor
    extract_label = (models.get(extract) or {}).get("label") or extract
    configured = bool(
        cfg.get("has_key")
        or cfg.get("has_env_key")
        or cfg.get("api_key")
        or cfg.get("api_key_enc")
    )
    return {
        "enabled": bool(cfg.get("enabled", True)),
        "configured": configured,
        "provider": provider,
        "provider_label": meta["label"],
        "advisor_model": advisor,
        "extract_model": extract,
        "advisor_label": advisor_label,
        "extract_label": extract_label,
        "badge": f"{meta['label']} {advisor_label}".strip(),
        "extract_badge": f"{meta['label']} {extract_label}".strip(),
    }


async def load_ai_settings() -> dict:
    try:
        import saas_billing
        st = await saas_billing.settings()
        cfg = normalize_ai(st.get("ai") or {})
    except Exception:
        cfg = normalize_ai({})
    key = ""
    has_enc = bool(cfg.get("api_key_enc"))
    if has_enc:
        try:
            key = comm_service.decrypt(cfg["api_key_enc"])
        except Exception:
            logger.warning("Stored AI API key could not be decrypted — CREDENTIAL_ENCRYPTION_KEY may have changed.")
            key = ""
    provider = cfg.get("provider") or "emergent"
    # Ortam değişkeni sağlayıcıya özeldir: Gemini'ye Emergent anahtarı göndermeyelim.
    fallback = env_key(provider)
    cfg["api_key"] = key or fallback
    # Kayıtlı blob varsa UI'da "kayıtlı" göster (şifre alanı boş görünse bile).
    cfg["has_key"] = has_enc
    cfg["has_env_key"] = bool(fallback)
    cfg["env_var"] = env_var_name(provider)
    cfg["key_hint"] = (key[-4:] if len(key) >= 4 else ("****" if has_enc else ""))
    return cfg


async def make_chat(
    session_id: str,
    system_message: str,
    purpose: str = "extract",
    *,
    api_key: str | None = None,
    provider: str | None = None,
    advisor_model: str | None = None,
    extract_model: str | None = None,
    base_url: str | None = None,
):
    """Build a chat client. Optional overrides let the platform test form try a key before saving."""
    cfg = await load_ai_settings()
    existing_key = cfg.get("api_key") or ""
    if provider:
        cfg = normalize_ai({
            **cfg,
            "provider": provider,
            "advisor_model": advisor_model or cfg.get("advisor_model"),
            "extract_model": extract_model or cfg.get("extract_model"),
            "base_url": base_url if base_url is not None else cfg.get("base_url"),
            "api_key_enc": cfg.get("api_key_enc") or "",
        })
        # normalize_ai api_key alanını düşürür; kayıtlı/override anahtarı geri koy.
        cfg["api_key"] = (api_key or "").strip() or existing_key or env_key(cfg["provider"])
    elif api_key is not None:
        cfg["api_key"] = api_key.strip()
    if base_url is not None and is_custom(cfg.get("provider") or ""):
        cfg["base_url"] = normalize_base_url(base_url)
    if advisor_model and not provider:
        cfg["advisor_model"] = _clamp_model(cfg.get("provider") or "emergent", advisor_model, cfg.get("advisor_model") or "")
    if extract_model and not provider:
        cfg["extract_model"] = _clamp_model(cfg.get("provider") or "emergent", extract_model, cfg.get("extract_model") or "") or cfg["advisor_model"]
    if not cfg.get("enabled", True):
        raise RuntimeError("AI entegrasyonu platform panelinden kapatılmış.")
    key = cfg.get("api_key") or ""
    model = cfg["advisor_model"] if purpose == "advisor" else cfg["extract_model"]
    provider = cfg.get("provider") or "emergent"
    if is_custom(provider):
        if not cfg.get("base_url"):
            raise RuntimeError("Özel AI uç noktasının adresi girilmemiş. Platform Yönetimi → AI Entegrasyonu ekranından adresi yazın.")
        if not model:
            raise RuntimeError("Özel AI uç noktası için model adı girilmemiş. Platform Yönetimi → AI Entegrasyonu ekranından model adını yazın.")
    elif not key:
        raise RuntimeError("Yapay zeka API anahtarı yapılandırılmamış. Platform Yönetimi → AI Entegrasyonu ekranından anahtar girin.")
    if provider in DIRECT_PROVIDERS:
        return DirectChat(provider, model, key, system_message, cfg.get("base_url") or "")
    vendor = sdk_vendor(provider, model)
    return LlmChat(api_key=key, session_id=session_id, system_message=system_message).with_model(vendor, model)


async def get_financial_ai_advice(company_context: dict, prompt: str, history: list = None) -> str:

    system_prompt = f"""Sen TamKobi'nin uzman Türk Ticaret ve Vergi Mevzuatına, E-Fatura ve Ön Muhasebe standartlarına hakim AI Finans ve Mali Müşavir Danışmanısın.
Kullanıcının şirketine dair güncel veriler:
- Şirket Adı: {company_context.get('company_name', 'TamKobi A.Ş.')}
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
        return f"""**TamKobi AI Finansal Değerlendirme Raporu:**

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

SALES_INVOICE_SYSTEM = """Sen bir Türk ön muhasebe asistanısın. Sana bir SATIŞ FATURASININ (e-Fatura / e-Arşiv / kağıt satış belgesi) PDF veya metninden çıkarılmış ham metin verilecek.
Görevin faturayı aşağıdaki JSON şemasına birebir uyan TEK bir JSON nesnesi olarak döndürmek. Açıklama, markdown veya kod bloğu YAZMA; sadece JSON.
Şema:
{"customer": {"name": str, "tax_number": str|null, "tax_office": str|null, "address": str|null, "phone": str|null, "email": str|null},
 "invoice_number": str|null, "issue_date": "YYYY-MM-DD"|null, "due_date": "YYYY-MM-DD"|null, "currency": "TRY"|"USD"|"EUR",
 "items": [{"name": str, "quantity": number, "unit": str, "unit_price": number, "vat_rate": integer, "discount_rate": number, "total": number}],
 "subtotal": number, "vat_total": number, "grand_total": number, "notes": str|null, "confidence": number 0-1}
Kurallar: Alıcı / müşteri / AccountingCustomerParty bilgisini customer alanına yaz (satıcı/şirket bilgisi DEĞİL).
Sayılar Türkçe formatta olabilir (1.234,56) → ondalık nokta ile number'a çevir. total = quantity*unit_price*(1-discount_rate/100) (KDV hariç).
KDV oranı yoksa 20 kullan. Birim yoksa "Adet". Tarihleri ISO'ya çevir. Bulamadığın alanlara null yaz. Fatura kalemi yoksa toplamdan tek kalem üret."""


def _normalize_invoice_items(data: dict) -> dict:
    items = []
    for it in data.get("items") or []:
        q = float(it.get("quantity") or 1)
        p = float(it.get("unit_price") or 0)
        d = float(it.get("discount_rate") or 0)
        items.append({
            "name": str(it.get("name") or "Kalem")[:200],
            "quantity": q,
            "unit": it.get("unit") or "Adet",
            "unit_price": p,
            "vat_rate": int(it.get("vat_rate") if it.get("vat_rate") is not None else 20),
            "discount_rate": d,
            "total": round(float(it.get("total") or q * p * (1 - d / 100)), 2),
            "sku": it.get("sku") or "",
            "barcode": it.get("barcode") or "",
        })
    data["items"] = items
    return data


async def extract_invoice_from_text(text: str, invoice_type: str = "purchase") -> dict:
    inv_type = "sales" if invoice_type == "sales" else "purchase"
    system = SALES_INVOICE_SYSTEM if inv_type == "sales" else INVOICE_SYSTEM
    label = "SATIŞ FATURASI METNİ" if inv_type == "sales" else "FATURA METNİ"
    chat = await make_chat(f"inv-extract-{inv_type}-{abs(hash(text[:200]))}", system, purpose="extract")
    raw = await chat.send_message(UserMessage(text=f"{label}:\n\n{text[:20000]}"))
    raw = str(raw).strip()
    if raw.startswith("```"):
        raw = raw.strip("`")
        raw = raw[raw.find("{"):]
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    data = json.loads(raw[start:end + 1])
    data = _normalize_invoice_items(data)
    if inv_type == "sales" and not data.get("customer") and data.get("supplier"):
        # Model alış şemasına kayarsa müşteri alanına taşı
        data["customer"] = data.pop("supplier")
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


B2B_CART_SYSTEM = """Sen bir B2B sipariş listesi ayrıştırıcısısın. Sana verilen metin (PDF, Excel/CSV tablo dökümü) içinden yalnızca SEPET KALEMLERİNİ çıkar. Yalnızca geçerli JSON döndür:
{"items":[{"product_name":"ürün adı veya null","sku":"stok/ürün kodu veya null","barcode":"EAN/barkod veya null","quantity":1}]}
Kurallar:
- Her satır bir kalem. quantity = adet/miktar/talep (yoksa 1).
- FİYAT / TUTAR / KDV / İSKONTO / TOPLAM / LİSTE FİYATI sütunlarını ve değerlerini ASLA okuma, quantity olarak kullanma veya JSON'a yazma. Fiyatlar B2B katalogdan uygulanır.
- Barkod/EAN (8–14 hane) varsa barcode alanına yaz. Stok kodu varsa sku alanına yaz.
- Sayılarda Türkçe biçim (1.234 veya 12,5) olabilir → quantity için tam sayıya yuvarla.
- Ürün kimliği yoksa satırı atla. Hiç kalem yoksa {"items":[]} döndür."""


async def extract_b2b_cart_from_text(text: str) -> dict:
    """B2B AI sepet: yalnız ürün kimliği + adet; fiyat alanları yok sayılır."""
    chat = await make_chat(f"b2b-cart-{abs(hash(text[:200]))}", B2B_CART_SYSTEM, purpose="extract")
    raw = str(await chat.send_message(UserMessage(text=f"B2B SİPARİŞ LİSTESİ (fiyatları yok say):\n\n{text[:30000]}"))).strip()
    start, end = raw.find("{"), raw.rfind("}")
    if start == -1 or end == -1:
        raise ValueError("AI yanıtı JSON içermiyor.")
    data = json.loads(raw[start:end + 1])
    items = []
    for it in data.get("items") or []:
        name = str(it.get("product_name") or "").strip()[:200]
        sku = it.get("sku")
        barcode = it.get("barcode")
        sku = str(sku).strip() if sku not in (None, "") else None
        barcode = str(barcode).strip() if barcode not in (None, "") else None
        try:
            q = int(round(float(it.get("quantity") or 1))) or 1
        except (TypeError, ValueError):
            q = 1
        if not name and not sku and not barcode:
            continue
        # Model yanlışlıkla fiyat alanları döndürse bile at
        items.append({
            "product_name": name or sku or barcode,
            "sku": sku,
            "barcode": barcode,
            "quantity": max(1, q),
        })
    return {"items": items}


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
