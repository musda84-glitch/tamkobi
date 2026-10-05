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
  Trash2,
  Pencil,
  RotateCcw,
  Tag,
  Printer,
  MessageSquare,
  Stamp,
  Package,
  Zap,
} from "lucide-react";
import { INVOICE_PRINT_SHARE_HINT } from "./invoicePrintShare";

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
 * Panelde yalnızca gerçek GİB gönderimi (einvoice_state) sayılır;
 * cariye faturalaşma (is_invoiced) tek başına e-belge değildir.
 * Pazaryeri siparişlerinde faturalı e-belge tipi = kesilmiş kabul edilir.
 */
export function orderHasEInvoiceIssued(ord) {
  if (!ord) return false;
  const state = String(ord.einvoice_state || "").toLowerCase();
  if (state === "sent" || state === "queued" || state === "accepted") return true;
  if (ord.invoice_gib_uuid || ord.gib_uuid || ord.invoice_gib_tracking_id || ord.gib_tracking_id) return true;
  if (ord.gib_invoice_id) return true;
  const gs = String(ord.invoice_gib_status || ord.gib_status || "");
  // "GİB'e Gönderildi" / iletildi / ziplenmiş — yerel "Gönderilmedi" ile karışmaz
  if (/ziplen|zarflan|ileti|gönderildi|1300|başarıyla tamamland/i.test(gs) && !/^\s*hata\s*:/i.test(gs)) return true;
  const eType = String(ord.e_type || ord.invoice_e_type || "").toLowerCase();
  if (eType === "paper" || eType === "expense_slip") return false;
  if (isIntegrationOrder(ord) && ord.is_invoiced && ["e_invoice", "e_archive", "e_export"].includes(eType)) {
    return true;
  }
  return false;
}

/** Sipariş satırında gösterilecek GİB / entegratör fatura numarası. */
export function orderGibInvoiceNumber(ord) {
  if (!ord) return "";
  const gib = String(ord.gib_invoice_id || "").trim();
  if (gib) return gib;
  // Yerel fatura no yalnızca GİB gönderimi sonrası (resmi no henüz düşmemiş olabilir)
  if (!orderHasEInvoiceIssued(ord)) return "";
  const no = String(ord.invoice_number || "").trim();
  if (!no || no === String(ord.order_number || "").trim()) return "";
  return no;
}

/** Sipariş fatura rozeti: taslak (sarı) → faturalaştı (yeşil buton) → faturalaşmış e-belge (kırmızı bilgi). */
export function orderEBelgeKindLabel(ord) {
  const eType = String(ord?.e_type || ord?.invoice_e_type || "").toLowerCase();
  if (eType === "e_invoice" || eType === "e_export") return "E-Fatura";
  if (eType === "e_archive") return "E-Arşiv";
  return "E-Belge";
}

export function orderInvoiceBadge(ord) {
  if (!ord) return null;
  if (orderHasEInvoiceIssued(ord)) {
    const kind = orderEBelgeKindLabel(ord);
    return {
      label: `Faturalaşmış (${kind})`,
      title: `Faturalaşmış (${kind})`,
      line1: "Faturalaşmış",
      line2: `(${kind})`,
      // Solid kırmızı bilgi rozeti — tıklanmaz
      className: "bg-rose-600 text-white border-rose-700",
      interactive: false,
      testId: kind === "E-Fatura" ? "ebelge-efatura" : kind === "E-Arşiv" ? "ebelge-earsiv" : "ebelge",
    };
  }
  if (ord.is_invoiced) {
    return {
      label: "Faturalaştı",
      title: "Faturalaştı — tıkla: E-Fatura Oluştur",
      className: "bg-emerald-100 text-emerald-800 border-emerald-200",
      interactive: true,
      testId: "invoiced",
    };
  }
  if (ord.invoice_id) {
    return {
      label: "Taslak",
      title: "Taslak",
      className: "bg-amber-100 text-amber-800 border-amber-200",
      interactive: true,
      testId: "draft",
    };
  }
  return null;
}

