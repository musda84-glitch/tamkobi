export const STATUS_TR = {
  draft: "Taslak", sent: "Gönderildi", accepted: "Kabul Edildi", rejected: "Reddedildi", pending: "Beklemede", approved: "Onaylandı", cancelled: "İptal",
  paid: "Ödendi", unpaid: "Ödenmedi", partially_paid: "Kısmi Ödendi", partial: "Kısmi", overdue: "Vadesi Geçti", completed: "Tamamlandı", active: "Aktif", inactive: "Pasif",
  planned: "Planlandı", done: "Yapıldı", quoted: "Teklif Verildi", planning: "Planlama", on_hold: "Beklemede", new: "Yeni", preparing: "Hazırlanıyor", shipped: "Kargolandı",
  delivered: "Teslim Edildi", returned: "İade Edildi", partially_returned: "Kısmi İade", in_transit: "Yolda", created: "Oluşturuldu", simulated: "Simüle", failed: "Hata",
  logged: "Kaydedildi", read: "Okundu", queued: "Sırada", connected: "Bağlı", disconnected: "Bağlı Değil", configured: "Yapılandırıldı", not_configured: "Yapılandırılmadı",
  error: "Hata", open: "Açık", closed: "Kapalı", present: "Geldi", absent: "Gelmedi", late: "Geç Geldi", leave: "İzinli", sent_to_gib: "GİB'e Gönderildi", matched: "Eşleşti", unmatched: "Eşleşmedi",
  declared: "Beyanname verildi", cleared: "Gümrük çıktı", invoiced: "Faturalandı"
};
/** Pazaryeri ham durumları (Trendyol/HB PascalCase) → Türkçe. */
export const MARKETPLACE_STATUS_TR = {
  Created: "Oluşturuldu",
  Picking: "Hazırlanıyor",
  Invoiced: "Faturalandı",
  Shipped: "Kargolandı",
  AtCollectionPoint: "Teslim Noktasında",
  Delivered: "Teslim Edildi",
  Cancelled: "İptal",
  UnDelivered: "Teslim Edilemedi",
  Returned: "İade",
  UnSupplied: "Tedarik Edilemedi",
  UnPacked: "Paketlenmedi",
  ReadyToShip: "Kargoya Hazır",
  WaitingInAction: "Aksiyon Bekliyor",
};
export const CHANNEL_TR = { manual: "Manuel", b2b: "B2B", saha: "Saha", trendyol: "Trendyol", hepsiburada: "Hepsiburada", amazon: "Amazon", shopify: "Shopify", n11: "N11", woocommerce: "WooCommerce", ciceksepeti: "Çiçeksepeti", pazarama: "Pazarama", sms: "SMS", email: "E-posta", whatsapp: "WhatsApp" };
export const CONTEXT_TR = { manual: "Manuel", invoice: "Fatura", order: "Sipariş", contact: "Cari", campaign: "Kampanya", statement: "Ekstre", installment: "Taksit", quote_approval: "Teklif Onayı", whatsapp_api: "WhatsApp", reminder: "Hatırlatma", cargo: "Kargo" };
export const DIRECTION_TR = { inbound: "Gelen", outbound: "Giden", receivable: "Alacak", payable: "Borç" };
export const E_TYPE_TR = { e_invoice: "E-Fatura", e_archive: "E-Arşiv", paper: "Kağıt Fatura", e_dispatch: "E-İrsaliye", e_export: "e-İhracat", expense_slip: "Gider Pusulası" };
export const INVOICE_TYPE_TR = { sales: "Satış", purchase: "Alış", proforma: "Proforma", return: "İade", dispatch: "İrsaliye", export: "İhracat", import: "İthalat" };

export const tr = (map, value) => (value == null || value === "" ? "—" : map[value] || map[String(value).toLowerCase()] || String(value));
export const statusTr = (v) => tr(STATUS_TR, v);
export const channelTr = (v) => tr(CHANNEL_TR, v);
export const contextTr = (v) => tr(CONTEXT_TR, v);

/** Trendyol vb. marketplace_status → Türkçe (Delivered → Teslim Edildi). */
export function marketplaceStatusTr(v) {
  if (v == null || v === "") return "—";
  const raw = String(v).trim();
  if (MARKETPLACE_STATUS_TR[raw]) return MARKETPLACE_STATUS_TR[raw];
  const lower = raw.toLowerCase();
  if (STATUS_TR[lower]) return STATUS_TR[lower];
  // CamelCase parçalarını ayırıp STATUS_TR dene (UnDelivered vb. zaten tabloda)
  const spaced = raw.replace(/([a-z])([A-Z])/g, "$1 $2");
  if (spaced !== raw && MARKETPLACE_STATUS_TR[raw.replace(/\s/g, "")]) return MARKETPLACE_STATUS_TR[raw.replace(/\s/g, "")];
  return spaced;
}

/** Sipariş durumu rozeti — arka plan / metin sınıfları */
export function orderStatusBadgeClass(status) {
  const s = String(status || "").toLowerCase();
  if (["shipped", "completed", "delivered", "approved"].includes(s)) {
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  }
  if (["cancelled", "returned", "partially_returned", "rejected", "failed"].includes(s)) {
    return "bg-rose-50 text-rose-700 border-rose-200";
  }
  if (["preparing", "in_transit", "partially_paid"].includes(s)) {
    return "bg-sky-50 text-sky-700 border-sky-200";
  }
  if (["pending", "new", "on_hold", "draft"].includes(s)) {
    return "bg-amber-50 text-amber-800 border-amber-200";
  }
  return "bg-slate-100 text-slate-600 border-slate-200";
}
