import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useParams } from "react-router-dom";
import { ShoppingCart, Package, FileText, Truck, CalendarClock, Loader2, Plus, Minus, Search, CheckCircle2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { fmt, B2BHeader, CartBody, MobileCartBar, OrdersList, StatementList } from "../components/B2BPortalParts";
import { B2BAiCart } from "../components/B2BAiCart";

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
  const [sheet, setSheet] = useState(false);
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
    try { const r = await axios.post(`${API_URL}/public/b2b/${token}/orders`, { items: lines.map((l) => ({ product_id: l.p.id, quantity: l.qty })), note }); setDone(r.data.order); setCart({}); setNote(""); setSheet(false); toast.success(r.data.message); load(); setTab("orders"); window.scrollTo({ top: 0, behavior: "smooth" }); }
    catch (e) { toast.error(e.response?.data?.detail || "Sipariş gönderilemedi."); } finally { setBusy(false); }
  };
  const cartProps = { lines, sub, vat, note, setNote, setQty, submit, busy };
  return (
    <div className="min-h-screen bg-slate-100 pb-24 lg:pb-6" data-testid="b2b-portal">
      <B2BHeader company={d.company} contact={d.contact} />
      <div className="max-w-6xl mx-auto px-3 sm:px-4 py-3 sm:py-4 space-y-3 sm:space-y-4">
        <div className="grid grid-cols-4 sm:flex gap-1 bg-white rounded-xl p-1 border" data-testid="b2b-tabs">{TABS.map(([k, l, Icon]) => <button key={k} onClick={() => setTab(k)} className={`flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 px-1 sm:px-3 py-2 rounded-lg text-[10px] sm:text-xs font-semibold leading-tight ${tab === k ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"}`} data-testid={`b2b-tab-${k}`}><Icon className="w-4 h-4 sm:w-3.5 sm:h-3.5" /><span className="text-center">{l}{k === "orders" && d.orders.length > 0 && ` (${d.orders.length})`}</span></button>)}</div>
        {done && <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 text-xs sm:text-sm text-emerald-800 flex items-start gap-2" data-testid="b2b-order-success"><CheckCircle2 className="w-5 h-5 shrink-0" /><span>Siparişiniz alındı: <b>{done.order_number}</b> — {fmt(done.total_amount)} ₺. Onaylandığında kargo takip numarası burada görünecek.</span></div>}
        {tab === "catalog" && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 space-y-3">
              {d.settings?.allow_orders !== false && d.settings?.allow_ai_cart !== false && <B2BAiCart token={token} products={d.products} onApply={(sel) => { setCart((c) => { const n = { ...c }; sel.forEach((i) => { n[i.product_id] = (n[i.product_id] || 0) + i.quantity; }); return n; }); }} />}
              <div className="space-y-2">
                <div className="relative"><Search className="w-4 h-4 absolute left-3 top-3 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ürün / kod ara…" className="w-full border rounded-xl pl-9 p-2.5 text-sm bg-white" data-testid="b2b-search" /></div>
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-3 px-3 sm:mx-0 sm:px-0 sm:flex-wrap" data-testid="b2b-categories">{cats.map((c) => <button key={c} onClick={() => setCat(c)} className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold border ${cat === c ? "bg-emerald-600 text-white border-emerald-600" : "bg-white text-slate-600"}`}>{c === "all" ? "Tümü" : c}</button>)}</div>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-2.5 sm:gap-3">{prods.map((p) => (
                <div key={p.id} className="bg-white rounded-2xl border p-2.5 sm:p-3 flex flex-col gap-2" data-testid={`b2b-product-${p.sku}`}>
                  <div className="h-24 sm:h-28 bg-slate-50 rounded-xl flex items-center justify-center overflow-hidden">{p.image_url ? <img src={resolveImageUrl(p.image_url)} alt="" className="h-full w-full object-contain" /> : <Package className="w-8 h-8 text-slate-300" />}</div>
                  <div className="min-w-0 flex-1"><div className="text-xs font-bold text-slate-900 leading-tight line-clamp-2">{p.name}</div><div className="text-[10px] text-slate-400 font-mono truncate">{p.sku}</div></div>
                  <div className="flex items-end justify-between gap-1"><div className="min-w-0"><div className="text-sm sm:text-base font-black text-slate-900 whitespace-nowrap">{fmt(p.price)} ₺</div>{p.price < p.list_price && <div className="text-[10px] text-slate-400 line-through">{fmt(p.list_price)} ₺</div>}<div className="text-[10px] text-slate-400">+KDV %{p.vat_rate} • {p.unit}</div></div><span className={`text-[10px] font-semibold shrink-0 ${p.in_stock ? "text-emerald-600" : "text-rose-600"}`}>{p.in_stock ? "Stokta" : "Yok"}</span></div>
                  {cart[p.id] ? <div className="flex items-center justify-between bg-slate-900 text-white rounded-xl p-0.5"><button onClick={() => setQty(p.id, cart[p.id] - 1)} className="p-2.5" aria-label="Azalt" data-testid={`b2b-dec-${p.sku}`}><Minus className="w-4 h-4" /></button><span className="font-bold" data-testid={`b2b-qty-${p.sku}`}>{cart[p.id]}</span><button onClick={() => setQty(p.id, cart[p.id] + 1)} className="p-2.5" aria-label="Artır" data-testid={`b2b-inc-${p.sku}`}><Plus className="w-4 h-4" /></button></div>
                    : <button onClick={() => setQty(p.id, 1)} disabled={!p.in_stock} className="flex items-center justify-center gap-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold disabled:opacity-40" data-testid={`b2b-add-${p.sku}`}><ShoppingCart className="w-3.5 h-3.5" /> Sepete Ekle</button>}
                </div>))}
                {prods.length === 0 && <div className="col-span-full p-8 text-center text-xs text-slate-400">Ürün bulunamadı.</div>}
              </div>
            </div>
            <div className="hidden lg:block bg-white rounded-2xl border p-4 space-y-3 h-fit lg:sticky lg:top-4" data-testid="b2b-cart">
              <div className="font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="w-4 h-4" /> Sepet ({lines.length})</div>
              <CartBody {...cartProps} />
            </div>
          </div>
        )}
        {tab === "orders" && <OrdersList orders={d.orders} />}
        {tab === "statement" && <StatementList invoices={d.invoices} company={d.company} balance={d.contact.balance} />}
        {tab === "installments" && <div className="bg-white rounded-2xl border divide-y text-xs" data-testid="b2b-installments">{d.installments.length === 0 && <div className="p-8 text-center text-slate-400">Bekleyen taksit yok.</div>}{d.installments.map((i) => <div key={i.id} className={`p-3 flex items-center gap-3 ${i.is_overdue ? "bg-rose-50/60" : ""}`}><CalendarClock className={`w-4 h-4 shrink-0 ${i.is_overdue ? "text-rose-600" : "text-slate-400"}`} /><div className="flex-1 min-w-0"><div className="font-semibold truncate">{i.invoice_number} • {i.label}</div><div className="text-slate-500">Vade {i.due_date}{i.is_overdue ? ` — ${-i.days_left} gün gecikti` : ` — ${i.days_left} gün kaldı`}</div></div><b className="text-sm whitespace-nowrap">{fmt(i.amount - (i.paid_amount || 0))} ₺</b></div>)}</div>}
      </div>
      {tab === "catalog" && <MobileCartBar lines={lines} total={sub + vat} open={sheet} setOpen={setSheet}><CartBody {...cartProps} suffix="-mobile" /></MobileCartBar>}
    </div>
  );
}
