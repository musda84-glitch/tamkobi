export const STATUS_TR = {
  draft: "Taslak", sent: "Gönderildi", accepted: "Kabul Edildi", rejected: "Reddedildi", pending: "Beklemede", approved: "Onaylandı", cancelled: "İptal",
  paid: "Ödendi", unpaid: "Ödenmedi", partially_paid: "Kısmi Ödendi", partial: "Kısmi", overdue: "Vadesi Geçti", completed: "Tamamlandı", active: "Aktif", inactive: "Pasif",
  planned: "Planlandı", done: "Yapıldı", quoted: "Teklif Verildi", planning: "Planlama", on_hold: "Beklemede", new: "Yeni", preparing: "Hazırlanıyor", shipped: "Kargolandı",
  delivered: "Teslim Edildi", returned: "İade Edildi", partially_returned: "Kısmi İade", in_transit: "Yolda", created: "Oluşturuldu", simulated: "Simüle", failed: "Hata",
  logged: "Kaydedildi", read: "Okundu", queued: "Sırada", connected: "Bağlı", disconnected: "Bağlı Değil", configured: "Yapılandırıldı", not_configured: "Yapılandırılmadı",
  error: "Hata", open: "Açık", closed: "Kapalı", present: "Geldi", absent: "Gelmedi", late: "Geç Geldi", leave: "İzinli", sent_to_gib: "GİB'e Gönderildi", matched: "Eşleşti", unmatched: "Eşleşmedi",
  declared: "Beyanname verildi", cleared: "Gümrük çıktı", invoiced: "Faturalandı"
};
export const CHANNEL_TR = { manual: "Manuel", b2b: "B2B", trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon", shopify: "Shopify", n11: "N11", woocommerce: "WooCommerce", ciceksepeti: "Çiçeksepeti", pazarama: "Pazarama", sms: "SMS", email: "E-posta", whatsapp: "WhatsApp", trade: "Dış Ticaret", saha: "Saha" };
export const CHANNEL_TR = { manual: "Manuel", b2b: "B2B", saha: "Saha", trade: "Dış Ticaret", trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon", shopify: "Shopify", n11: "N11", woocommerce: "WooCommerce", ciceksepeti: "Çiçeksepeti", pazarama: "Pazarama", sms: "SMS", email: "E-posta", whatsapp: "WhatsApp" };
export const CHANNEL_TR = { manual: "Manuel", b2b: "B2B", saha: "Saha", trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon", shopify: "Shopify", n11: "N11", woocommerce: "WooCommerce", ciceksepeti: "Çiçeksepeti", pazarama: "Pazarama", sms: "SMS", email: "E-posta", whatsapp: "WhatsApp" };
export const CONTEXT_TR = { manual: "Manuel", invoice: "Fatura", order: "Sipariş", contact: "Cari", campaign: "Kampanya", statement: "Ekstre", installment: "Taksit", quote_approval: "Teklif Onayı", whatsapp_api: "WhatsApp", reminder: "Hatırlatma", cargo: "Kargo" };
export const DIRECTION_TR = { inbound: "Gelen", outbound: "Giden", receivable: "Alacak", payable: "Borç" };
export const E_TYPE_TR = { e_invoice: "E-Fatura", e_archive: "E-Arşiv", paper: "Kağıt Fatura", e_dispatch: "E-İrsaliye", e_export: "e-İhracat" };
export const INVOICE_TYPE_TR = { sales: "Satış", purchase: "Alış", proforma: "Proforma", return: "İade", dispatch: "İrsaliye", export: "İhracat", import: "İthalat" };

export const tr = (map, value) => (value == null || value === "" ? "—" : map[value] || map[String(value).toLowerCase()] || String(value));
export const statusTr = (v) => tr(STATUS_TR, v);
export const channelTr = (v) => tr(CHANNEL_TR, v);
export const contextTr = (v) => tr(CONTEXT_TR, v);
