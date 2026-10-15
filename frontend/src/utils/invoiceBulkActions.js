import { Zap, FileText, Printer, Mail, Code2, History, Link2, RefreshCw, Trash2, CheckCircle, XCircle } from "lucide-react";
import {
  canDeleteInvoice,
  isDispatchDocument,
  isGibIssued,
  isIncomingPurchaseInvoice,
} from "../components/InvoiceContextMenu";

/** Faturalar «Toplu İşlemler» — e-belge → yazdır → tarih/link → durum → sil/iptal. */
export const INVOICE_BULK_ACTIONS = [
  { id: "einvoice_send", label: "Toplu E-Fatura / E-Arşiv Gönder", icon: Zap },
  { id: "einvoice_print", label: "Toplu E-Fatura Yazdır", icon: FileText },
  { id: "invoice_print", label: "Toplu Fatura Yazdır", icon: Printer },
  { id: "xml", label: "Toplu E-Fatura XML'i İndir", icon: Code2 },
  { id: "invoice_date", label: "Toplu Fatura Tarihi Değiştir", icon: History },
  { id: "invoice_link", label: "Toplu Fatura Linki Gönder", icon: Mail },
  { id: "approve", label: "Toplu Taslak Onayla", icon: CheckCircle },
  { id: "refresh", label: "GİB Durumlarını Güncelle", icon: RefreshCw },
  { id: "cancel", label: "Seçili Faturaları İptal Et", icon: XCircle },
  { id: "delete", label: "Seçili Taslakları Sil", icon: Trash2 },
];

export const invoiceBulkNeedsSelection = (id) => id !== "refresh";

export const INVOICE_BULK_REFRESH_LIMIT = 40;

export const bulkApiErrorDetail = (err) => {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d.map((x) => x?.msg || x?.message || x?.detail || "").filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "";
};

/** Blob JSON gövdeli API hataları (XML indirme) için neden metni. */
export async function bulkApiErrorDetailAsync(err) {
  const blob = err?.response?.data;
  if (blob && typeof blob.text === "function") {
    try {
      const j = JSON.parse(await blob.text());
      if (typeof j?.detail === "string" && j.detail.trim()) return j.detail.trim();
    } catch { /* ignore */ }
  }
  return bulkApiErrorDetail(err);
}


export const INVOICE_LINK_TTL_HOURS = 720;

