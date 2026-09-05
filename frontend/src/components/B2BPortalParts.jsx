import React from "react";
import { ShoppingCart, Truck, Trash2, Building2, X, ExternalLink, PackageCheck, Clock } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";
import { statusTr } from "../utils/labels";

export const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });

export const B2BHeader = ({ company, contact }) => {
  const bal = contact.balance || 0;
  return (
    <header className="bg-slate-900 text-white" data-testid="b2b-header">
      <div className="max-w-6xl mx-auto px-4 py-3 sm:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          {company.logo_url ? <img src={resolveImageUrl(company.logo_url)} alt="" className="h-9 sm:h-10 w-9 sm:w-auto bg-white rounded-lg p-1 object-contain shrink-0" /> : <Building2 className="w-7 h-7 text-slate-400 shrink-0" />}
          <div className="min-w-0"><div className="font-bold leading-tight text-sm sm:text-base truncate">{company.name} <span className="text-[10px] bg-emerald-600 rounded px-1.5 py-0.5 ml-1 align-middle">B2B</span></div><div className="text-[11px] sm:text-xs text-slate-400 truncate">{[company.phone, company.email].filter(Boolean).join(" • ")}</div></div>
        </div>
        <div className="flex items-center justify-between sm:justify-end gap-3 border-t border-white/10 sm:border-0 pt-2 sm:pt-0 text-xs">
          <div className="font-bold text-sm truncate" data-testid="b2b-contact-name">{contact.name}</div>
          <div className="text-right shrink-0"><div className="text-slate-400">Bakiye</div><div className={`font-bold ${bal > 0 ? "text-rose-300" : "text-emerald-300"}`} data-testid="b2b-balance">{fmt(Math.abs(bal))} ₺ {bal > 0 ? "borç" : bal < 0 ? "alacak" : ""}</div>{contact.discount > 0 && <span className="inline-block mt-0.5 bg-emerald-600/30 text-emerald-200 rounded px-1.5 text-[10px]">Size özel %{contact.discount} indirim</span>}</div>
        </div>
      </div>
    </header>
  );
};

export const CartBody = ({ lines, sub, vat, note, setNote, setQty, submit, busy, suffix = "" }) => (
  <>
    {lines.length === 0 && <div className="text-xs text-slate-400 py-6 text-center">Sepetiniz boş.</div>}
    <div className="divide-y text-xs max-h-60 sm:max-h-72 overflow-y-auto">{lines.map((l) => <div key={l.p.id} className="py-2 flex items-center gap-2" data-testid={`b2b-cart-line-${l.p.sku}${suffix}`}><div className="flex-1 min-w-0"><div className="font-semibold truncate">{l.p.name}</div><div className="text-slate-400">{l.qty} × {fmt(l.p.price)} ₺</div></div><b className="whitespace-nowrap">{fmt(l.p.price * l.qty)} ₺</b><button onClick={() => setQty(l.p.id, 0)} className="text-rose-500 p-1.5" aria-label="Kaldır"><Trash2 className="w-4 h-4" /></button></div>)}</div>
    {lines.length > 0 && <>
      <div className="text-xs space-y-1 border-t pt-2"><div className="flex justify-between text-slate-500"><span>Ara Toplam</span><span>{fmt(sub)} ₺</span></div><div className="flex justify-between text-slate-500"><span>KDV</span><span>{fmt(vat)} ₺</span></div><div className="flex justify-between font-black text-base border-t pt-1"><span>Toplam</span><span data-testid={`b2b-cart-total${suffix}`}>{fmt(sub + vat)} ₺</span></div></div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sipariş notu (teslimat, adres…)" className="w-full border rounded-xl p-2.5 text-sm sm:text-xs" data-testid={`b2b-note${suffix}`} />
      <button onClick={submit} disabled={busy} className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold disabled:opacity-50" data-testid={`b2b-submit-order${suffix}`}>{busy ? "Gönderiliyor…" : "Siparişi Gönder"}</button>
    </>}
  </>
);

