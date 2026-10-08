/** Sipariş «E-Fatura / E-Arşiv Yazdır & Gönder»: yalnızca yazdırma + e-posta + WhatsApp. */

import { formatTrAmount } from "./money";

export const INVOICE_PRINT_SHARE_HINT = "Yazdırma, e-posta ve WhatsApp";
export const INVOICE_PRINT_SHARE_NOTE =
  "GİB gönderimi değildir. Yalnızca yazdırma, e-posta ve WhatsApp paylaşımı için kullanılır.";

export function invoicePrintShareKindLabel(ord) {
  const eType = String(ord?.e_type || ord?.invoice_e_type || "").toLowerCase();
  if (eType === "e_archive") return "E-Arşiv";
  return "E-Fatura";
}

export function invoicePrintShareNumber(ord) {
  if (!ord) return "";
  return String(
    ord.gib_invoice_id
    || ord.invoice_number
    || ord.order_number
    || "",
  ).trim();
}

/** PrintDocument / entegratör PDF için siparişten fatura belgesi. */
export function invoicePrintShareDocFromOrder(ord) {
  if (!ord?.invoice_id) return null;
  const eType = String(ord.e_type || ord.invoice_e_type || "e_archive").toLowerCase();
  return {
    id: ord.invoice_id,
    _id: ord.invoice_id,
    invoice_number: invoicePrintShareNumber(ord) || ord.invoice_id,
    e_type: eType,
    einvoice_state: ord.einvoice_state || "sent",
    gib_uuid: ord.invoice_gib_uuid || ord.gib_uuid,
    gib_tracking_id: ord.invoice_gib_tracking_id || ord.gib_tracking_id,
    gib_status: ord.invoice_gib_status || ord.gib_status,
    gib_invoice_id: ord.gib_invoice_id,
    contact_name: ord.customer_name,
    contact_id: ord.contact_id,
    shipping_address: ord.shipping_address || ord.address || "",
    address: ord.shipping_address || ord.address || "",
    city: ord.city || "",
    customer_phone: ord.customer_phone || "",
    grand_total: ord.grand_total ?? ord.total ?? ord.total_amount,
    due_date: ord.due_date,
    items: ord.items,
    status: "approved",
  };
}

export function invoicePrintShareSubject(ord) {
  const kind = invoicePrintShareKindLabel(ord);
  const no = invoicePrintShareNumber(ord);
  return no ? `${kind} ${no}` : kind;
}

export function invoicePrintShareMessage(ord, { pdfUrl, companyName } = {}) {
  const name = String(ord?.customer_name || "müşterimiz").trim() || "müşterimiz";
  const kind = invoicePrintShareKindLabel(ord);
  const no = invoicePrintShareNumber(ord) || "belgeniz";
  const total = Number(ord?.grand_total ?? ord?.total ?? ord?.total_amount);
  const amount = Number.isFinite(total) && total > 0 ? ` (${formatTrAmount(total)} ₺)` : "";
  const lines = [
    `Sayın ${name},`,
    "",
    `${no} numaralı ${kind}${amount} belgeniz hazırdır.`,
  ];
  if (pdfUrl) {
    lines.push("", `PDF: ${pdfUrl}`);
  }
  if (companyName) {
    lines.push("", companyName);
  }
  return lines.join("\n");
}

export function invoicePdfPublicUrl(origin, invoiceId) {
  const base = String(origin || "").replace(/\/+$/, "");
  const id = String(invoiceId || "").trim();
  if (!base || !id) return "";
  return `${base}/api/invoices/${id}/pdf`;
}

/** TR cep → WhatsApp uluslararası (90…). */
export function whatsappPhoneDigits(phone) {
  let d = String(phone || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("0")) d = `90${d.slice(1)}`;
  if (d.length === 10 && d.startsWith("5")) d = `90${d}`;
  return d;
}

export function whatsappMeUrl(phone, text) {
  const digits = whatsappPhoneDigits(phone);
  if (!digits) return "";
  const q = text ? `?text=${encodeURIComponent(text)}` : "";
  return `https://wa.me/${digits}${q}`;
}

export async function fetchInvoicePdfFile(axiosClient, apiUrl, invoiceId, filename) {
  const id = String(invoiceId || "").trim();
  if (!axiosClient || !apiUrl || !id) throw new Error("Fatura PDF alınamadı.");
  const r = await axiosClient.get(`${apiUrl}/invoices/${id}/pdf`, {
    responseType: "blob",
    params: { download: 1 },
    headers: { Accept: "application/pdf" },
  });
  const blob = r.data instanceof Blob ? r.data : new Blob([r.data], { type: "application/pdf" });
  if (!blob || blob.size < 50) throw new Error("Fatura PDF alınamadı.");
  const name = filename || `${id}.pdf`;
  return new File([blob], name, { type: "application/pdf" });
}