export function isDispatchInvoice(inv) {
  return Boolean(inv && (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch"));
}

/** Tekil ve toplu iptal onay metni. GİB/İşNet çağrılmaz; iptal geri alınamaz. */
export function invoiceCancelConfirmText({
  invoices,
  count,
  gibSentCount = 0,
  isDispatch,
} = {}) {
  const list = Array.isArray(invoices) ? invoices : [];
  const n = Number(count != null ? count : (list.length || 1)) || 1;
  const dispatch = isDispatch != null
    ? !!isDispatch
    : list.length > 0 && list.every(isDispatchInvoice);
  if (dispatch) {
    if (n === 1 && list[0]?.invoice_number) {
      return `${list[0].invoice_number} numaralı e-irsaliye iptal edilsin mi?\nKayıt iptal edilir; bağlı sipariş irsaliye bağı kopar. İptal geri alınamaz.`;
    }
    return `${n} irsaliye iptal edilecek. İptal geri alınamaz.\nKayıt iptal edilir; bağlı sipariş irsaliye bağı kopar.`;
  }
  const gib = Number(gibSentCount) || 0;
  const lines = [
    `${n} fatura iptal edilecek. İptal geri alınamaz.`,
    "Cari bakiyesi ve stok etkileri geri alınır.",
    "Bu işlem GİB/İşNet'teki e-belgeyi İPTAL ETMEZ; GİB'e gönderilmiş belgeleri ayrıca GİB/İşNet portalından iptal etmelisiniz.",
  ];
  if (gib > 0) lines.push(`${gib} tanesi GİB'e gönderilmiş.`);
  return lines.join("\n");
}

export function invoiceShareLinkParams() {
  return { kind: "pdf", ttl_hours: INVOICE_LINK_TTL_HOURS };
}

export function invoiceLinkMailBody({ contactName, invoiceNumber, link } = {}) {
  return `Sayın ${contactName || ""},\n\n${invoiceNumber || ""} numaralı faturanız: ${link}\n\nLink 30 gün geçerlidir.`;
}

function contactEmailForInvoice(inv, contacts = []) {
  const c = (contacts || []).find((x) => (x.id || x._id) === inv?.contact_id) || {};
  return String(inv?.contact_email || c.email || "").trim();
}

export function classifyInvoiceLinkRecipients(invoices = [], contacts = []) {
  const ready = [];
  const skipped = [];
  for (const inv of invoices || []) {
    const email = contactEmailForInvoice(inv, contacts);
    if (email) ready.push({ inv, email });
    else skipped.push({ inv, reason: "E-posta yok" });
  }
  return { ready, skipped, total: (invoices || []).length };
}

export async function sendInvoiceShareLink({ axiosClient, apiUrl, companyId, inv, email }) {
  const invId = inv.id || inv._id;
  const sr = await axiosClient.get(`${apiUrl}/invoices/${invId}/share-link`, {
    params: invoiceShareLinkParams(),
  });
  const link = sr.data?.url;
  if (!link) throw new Error("İmzalı link yok");
  const fd = new FormData();
  fd.append("company_id", companyId || "");
  fd.append("to", email);
  fd.append("subject", `Faturanız ${inv.invoice_number || ""}`);
  fd.append("body", invoiceLinkMailBody({
    contactName: inv.contact_name,
    invoiceNumber: inv.invoice_number,
    link,
  }));
  fd.append("context", "invoice");
  fd.append("ref_id", invId);
  fd.append("contact_id", inv.contact_id || "");
  fd.append("contact_name", inv.contact_name || "");
  await axiosClient.post(`${apiUrl}/comm/mail/send`, fd);
}

export function invoiceBulkApproveSkipReason(inv) {
  if (!inv) return "Taslak değil";
  if (inv.invoice_type === "purchase" && (
    inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id
  )) return "Gelen alış faturası";
  if (inv.status === "approving") return "Fatura onaylanıyor";
  if (inv.status !== "draft") return "Taslak değil";
  return "";
}

export async function runInvoiceBulkItems(list, { skipReason, run } = {}) {
  const items = [];
  for (const inv of list || []) {
    const id = inv?.id || inv?._id;
    const label = inv?.invoice_number || id || "—";
    const skip = skipReason ? skipReason(inv) : "";
    if (skip) {
      items.push({ id, label, outcome: "skipped", reason: skip });
      continue;
    }
    try {
      const extra = await run(inv);
      const patch = extra && typeof extra === "object" && !Array.isArray(extra) ? extra : {};
      items.push({ id, label, outcome: "ok", ...patch });
    } catch (err) {
      items.push({ id, label, outcome: "error", reason: bulkApiErrorDetail(err) || "Hata" });
    }
  }
  return items;
}

/** GİB'e çıkmış belge: UUID / takip no / isGibIssued. */
export function invoiceHasGoneToGib(inv) {
  if (!inv) return false;
  return Boolean(inv.gib_uuid || inv.gib_tracking_id || isGibIssued(inv));
}

export function invoiceBulkRefreshSkipReason(inv) {
  if (invoiceHasGoneToGib(inv)) return "";
  return "GİB'e gönderilmemiş";
}

export function invoiceBulkRefreshConfirmText(n) {
  return `${Number(n) || 0} belge güncellenecek`;
}

export function invoiceBulkRefreshRemainderReason(n) {
  return `kalan ${Number(n) || 0} belge için tekrar çalıştırın`;
}

export function invoiceBulkRefreshOkPatch(data) {
  if (data?.updated) return { reason: data.gib_status || "Güncellendi" };
  return { reason: "Değişiklik yok" };
}

export function pickInvoiceBulkRefreshTargets({
  selected = [],
  visible = [],
  limit = INVOICE_BULK_REFRESH_LIMIT,
} = {}) {
  if ((selected || []).length) {
    return {
      mode: "selected",
      targets: selected,
      remainder: 0,
      confirmCount: 0,
      needsConfirm: false,
    };
  }
  const gib = (visible || []).filter(invoiceHasGoneToGib);
  return {
    mode: "visible",
    targets: gib.slice(0, limit),
    remainder: Math.max(0, gib.length - limit),
    confirmCount: gib.length,
    needsConfirm: true,
  };
}

export function invoiceBulkRefreshGate({
  selected = [],
  visible = [],
  limit = INVOICE_BULK_REFRESH_LIMIT,
  confirm = (msg) => (typeof window !== "undefined" ? window.confirm(msg) : false),
} = {}) {
  const picked = pickInvoiceBulkRefreshTargets({ selected, visible, limit });
  if (picked.mode === "visible") {
    if (!picked.confirmCount) return { ...picked, empty: true, cancelled: false };
    if (!confirm(invoiceBulkRefreshConfirmText(picked.confirmCount))) {
      return { ...picked, empty: false, cancelled: true };
    }
  }
  return { ...picked, empty: false, cancelled: false };
}

export async function runInvoiceRefreshBulk(list, { refresh, remainder = 0 } = {}) {
  const items = await runInvoiceBulkItems(list, {
    skipReason: invoiceBulkRefreshSkipReason,
    run: async (inv) => invoiceBulkRefreshOkPatch(await refresh(inv)),
  });
  if (!remainder) return items;
  return [
    ...items,
    {
      id: "__remainder__",
      label: "Kalan belgeler",
      outcome: "skipped",
      reason: invoiceBulkRefreshRemainderReason(remainder),
    },
  ];
}

export function invoiceXmlFileName(inv) {
  const id = inv?.id || inv?._id || "invoice";
  return `${inv?.invoice_number || id}.xml`;
}

export function invoiceBulkXmlSkipReason(inv) {
  if (!inv) return "Belge yok";
  if (inv.status === "draft") return "Taslak";
  if (inv.status === "cancelled") return "İptal edilmiş";
  const et = String(inv.e_type || "");
  if (et === "paper") return "Kağıt fatura";
  if (et === "expense_slip") return "Gider pusulası";
  if (!invoiceHasGoneToGib(inv)) return "GİB'e gönderilmemiş";
  return "";
}

export async function fetchInvoiceXmlResponse(axiosClient, apiUrl, id) {
  try {
    return await axiosClient.get(`${apiUrl}/e-invoice/${id}/xml`, { responseType: "blob" });
  } catch {
    return await axiosClient.get(`${apiUrl}/invoices/${id}/xml`, { responseType: "blob" });
  }
}

export function triggerBrowserDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function runInvoiceXmlBulk(list, { download } = {}) {
  return runInvoiceBulkItems(list, {
    skipReason: invoiceBulkXmlSkipReason,
    run: download,
  });
}

/** Backend `invoice_gib_locked` ile aynı ön eleme — son karar yine backend. */
export function invoiceGibLocked(inv) {
  if (!inv) return false;
  if (inv.status === "draft") return false;
  const eType = String(inv.e_type || "").trim().toLowerCase();
  const state = String(inv.einvoice_state || "").trim().toLowerCase();
  if (eType === "paper" || eType === "expense_slip" || state === "paper" || state === "not_applicable") return false;
  const gsEarly = String(inv.gib_status || "").trim().toLowerCase();
  if (state === "error" || gsEarly.startsWith("hata")) {
    return String(inv.gib_status_code || "").trim() === "1300";
  }
  if (state === "sent" || state === "queued") return true;
  if (inv.gib_tracking_id || inv.gib_uuid) return true;
  const code = String(inv.gib_status_code || "").trim();
  if (/^\d+$/.test(code) && Number(code) >= 1000) return true;
  const gs = String(inv.gib_status || "").toLowerCase();
  if (gs.includes("hata")) return false;
  if (["başarıyla tamamland", "basariyla tamamland", "ileti", "kuyrukta", "zarf ", "hedeften"].some((k) => gs.includes(k))) {
    return true;
  }
  if (gs.replace(/ı/g, "i").includes("gib onay")) return true;
  return false;
}

export function invoiceBulkDateSkipReason(inv) {
  if (!inv) return "Belge yok";
  if (inv.status === "cancelled") return "İptal edilmiş fatura düzenlenemez.";
  if (invoiceGibLocked(inv)) return "GİB'e iletilmiş faturada sadece vade ve not düzenlenebilir.";
  return "";
}

export function classifyInvoiceDateBulk(list = []) {
  const ready = [];
  const skipped = [];
  for (const inv of list || []) {
    const reason = invoiceBulkDateSkipReason(inv);
    if (reason) skipped.push({ inv, reason });
    else ready.push(inv);
  }
  return { ready, skipped, updateCount: ready.length, skipCount: skipped.length };
}

export function invoiceBulkDateSummaryText({ updateCount = 0, skipCount = 0 } = {}) {
  return `${Number(updateCount) || 0} fatura güncellenecek; ${Number(skipCount) || 0} atlanacak`;
}

export async function runInvoiceDateBulk(list, { date, put } = {}) {
  return runInvoiceBulkItems(list, {
    skipReason: invoiceBulkDateSkipReason,
    run: (inv) => put(inv, date),
  });
}

export function invoiceBulkDeleteSkipReason(inv) {
  if (canDeleteInvoice(inv)) return "";
  if (!inv) return "Belge yok";
  if (inv.status === "cancelled") return "İptal edilmiş";
  if (isIncomingPurchaseInvoice(inv)) return "Gelen alış faturası";
  if (isDispatchDocument(inv) && invoiceHasGoneToGib(inv)) return "GİB'e gönderilmiş irsaliye";
  if (inv.status !== "draft") return "Faturalaşmış belge silinemez";
  return "Silinemez";
}

export async function runInvoiceDeleteBulk(list, { remove } = {}) {
  return runInvoiceBulkItems(list, {
    skipReason: invoiceBulkDeleteSkipReason,
    run: remove,
  });
}