/* Mobil: alt sabit sepet çubuğu + açılır alt panel */
export const MobileCartBar = ({ lines, total, open, setOpen, children }) => {
  if (lines.length === 0) return null;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  return (
    <>
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-40 p-3 pointer-events-none">
        <button onClick={() => setOpen(true)} className="pointer-events-auto w-full flex items-center justify-between bg-slate-900 text-white rounded-2xl px-4 py-3 shadow-2xl" data-testid="b2b-mobile-cart-bar">
          <span className="flex items-center gap-2 font-bold text-sm"><span className="relative"><ShoppingCart className="w-5 h-5" /><span className="absolute -top-2 -right-2 bg-emerald-500 text-[10px] rounded-full w-4.5 h-4.5 min-w-[18px] px-1 flex items-center justify-center">{count}</span></span> Sepet</span>
          <span className="font-black">{fmt(total)} ₺ <span className="text-xs font-semibold text-emerald-300 ml-1">Siparişe geç →</span></span>
        </button>
      </div>
      {open && (
        <div className="lg:hidden fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-end" onClick={() => setOpen(false)}>
          <div className="bg-white w-full rounded-t-3xl p-4 pb-6 space-y-3 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="b2b-mobile-cart-sheet">
            <div className="flex items-center justify-between"><div className="font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Sepet ({lines.length})</div><button onClick={() => setOpen(false)} className="p-2 text-slate-400" aria-label="Kapat" data-testid="b2b-mobile-cart-close"><X className="w-5 h-5" /></button></div>
            {children}
          </div>
        </div>
      )}
    </>
  );
};

const STEP_LABELS = { created: "Hazırlanıyor", picked_up: "Kargoya Verildi", in_transit: "Yolda", out_for_delivery: "Dağıtımda", delivered: "Teslim Edildi", returned: "İade" };
const fmtDate = (d) => (d ? new Date(d + "T00:00:00").toLocaleDateString("tr-TR", { day: "numeric", month: "short", weekday: "short" }) : "");

export const TrackingCard = ({ t, orderNumber }) => {
  if (!t) return <span className="text-slate-400 text-xs">Kargo bekleniyor</span>;
  const done = t.status === "delivered";
  return (
    <div className={`rounded-xl border p-2.5 text-xs space-y-1.5 ${done ? "bg-emerald-50 border-emerald-200" : t.is_late ? "bg-rose-50 border-rose-200" : "bg-sky-50 border-sky-200"}`} data-testid={`b2b-tracking-${orderNumber}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={`inline-flex items-center gap-1 font-bold ${done ? "text-emerald-700" : t.is_late ? "text-rose-700" : "text-sky-800"}`}>{done ? <PackageCheck className="w-4 h-4" /> : <Truck className="w-4 h-4" />} {STEP_LABELS[t.status] || t.status}{t.carrier ? <span className="font-normal text-slate-500"> · {t.carrier}</span> : null}</span>
        {t.tracking_number && (t.tracking_url ? <a href={t.tracking_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-mono font-semibold text-indigo-700 underline decoration-dotted" data-testid={`b2b-tracking-link-${orderNumber}`}>{t.tracking_number} <ExternalLink className="w-3 h-3" /></a> : <span className="font-mono font-semibold">{t.tracking_number}</span>)}
      </div>
      {t.step >= 0 && <div className="flex items-center gap-1" aria-label="Kargo adımları">{t.steps.map((s, i) => <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= t.step ? (done ? "bg-emerald-500" : "bg-sky-500") : "bg-slate-200"}`} title={STEP_LABELS[s]} />)}</div>}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
        {done ? <span>Teslim: <b>{fmtDate((t.delivered_at || "").slice(0, 10)) || "—"}</b></span> : t.estimated_delivery ? <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" /> Tahmini teslim <b className={t.is_late ? "text-rose-700" : ""} data-testid={`b2b-eta-${orderNumber}`}>{fmtDate(t.estimated_delivery)}</b>{t.is_late ? " (gecikti)" : ""}</span> : null}
        {t.shipped_at && !done && <span>Kargolandı {fmtDate(t.shipped_at)}</span>}
      </div>
    </div>
  );
};

const Th = ({ children, right }) => <th className={`p-3 ${right ? "text-right" : "text-left"}`}>{children}</th>;

