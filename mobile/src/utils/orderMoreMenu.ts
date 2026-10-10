/** Web `frontend/src/utils/orderMoreMenu.js` — sipariş ⋮ menü varyantları. */

import { isWarehouseShipped } from "./orderCargo";

export type OrderMoreIcon = string;

export type OrderMoreKind = "panel_einvoice" | "integration_einvoice" | "panel_draft" | "panel_invoiced" | "held_cart" | "default";

export type OrderMoreItem = {
  id: string;
  label: string;
  icon: OrderMoreIcon;
  testId: string;
  section?: string | null;
  color: string;
  eType?: "e_invoice" | "e_archive";
  hint?: string;
  title?: string;
  hidden?: boolean;
};

export type OrderMoreOrder = {
  channel?: string | null;
  is_invoiced?: boolean;
  invoice_id?: string;
  invoice_number?: string;
  order_number?: string;
  e_type?: string | null;
  invoice_e_type?: string | null;
  einvoice_state?: string | null;
  order_status?: string | null;
  dispatch_number?: string | null;
  form_printed_at?: string | null;
  cargo_tracking_number?: string | null;
  cargo_barcode?: string | null;
  cargo_shipment_id?: string | null;
  cargo_label_url?: string | null;
  cargo_carrier?: string | null;
  warehouse_shipped?: boolean;
  is_held_cart?: boolean;
  is_active_cart?: boolean;
  invoice_gib_uuid?: string | null;
  gib_uuid?: string | null;
  invoice_gib_tracking_id?: string | null;
  gib_tracking_id?: string | null;
  gib_invoice_id?: string | null;
  invoice_gib_status?: string | null;
  gib_status?: string | null;
};

const PANEL_CHANNELS = new Set(["b2b", "manual", "saha", ""]);
const CARGO_LABEL_IDS = new Set(["cargo_mini", "cargo_10x10"]);

export function isIntegrationOrder(ord?: OrderMoreOrder | null): boolean {
  const ch = String(ord?.channel || "").toLowerCase();
  return !!ch && !PANEL_CHANNELS.has(ch);
}

export function isPanelOrder(ord?: OrderMoreOrder | null): boolean {
  return !isIntegrationOrder(ord);
}

/** Kargo gönderimi yapılmış mı? (takip no / sevkiyat / depo sevk) */
export function orderHasCargoDispatch(ord?: OrderMoreOrder | null): boolean {
  if (!ord) return false;
  if (ord.cargo_tracking_number || ord.cargo_barcode || ord.cargo_shipment_id || ord.cargo_label_url) return true;
  return isWarehouseShipped({
    cargo_carrier: ord.cargo_carrier || undefined,
    cargo_tracking_number: ord.cargo_tracking_number || undefined,
    warehouse_shipped: ord.warehouse_shipped,
  });
}

/**
 * B2B/panel: kargo yoksa mini kargo etiket menülerini çıkar.
 * Pazaryeri siparişlerinde etiket satırları kalır.
 */
export function filterPanelCargoLabelItems(ord: OrderMoreOrder | null | undefined, items: OrderMoreItem[]): OrderMoreItem[] {
  const rows = Array.isArray(items) ? items : [];
  if (!isPanelOrder(ord) || orderHasCargoDispatch(ord)) return rows;
  return rows.filter((r) => !CARGO_LABEL_IDS.has(r?.id));
}

/**
 * E-fatura / e-arşiv GİB üzerinden kesilmiş mi?
 * Yalnızca gerçek GİB / entegratör gönderim sinyalleri sayılır.
 * Cariye faturalaşma (is_invoiced) veya e_type tek başına e-belge değildir.
 */
export function orderHasEInvoiceIssued(ord?: OrderMoreOrder | null): boolean {
  if (!ord) return false;
  const state = String(ord.einvoice_state || "").toLowerCase();
  if (state === "sent" || state === "queued" || state === "accepted") return true;
  if (ord.invoice_gib_uuid || ord.gib_uuid || ord.invoice_gib_tracking_id || ord.gib_tracking_id) return true;
  if (ord.gib_invoice_id) return true;
  const gs = String(ord.invoice_gib_status || ord.gib_status || "");
  if (/ziplen|zarflan|ileti|gönderildi|1300|başarıyla tamamland/i.test(gs) && !/^\s*hata\s*:/i.test(gs)) return true;
  return false;
}

