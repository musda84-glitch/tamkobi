import React, { useEffect, useRef } from "react";
import { FileText, Archive, Printer, Eye, MessageSquare, DollarSign, FileCheck2, CalendarClock, Truck, Globe } from "lucide-react";
import { FileText, Archive, Printer, Eye, MessageSquare, DollarSign, FileCheck2, CalendarClock, Truck, Globe, CheckCircle2, XCircle } from "lucide-react";
import { FileText, Archive, Printer, Eye, MessageSquare, DollarSign, FileCheck2, CalendarClock, Truck, CheckCircle2, XCircle } from "lucide-react";
import axios from "axios";
import { toast } from "sonner";
import { FileText, Archive, Printer, Eye, MessageSquare, DollarSign, FileCheck2, CalendarClock, Truck, FileCode, FileDown } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const E_TYPE_LABELS = { e_invoice: "E-Fatura", e_archive: "E-Arşiv", paper: "Kağıt Fatura", e_dispatch: "E-İrsaliye", e_export: "e-İhracat" };

const ISSUE_OPTIONS = [
  { key: "e_invoice", label: "E-Fatura olarak kes", sub: "GİB Portal (mükellef alıcı)", icon: FileCheck2, color: "text-emerald-600" },
  { key: "e_archive", label: "E-Arşiv olarak kes", sub: "Nihai tüketici / mükellef olmayan", icon: Archive, color: "text-blue-600" },
  { key: "e_export", label: "e-İhracat olarak kes", sub: "GİB e-İhracat · GTIP / teslim şekli", icon: Globe, color: "text-sky-600" },
  { key: "paper", label: "Kağıt Fatura olarak kes", sub: "Matbu / elden", icon: FileText, color: "text-amber-600" }
];

/** Alış e-faturası GİB'den gelir; satıcı keser, alıcı onaylar/reddeder. */
export function isIncomingPurchaseInvoice(inv) {
  if (!inv || inv.invoice_type !== "purchase") return false;
  if (inv.direction === "incoming" || inv.source === "edoc_inbox" || inv.edoc_id) return true;
  if (inv.e_type === "e_invoice") return true;
  const gs = String(inv.gib_status || "");
  return /gelen|received/i.test(gs);
}

export function incomingPurchaseResponse(inv) {
  const r = String(inv?.gib_response || "").toLowerCase();
  if (r === "accepted" || r === "rejected") return r;
  const gs = String(inv?.gib_status || "");
  if (/reddedildi/i.test(gs)) return "rejected";
  if (/gelen/i.test(gs) && /onaylandı/i.test(gs)) return "accepted";
  return "pending";
}

export function isIncomingPurchasePending(inv) {
  if (!isIncomingPurchaseInvoice(inv)) return false;
  if (inv.status === "cancelled") return false;
  return incomingPurchaseResponse(inv) === "pending";
}

export const InvoiceContextMenu = ({ menu, onClose, onIssue, onPreview, onPrint, onNotify, onPayment, onInstallments, onDispatch, onAcceptIncoming, onRejectIncoming }) => {
const isOutgoingEdoc = (inv) => inv?.invoice_type === "sales" && (inv.e_type === "e_invoice" || inv.e_type === "e_archive");

const downloadInvoiceFile = (inv, kind) => {
  const id = inv.id || inv._id;
  const num = String(inv.invoice_number || "fatura").replace(/[^\w.-]+/g, "_");
  const url = kind === "xml" ? `${API_URL}/invoices/${id}/xml` : `${API_URL}/invoices/${id}/pdf?download=1`;
  axios.get(url, { responseType: "blob" }).then((r) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(r.data);
    a.download = `${num}.${kind === "xml" ? "xml" : "pdf"}`;
    a.click();
    URL.revokeObjectURL(a.href);
  }).catch(() => toast.error(kind === "xml" ? "XML indirilemedi." : "PDF indirilemedi."));
};

