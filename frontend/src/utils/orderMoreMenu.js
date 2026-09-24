/** Sipariş «Diğer işlemler» menü varyantları (kanal + fatura durumuna göre). */

import {
  RefreshCw,
  FileText,
  FileSpreadsheet,
  Truck,
  Mail,
  History,
  Download,
  Link2,
  Code2,
  Pencil,
  RotateCcw,
  Tag,
  Printer,
  MessageSquare,
  Stamp,
  Package,
  Zap,
} from "lucide-react";

const PANEL_CHANNELS = new Set(["b2b", "manual", "saha", ""]);

/** Pazaryeri / e-ticaret entegrasyon siparişi mi? */
export function isIntegrationOrder(ord) {
  const ch = String(ord?.channel || "").toLowerCase();
  return !!ch && !PANEL_CHANNELS.has(ch);
}

/** Panel (B2B / manuel / saha) siparişi. */
export function isPanelOrder(ord) {
  return !isIntegrationOrder(ord);
}

/**
 * E-fatura / e-arşiv GİB üzerinden kesilmiş mi?
 * Kağıt fatura sayılmaz.
 */
export function orderHasEInvoiceIssued(ord) {
  if (!ord) return false;
  const state = String(ord.einvoice_state || "").toLowerCase();
  if (state === "sent" || state === "queued" || state === "accepted") return true;
  const eType = String(ord.e_type || ord.invoice_e_type || "").toLowerCase();
  if (eType === "paper" || eType === "expense_slip") return false;
  if (ord.is_invoiced && (!eType || ["e_invoice", "e_archive", "e_export"].includes(eType))) return true;
  if (ord.invoice_id && ["e_invoice", "e_archive", "e_export"].includes(eType) && ord.is_invoiced) return true;
  return false;
}

/** Menü kimliği: panel_einvoice | integration_einvoice | panel_draft | panel_invoiced | default */
export function orderMoreMenuKind(ord) {
  if (isPanelOrder(ord) && orderHasEInvoiceIssued(ord)) return "panel_einvoice";
  if (isIntegrationOrder(ord) && orderHasEInvoiceIssued(ord)) return "integration_einvoice";
  // Panel: kağıt / taslak fatura — henüz GİB e-belgesi yok
  if (isPanelOrder(ord) && ord?.is_invoiced) return "panel_invoiced";
  if (isPanelOrder(ord) && !ord?.is_invoiced) return "panel_draft";
  return "default";
}

const item = (id, label, icon, opts = {}) => ({
  id,
  label,
  icon,
  testId: opts.testId || id,
  section: opts.section || null,
  color: opts.color || "text-slate-500",
  eType: opts.eType,
  hidden: !!opts.hidden,
});

/** Entegrasyondan gelen + e-faturası kesilmiş sipariş menüsü. */
export function integrationEInvoiceMoreItems() {
  return [
    item("refresh_status", "Siparişin Güncel Durumunu Getir", RefreshCw, { color: "text-emerald-600" }),
    item("mini_10x15", "Mini E-Arşiv Yazdır (10X15cm)", FileText, { color: "text-sky-600" }),
    item("mini_8x20", "Mini E-Arşiv Yazdır (8X20cm)", FileText, { color: "text-sky-600" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", Mail, { color: "text-emerald-600" }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", History, { color: "text-sky-500" }),
    item("digital_code_notify", "Dijital Kod Bildir", Download, { color: "text-rose-600" }),
    item("navlungo_create", "Navlungo Siparişi Oluştur", Truck, { color: "text-rose-600" }),
    item("cargo_change", "Paketli Siparişin Kargo Firmasını Değiştir", Truck, { color: "text-sky-500" }),
    item("invoice_link", "Fatura Linki Gönder", Link2, { color: "text-rose-500" }),
    item("xml", "E-Fatura XML'i İndir", Code2, { color: "text-sky-500" }),
  ];
}

/** B2B / panel / manuel taslak (henüz faturalanmamış) sipariş menüsü. */
export function panelDraftMoreItems() {
  return [
    item("faturalastir", "Faturalaştır", FileText, { color: "text-emerald-600" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("invoice_date", "Fatura Tarihi Değiştir", History, { color: "text-amber-600" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
  ];
}

/** B2B / panel — GİB e-fatura / e-arşiv kesilmiş işlem menüsü. */
export function panelEInvoiceMoreItems() {
  return [
    item("mini_10x15", "Mini E-Arşiv Yazdır (10X15cm)", FileText, { color: "text-sky-600" }),
    item("mini_8x20", "Mini E-Arşiv Yazdır (8X20cm)", FileText, { color: "text-sky-600" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", Mail, { color: "text-emerald-600" }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", History, { color: "text-sky-500" }),
    item("invoice_link", "Fatura Linki Gönder", Link2, { color: "text-rose-500" }),
    item("xml", "E-Fatura XML'i İndir", Code2, { color: "text-sky-500" }),
    item("invoice_date", "Fatura Tarihi Değiştir", History, { color: "text-amber-600" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
  ];
}

/** B2B / panel faturalaştıktan sonra (E-Fatura Oluştur menüsü). */
export function panelInvoicedMoreItems() {
  return [
    item("efatura_olustur", "E-Fatura Oluştur", Zap, { color: "text-rose-500" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("invoice_date", "Fatura Tarihi Değiştir", History, { color: "text-amber-600" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
  ];
}

/** Varsayılan menü (entegrasyon taslak vb.). */
export function defaultMoreItems(ord, { eBelgeItems = [] } = {}) {
  const rows = eBelgeItems.map((eb) =>
    item(`ebelge_${eb.eType}`, eb.label, Stamp, {
      testId: `e-belge-${eb.testIdSuffix}`,
      section: "E-Belge (GİB)",
      color: eb.eType === "e_invoice" ? "text-indigo-600" : "text-violet-600",
      eType: eb.eType,
    }),
  );
  rows.push(
    item("edit", "Siparişi Düzenle", Pencil),
    item("dispatch", ord?.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "E-İrsaliye Oluştur & Yazdır", Package),
    item("return", "İade Al", RotateCcw, { hidden: ["returned"].includes(ord?.order_status) }),
    item("cargo_label", "Kargo Etiketi Yazdır", Tag),
    item("print_form", ord?.form_printed_at ? "Sipariş Formu (yazdırıldı)" : "Sipariş Formu Yazdır", Printer),
    item("notify", "Müşteriye Bildirim Gönder", MessageSquare),
  );
  return rows.filter((r) => !r.hidden);
}

/** Tüm menü varyantlarında ortak: siparişi Excel / PDF indir. */
export function orderDownloadMoreItems() {
  return [
    item("download_xlsx", "Siparişi Excel İndir", FileSpreadsheet, { color: "text-emerald-600" }),
    item("download_pdf", "Siparişi PDF İndir", FileText, { color: "text-rose-600" }),
  ];
}

/**
 * Siparişe göre menü satırları.
 * @returns {{ kind: string, items: array }}
 */
export function orderMoreMenuItems(ord, opts = {}) {
  const kind = orderMoreMenuKind(ord);
  let items;
  if (kind === "panel_einvoice") items = panelEInvoiceMoreItems();
  else if (kind === "integration_einvoice") items = integrationEInvoiceMoreItems();
  else if (kind === "panel_draft") items = panelDraftMoreItems();
  else if (kind === "panel_invoiced") items = panelInvoicedMoreItems();
  else items = defaultMoreItems(ord, opts);
  return { kind, items: [...items, ...orderDownloadMoreItems()] };
}
