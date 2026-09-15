import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { API_URL, useAuth } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";
import { statusTr } from "../utils/labels";
import { lineFromProduct } from "../utils/documentLines";
import { ScanButton } from "../components/CameraScanner";

import {
  Smartphone, Search, Plus, Minus, Trash2, UserPlus, Maximize2, Minimize2,
  RefreshCw, Package, ShoppingCart, CheckCircle2, MapPin, Phone, X,
} from "lucide-react";

const fmt = (n) => (Number(n) || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const pid = (p) => p?.id || p?._id || "";

export default function FieldSalesPage() {
  const { activeCompany, user, can } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const canEdit = can("/saha", "edit");

  const [contacts, setContacts] = useState([]);
  const [products, setProducts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [custQ, setCustQ] = useState("");
  const [prodQ, setProdQ] = useState("");
  const [barcode, setBarcode] = useState("");
  const [customer, setCustomer] = useState(null);
  const [newCust, setNewCust] = useState(null);
  const [cart, setCart] = useState([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [kiosk, setKiosk] = useState(false);
  const [showCart, setShowCart] = useState(false);

  const load = useCallback(async () => {
    try {
      const [c, p, o] = await Promise.all([
        axios.get(`${API_URL}/contacts?company_id=${companyId}`),
        axios.get(`${API_URL}/products?company_id=${companyId}`),
        axios.get(`${API_URL}/orders?company_id=${companyId}`),
      ]);
      setContacts((c.data || []).filter((x) => !x.type || ["customer", "both"].includes(x.type)));
      setProducts((p.data || []).filter((x) => x.is_active !== false && x.type !== "raw_material"));
      setOrders(o.data || []);
    } catch {
      toast.error("Saha verileri yüklenemedi.");
    }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);

  const custHits = useMemo(() => {
    const q = custQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return contacts.filter((c) =>
      [c.name, c.phone, c.tax_number_or_id, c.city, c.email].some((v) => String(v || "").toLowerCase().includes(q))
    ).slice(0, 12);
  }, [contacts, custQ]);

  const prodHits = useMemo(() => {
    const q = prodQ.trim().toLowerCase();
    if (q.length < 2) return [];
    return products.filter((p) =>
      [p.name, p.sku, p.barcode, p.category].some((v) => String(v || "").toLowerCase().includes(q))
    ).slice(0, 16);
  }, [products, prodQ]);

  const todayOrders = useMemo(() => {
    const day = new Date().toISOString().slice(0, 10);
    return orders.filter((o) => o.channel === "saha" && String(o.order_date || "").slice(0, 10) === day).slice(0, 12);
  }, [orders]);

  const total = cart.reduce((s, it) => {
    const qty = Number(it.quantity) || 0;
    const unitIncl = Number(it.unit_price_incl);
    if (Number.isFinite(unitIncl) && unitIncl) return s + unitIncl * qty;
    const net = qty * (Number(it.unit_price) || 0);
    const rate = Number(it.vat_rate) || 0;
    return s + (rate ? net * (1 + rate / 100) : net);
  }, 0);
  const count = cart.reduce((s, it) => s + (Number(it.quantity) || 0), 0);

  const addProduct = (p, qty = 1) => {
    const id = pid(p);
    if (!id && !p.name) return;
    setCart((prev) => {
      const i = prev.findIndex((x) => x.product_id === id && id);
      if (i >= 0) {
        const next = [...prev];
        const quantity = Number(next[i].quantity) + qty;
        const unit = Number(next[i].unit_price) || 0;
        const rate = Number(next[i].vat_rate) || 0;
        const total = Math.round(quantity * unit * 100) / 100;
        const vat_amount = Math.round(total * rate / 100 * 100) / 100;
        next[i] = {
          ...next[i],
          quantity,
          total,
          vat_amount,
          total_incl: Math.round((total + vat_amount) * 100) / 100,
        };
        return next;
      }
      const line = lineFromProduct(p, { invoiceType: "sales", quantity: qty });
      return [...prev, {
        product_id: id, product_name: p.name, sku: p.sku || "", barcode: p.barcode || "",
        quantity: qty,
        unit_price: Number(line.unit_price) || 0,
        unit_price_incl: Number(line.unit_price_incl) || 0,
        vat_rate: Number(line.vat_rate) || 0,
        total: Number(line.total) || 0,
        total_incl: Number(line.total_incl) || 0,
        vat_amount: Number(line.vat_amount) || 0,
        image_url: p.image_url, stock_quantity: p.stock_quantity,
      }];
    });
    toast.success(`${p.name} sepete eklendi`);
  };
  const setQty = (i, q) => setCart((prev) => prev.map((it, k) => {
    if (k !== i) return it;
    const quantity = Math.max(1, Number(q) || 1);
    const unit = Number(it.unit_price) || 0;
    const rate = Number(it.vat_rate) || 0;
    const total = Math.round(quantity * unit * 100) / 100;
    const vat_amount = Math.round(total * rate / 100 * 100) / 100;
    return {
      ...it,
      quantity,
      total,
      vat_amount,
      total_incl: Math.round((total + vat_amount) * 100) / 100,
      unit_price_incl: Math.round(unit * (1 + rate / 100) * 10000) / 10000,
    };
  }));
  const removeLine = (i) => setCart((prev) => prev.filter((_, k) => k !== i));

  const scanBarcode = async (code) => {
    const raw = (code || barcode).trim();
    if (!raw) return;
    setBarcode("");
    const local = products.find((p) => p.barcode === raw || p.sku === raw || (p.variants || []).some((v) => v.barcode === raw));
    if (local) { addProduct(local); return; }
    try {
      const r = await axios.get(`${API_URL}/products/barcode/${encodeURIComponent(raw)}?company_id=${companyId}`);
      addProduct(r.data);
    } catch {
      toast.error("Barkod ile ürün bulunamadı.");
    }
  };

  const pickContact = (c) => {
    setCustomer(c);
    setCustQ("");
    setNewCust(null);
  };

  const saveQuickContact = async () => {
    const name = (newCust?.name || "").trim();
    if (!name) { toast.error("Müşteri adı gerekli."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/contacts`, {
        company_id: companyId, type: "customer", name, phone: newCust.phone || "",
        city: newCust.city || "", address: newCust.address || "", tax_number_or_id: "11111111111",
        category: "Saha Müşterisi",
      });
      setContacts((list) => [r.data, ...list]);
      pickContact(r.data);
      toast.success("Cari açıldı.");
    } catch (e) {
      toast.error(e.response?.data?.detail || "Cari açılamadı.");
    } finally { setBusy(false); }
  };

  const submit = async () => {
    if (!canEdit) { toast.error("Sipariş oluşturma yetkiniz yok."); return; }
    const name = (customer?.name || newCust?.name || "").trim();
    if (!name) { toast.error("Önce müşteri seçin veya yeni cari açın."); return; }
    if (!cart.length) { toast.error("Sepete en az bir ürün ekleyin."); return; }
    setBusy(true);
    try {
      const items = cart.map((it) => {
        const quantity = Number(it.quantity) || 0;
        const unit_price = Number(it.unit_price) || 0;
        const vat_rate = Number(it.vat_rate) || 0;
        const total = Math.round(quantity * unit_price * 100) / 100;
        const vat_amount = Math.round(total * vat_rate / 100 * 100) / 100;
        return {
          product_id: it.product_id || "", product_name: it.product_name, sku: it.sku || "",
          quantity, unit_price, unit_price_incl: Number(it.unit_price_incl) || Math.round(unit_price * (1 + vat_rate / 100) * 10000) / 10000,
          vat_rate, total, vat_amount, total_incl: Math.round((total + vat_amount) * 100) / 100,
        };
      });
      const r = await axios.post(`${API_URL}/orders`, {
        company_id: companyId, channel: "saha", order_status: "pending",
        customer_name: name, customer_phone: customer?.phone || newCust?.phone || "",
        customer_email: customer?.email || "",
        shipping_address: customer?.address || newCust?.address || "-",
        city: customer?.city || newCust?.city || "-",
        contact_id: pid(customer) || null, notes,
        salesperson_name: user?.name || "",
        items, total_amount: total,
      });
      toast.success(`Sipariş alındı: ${r.data.order_number}`);
      setCart([]); setNotes(""); setCustomer(null); setNewCust(null); setShowCart(false);
      load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Sipariş kaydedilemedi.");
    } finally { setBusy(false); }
  };

  const shell = kiosk ? "fixed inset-0 z-[100] bg-slate-100 overflow-y-auto p-3 sm:p-5" : "space-y-4";

  return (
    <div className={shell} data-testid="field-sales-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Smartphone className="w-6 h-6 text-emerald-600" /> Saha Sipariş
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">Tablette veya telefonda cari seçin, ürün tarayın, siparişi anında alın.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={load} className="p-3 bg-white border-2 border-slate-200 rounded-xl min-h-12 min-w-12" data-testid="saha-refresh" title="Yenile"><RefreshCw className="w-5 h-5" /></button>
          <button onClick={() => setKiosk(!kiosk)} className="flex items-center gap-2 px-4 py-3 bg-slate-900 text-white rounded-xl font-semibold min-h-12" data-testid="saha-kiosk">
            {kiosk ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />} {kiosk ? "Çık" : "Tablet Modu"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="font-bold text-slate-900">1. Müşteri</div>
          <button onClick={() => { setNewCust({ name: "", phone: "", city: "", address: "" }); setCustomer(null); }} className="text-sm font-semibold text-emerald-700 flex items-center gap-1 min-h-11 px-2" data-testid="saha-new-customer">
            <UserPlus className="w-4 h-4" /> Yeni cari
          </button>
        </div>
        {customer ? (
          <div className="flex items-start justify-between gap-3 bg-emerald-50 border border-emerald-200 rounded-xl p-3" data-testid="saha-selected-customer">
            <div className="min-w-0">
              <div className="font-bold text-slate-900 truncate">{customer.name}</div>
              <div className="text-xs text-slate-600 flex flex-wrap gap-x-3 gap-y-1 mt-1">
                {customer.phone && <span className="flex items-center gap-1"><Phone className="w-3.5 h-3.5" />{customer.phone}</span>}
                {(customer.city || customer.address) && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{[customer.city, customer.address].filter(Boolean).join(" · ")}</span>}
              </div>
            </div>
            <button onClick={() => setCustomer(null)} className="p-2 rounded-lg hover:bg-white" data-testid="saha-clear-customer"><X className="w-4 h-4" /></button>
          </div>
        ) : newCust ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2" data-testid="saha-quick-customer">
            <input value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} placeholder="Unvan / ad *" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm min-h-12" data-testid="saha-new-name" />
            <input value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} placeholder="Telefon" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm min-h-12" data-testid="saha-new-phone" />
            <input value={newCust.city} onChange={(e) => setNewCust({ ...newCust, city: e.target.value })} placeholder="İl" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm min-h-12" data-testid="saha-new-city" />
            <input value={newCust.address} onChange={(e) => setNewCust({ ...newCust, address: e.target.value })} placeholder="Adres" className="bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-sm min-h-12" data-testid="saha-new-address" />
            <div className="sm:col-span-2 flex gap-2">
              <button onClick={saveQuickContact} disabled={busy} className="flex-1 py-3 bg-emerald-600 text-white rounded-xl font-bold min-h-12" data-testid="saha-save-customer">Cariyi kaydet</button>
              <button onClick={() => setNewCust(null)} className="px-4 py-3 border rounded-xl min-h-12">Vazgeç</button>
            </div>
          </div>
        ) : (
          <div>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Cari adı, telefon veya VKN ara…" className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-base min-h-12" data-testid="saha-customer-search" />
            </div>
            {custHits.length > 0 && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2">
                {custHits.map((c) => (
                  <button key={pid(c)} type="button" onClick={() => pickContact(c)} className="text-left bg-slate-50 hover:bg-emerald-50 border border-slate-200 rounded-xl p-3 min-h-14" data-testid={`saha-customer-${pid(c)}`}>
                    <div className="font-semibold text-slate-900 truncate">{c.name}</div>
                    <div className="text-xs text-slate-500 truncate">{[c.phone, c.city].filter(Boolean).join(" · ")}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3 bg-white border border-slate-200 rounded-2xl p-4 space-y-3">
          <div className="font-bold text-slate-900">2. Ürün ekle</div>
          <form onSubmit={(e) => { e.preventDefault(); scanBarcode(); }} className="flex gap-2">
            <input value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="Barkod oku veya yaz, Enter" className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-3 text-base min-h-12 font-mono" data-testid="saha-barcode" inputMode="numeric" />
            <ScanButton size="md" label="Kamera" title="Kamera ile barkod / QR okut" onScan={(code) => { setBarcode(code); scanBarcode(code); }} />
            <button type="submit" className="px-4 py-3 bg-indigo-600 text-white rounded-xl font-semibold min-h-12" data-testid="saha-barcode-go">Ekle</button>
          </form>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input value={prodQ} onChange={(e) => setProdQ(e.target.value)} placeholder="Ürün adı veya SKU ara…" className="w-full bg-slate-50 border border-slate-200 rounded-xl pl-10 pr-3 py-3 text-base min-h-12" data-testid="saha-product-search" />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-[52vh] overflow-y-auto">
            {prodHits.map((p) => (
              <button key={pid(p)} type="button" onClick={() => addProduct(p)} className="text-left flex gap-3 bg-slate-50 hover:bg-indigo-50 border border-slate-200 rounded-xl p-3 min-h-16" data-testid={`saha-product-${pid(p)}`}>
                {resolveImageUrl(p.image_url) ? <img src={resolveImageUrl(p.image_url)} alt="" className="w-14 h-14 rounded-lg object-cover bg-white border shrink-0" /> : <div className="w-14 h-14 rounded-lg border bg-white flex items-center justify-center text-slate-300 shrink-0"><Package className="w-6 h-6" /></div>}
                <div className="min-w-0 flex-1">
                  <div className="font-semibold text-slate-900 truncate">{p.name}</div>
                  <div className="text-[11px] text-slate-500 truncate">{p.sku || p.barcode || "—"} · stok {p.stock_quantity ?? "—"}</div>
                  <div className="font-bold text-slate-900">{fmt(p.sale_price)} ₺</div>
                </div>
              </button>
            ))}
            {prodQ.trim().length >= 2 && !prodHits.length && <div className="col-span-full text-sm text-slate-500 py-6 text-center">Ürün bulunamadı.</div>}
            {prodQ.trim().length < 2 && <div className="col-span-full text-sm text-slate-400 py-4 text-center">Aramak için en az 2 karakter yazın veya barkod okutun.</div>}
          </div>
        </div>

        <div className={`lg:col-span-2 bg-white border border-slate-200 rounded-2xl p-4 space-y-3 ${showCart ? "" : "hidden lg:block"}`} data-testid="saha-cart">
          <div className="flex items-center justify-between">
            <div className="font-bold text-slate-900 flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> Sepet ({count})</div>
            <button className="lg:hidden p-2" onClick={() => setShowCart(false)}><X className="w-4 h-4" /></button>
          </div>
          {!cart.length && <div className="text-sm text-slate-400 text-center py-8">Henüz ürün yok.</div>}
          <div className="space-y-2 max-h-[40vh] overflow-y-auto">
            {cart.map((it, i) => (
              <div key={`${it.product_id}-${i}`} className="border border-slate-100 rounded-xl p-2.5" data-testid={`saha-cart-line-${i}`}>
                <div className="flex justify-between gap-2">
                  <div className="font-semibold text-sm text-slate-900 truncate">{it.product_name}</div>
                  <button onClick={() => removeLine(i)} className="p-2 text-rose-500" data-testid={`saha-cart-remove-${i}`}><Trash2 className="w-4 h-4" /></button>
                </div>
                <div className="flex items-center justify-between mt-1">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setQty(i, it.quantity - 1)} className="w-11 h-11 rounded-xl border bg-slate-50 flex items-center justify-center" data-testid={`saha-qty-minus-${i}`}><Minus className="w-4 h-4" /></button>
                    <input type="number" min="1" value={it.quantity} onChange={(e) => setQty(i, e.target.value)} className="w-14 text-center border rounded-xl py-2 font-bold min-h-11" data-testid={`saha-qty-${i}`} />
                    <button onClick={() => setQty(i, it.quantity + 1)} className="w-11 h-11 rounded-xl border bg-slate-50 flex items-center justify-center" data-testid={`saha-qty-plus-${i}`}><Plus className="w-4 h-4" /></button>
                  </div>
                  <div className="font-bold">{fmt((Number(it.unit_price_incl) || Number(it.unit_price) * (1 + (Number(it.vat_rate) || 0) / 100) || 0) * Number(it.quantity))} ₺</div>
                </div>
              </div>
            ))}
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Sipariş notu (teslim, vade, özel istek)" className="w-full bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm" data-testid="saha-notes" />
          <div className="flex items-center justify-between text-lg font-bold"><span>Toplam</span><span data-testid="saha-total">{fmt(total)} ₺</span></div>
          <button onClick={submit} disabled={busy || !canEdit} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-base min-h-14 disabled:opacity-50 flex items-center justify-center gap-2" data-testid="saha-submit">
            <CheckCircle2 className="w-5 h-5" /> {busy ? "Kaydediliyor…" : "Siparişi Al"}
          </button>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-4">
        <div className="font-bold text-slate-900 mb-3">Bugünkü saha siparişleri</div>
        {!todayOrders.length && <div className="text-sm text-slate-400">Henüz saha siparişi yok.</div>}
        <div className="space-y-2">
          {todayOrders.map((o) => (
            <div key={o.id || o._id} className="flex items-center justify-between gap-3 border border-slate-100 rounded-xl p-3" data-testid={`saha-today-${o.order_number}`}>
              <div className="min-w-0">
                <div className="font-mono text-xs text-slate-400">{o.order_number}</div>
                <div className="font-semibold truncate">{o.customer_name}</div>
                <div className="text-xs text-slate-500">{(o.items || []).length} kalem · {statusTr(o.order_status)}</div>
              </div>
              <div className="font-bold shrink-0">{fmt(o.total_amount)} ₺</div>
            </div>
          ))}
        </div>
      </div>

      <div className="lg:hidden h-20" />
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white/95 backdrop-blur border-t p-3 flex items-center gap-3">
        <button onClick={() => setShowCart(true)} className="flex-1 flex items-center justify-between bg-slate-900 text-white rounded-2xl px-4 py-3 min-h-14 font-bold" data-testid="saha-mobile-cart">
          <span className="flex items-center gap-2"><ShoppingCart className="w-5 h-5" /> Sepet ({count})</span>
          <span>{fmt(total)} ₺</span>
        </button>
      </div>
    </div>
  );
}
