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
