import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, FileText, Wallet, ShoppingCart, MessageSquare, Send, Loader2, Navigation, Phone, Mail } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { mapsLink } from "./ContactLocationModal";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TABS = [["invoices", "Faturalar", FileText], ["payments", "Ödemeler", Wallet], ["orders", "Siparişler", ShoppingCart], ["comm", "İletişim", MessageSquare]];

export const ContactDetailPanel = ({ contactId, onClose, onMessage }) => {
  const [data, setData] = useState(null);
  const [tab, setTab] = useState("invoices");
  const [busy, setBusy] = useState(null);
  const [orderDetail, setOrderDetail] = useState(null);

  const load = async () => {
    try { const r = await axios.get(`${API_URL}/contacts/${contactId}/overview`); setData(r.data); }
    catch { toast.error("Cari detayı yüklenemedi."); onClose(); }
  };
  useEffect(() => { load(); }, [contactId]);

  const sendToGib = async (inv) => {
    setBusy(inv.id);
    try { const r = await axios.post(`${API_URL}/invoices/${inv.id}/send-to-gib`); toast.success(r.data.message || "E-Fatura GİB'e gönderildi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Gönderilemedi."); } finally { setBusy(null); }
  };

  if (!data) return <div className="fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center"><Loader2 className="w-6 h-6 text-white animate-spin" /></div>;
  const { contact: c, summary: s } = data;

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div className="bg-white w-full max-w-3xl h-full shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()} data-testid="contact-detail-panel">
        <div className="px-6 py-4 border-b flex items-start justify-between gap-3">
          <div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${c.type === "customer" ? "bg-blue-50 text-blue-700" : "bg-amber-50 text-amber-700"}`}>{c.type === "customer" ? "Müşteri" : c.type === "supplier" ? "Tedarikçi" : "Müşteri & Tedarikçi"}</span>
            <h2 className="text-lg font-bold text-slate-900 mt-1">{c.name}</h2>
            <div className="text-xs text-slate-500 flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <span>VKN/TCKN: {c.tax_number_or_id}</span>
              {c.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" /> {c.phone}</span>}
              {c.email && <span className="flex items-center gap-1"><Mail className="w-3 h-3" /> {c.email}</span>}
              {mapsLink(c) && <a href={mapsLink(c)} target="_blank" rel="noreferrer" className="text-rose-600 font-semibold flex items-center gap-1 hover:underline"><Navigation className="w-3 h-3" /> Konum</a>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onMessage?.(c)} className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold" data-testid="detail-message-btn"><MessageSquare className="w-3.5 h-3.5" /> Mesaj</button>
            <button onClick={onClose} className="text-slate-400 hover:text-slate-700" data-testid="close-contact-detail-btn"><X className="w-5 h-5" /></button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-6 py-3 bg-slate-50 border-b text-xs">
          {[["Cari Bakiye", c.balance, c.balance > 0 ? "text-emerald-700" : c.balance < 0 ? "text-rose-700" : "text-slate-700"], ["Toplam Fatura", s.total_invoiced, "text-slate-900"], ["Tahsil Edilen", s.total_paid, "text-emerald-700"], ["Açık Bakiye", s.open_amount, "text-rose-700"]].map(([l, v, cls]) => (
            <div key={l} className="bg-white border border-slate-200 rounded-xl p-2.5" data-testid={`detail-summary-${l}`}><div className="text-[10px] uppercase text-slate-400 font-semibold">{l}</div><div className={`font-bold ${cls}`}>{fmt(v)} ₺</div></div>
          ))}
        </div>

        <div className="flex items-center gap-1 px-6 border-b">
          {TABS.map(([k, l, Icon]) => (
            <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold border-b-2 -mb-px ${tab === k ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500 hover:text-slate-800"}`} data-testid={`detail-tab-${k}`}>
              <Icon className="w-3.5 h-3.5" /> {l} <span className="text-slate-400">({k === "invoices" ? data.invoices.length : k === "payments" ? data.payments.length : k === "orders" ? data.orders.length : data.communications.length})</span>
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-6 text-xs">
          {tab === "invoices" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Fatura No</th><th className="py-2">Tarih</th><th className="py-2">Tür</th><th className="py-2 text-right">Tutar</th><th className="py-2">GİB</th><th className="py-2">Ödeme</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.invoices.length === 0 && <tr><td colSpan={7} className="py-6 text-center text-slate-400">Fatura yok.</td></tr>}
                {data.invoices.map((inv) => (
                  <tr key={inv.id} data-testid={`detail-inv-${inv.invoice_number}`}>
                    <td className="py-2 font-mono font-semibold text-slate-900">{inv.invoice_number}</td>
                    <td className="py-2 text-slate-500">{inv.issue_date}</td>
                    <td className="py-2"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase">{inv.invoice_type === "sales" ? "Satış" : inv.invoice_type === "purchase" ? "Alış" : inv.invoice_type}</span> <span className="text-slate-400">{inv.e_type === "e_invoice" ? "e-Fatura" : inv.e_type === "e_archive" ? "e-Arşiv" : inv.e_type}</span></td>
                    <td className="py-2 text-right font-bold">{fmt(inv.grand_total)} ₺</td>
                    <td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${inv.status === "draft" ? "bg-slate-100 text-slate-600" : "bg-emerald-50 text-emerald-700"}`}>{inv.gib_status || "Taslak"}</span></td>
                    <td className="py-2"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${inv.payment_status === "paid" ? "bg-emerald-100 text-emerald-800" : inv.payment_status === "partially_paid" ? "bg-amber-100 text-amber-800" : "bg-rose-100 text-rose-800"}`}>{inv.payment_status === "paid" ? "Ödendi" : inv.payment_status === "partially_paid" ? "Kısmi" : "Ödenmedi"}</span></td>
                    <td className="py-2 text-right">{inv.status === "draft" && <button onClick={() => sendToGib(inv)} disabled={busy === inv.id} className="inline-flex items-center gap-1 px-2 py-1 bg-emerald-600 text-white rounded-md text-[10px] font-semibold disabled:opacity-50" data-testid={`detail-gib-btn-${inv.invoice_number}`}>{busy === inv.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} E-Faturaya Kes</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {tab === "payments" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Tarih</th><th className="py-2">Hesap</th><th className="py-2">Açıklama</th><th className="py-2 text-right">Tutar</th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.payments.length === 0 && <tr><td colSpan={4} className="py-6 text-center text-slate-400">Ödeme hareketi yok.</td></tr>}
                {data.payments.map((p) => <tr key={p.id}><td className="py-2 font-mono text-slate-500">{p.date}</td><td className="py-2 font-semibold">{p.account_name}</td><td className="py-2 text-slate-600">{p.category} • {p.description}</td><td className={`py-2 text-right font-bold ${p.type === "inflow" ? "text-emerald-600" : "text-rose-600"}`}>{p.type === "inflow" ? "+" : "-"}{fmt(p.amount)} ₺</td></tr>)}
              </tbody>
            </table>
          )}
          {tab === "orders" && (
            <table className="w-full text-left">
              <thead className="text-slate-500 uppercase text-[10px] font-semibold border-b"><tr><th className="py-2">Sipariş</th><th className="py-2">Kanal</th><th className="py-2">Durum</th><th className="py-2">Kargo</th><th className="py-2 text-right">Tutar</th><th className="py-2"></th></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {data.orders.length === 0 && <tr><td colSpan={5} className="py-6 text-center text-slate-400">Sipariş yok.</td></tr>}
                {data.orders.map((o) => <tr key={o.id}><td className="py-2 font-mono font-semibold">{o.order_number}</td><td className="py-2 uppercase text-slate-500">{o.channel}</td><td className="py-2"><span className="bg-slate-100 px-1.5 py-0.5 rounded text-[10px] font-semibold">{o.order_status}</span></td><td className="py-2 font-mono text-slate-500">{o.cargo_tracking_number || "—"}</td><td className="py-2 text-right font-bold">{fmt(o.total_amount)} ₺</td><td className="py-2 text-right"><button onClick={() => setOrderDetail(o)} className="px-2 py-1 bg-slate-900 text-white rounded-md text-[10px] font-semibold" data-testid={`detail-order-btn-${o.order_number}`}>Detay</button></td></tr>)}
              </tbody>
            </table>
          )}
          {tab === "comm" && (
            <div className="space-y-2">
              {data.communications.length === 0 && <div className="py-6 text-center text-slate-400">İletişim geçmişi yok.</div>}
              {data.communications.map((m) => (
                <div key={m.id} className="border border-slate-200 rounded-xl p-3 flex gap-3">
                  <div className={`p-1.5 rounded-lg h-fit ${m.channel === "sms" ? "bg-indigo-50 text-indigo-600" : "bg-emerald-50 text-emerald-600"}`}>{m.channel === "sms" ? <MessageSquare className="w-4 h-4" /> : <Mail className="w-4 h-4" />}</div>
                  <div className="flex-1"><div className="flex justify-between"><b>{m.channel === "sms" ? `SMS → ${m.to}` : m.subject}</b><span className="text-slate-400">{new Date(m.created_at).toLocaleString("tr-TR")}</span></div><p className="text-slate-600 mt-1">{m.message || m.body}</p><span className={`text-[10px] font-semibold ${m.status === "failed" ? "text-rose-600" : "text-emerald-600"}`}>{m.status}</span></div>
                </div>
              ))}
            </div>
          )}
        </div>
        {orderDetail && (
          <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={() => setOrderDetail(null)}>
            <div className="bg-white rounded-2xl max-w-lg w-full p-5 space-y-3 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="order-detail-modal">
              <div className="flex justify-between items-start border-b pb-2"><div><h3 className="text-sm font-bold text-slate-900">Sipariş {orderDetail.order_number}</h3><p className="text-slate-500">{new Date(orderDetail.order_date).toLocaleString("tr-TR")} • {orderDetail.channel?.toUpperCase()} • <b>{orderDetail.order_status}</b></p></div><button onClick={() => setOrderDetail(null)} className="text-slate-400"><X className="w-5 h-5" /></button></div>
              <div className="text-slate-600"><b>Teslimat:</b> {orderDetail.shipping_address}, {orderDetail.city} {orderDetail.customer_phone && `• ${orderDetail.customer_phone}`}</div>
              {orderDetail.cargo_tracking_number && <div className="text-slate-600"><b>Kargo:</b> {orderDetail.cargo_carrier} • <span className="font-mono">{orderDetail.cargo_tracking_number}</span></div>}
              <table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="py-1 text-left">Ürün</th><th className="py-1 text-right">Adet</th><th className="py-1 text-right">Birim</th><th className="py-1 text-right">Toplam</th></tr></thead>
                <tbody className="divide-y divide-slate-100">{(orderDetail.items || []).map((it, i) => <tr key={i}><td className="py-1.5"><div className="font-semibold">{it.product_name}</div><div className="font-mono text-slate-400">{it.sku}</div></td><td className="py-1.5 text-right">{it.quantity}</td><td className="py-1.5 text-right">{fmt(it.unit_price)} ₺</td><td className="py-1.5 text-right font-bold">{fmt(it.total)} ₺</td></tr>)}</tbody></table>
              <div className="flex justify-between border-t pt-2 font-bold"><span>Genel Toplam</span><span>{fmt(orderDetail.total_amount)} ₺</span></div>
              <div className="flex justify-between text-slate-500"><span>Fatura: {orderDetail.is_invoiced ? "Kesildi" : "Kesilmedi"}</span></div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