export const OrdersList = ({ orders }) => (
  <div className="bg-white rounded-2xl border overflow-hidden" data-testid="b2b-orders">
    {orders.length === 0 && <div className="p-8 text-center text-slate-400 text-xs">Henüz sipariş yok.</div>}
    <div className="md:hidden divide-y">{orders.map((o) => (
      <div key={o.id} className="p-3 text-xs space-y-1" data-testid={`b2b-order-${o.order_number}`}>
        <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{o.order_number}</span><span className="bg-slate-100 px-1.5 py-0.5 rounded font-semibold">{statusTr(o.order_status)}</span></div>
        <div className="text-slate-500">{(o.order_date || "").slice(0, 10)} · {(o.items || []).map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</div>
        <div className="flex items-center justify-between gap-2"><span className="font-bold text-sm">{fmt(o.total_amount)} ₺</span></div>
        <TrackingCard t={o.tracking} orderNumber={o.order_number} />
      </div>))}</div>
    {orders.length > 0 && <table className="hidden md:table w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b"><tr><Th>Sipariş</Th><Th>Tarih</Th><Th>Kalem</Th><Th right>Tutar</Th><Th>Durum</Th><Th>Kargo</Th></tr></thead><tbody className="divide-y">{orders.map((o) => <tr key={o.id}><td className="p-3 font-mono font-bold">{o.order_number}</td><td className="p-3 text-slate-500">{(o.order_date || "").slice(0, 10)}</td><td className="p-3">{(o.items || []).map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td><td className="p-3 text-right font-bold">{fmt(o.total_amount)} ₺</td><td className="p-3"><span className="bg-slate-100 px-1.5 py-0.5 rounded font-semibold">{statusTr(o.order_status)}</span></td><td className="p-3 min-w-[260px]"><TrackingCard t={o.tracking} orderNumber={o.order_number} /></td></tr>)}</tbody></table>}
  </div>
);

const payStatus = (v) => (["paid", "partially_paid", "unpaid", "overdue"].includes(v) ? v : "unpaid");

export const StatementList = ({ invoices, company, balance }) => {
  const bal = balance || 0;
  return (
    <div className="bg-white rounded-2xl border overflow-hidden" data-testid="b2b-statement">
      <div className="p-3 border-b flex flex-col sm:flex-row sm:justify-between gap-1 text-sm"><b>Faturalarım</b><span className="text-xs sm:text-sm">Güncel bakiye: <b className={bal > 0 ? "text-rose-600" : "text-emerald-600"}>{fmt(Math.abs(bal))} ₺ {bal > 0 ? "(borcunuz)" : bal < 0 ? "(alacağınız)" : ""}</b></span></div>
      {invoices.length === 0 && <div className="p-8 text-center text-slate-400 text-xs">Fatura yok.</div>}
      <div className="md:hidden divide-y">{invoices.map((i) => (
        <div key={i.invoice_number} className="p-3 text-xs space-y-1" data-testid={`b2b-invoice-${i.invoice_number}`}>
          <div className="flex items-center justify-between gap-2"><span className="font-mono font-bold">{i.invoice_number}</span><span className={`px-1.5 py-0.5 rounded font-semibold ${payStatus(i.payment_status) === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(payStatus(i.payment_status))}</span></div>
          <div className="text-slate-500">Tarih {i.issue_date}{i.due_date ? ` · Vade ${i.due_date}` : ""}</div>
          <div className="flex items-center justify-between"><span className="font-bold text-sm">{fmt(i.grand_total)} ₺</span><span className="text-slate-500">Ödenen {fmt(i.paid_amount)} ₺{i.grand_total - (i.paid_amount || 0) > 0.01 && <b className="text-rose-600 ml-1">· kalan {fmt(i.grand_total - (i.paid_amount || 0))} ₺</b>}</span></div>
        </div>))}</div>
      {invoices.length > 0 && <table className="hidden md:table w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b"><tr><Th>Fatura</Th><Th>Tarih</Th><Th>Vade</Th><Th right>Tutar</Th><Th right>Ödenen</Th><Th>Durum</Th></tr></thead><tbody className="divide-y">{invoices.map((i) => <tr key={i.invoice_number}><td className="p-3 font-mono font-bold">{i.invoice_number}</td><td className="p-3">{i.issue_date}</td><td className="p-3">{i.due_date || "-"}</td><td className="p-3 text-right font-bold">{fmt(i.grand_total)} ₺</td><td className="p-3 text-right">{fmt(i.paid_amount)} ₺</td><td className="p-3"><span className={`px-1.5 py-0.5 rounded font-semibold ${payStatus(i.payment_status) === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(payStatus(i.payment_status))}</span></td></tr>)}</tbody></table>}
      {company.iban && <div className="p-3 text-xs text-slate-500 border-t break-all">Ödeme için: <b>{company.bank_name}</b> IBAN <span className="font-mono">{company.iban}</span></div>}
    </div>
  );
};