export const InvoiceContextMenu = ({ menu, onClose, onIssue, onPreview, onPrint, onNotify, onPayment, onInstallments, onDispatch }) => {
  const ref = useRef(null);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    document.addEventListener("scroll", onClose, true);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("scroll", onClose, true); document.removeEventListener("keydown", esc); };
  }, [menu, onClose]);

  if (!menu) return null;
  const { inv } = menu;
  const incoming = isIncomingPurchaseInvoice(inv);
  const pending = isIncomingPurchasePending(inv);
  const issued = inv.gib_status && inv.gib_status !== "Taslak";
  const left = Math.min(menu.x, window.innerWidth - 280);
  const top = Math.min(menu.y, window.innerHeight - 420);
  const Item = ({ icon: Icon, label, sub, color = "text-slate-500", onClick, testId }) => (
    <button onClick={() => { onClick(); onClose(); }} className="w-full flex items-start gap-2.5 px-3 py-2 text-left hover:bg-slate-50 transition" data-testid={testId}>
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
      <span><span className="block text-xs font-semibold text-slate-800">{label}</span>{sub && <span className="block text-[10px] text-slate-400">{sub}</span>}</span>
    </button>
  );

  return (
    <div ref={ref} style={{ left, top }} className="fixed z-[70] w-64 bg-white rounded-xl border border-slate-200 shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-100" data-testid="invoice-context-menu" onContextMenu={(e) => e.preventDefault()}>
      <div className="px-3 py-1.5 text-[10px] uppercase font-bold text-slate-400 border-b border-slate-100 truncate">{inv.invoice_number} • {inv.contact_name}</div>
      {incoming ? (
        pending ? (
          <div className="border-b border-slate-100 pb-1">
            <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-bold text-amber-800">GELEN E-FATURA</div>
            <p className="px-3 pb-1 text-[10px] text-slate-500">Bu belge GİB'den geldi; kesilmez. 8 gün içinde ticari yanıt verin.</p>
            {onAcceptIncoming && <Item icon={CheckCircle2} color="text-emerald-600" label="Onayla (Kabul)" sub="Ticari kabul yanıtı GİB'e iletilir" onClick={() => onAcceptIncoming(inv)} testId="ctx-accept-incoming" />}
            {onRejectIncoming && <Item icon={XCircle} color="text-rose-600" label="Reddet" sub="Ticari ret — alış kaydı iptal edilir" onClick={() => onRejectIncoming(inv)} testId="ctx-reject-incoming" />}
          </div>
        ) : (
          <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100" data-testid="ctx-incoming-info">
            Gelen e-fatura — kesilmez. Durum: <span className="font-semibold text-slate-700">{inv.gib_status || incomingPurchaseResponse(inv)}</span>
          </div>
        )
      ) : issued ? (
        <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100" data-testid="ctx-issued-info">
          Kesildi: <span className="font-semibold text-slate-700">{E_TYPE_LABELS[inv.e_type] || inv.e_type}</span> — belge türü artık değiştirilemez.
        </div>
      ) : (
        <div className="border-b border-slate-100 pb-1">
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-bold text-emerald-700">FATURAYI KES</div>
          {ISSUE_OPTIONS.map(o => (
            <Item key={o.key} icon={o.icon} color={o.color} label={o.label} sub={inv.e_type === o.key ? `${o.sub} • seçili tür` : o.sub} onClick={() => onIssue(inv, o.key)} testId={`ctx-issue-${o.key}`} />
          ))}
        </div>
      )}
      <Item icon={Eye} label="Görüntüle" onClick={() => onPreview(inv)} testId="ctx-preview" />
      <Item icon={Printer} label="Şablonlu Yazdır" onClick={() => onPrint(inv)} testId="ctx-print" />
      {isOutgoingEdoc(inv) && (
        <>
          <Item icon={FileCode} color="text-indigo-600" label="XML indir" sub="UBL-TR e-Fatura / e-Arşiv" onClick={() => downloadInvoiceFile(inv, "xml")} testId="ctx-download-xml" />
          <Item icon={FileDown} color="text-rose-600" label="PDF indir" sub="Görüntülenebilir belge kopyası" onClick={() => downloadInvoiceFile(inv, "pdf")} testId="ctx-download-pdf" />
        </>
      )}
      <Item icon={MessageSquare} label="SMS / E-posta Gönder" onClick={() => onNotify(inv)} testId="ctx-notify" />
      {onDispatch && inv.invoice_type === "sales" && <Item icon={Truck} color="text-fuchsia-600" label={inv.dispatch_number ? `İrsaliye: ${inv.dispatch_number}` : "İrsaliye Oluştur"} sub={inv.dispatch_number ? "Bu faturanın irsaliyesi var" : "Sevk irsaliyesi (KDV'siz) düzenle"} onClick={() => onDispatch(inv)} testId="ctx-dispatch" />}
      {inv.payment_status !== "paid" && inv.status !== "cancelled" && <Item icon={DollarSign} color="text-emerald-600" label="Tahsilat / Ödeme Ekle" onClick={() => onPayment(inv)} testId="ctx-payment" />}
      {onInstallments && <Item icon={CalendarClock} color="text-violet-600" label={inv.installment_plan ? `Taksitler (${inv.installment_plan.paid_count}/${inv.installment_plan.count})` : "Taksitlendir"} sub={inv.installment_plan ? "Planı gör, tahsil et" : "Ödeme planı oluştur"} onClick={() => onInstallments(inv)} testId="ctx-installments" />}
    </div>
  );
};
