import { Zap, FileText, Printer, Mail, Code2, History, Link2, RefreshCw, Trash2, CheckCircle, XCircle } from "lucide-react";

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

export const bulkApiErrorDetail = (err) => {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d.map((x) => x?.msg || x?.message || x?.detail || "").filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "";
};
