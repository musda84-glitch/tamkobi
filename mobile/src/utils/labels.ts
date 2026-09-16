export const STATUS_TR: Record<string, string> = {
  draft: "Taslak",
  sent: "Gönderildi",
  accepted: "Kabul Edildi",
  rejected: "Reddedildi",
  pending: "Beklemede",
  approved: "Onaylandı",
  cancelled: "İptal",
  paid: "Ödendi",
  unpaid: "Ödenmedi",
  partially_paid: "Kısmi Ödendi",
  overdue: "Vadesi Geçti",
  completed: "Tamamlandı",
  preparing: "Hazırlanıyor",
  shipped: "Kargolandı",
  delivered: "Teslim Edildi",
  returned: "İade Edildi",
  present: "Geldi",
  absent: "Gelmedi",
  leave: "İzinli",
  in_progress: "Devam",
  paused: "Duraklatıldı",
  waiting: "Bekliyor",
  ready: "Hazır",
  planned: "Planlı",
  advance: "Avans",
  bonus: "Prim",
};

export const LEAVE_TYPE_TR: Record<string, string> = {
  annual: "Yıllık",
  sick: "Hastalık",
  unpaid: "Ücretsiz",
  other: "Diğer",
};

export const CHANNEL_TR: Record<string, string> = {
  manual: "Manuel",
  b2b: "B2B",
  saha: "Saha",
  trendyol: "Trendyol",
  hepsiburada: "Hepsiburada",
  amazon: "Amazon",
  shopify: "Shopify",
  n11: "N11",
  woocommerce: "WooCommerce",
  shopphp: "ShopPHP",
};

export const INVOICE_TYPE_TR: Record<string, string> = {
  sales: "Satış",
  purchase: "Alış",
  proforma: "Proforma",
  return: "İade",
  dispatch: "İrsaliye",
};

export const E_TYPE_TR: Record<string, string> = {
  e_invoice: "E-Fatura",
  e_archive: "E-Arşiv",
  paper: "Kağıt Fatura",
  e_dispatch: "E-İrsaliye",
};

export function tr(map: Record<string, string>, value?: string | null): string {
  if (value == null || value === "") return "—";
  return map[value] || map[String(value).toLowerCase()] || String(value);
}

export const statusTr = (v?: string | null) => tr(STATUS_TR, v);
export const leaveTr = (v?: string | null) => tr(LEAVE_TYPE_TR, v);
export const channelTr = (v?: string | null) => tr(CHANNEL_TR, v);
export const invoiceTypeTr = (v?: string | null) => tr(INVOICE_TYPE_TR, v);
export const eTypeTr = (v?: string | null) => tr(E_TYPE_TR, v);
