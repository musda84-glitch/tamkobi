import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useParams } from "react-router-dom";
import { ShoppingCart, Package, FileText, Truck, CalendarClock, Loader2, Plus, Minus, Trash2, Building2, Search, CheckCircle2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { statusTr } from "../utils/labels";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const TABS = [["catalog", "Ürünler", Package], ["orders", "Siparişlerim", Truck], ["statement", "Hesap Ekstresi", FileText], ["installments", "Taksitlerim", CalendarClock]];

export default function B2BPortalPage() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [err, setErr] = useState("");
  const [tab, setTab] = useState("catalog");
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [cart, setCart] = useState(() => { try { return JSON.parse(localStorage.getItem(`b2b_cart_${token}`) || "{}"); } catch { return {}; } });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/public/b2b/${token}`).then((r) => setD(r.data)).catch((e) => setErr(e.response?.data?.detail || "Portal yüklenemedi.")), [token]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { localStorage.setItem(`b2b_cart_${token}`, JSON.stringify(cart)); }, [cart, token]);
  if (err) return <div className="min-h-screen flex items-center justify-center bg-slate-100 p-6"><div className="bg-white rounded-2xl p-8 shadow-xl text-center font-bold text-slate-800" data-testid="b2b-error">{err}</div></div>;
  if (!d) return <div className="min-h-screen flex items-center justify-center bg-slate-100"><Loader2 className="w-6 h-6 animate-spin text-slate-500" /></div>;
  const cats = ["all", ...Array.from(new Set(d.products.map((p) => p.category).filter(Boolean)))];
  const prods = d.products.filter((p) => (cat === "all" || p.category === cat) && (p.name.toLowerCase().includes(q.toLowerCase()) || (p.sku || "").toLowerCase().includes(q.toLowerCase())));
  const lines = Object.entries(cart).map(([id, qty]) => ({ p: d.products.find((x) => x.id === id), qty })).filter((l) => l.p && l.qty > 0);
  const sub = lines.reduce((s, l) => s + l.p.price * l.qty, 0);
  const vat = lines.reduce((s, l) => s + l.p.price * l.qty * (l.p.vat_rate || 20) / 100, 0);
  const setQty = (id, qty) => setCart((c) => { const n = { ...c }; if (qty <= 0) delete n[id]; else n[id] = qty; return n; });
  const submit = async () => {
    setBusy(true);
    try { const r = await axios.post(`${API_URL}/public/b2b/${token}/orders`, { items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty })), note }); setDone(r.data.order); setCart({}); setNote(""); toast.success(r.data.message); load(); setTab("orders"); }
    catch (e) { toast.error(e.response?.data?.detail || "Sipariş gönderilemedi."); } finally { setBusy(false); }
  };
  const bal = d.contact.balance || 0;
  return (
    <div className="min-h-screen bg-slate-100" data-testid="b2b-portal">
      <header className="bg-slate-900 text-white"><div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">{d.company.logo_url ? <img src={resolveImageUrl(d.company.logo_url)} alt="" className="h-10 bg-white rounded-lg p-1 object-contain" /> : <Building2 className="w-7 h-7 text-slate-400" />}<div><div className="font-bold leading-tight">{d.company.name} <span className="text-[10px] bg-emerald-600 rounded px-1.5 py-0.5 ml-1 align-middle">B2B</span></div><div className="text-xs text-slate-400">{d.company.phone} • {d.company.email}</div></div></div>
        <div className="text-right text-xs"><div className="font-bold text-sm">{d.contact.name}</div><div className="text-slate-400">Bakiye: <b className={bal > 0 ? "text-rose-300" : "text-emerald-300"}>{fmt(Math.abs(bal))} ₺ {bal > 0 ? "borç" : bal < 0 ? "alacak" : ""}</b>{d.contact.discount > 0 && <span className="ml-2 bg-emerald-600/30 text-emerald-200 rounded px-1.5">Size özel %{d.contact.discount} indirim</span>}</div></div>
      </div></header>
      <div className="max-w-6xl mx-auto px-4 py-4 space-y-4">
        <div className="flex gap-1 bg-white rounded-xl p-1 border overflow-x-auto">{TABS.map(([k, l, Icon]) => <button key={k} onClick={() => setTab(k)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`b2b-tab-${k}`}><Icon className="w-3.5 h-3.5" /> {l}{k === "orders" && d.orders.length > 0 && ` (${d.orders.length})`}</button>)}</div>
        {done && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-sm text-emerald-800 flex items-center gap-2" data-testid="b2b-order-done"><CheckCircle2 className="w-5 h-5" /> Siparişiniz alındı: <b>{done.order_number}</b> — {fmt(done.total_amount)} ₺. Onaylandığında kargo takip numarası burada görünecek.</div>}
        {tab === "catalog" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              <div className="flex flex-wrap gap-2 items-center"><div className="relative flex-1 min-w-[200px]"><Search className="w-4 h-4 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün / kod ara…" className="w-full border rounded-xl pl-8 p-2 text-sm bg-white" data-testid="b2b-search" /></div>{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`px-2.5 py-1.5 rounded-lg text-xs font-semibold border ${cat === c ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600"}`}>{c === "all" ? "Tümü" : c}</button>)}</div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">{prods.map((p) => (
                <div key={p.id} className="bg-white rounded-2xl border p-3 flex flex-col gap-2" data-testid={`b2b-product-${p.sku}`}>
                  <div className="h-28 bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden">{p.image_url ? <img src={resolveImageUrl(p.image_url)} alt="" className="h-full w-full object-contain" /> : <Package className="w-8 h-8 text-slate-300" />}</div>
                  <div className="min-w-0"><div className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</div><div className="text-[10px] text-slate-400 font-mono">{p.sku}</div></div>
                  <div className="flex items-end justify-between"><div><div className="text-base font-black text-slate-900">{fmt(p.price)} ₺</div>{p.price < p.list_price && <div className="text-[10px] text-slate-400 line-through">{fmt(p.list_price)} ₺</div>}<div className="text-[10px] text-slate-400">+KDV %{p.vat_rate} • {p.unit}</div></div><span className={`text-[10px] font-semibold ${p.in_stock ? "text-emerald-600" : "text-rose-600"}`}>{p.in_stock ? "Stokta" : "Stokta yok"}</span></div>
                  {cart[p.id] ? <div className="flex items-center justify-between bg-slate-900 text-white rounded-xl p-1"><button onClick={() => setQty(p.id, cart[p.id] - 1)} className="p-1.5" data-testid={`b2b-dec-${p.sku}`}><Minus className="w-4 h-4" /></button><span className="font-bold">{cart[p.id]}</span><button onClick={() => setQty(p.id, cart[p.id] + 1)} className="p-1.5" data-testid={`b2b-inc-${p.sku}`}><Plus className="w-4 h-4" /></button></div>
                    : <button onClick={() => setQty(p.id, 1)} disabled={!p.in_stock} className="flex items-center justify-center gap-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40" data-testid={`b2b-add-${p.sku}`}><ShoppingCart className="w-3.5 h-3.5" /> Sepete Ekle</button>}
                </div>))}</div>
            </div>
            <div className="bg-white rounded-2xl border p-4 space-y-3 h-fit lg:sticky lg:top-4" data-testid="b2b-cart">
              <div className="font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Sepet ({lines.length})</div>
              {lines.length === 0 && <div className="text-xs text-slate-400 py-6 text-center">Sepetiniz boş.</div>}
              <div className="divide-y text-xs max-h-72 overflow-y-auto">{lines.map((l) => <div key={l.p.id} className="py-2 flex items-center gap-2"><div className="flex-1 min-w-0"><div className="font-semibold truncate">{l.p.name}</div><div className="text-slate-400">{l.qty} × {fmt(l.p.price)} ₺</div></div><b>{fmt(l.p.price * l.qty)} ₺</b><button onClick={() => setQty(l.p.id, 0)} className="text-rose-500 p-1"><Trash2 className="w-3.5 h-3.5" /></button></div>)}</div>
              {lines.length > 0 && <>
                <div className="text-xs space-y-1 border-t pt-2"><div className="flex justify-between text-slate-500"><span>Ara Toplam</span><span>{fmt(sub)} ₺</span></div><div className="flex justify-between text-slate-500"><span>KDV</span><span>{fmt(vat)} ₺</span></div><div className="flex justify-between font-black text-base border-t pt-1"><span>Toplam</span><span data-testid="b2b-cart-total">{fmt(sub + vat)} ₺</span></div></div>
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Sipariş notu (teslimat, adres…)" className="w-full border rounded-xl p-2 text-xs" data-testid="b2b-note" />
                <button onClick={submit} disabled={busy} className="w-full py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-bold disabled:opacity-50" data-testid="b2b-submit-order">{busy ? "Gönderiliyor…" : "Siparişi Gönder"}</button>
              </>}
            </div>
          </div>
        )}
        {tab === "orders" && <div className="bg-white rounded-2xl border overflow-x-auto"><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left p-3">Sipariş</th><th className="text-left p-3">Tarih</th><th className="text-left p-3">Kalem</th><th className="text-right p-3">Tutar</th><th className="text-left p-3">Durum</th><th className="text-left p-3">Kargo</th></tr></thead><tbody className="divide-y">{d.orders.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-slate-400">Henüz sipariş yok.</td></tr>}{d.orders.map((o) => <tr key={o.id} data-testid={`b2b-order-${o.order_number}`}><td className="p-3 font-mono font-bold">{o.order_number}</td><td className="p-3 text-slate-500">{(o.order_date || "").slice(0, 10)}</td><td className="p-3">{(o.items || []).map((i) => `${i.quantity}× ${i.product_name}`).join(", ")}</td><td className="p-3 text-right font-bold">{fmt(o.total_amount)} ₺</td><td className="p-3"><span className="bg-slate-100 px-1.5 py-0.5 rounded font-semibold">{statusTr(o.order_status)}</span></td><td className="p-3">{o.cargo_tracking_number ? <span className="flex items-center gap-1 text-emerald-700 font-semibold"><Truck className="w-3.5 h-3.5" /> {o.cargo_carrier} • {o.cargo_tracking_number}</span> : <span className="text-slate-400">—</span>}</td></tr>)}</tbody></table></div>}
        {tab === "statement" && <div className="bg-white rounded-2xl border overflow-x-auto"><div className="p-3 border-b flex justify-between text-sm"><b>Faturalarım</b><span>Güncel bakiye: <b className={bal > 0 ? "text-rose-600" : "text-emerald-600"}>{fmt(Math.abs(bal))} ₺ {bal > 0 ? "(borcunuz)" : bal < 0 ? "(alacağınız)" : ""}</b></span></div><table className="w-full text-xs"><thead className="bg-slate-50 text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left p-3">Fatura</th><th className="text-left p-3">Tarih</th><th className="text-left p-3">Vade</th><th className="text-right p-3">Tutar</th><th className="text-right p-3">Ödenen</th><th className="text-left p-3">Durum</th></tr></thead><tbody className="divide-y">{d.invoices.map((i) => <tr key={i.invoice_number}><td className="p-3 font-mono font-bold">{i.invoice_number}</td><td className="p-3">{i.issue_date}</td><td className="p-3">{i.due_date || "-"}</td><td className="p-3 text-right font-bold">{fmt(i.grand_total)} ₺</td><td className="p-3 text-right">{fmt(i.paid_amount)} ₺</td><td className="p-3"><span className={`px-1.5 py-0.5 rounded font-semibold ${i.payment_status === "paid" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{statusTr(i.payment_status)}</span></td></tr>)}</tbody></table>{d.company.iban && <div className="p-3 text-xs text-slate-500 border-t">Ödeme için: <b>{d.company.bank_name}</b> IBAN <span className="font-mono">{d.company.iban}</span></div>}</div>}
        {tab === "installments" && <div className="bg-white rounded-2xl border divide-y text-xs">{d.installments.length === 0 && <div className="p-8 text-center text-slate-400">Bekleyen taksit yok.</div>}{d.installments.map((i) => <div key={i.id} className={`p-3 flex items-center gap-3 ${i.is_overdue ? "bg-rose-50/60" : ""}`}><CalendarClock className={`w-4 h-4 ${i.is_overdue ? "text-rose-600" : "text-slate-400"}`} /><div className="flex-1"><div className="font-semibold">{i.invoice_number} • {i.label}</div><div className="text-slate-500">Vade {i.due_date}{i.is_overdue ? ` — ${-i.days_left} gün gecikti` : ` — ${i.days_left} gün kaldı`}</div></div><b className="text-sm">{fmt(i.amount - (i.paid_amount || 0))} ₺</b></div>)}</div>}
      </div>
    </div>
  );
}
