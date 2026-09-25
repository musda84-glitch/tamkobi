import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import axios from "axios";
import {
  FileText, Archive, Printer, Eye, MessageSquare, DollarSign, FileCheck2, CalendarClock,
  Truck, Globe, CheckCircle2, XCircle, Download, FileCode2, ExternalLink, Trash2, Receipt, Pencil, Loader2, Copy,
} from "lucide-react";
import { canCopyInvoice, INVOICE_COPY_MODES } from "./invoiceCopyModes";
export const E_TYPE_LABELS = {
  e_invoice: "E-Fatura",
  e_archive: "E-Arşiv",
  paper: "Kağıt Fatura",
  e_dispatch: "E-İrsaliye",
  e_export: "e-İhracat",
  expense_slip: "Gider Pusulası",
};

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

/** Yalnızca GİB'e gerçekten iletilmiş / kağıt kesilmiş faturalar "kesildi" sayılır. */
export const GIB_ISSUED_STATUSES = new Set([
  "Başarıyla İletildi (GİB Onaylı)",
  "Kağıt Fatura (Matbu)",
  "n11 Faturam ile GİB'e iletildi",
  "e-İhracat GİB'e iletildi",
  "GİB'e Gönderildi",
  "Kuyrukta",
]);

export function isGibIssued(inv) {
  if (!inv) return false;
  if (inv.einvoice_state === "sent" || inv.einvoice_state === "queued") return true;
  if (inv.gib_tracking_id) return true;
  const gs = String(inv.gib_status || "");
  if (GIB_ISSUED_STATUSES.has(gs)) return true;
  return /ileti|matbu|n11 faturam|e-ihracat.*ileti/i.test(gs) && !/onaylandı$/i.test(gs);
}

/** Taslak ve (ödenmemiş) kağıt faturalar silinebilir. */
export function canDeleteInvoice(inv) {
  if (!inv) return false;
  if (inv.status === "draft") return true;
  if (inv.e_type !== "paper") return false;
  if (Number(inv.paid_amount || 0) > 0.01) return false;
  if (["paid", "partially_paid", "partial"].includes(String(inv.payment_status || ""))) return false;
  return true;
}

/** Taslak ve kağıt kayıtlar henüz GİB e-belgesi değildir; menüden kesilebilir. */
export function canIssueInvoice(inv) {
  if (!inv || isIncomingPurchaseInvoice(inv)) return false;
  if (inv.status === "cancelled" || inv.invoice_type === "dispatch" || inv.e_type === "expense_slip") return false;
  if (inv.status === "draft" || inv.e_type === "paper") return true;
  return !isGibIssued(inv);
}

/** Keep a fixed menu inside the viewport. Tall menus scroll instead of running off the bottom. */
export function placeContextMenu({ x, y, width = 256, height, viewportWidth, viewportHeight, margin = 8 }) {
  const available = Math.max(120, viewportHeight - margin * 2);
  const used = Math.min(Math.max(Number(height) || 0, 0), available);
  let top = y;
  if (top + used > viewportHeight - margin) top = viewportHeight - margin - used;
  if (top < margin) top = margin;
  let left = x;
  if (left + width > viewportWidth - margin) left = viewportWidth - margin - width;
  if (left < margin) left = margin;
  return { left, top, maxHeight: available };
}

export function invoiceHasPayment(inv) {
  if (!inv) return false;
  if (Number(inv.paid_amount || 0) > 0.01) return true;
  return ["paid", "partially_paid", "partial"].includes(String(inv.payment_status || ""));
}

/** Onaylı faturalar iptal edilebilir (silinmez). Ödemeli olanlarda düğme görünür; tahsilat varsa sunucu geri almayı ister. */
export function canCancelInvoice(inv) {
  if (!inv) return false;
  if (inv.status === "cancelled" || inv.status === "draft") return false;
  if (inv.invoice_type === "dispatch") return false;
  return true;
}

/** Taslak satış/alış belgesi ⋮ menüden düzenlenir (satır ikonu yok). */
export function canEditInvoice(inv) {
  if (!inv || inv.status !== "draft") return false;
  if (isIncomingPurchaseInvoice(inv)) return false;
  if (inv.invoice_type === "dispatch") return false;
  return true;
}

/** Kesilmiş satış/alış belgesinden, aynı cari ve kalemlerle gider pusulası düzenlenir. */
export function canIssueExpenseSlip(inv) {
  if (!inv) return false;
  if (inv.status === "cancelled" || inv.status === "draft") return false;
  if (inv.invoice_type === "dispatch" || inv.e_type === "expense_slip") return false;
  if (isIncomingPurchaseInvoice(inv)) return false;
  if (!inv.contact_id && !inv.contact_name) return false;
  return true;
}