/** Sipariş satırında gösterilecek GİB / entegratör fatura numarası. */
export function orderGibInvoiceNumber(ord?: OrderMoreOrder | null): string {
  if (!ord) return "";
  const gib = String(ord.gib_invoice_id || "").trim();
  if (gib) return gib;
  if (!orderHasEInvoiceIssued(ord)) return "";
  const no = String(ord.invoice_number || "").trim();
  if (!no || no === String(ord.order_number || "").trim()) return "";
  return no;
}

export function orderEBelgeKindLabel(ord?: OrderMoreOrder | null): string {
  const eType = String(ord?.e_type || ord?.invoice_e_type || "").toLowerCase();
  if (eType === "e_invoice" || eType === "e_export") return "E-Fatura";
  if (eType === "e_archive") return "E-Arşiv";
  return "E-Belge";
}

export type OrderInvoiceBadge = {
  label: string;
  title: string;
  line1?: string;
  line2?: string;
  interactive: boolean;
  testId: string;
  tone: "rose" | "green" | "amber";
};

/** Sipariş fatura rozeti: taslak (sarı) → faturalaştı (yeşil) → faturalaşmış e-belge (kırmızı bilgi). */
export function orderInvoiceBadge(ord?: OrderMoreOrder | null): OrderInvoiceBadge | null {
  if (!ord) return null;
  if (orderHasEInvoiceIssued(ord)) {
    const kind = orderEBelgeKindLabel(ord);
    return {
      label: `Faturalaşmış (${kind})`,
      title: `Faturalaşmış (${kind})`,
      line1: "Faturalaşmış",
      line2: `(${kind})`,
      interactive: false,
      testId: kind === "E-Fatura" ? "ebelge-efatura" : kind === "E-Arşiv" ? "ebelge-earsiv" : "ebelge",
      tone: "rose",
    };
  }
  if (ord.is_invoiced) {
    return {
      label: "Faturalaştı",
      title: "Faturalaştı — tıkla: E-Fatura Oluştur",
      interactive: true,
      testId: "invoiced",
      tone: "green",
    };
  }
  if (ord.invoice_id) {
    return {
      label: "Taslak",
      title: "Taslak",
      interactive: true,
      testId: "draft",
      tone: "amber",
    };
  }
  return null;
}

export function orderMoreMenuKind(ord?: OrderMoreOrder | null): OrderMoreKind {
  if (ord?.is_held_cart || ord?.order_status === "held_cart" || ord?.is_active_cart || ord?.order_status === "active_cart") return "held_cart";
  if (isPanelOrder(ord) && orderHasEInvoiceIssued(ord)) return "panel_einvoice";
  if (isIntegrationOrder(ord) && orderHasEInvoiceIssued(ord)) return "integration_einvoice";
  // Cariye faturalaştı, henüz GİB e-belgesi yok → yeşil Faturalaştı / E-Fatura Oluştur
  if (ord?.is_invoiced) return "panel_invoiced";
  if (isPanelOrder(ord) && !ord?.is_invoiced) return "panel_draft";
  return "default";
}

function item(
  id: string,
  label: string,
  icon: OrderMoreIcon,
  opts: { testId?: string; section?: string | null; color?: string; eType?: "e_invoice" | "e_archive"; hidden?: boolean; hint?: string; title?: string } = {},
): OrderMoreItem & { hidden?: boolean } {
  return {
    id,
    label,
    icon,
    testId: opts.testId || id,
    section: opts.section || null,
    color: opts.color || "#64748B",
    eType: opts.eType,
    hint: opts.hint,
    title: opts.title || opts.hint,
    hidden: !!opts.hidden,
  };
}

export const INVOICE_PRINT_SHARE_HINT = "Yazdırma, e-posta ve WhatsApp";
export const INVOICE_PRINT_SHARE_NOTE =
  "GİB gönderimi değildir. Yalnızca yazdırma, e-posta ve WhatsApp paylaşımı için kullanılır.";

