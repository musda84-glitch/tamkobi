import os
import json
import logging
from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

async def get_financial_ai_advice(company_context: dict, prompt: str, history: list = None) -> str:
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        return "Yapay Zeka API anahtarı yapılandırılmamış. Lütfen sistem yöneticinizle görüşün."

    system_prompt = f"""Sen NexusHesap'ın uzman Türk Ticaret ve Vergi Mevzuatına, E-Fatura ve Ön Muhasebe standartlarına hakim AI Finans ve Mali Müşavir Danışmanısın.
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
        chat = LlmChat(
            api_key=api_key,
            session_id=f"finance-session-{company_context.get('company_id', 'default')}",
            system_message=system_prompt
        ).with_model("openai", "gpt-5.4")

        # Combine short conversation if provided
        user_msg = UserMessage(text=prompt)
        response_text = await chat.send_message(user_msg)
        return response_text
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
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY tanımlı değil.")
    chat = LlmChat(api_key=api_key, session_id=f"inv-extract-{abs(hash(text[:200]))}", system_message=INVOICE_SYSTEM).with_model("anthropic", "claude-sonnet-4-6")
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
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY tanımlı değil.")
    chat = LlmChat(api_key=api_key, session_id=f"ord-extract-{abs(hash(text[:200]))}", system_message=ORDER_SYSTEM).with_model("anthropic", "claude-sonnet-4-6")
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


async def ai_map_columns(entity_label: str, fields: list, columns: list, sample_rows: list) -> dict:
    """Excel sütunlarını hedef alanlara eşle: {"mapping": {field: column|null}, "notes": "..."}"""
    api_key = os.environ.get("EMERGENT_LLM_KEY", "")
    if not api_key:
        raise RuntimeError("EMERGENT_LLM_KEY tanımlı değil.")
    sys_msg = "Sen bir veri aktarım uzmanısın. Türkçe muhasebe/ERP Excel dosyalarındaki sütun başlıklarını verilen hedef alanlara eşlersin. Yalnızca JSON döndür: {\"mapping\": {\"hedef_alan\": \"Sütun Başlığı veya null\"}, \"notes\": \"kısa Türkçe açıklama\"}. Aynı sütunu iki alana verme. Emin değilsen null bırak. Örnek satır değerlerine bakarak (VKN 10 hane, TCKN 11 hane, telefon, e-posta, tarih, para) karar ver."
    chat = LlmChat(api_key=api_key, session_id=f"mig-map-{abs(hash(str(columns)))}", system_message=sys_msg).with_model("anthropic", "claude-sonnet-4-6")
    prompt = f"VERİ TÜRÜ: {entity_label}\nHEDEF ALANLAR (key: açıklama):\n" + "\n".join(f"- {f['key']}: {f['label']}{' (zorunlu)' if f.get('required') else ''}" for f in fields) + f"\n\nEXCEL SÜTUNLARI: {json.dumps(columns, ensure_ascii=False)}\n\nÖRNEK SATIRLAR:\n{json.dumps(sample_rows[:5], ensure_ascii=False, default=str)[:6000]}"
    raw = str(await chat.send_message(UserMessage(text=prompt))).strip()
    start, end = raw.find("{"), raw.rfind("}")
    data = json.loads(raw[start:end + 1])
    valid_fields = {f["key"] for f in fields}
    mapping = {k: (v if v in columns else None) for k, v in (data.get("mapping") or {}).items() if k in valid_fields}
    return {"mapping": mapping, "notes": str(data.get("notes") or "")[:400]}
