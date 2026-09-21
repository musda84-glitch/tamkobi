import { Zap, FileText, Truck, Mail, Receipt, Printer, History, ThumbsUp, Code2, RefreshCw, Trash2 } from "lucide-react";

export const ORDER_BULK_ACTIONS = [
  { id: "einvoice_create", label: "Toplu E-Fatura Oluştur", icon: Zap },
  { id: "einvoice_print", label: "Toplu E-Fatura Yazdır", icon: FileText },
  { id: "mini_10x15", label: "Toplu Mini E-Fatura Yazdır (10X15cm)", icon: FileText },
  { id: "mini_8x20", label: "Toplu Mini E-Fatura Yazdır (8X20cm)", icon: FileText },
  { id: "hepsijet", label: "Toplu HepsiJet Ortak Barkod Yazdır", icon: Truck },
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
  { id: "invoice_link", label: "Toplu Fatura Linki gönder", icon: ThumbsUp },
  { id: "refresh", label: "Siparişlerin Güncel Durumlarını Getir", icon: RefreshCw },
  { id: "navlungo", label: "Toplu Navlungo Kargo Etiketi Yazdır", icon: Truck },
  { id: "cancel", label: "Seçili Siparişleri İptal Et", icon: Trash2 },
];

export const bulkActionNeedsSelection = (id) => id !== "refresh";