export function integrationEInvoiceMoreItems(): OrderMoreItem[] {
  return [
    item("refresh_status", "Siparişin Güncel Durumunu Getir", "refresh", { color: "#059669" }),
    item("mini_10x15", "Mini E-Arşiv Yazdır (10X15cm)", "document-text", { color: "#0284C7" }),
    item("mini_8x20", "Mini E-Arşiv Yazdır (8X20cm)", "document-text", { color: "#0284C7" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", "mail", { color: "#059669", hint: INVOICE_PRINT_SHARE_HINT, title: INVOICE_PRINT_SHARE_HINT }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", "time", { color: "#0EA5E9" }),
    item("digital_code_notify", "Dijital Kod Bildir", "download", { color: "#E11D48" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
    item("cargo_change", "Pazaryeri Kargo Firmasını Değiştir", "car", { color: "#0EA5E9" }),
    item("invoice_link", "Fatura Linki Gönder", "link", { color: "#F43F5E" }),
    item("xml", "E-Fatura XML'i İndir", "code-slash", { color: "#0EA5E9" }),
    item("efatura_pdf", "E-Fatura PDF İndir", "download", { color: "#4F46E5", testId: "efatura-pdf" }),
  ];
}

export function panelDraftMoreItems(ord?: OrderMoreOrder | null): OrderMoreItem[] {
  return filterPanelCargoLabelItems(ord, [
    item("faturalastir", "Faturalaştır", "document-text", { color: "#059669" }),
    item(
      "dispatch",
      ord?.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "İrsaliye olarak kaydet",
      "cube-outline",
      { color: "#C026D3" },
    ),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("invoice_date", "Fatura Tarihi Değiştir", "time", { color: "#D97706" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
  ]);
}

export function panelEInvoiceMoreItems(ord?: OrderMoreOrder | null): OrderMoreItem[] {
  const kind = orderEBelgeKindLabel(ord);
  const doc = kind === "E-Belge" ? "E-Fatura" : kind;
  return filterPanelCargoLabelItems(ord, [
    item("mini_10x15", `Mini ${doc} Yazdır (10X15cm)`, "document-text", { color: "#0284C7" }),
    item("mini_8x20", `Mini ${doc} Yazdır (8X20cm)`, "document-text", { color: "#0284C7" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("earsiv_send", `${doc} Yazdır & Gönder`, "mail", {
      color: "#059669",
      hint: INVOICE_PRINT_SHARE_HINT,
      title: INVOICE_PRINT_SHARE_HINT,
    }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
    item("xml", `${doc} XML'i İndir`, "code-slash", { color: "#0EA5E9" }),
    item("efatura_pdf", `${doc} PDF İndir`, "download", { color: "#4F46E5", testId: "efatura-pdf" }),
  ]);
}

export function panelInvoicedMoreItems(ord?: OrderMoreOrder | null): OrderMoreItem[] {
  return filterPanelCargoLabelItems(ord, [
    item("efatura_olustur", "E-Fatura Oluştur", "flash", { color: "#F43F5E", testId: "efatura-olustur" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
  ]);
}

export function eBelgeMenuItems(showEFatura: boolean): Array<{
  eType: "e_invoice" | "e_archive";
  label: string;
  testIdSuffix: string;
}> {
  const earsiv = { eType: "e_archive" as const, label: "E-Arşiv kes (GİB)", testIdSuffix: "earsiv" };
  if (showEFatura) {
    return [
      { eType: "e_invoice", label: "E-Fatura kes (GİB)", testIdSuffix: "efatura" },
      earsiv,
    ];
  }
  return [earsiv];
}

export function defaultMoreItems(
  ord?: OrderMoreOrder | null,
  opts: { eBelgeItems?: Array<{ eType: "e_invoice" | "e_archive"; label: string; testIdSuffix: string }> } = {},
): OrderMoreItem[] {
  const rows: OrderMoreItem[] = (ord?.is_invoiced ? (opts.eBelgeItems || []) : []).map((eb) =>
    item(`ebelge_${eb.eType}`, eb.label, "receipt", {
      testId: `e-belge-${eb.testIdSuffix}`,
      section: "E-Belge (GİB)",
      color: eb.eType === "e_invoice" ? "#4F46E5" : "#7C3AED",
      eType: eb.eType,
    }),
  );
  rows.push(
    item("edit", "Siparişi Düzenle", "create"),
    item("dispatch", ord?.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "E-İrsaliye Oluştur & Yazdır", "cube-outline"),
    item("return", "İade Al", "return-down-back", { hidden: ["returned"].includes(String(ord?.order_status || "")) }),
    item("cargo_label", "Kargo Etiketi Yazdır", "pricetag"),
    item("print_form", ord?.form_printed_at ? "Sipariş Formu (yazdırıldı)" : "Sipariş Formu Yazdır", "print"),
    item("notify", "Müşteriye Bildirim Gönder", "chatbubble-ellipses"),
  );
  return rows.filter((r) => !r.hidden);
}

export function orderDownloadMoreItems(): OrderMoreItem[] {
  return [
    item("download_xlsx", "Siparişi Excel İndir", "document-text", { color: "#059669" }),
    item("download_pdf", "Siparişi PDF İndir", "document-text", { color: "#E11D48" }),
  ];
}

export function canDeleteFromMoreMenu(ord?: OrderMoreOrder | null): boolean {
  return !!ord && !ord.is_invoiced && !ord.invoice_id;
}

export function orderDeleteMoreItem(): OrderMoreItem {
  return item("delete", "Siparişi Sil", "trash", { color: "#E11D48", testId: "delete" });
}

export function orderMoreMenuItems(
  ord?: OrderMoreOrder | null,
  opts: {
    eBelgeItems?: Array<{ eType: "e_invoice" | "e_archive"; label: string; testIdSuffix: string }>;
    canDelete?: boolean;
  } = {},
): { kind: OrderMoreKind; items: OrderMoreItem[] } {
  const kind = orderMoreMenuKind(ord);
  let items: OrderMoreItem[];
  if (kind === "held_cart") {
    return { kind, items: [] };
  }
  if (kind === "panel_einvoice") {
    return { kind, items: panelEInvoiceMoreItems(ord) };
  }
  if (kind === "integration_einvoice") items = integrationEInvoiceMoreItems();
  else if (kind === "panel_draft") items = panelDraftMoreItems(ord);
  else if (kind === "panel_invoiced") {
    return { kind, items: panelInvoicedMoreItems(ord) };
  } else items = defaultMoreItems(ord, opts);
  const allowDelete = opts.canDelete !== false;
  if (allowDelete && canDeleteFromMoreMenu(ord)) items = [...items, orderDeleteMoreItem()];
  return { kind, items: [...items, ...orderDownloadMoreItems()] };
}

/** Web mobil karttaki tek birincil kısayol. */
export function mobilePrimaryAction(ord?: OrderMoreOrder | null): { id: string; label: string } | null {
  const kind = orderMoreMenuKind(ord);
  if (kind === "held_cart") return null;
  if (kind === "panel_draft") return { id: "faturalastir", label: "Faturalaştır" };
  if (kind === "panel_invoiced") return { id: "efatura_olustur", label: "E-Fatura" };
  if (kind === "panel_einvoice") return { id: "mini_10x15", label: "E-Arşiv" };
  if (kind === "integration_einvoice") return { id: "cargo_mini", label: "Etiket" };
  return null;
}

export function canReturnOrder(status?: string | null): boolean {
  const s = String(status || "").trim().toLowerCase();
  return s !== "returned" && s !== "iade edildi";
}

export function orderNotifySubject(orderNumber?: string | null): string {
  return `Siparişiniz Yola Çıktı - ${orderNumber || ""}`.replace(/\s+$/, "");
}

export function orderNotifyMessage(order: {
  customer_name?: string;
  order_number?: string;
  cargo_carrier?: string;
  cargo_carrier_name?: string;
  cargo_tracking_number?: string;
}): string {
  const carrier = order.cargo_carrier_name || order.cargo_carrier || "kargo";
  return `Sayın ${order.customer_name || "müşterimiz"}, ${order.order_number || "siparişiniz"} numaralı siparişiniz ${carrier} ile yola çıktı. Takip No: ${order.cargo_tracking_number || "-"}. İyi günler dileriz.`;
}

export function invoicePrintShareMessage(order: {
  customer_name?: string;
  invoice_number?: string;
  gib_invoice_id?: string;
  order_number?: string;
  e_type?: string | null;
  invoice_e_type?: string | null;
}, pdfUrl?: string): string {
  const eType = String(order.e_type || order.invoice_e_type || "").toLowerCase();
  const kind = eType === "e_archive" ? "E-Arşiv" : "E-Fatura";
  const no = String(order.gib_invoice_id || order.invoice_number || order.order_number || "belgeniz").trim();
  const lines = [
    `Sayın ${order.customer_name || "müşterimiz"},`,
    "",
    `${no} numaralı ${kind} belgeniz hazırdır.`,
  ];
  if (pdfUrl) lines.push("", `PDF: ${pdfUrl}`);
  return lines.join("\n");
}

export function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