/** Menü kimliği: panel_einvoice | integration_einvoice | panel_draft | panel_invoiced | held_cart | default */
export function orderMoreMenuKind(ord) {
  if (ord?.is_held_cart || ord?.order_status === "held_cart" || ord?.is_active_cart || ord?.order_status === "active_cart") return "held_cart";
  if (isPanelOrder(ord) && orderHasEInvoiceIssued(ord)) return "panel_einvoice";
  if (isIntegrationOrder(ord) && orderHasEInvoiceIssued(ord)) return "integration_einvoice";
  // Panel: cariye faturalaştı, henüz GİB e-belgesi yok → e-belge kes
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
  hint: opts.hint || "",
  title: opts.title || opts.hint || "",
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
    item("earsiv_send", "E-Arşiv Yazdır & Gönder", Mail, {
      color: "text-emerald-600",
      hint: INVOICE_PRINT_SHARE_HINT,
      title: INVOICE_PRINT_SHARE_HINT,
    }),
    item("cargo_track_notify", "Kargo Takip Kodu Bildir", History, { color: "text-sky-500" }),
    item("digital_code_notify", "Dijital Kod Bildir", Download, { color: "text-rose-600" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
    item("cargo_change", "Pazaryeri Kargo Firmasını Değiştir", Truck, { color: "text-sky-500" }),
    item("invoice_link", "Fatura Linki Gönder", Link2, { color: "text-rose-500" }),
    item("xml", "E-Fatura XML'i İndir", Code2, { color: "text-sky-500" }),
    item("efatura_pdf", "E-Fatura PDF İndir", Download, { color: "text-indigo-600", testId: "efatura-pdf" }),
  ];
}

/** B2B / panel / manuel taslak (henüz faturalanmamış) sipariş menüsü. */
export function panelDraftMoreItems(ord) {
  return [
    item("faturalastir", "Faturalaştır", FileText, { color: "text-emerald-600" }),
    item(
      "dispatch",
      ord?.dispatch_number ? `İrsaliye: ${ord.dispatch_number}` : "İrsaliye olarak kaydet",
      Package,
      { color: "text-fuchsia-600" },
    ),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("invoice_date", "Fatura Tarihi Değiştir", History, { color: "text-amber-600" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
  ];
}

/** B2B / panel — GİB e-fatura / e-arşiv kesilmiş işlem menüsü (onay sonrası). */
export function panelEInvoiceMoreItems(ord) {
  const kind = orderEBelgeKindLabel(ord); // E-Fatura | E-Arşiv | E-Belge
  const doc = kind === "E-Belge" ? "E-Fatura" : kind;
  return [
    item("mini_10x15", `Mini ${doc} Yazdır (10X15cm)`, FileText, { color: "text-sky-600" }),
    item("mini_8x20", `Mini ${doc} Yazdır (8X20cm)`, FileText, { color: "text-sky-600" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("earsiv_send", `${doc} Yazdır & Gönder`, Mail, {
      color: "text-emerald-600",
      hint: INVOICE_PRINT_SHARE_HINT,
      title: INVOICE_PRINT_SHARE_HINT,
    }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
    item("xml", `${doc} XML'i İndir`, Code2, { color: "text-sky-500" }),
    item("efatura_pdf", `${doc} PDF İndir`, Download, { color: "text-indigo-600", testId: "efatura-pdf" }),
  ];
}

/**
 * B2B / panel faturalaştıktan sonra (henüz GİB e-belgesi yok).
 * «E-Fatura Oluştur» → Elektronik Fatura Onayı modalı (Temel/Ticari).
 */
export function panelInvoicedMoreItems() {
  return [
    item("efatura_olustur", "E-Fatura Oluştur", Zap, { color: "text-rose-500", testId: "efatura-olustur" }),
    item("cargo_mini", "Mini Kargo Etiketi Yazdır", Truck, { color: "text-sky-500" }),
    item("cargo_10x10", "Mini Kargo Etiketi Yazdır 10X10", Truck, { color: "text-sky-500" }),
    item("kargola", "Kargola", Truck, { color: "text-rose-600" }),
  ];
}

/** Varsayılan menü (entegrasyon taslak vb.). Taslak siparişte e-Fatura/e-Arşiv kesimi yok. */
export function defaultMoreItems(ord, { eBelgeItems = [] } = {}) {
  const rows = (ord?.is_invoiced ? eBelgeItems : []).map((eb) =>
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
export function canDeleteFromMoreMenu(ord) {
  return !!ord && !ord.is_invoiced && !ord.invoice_id;
}

export function orderDeleteMoreItem() {
  return item("delete", "Siparişi Sil", Trash2, { color: "text-rose-600", testId: "delete" });
}

export function orderMoreMenuItems(ord, opts = {}) {
  const kind = orderMoreMenuKind(ord);
  let items;
  if (kind === "held_cart") {
    // Aktif / bekleyen sepet: satırda Yazdır + Eksik ürünleri üretime al; menü boş
    return { kind, items: [] };
  }
  if (kind === "panel_einvoice") {
    // E-belge onayı sonrası: yazdır / kargo / XML (Excel/PDF yok — referans menü)
    return { kind, items: panelEInvoiceMoreItems(ord) };
  }
  if (kind === "integration_einvoice") items = integrationEInvoiceMoreItems();
  else if (kind === "panel_draft") items = panelDraftMoreItems(ord);
  else if (kind === "panel_invoiced") {
    // Faturalaştı: E-Fatura Oluştur + kargo (Excel/PDF yok — referans menü)
    return { kind, items: panelInvoicedMoreItems() };
  } else items = defaultMoreItems(ord, opts);
  const allowDelete = opts.canDelete !== false;
  if (allowDelete && canDeleteFromMoreMenu(ord)) items = [...items, orderDeleteMoreItem()];
  return { kind, items: [...items, ...orderDownloadMoreItems()] };
}
