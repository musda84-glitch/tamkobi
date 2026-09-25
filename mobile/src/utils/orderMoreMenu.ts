/** Web `frontend/src/utils/orderMoreMenu.js` — sipariş ⋮ menü varyantları. */

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
};

export type OrderMoreOrder = {
  channel?: string | null;
  is_invoiced?: boolean;
  invoice_id?: string;
  e_type?: string | null;
  invoice_e_type?: string | null;
  einvoice_state?: string | null;
  order_status?: string | null;
  dispatch_number?: string | null;
  form_printed_at?: string | null;
  cargo_tracking_number?: string | null;
  is_held_cart?: boolean;
  is_active_cart?: boolean;
};

const PANEL_CHANNELS = new Set(["b2b", "manual", "saha", ""]);

export function isIntegrationOrder(ord?: OrderMoreOrder | null): boolean {
  const ch = String(ord?.channel || "").toLowerCase();
  return !!ch && !PANEL_CHANNELS.has(ch);
}

export function isPanelOrder(ord?: OrderMoreOrder | null): boolean {
  return !isIntegrationOrder(ord);
}

export function orderHasEInvoiceIssued(ord?: OrderMoreOrder | null): boolean {
  if (!ord) return false;
  const state = String(ord.einvoice_state || "").toLowerCase();
  if (state === "sent" || state === "queued" || state === "accepted") return true;
  const eType = String(ord.e_type || ord.invoice_e_type || "").toLowerCase();
  if (eType === "paper" || eType === "expense_slip") return false;
  if (ord.is_invoiced && (!eType || ["e_invoice", "e_archive", "e_export"].includes(eType))) return true;
  if (ord.invoice_id && ["e_invoice", "e_archive", "e_export"].includes(eType) && ord.is_invoiced) return true;
  return false;
}

export function orderMoreMenuKind(ord?: OrderMoreOrder | null): OrderMoreKind {
  if (ord?.is_held_cart || ord?.order_status === "held_cart" || ord?.is_active_cart || ord?.order_status === "active_cart") return "held_cart";
  if (isPanelOrder(ord) && orderHasEInvoiceIssued(ord)) return "panel_einvoice";
  if (isIntegrationOrder(ord) && orderHasEInvoiceIssued(ord)) return "integration_einvoice";
  if (isPanelOrder(ord) && ord?.is_invoiced) return "panel_invoiced";
  if (isPanelOrder(ord) && !ord?.is_invoiced) return "panel_draft";
  return "default";
}

function item(
  id: string,
  label: string,
  icon: OrderMoreIcon,
  opts: { testId?: string; section?: string | null; color?: string; eType?: "e_invoice" | "e_archive"; hidden?: boolean } = {},
): OrderMoreItem & { hidden?: boolean } {
  return {
    id,
    label,
    icon,
    testId: opts.testId || id,
    section: opts.section || null,
    color: opts.color || "#64748B",
    eType: opts.eType,
    hidden: !!opts.hidden,
  };
}

export function integrationEInvoiceMoreItems(): OrderMoreItem[] {
  return [
    item("refresh_status", "Siparişin Güncel Durumunu Getir", "refresh", { color: "#059669" }),
    item("mini_10x15", "Mini E-Arşiv Yazdır (10X15cm)", "document-text", { color: "#0284C7" }),
    item("mini_8x20", "Mini E-Arşiv Yazdır (8X20cm)", "document-text", { color: "#0284C7" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", "mail", { color: "#059669" }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", "time", { color: "#0EA5E9" }),
    item("digital_code_notify", "Dijital Kod Bildir", "download", { color: "#E11D48" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
    item("cargo_change", "Pazaryeri Kargo Firmasını Değiştir", "car", { color: "#0EA5E9" }),
    item("invoice_link", "Fatura Linki Gönder", "link", { color: "#F43F5E" }),
    item("xml", "E-Fatura XML'i İndir", "code-slash", { color: "#0EA5E9" }),
  ];
}

export function panelDraftMoreItems(): OrderMoreItem[] {
  return [
    item("faturalastir", "Faturalaştır", "document-text", { color: "#059669" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("invoice_date", "Fatura Tarihi Değiştir", "time", { color: "#D97706" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
  ];
}

export function panelEInvoiceMoreItems(): OrderMoreItem[] {
  return [
    item("mini_10x15", "Mini E-Arşiv Yazdır (10X15cm)", "document-text", { color: "#0284C7" }),
    item("mini_8x20", "Mini E-Arşiv Yazdır (8X20cm)", "document-text", { color: "#0284C7" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", "mail", { color: "#059669" }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", "time", { color: "#0EA5E9" }),
    item("invoice_link", "Fatura Linki Gönder", "link", { color: "#F43F5E" }),
    item("xml", "E-Fatura XML'i İndir", "code-slash", { color: "#0EA5E9" }),
    item("invoice_date", "Fatura Tarihi Değiştir", "time", { color: "#D97706" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
  ];
}

export function panelInvoicedMoreItems(): OrderMoreItem[] {
  return [
    item("efatura_olustur", "E-Fatura Oluştur", "flash", { color: "#F43F5E" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", "car", { color: "#0EA5E9" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", "car", { color: "#0EA5E9" }),
    item("invoice_date", "Fatura Tarihi Değiştir", "time", { color: "#D97706" }),
    item("kargola", "Kargola", "car", { color: "#E11D48" }),
  ];
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
  const rows = (opts.eBelgeItems || []).map((eb) =>
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
    const allowDelete = opts.canDelete !== false;
    return { kind, items: allowDelete ? [orderDeleteMoreItem()] : [] };
  }
  if (kind === "panel_einvoice") items = panelEInvoiceMoreItems();
  else if (kind === "integration_einvoice") items = integrationEInvoiceMoreItems();
  else if (kind === "panel_draft") items = panelDraftMoreItems();
  else if (kind === "panel_invoiced") items = panelInvoicedMoreItems();
  else items = defaultMoreItems(ord, opts);
  const allowDelete = opts.canDelete !== false;
  if (allowDelete && canDeleteFromMoreMenu(ord)) items = [...items, orderDeleteMoreItem()];
  return { kind, items };
}

/** Web mobil karttaki tek birincil kısayol. */
export function mobilePrimaryAction(ord?: OrderMoreOrder | null): { id: string; label: string } | null {
  const kind = orderMoreMenuKind(ord);
  if (kind === "held_cart") return { id: "delete", label: "Sil" };
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

export function todayYmd(now = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function isYmd(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