const ISSUE_OPTIONS = [
  { key: "auto", label: "E-Fatura / E-Arşiv (GİB)", sub: "Mükellef ise e-Fatura, değilse e-Arşiv", icon: FileCheck2, color: "text-emerald-600" },
  { key: "e_export", label: "e-İhracat olarak kes", sub: "GİB e-İhracat · GTIP / teslim şekli", icon: Globe, color: "text-sky-600" },
  { key: "paper", label: "Kağıt Fatura olarak kes", sub: "Matbu / elden", icon: FileText, color: "text-amber-600" },
];

/** GİB lookup sonucu → kesilecek belge türü. */
export function suggestedIssueTypeFromGib(lookup) {
  if (!lookup) return "e_archive";
  if (lookup.suggested_e_type === "e_invoice" || lookup.suggested_e_type === "e_archive") {
    return lookup.suggested_e_type;
  }
  return lookup.is_e_invoice_user ? "e_invoice" : "e_archive";
}

export function invoiceBuyerTaxId(inv) {
  if (!inv) return "";
  return String(inv.contact_tax_id || inv.buyer_tax_id || "").replace(/\D/g, "");
}

/** Kağıt / ihracat dışındaki kesimlerde tür GİB'den gelir. */
export function shouldResolveIssueFromGib(eType) {
  if (eType == null || eType === "" || eType === "auto") return true;
  return !["paper", "e_export", "e_ihracat", "e_dispatch", "expense_slip"].includes(eType);
}
export const InvoiceContextMenu = (props) => {
  const {
    menu, onClose, onIssue, onPreview, onPrint, onNotify, onPayment, onInstallments, onDispatch, onDelete, onCancel, onExpenseSlip, onEdit, onCopy,
  } = props;
  const onAcceptIncoming = props.onAcceptIncoming;
  const onRejectIncoming = props.onRejectIncoming;
  const apiBase = props.apiBase || "";
  const companyId = props.companyId || menu?.inv?.company_id || "";
  const ref = useRef(null);
  const [pos, setPos] = useState(null);
  const [gibLookup, setGibLookup] = useState(null);
  const [gibBusy, setGibBusy] = useState(false);
  useEffect(() => {
    if (!menu) return;
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    const esc = (e) => e.key === "Escape" && onClose();
    document.addEventListener("mousedown", close);
    const onScroll = (e) => { if (ref.current && ref.current.contains(e.target)) return; onClose(); };
    document.addEventListener("scroll", onScroll, true);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("scroll", onScroll, true);
      document.removeEventListener("keydown", esc);
    };
  }, [menu, onClose]);
  useEffect(() => {
    if (!menu?.inv || !canIssueInvoice(menu.inv) || isIncomingPurchaseInvoice(menu.inv)) {
      setGibLookup(null);
      setGibBusy(false);
      return undefined;
    }
    const tax = invoiceBuyerTaxId(menu.inv);
    if (!apiBase || tax.length < 10) {
      setGibLookup(null);
      setGibBusy(false);
      return undefined;
    }
    let cancelled = false;
    setGibBusy(true);
    setGibLookup(null);
    const cid = companyId || menu.inv.company_id || "";
    axios
      .get(`${apiBase}/gib/lookup`, { params: { tax_id: tax, company_id: cid } })
      .then((r) => { if (!cancelled) setGibLookup(r.data); })
      .catch(() => { if (!cancelled) setGibLookup(null); })
      .finally(() => { if (!cancelled) setGibBusy(false); });
    return () => { cancelled = true; };
  }, [menu, apiBase, companyId]);
  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    if (!el) return;
    const next = placeContextMenu({
      x: menu.x,
      y: menu.y,
      height: el.scrollHeight,
      viewportWidth: window.innerWidth,
      viewportHeight: window.innerHeight,
    });
    setPos((prev) => (
      prev && prev.left === next.left && prev.top === next.top && prev.maxHeight === next.maxHeight ? prev : next
    ));
    if (el.scrollHeight > next.maxHeight + 1 && menu.y > window.innerHeight * 0.55) {
      el.scrollTop = el.scrollHeight;
    }
  }, [menu, gibLookup, gibBusy]);

  if (!menu) return null;
  const { inv } = menu;
  const incoming = isIncomingPurchaseInvoice(inv);
  const pending = isIncomingPurchasePending(inv);
  const issued = isGibIssued(inv);
  const canIssue = canIssueInvoice(inv);
  const deletable = canDeleteInvoice(inv);
  const editable = canEditInvoice(inv);
  const cancellable = canCancelInvoice(inv);
  const slipable = canIssueExpenseSlip(inv);
  const copyable = onCopy && canCopyInvoice(inv);
  const paid = invoiceHasPayment(inv);
  const showIssuedActions = issued && !incoming;
  const gibType = suggestedIssueTypeFromGib(gibLookup);
  const gibSub = gibBusy
    ? "GİB mükellef sorgulanıyor…"
    : gibLookup
      ? (gibType === "e_invoice" ? "GİB: e-Fatura mükellefi → E-Fatura" : "GİB: kayıt yok → E-Arşiv")
      : "Mükellef ise e-Fatura, değilse e-Arşiv";
  const placed = pos || placeContextMenu({
    x: menu.x,
    y: menu.y,
    height: 360,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
  });
  const Item = ({ icon: Icon, label, sub, color = "text-slate-500", onClick, testId, disabled }) => (
    <button
      type="button"
      disabled={disabled}
      onClick={() => { if (disabled) return; onClick(); onClose(); }}
      className={`w-full flex items-start gap-2.5 px-3 py-2 text-left transition ${disabled ? "opacity-60 cursor-wait" : "hover:bg-slate-50"}`}
      data-testid={testId}
    >
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
      <span>
        <span className="block text-xs font-semibold text-slate-800">{label}</span>
        {sub && <span className="block text-[10px] text-slate-400">{sub}</span>}
      </span>
    </button>
  );

  const menuNode = (
    <div ref={ref} style={{ left: placed.left, top: placed.top, maxHeight: placed.maxHeight }} className="fixed z-[70] w-64 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-2xl py-1.5 animate-in fade-in zoom-in-95 duration-100" data-testid="invoice-context-menu" onContextMenu={(e) => e.preventDefault()}>
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
      ) : canIssue ? (
        <div className="border-b border-slate-100 pb-1">
          {onEdit && editable && (
            <Item icon={Pencil} color="text-amber-700" label="Taslağı Düzenle" sub="Kalem, cari ve tutar" onClick={() => onEdit(inv)} testId="ctx-edit" />
          )}
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-bold text-emerald-700">FATURAYI KES</div>
          {inv.status === "draft" && (
            <p className="px-3 pb-1 text-[10px] text-slate-500" data-testid="ctx-draft-issue-note">Taslak olarak kayıtlı. Kesildiğinde cariye işlenir.</p>
          )}
          {inv.e_type === "paper" && inv.status !== "draft" && (
            <p className="px-3 pb-1 text-[10px] text-slate-500" data-testid="ctx-paper-info">Kağıt fatura (matbu) — GİB e-belgesi değildir; buradan kesilebilir.</p>
          )}
          {ISSUE_OPTIONS.map((o) => {
            const isAuto = o.key === "auto";
            const label = isAuto
              ? (gibBusy ? "GİB sorgulanıyor…" : gibLookup ? (gibType === "e_invoice" ? "E-Fatura olarak kes" : "E-Arşiv olarak kes") : o.label)
              : o.label;
            const sub = isAuto ? gibSub : o.sub;
            const Icon = isAuto && gibBusy
              ? Loader2
              : isAuto && gibLookup
                ? (gibType === "e_invoice" ? FileCheck2 : Archive)
                : o.icon;
            const color = isAuto && gibLookup
              ? (gibType === "e_invoice" ? "text-emerald-600" : "text-blue-600")
              : o.color;
            return (
              <Item
                key={o.key}
                icon={Icon}
                color={`${color}${isAuto && gibBusy ? " animate-spin" : ""}`}
                label={label}
                sub={sub}
                disabled={isAuto && gibBusy}
                onClick={() => onIssue(inv, isAuto ? "auto" : o.key)}
                testId={isAuto ? "ctx-issue-gib" : `ctx-issue-${o.key}`}
              />
            );
          })}
          {/* Geriye dönük test id: eski e_invoice / e_archive düğmeleri GİB auto'ya yönlenir */}
          <button type="button" className="hidden" data-testid="ctx-issue-e_invoice" onClick={() => { onIssue(inv, "auto"); onClose(); }} aria-hidden />
          <button type="button" className="hidden" data-testid="ctx-issue-e_archive" onClick={() => { onIssue(inv, "auto"); onClose(); }} aria-hidden />
        </div>
      ) : issued ? (
        <div className="px-3 py-2 text-[11px] text-slate-500 border-b border-slate-100" data-testid="ctx-issued-info">
          Kesildi: <span className="font-semibold text-slate-700">{E_TYPE_LABELS[inv.e_type] || inv.e_type}</span> — belge türü artık değiştirilemez.
        </div>
      ) : null}
      {issued && inv.e_type !== "paper" && inv.e_type !== "expense_slip" && (
        <div className="border-b border-slate-100 pb-1" data-testid="ctx-edoc-downloads">
          <div className="px-3 pt-1.5 pb-0.5 text-[10px] font-bold text-slate-500">E-BELGE</div>
          <Item icon={FileCode2} color="text-indigo-600" label="UBL XML İndir" sub="GİB UBL-TR arşiv kopyası" onClick={() => window.open(`${apiBase}/invoices/${inv.id || inv._id}/xml`, "_blank")} testId="ctx-download-xml" />
          <Item icon={Download} color="text-indigo-600" label="PDF Önizle / İndir" sub="Yazdırılabilir fatura PDF" onClick={() => window.open(`${apiBase}/invoices/${inv.id || inv._id}/pdf`, "_blank")} testId="ctx-download-pdf" />
          {inv.gib_document_url && <Item icon={ExternalLink} color="text-emerald-600" label="Resmi GİB Belgesi" sub="Entegratör görüntüleme linki" onClick={() => window.open(inv.gib_document_url, "_blank")} testId="ctx-gib-doc-url" />}
        </div>
      )}
      {showIssuedActions && ((onCancel && cancellable) || (onExpenseSlip && slipable)) && (
        <div className="border-b border-slate-100 pb-1" data-testid="ctx-issued-actions">
          {onCancel && cancellable && (
            <Item icon={XCircle} color="text-amber-600" label="Faturayı İptal Et" sub={paid ? "Önce tahsilatı / ödemeyi geri alın" : "Cari/stok geri alınır; kayıt listede kalır"} onClick={() => onCancel(inv)} testId="ctx-cancel" />
          )}
          {onExpenseSlip && slipable && (
            <Item icon={Receipt} color="text-rose-600" label={inv.expense_slip_number ? `Gider Pusulası: ${inv.expense_slip_number}` : "Gider Pusulası Kes"} sub={inv.expense_slip_number ? "Bu fatura için kesilmiş pusula" : "Aynı cari ve kalemlerle alış pusulası"} onClick={() => onExpenseSlip(inv)} testId="ctx-expense-slip" />
          )}
        </div>
      )}
      <Item icon={Eye} label="Görüntüle" onClick={() => onPreview(inv)} testId="ctx-preview" />
      <Item icon={Printer} label={inv.e_type === "expense_slip" ? "Gider Pusulası Yazdır" : "Şablonlu Yazdır"} onClick={() => onPrint(inv)} testId="ctx-print" />
      <Item icon={MessageSquare} label="SMS / E-posta Gönder" onClick={() => onNotify(inv)} testId="ctx-notify" />
      {copyable && (
        <div className="border-t border-slate-100 mt-1 pt-1" data-testid="ctx-copy-section">
          <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold text-indigo-700">KOPYALA</div>
          {INVOICE_COPY_MODES.map((m) => (
            <Item
              key={m.key}
              icon={Copy}
              color="text-indigo-600"
              label={m.label}
              onClick={() => onCopy(inv, m.key)}
              testId={`ctx-copy-${m.key}`}
            />
          ))}
        </div>
      )}
      {onDispatch && inv.invoice_type === "sales" && (
        <Item icon={Truck} color="text-fuchsia-600" label={inv.dispatch_number ? `İrsaliye: ${inv.dispatch_number}` : "İrsaliye Oluştur"} sub={inv.dispatch_number ? "Bu faturanın irsaliyesi var" : "Sevk irsaliyesi (KDV'siz) düzenle"} onClick={() => onDispatch(inv)} testId="ctx-dispatch" />
      )}
      {inv.payment_status !== "paid" && inv.status !== "cancelled" && <Item icon={DollarSign} color="text-emerald-600" label="Tahsilat / Ödeme Ekle" onClick={() => onPayment(inv)} testId="ctx-payment" />}
      {onInstallments && inv.status !== "cancelled" && (
        <Item icon={CalendarClock} color="text-violet-600" label={inv.installment_plan ? `Taksitler (${inv.installment_plan.paid_count}/${inv.installment_plan.count})` : "Taksitlendir"} sub={inv.installment_plan ? "Planı gör, tahsil et" : "Ödeme planı oluştur"} onClick={() => onInstallments(inv)} testId="ctx-installments" />
      )}
      {(onDelete && deletable) || (onCancel && cancellable && !showIssuedActions) ? (
        <div className="border-t border-slate-100 mt-1 pt-1" data-testid="ctx-danger-actions">
          {onCancel && cancellable && !showIssuedActions && (
            <Item icon={XCircle} color="text-amber-600" label="Faturayı İptal Et" sub={paid ? "Önce tahsilatı / ödemeyi geri alın" : "Cari/stok geri alınır; kayıt listede kalır"} onClick={() => onCancel(inv)} testId="ctx-cancel" />
          )}
          {onDelete && deletable && (
            <Item icon={Trash2} color="text-rose-600" label={inv.status === "draft" ? "Taslağı Sil" : "Kağıt Faturayı Sil"} sub="Çöp kutusuna taşınır (30 gün)" onClick={() => onDelete(inv)} testId="ctx-delete" />
          )}
        </div>
      ) : null}
    </div>
  );
  return createPortal(menuNode, document.body);
};
