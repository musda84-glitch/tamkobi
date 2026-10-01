import { Zap, FileText, Truck, Mail, Receipt, Printer, History, ThumbsUp, Code2, RefreshCw, Trash2, Link2 } from "lucide-react";
import { orderHasEInvoiceIssued } from "./orderMoreMenu";

/**
 * Siparişler «Toplu İşlemler» — referans sıra (HepsiJet yok).
 */
export const ORDER_BULK_ACTIONS = [
  { id: "einvoice_create", label: "Toplu E-Fatura Oluştur", icon: Zap },
  { id: "einvoice_print", label: "Toplu E-Fatura Yazdır", icon: FileText },
  { id: "mini_10x15", label: "Toplu Mini E-Fatura Yazdır (10X15cm)", icon: FileText },
  { id: "mini_8x20", label: "Toplu Mini E-Fatura Yazdır (8X20cm)", icon: FileText },
  { id: "einvoice_send", label: "Toplu E-Fatura Gönder", icon: Mail },
  { id: "invoice_create", label: "Toplu Fatura Oluştur", icon: Receipt },
  { id: "invoice_print", label: "Toplu Fatura Yazdır", icon: Printer },
  { id: "cargo_label", label: "Toplu Kargo Etiketi Yazdır", icon: Truck },
  { id: "cargo_mini", label: "Toplu Mini Kargo Etiketi Yazdır", icon: Truck },
  { id: "cargo_10x10", label: "Toplu Mini Kargo Etiketi Yazdır 10X10", icon: Truck },
  { id: "invoice_date", label: "Toplu Fatura Tarihi Değiştir", icon: History },
  { id: "approve", label: "Toplu Sipariş Onayla", icon: ThumbsUp },
  { id: "cargo_create", label: "Toplu Kargo Siparişi Oluştur", icon: Truck },
  { id: "xml", label: "Toplu E-Fatura XML'i İndir", icon: Code2 },
  { id: "invoice_link", label: "Toplu Fatura Linki gönder", icon: Link2 },
  { id: "refresh", label: "Siparişlerin Güncel Durumlarını Getir", icon: RefreshCw },
  { id: "navlungo", label: "Toplu Navlungo Kargo Etiketi Yazdır", icon: Truck },
  { id: "cancel", label: "Seçili Siparişleri İptal Et", icon: Trash2 },
];

export const bulkActionNeedsSelection = (id) => id !== "refresh";

/** Toplu e-belge oluştur/gönder: GİB'e iletilmiş siparişler atlanır. */
export const orderBulkEInvoiceEligible = (ord) => !!ord && !orderHasEInvoiceIssued(ord);

/** API hata metni (toast için). */
export const bulkApiErrorDetail = (err) => {
  const d = err?.response?.data?.detail ?? err?.response?.data?.message ?? err?.message;
  if (typeof d === "string" && d.trim()) return d.trim();
  if (Array.isArray(d)) {
    const parts = d.map((x) => x?.msg || x?.message || x?.detail || "").filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  return "";
};

export const orderRowId = (o) => o?.id || o?._id || "";
