import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { Search, UserPlus, ShoppingBag, Users, Package, Receipt, FileText } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { ContactForm } from "./ContactForm";

const money = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 }) + " ₺";

export const HeaderQuickActions = ({ companyId }) => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [res, setRes] = useState(null);
  const [open, setOpen] = useState(false);
  const [newContact, setNewContact] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (q.trim().length < 2) { setRes(null); return undefined; }
    const t = setTimeout(() => axios.get(`${API_URL}/search`, { params: { q, company_id: companyId } }).then((r) => { setRes(r.data); setOpen(true); }).catch(() => {}), 300);
    return () => clearTimeout(t);
  }, [q, companyId]);
  useEffect(() => { const h = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); }; document.addEventListener("mousedown", h); return () => document.removeEventListener("mousedown", h); }, []);
  useEffect(() => { const h = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); box.current?.querySelector("input")?.focus(); } }; window.addEventListener("keydown", h); return () => window.removeEventListener("keydown", h); }, []);
  const go = (path) => { setOpen(false); setQ(""); navigate(path); };
  const groups = res ? [["Cariler", Users, res.contacts, (c) => [c.name, `${c.tax_number_or_id || ""} · ${money(c.balance)}`, `/contacts?contact_id=${c.id}`]], ["Ürünler", Package, res.products, (p) => [p.name, `SKU ${p.sku || "-"} · Stok ${p.stock_quantity ?? "-"} · ${money(p.sale_price)}`, `/stock?q=${encodeURIComponent(p.sku || p.name)}`]], ["Siparişler", ShoppingBag, res.orders, (o) => [o.order_number, `${o.customer_name || ""} · ${money(o.total_amount)}`, `/orders?q=${encodeURIComponent(o.order_number)}`]], ["Faturalar", Receipt, res.invoices, (i) => [i.invoice_number, `${i.contact_name || ""} · ${money(i.grand_total)}`, `/invoices?q=${encodeURIComponent(i.invoice_number)}`]]].filter((g) => g[2]?.length) : [];
  return (
    <div className="flex items-center gap-2" ref={box}>
      <div className="relative hidden md:block">
        <Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" />
        <input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => res && setOpen(true)} placeholder="Ara: cari, ürün, sipariş, fatura… (Ctrl+K)" className="w-56 lg:w-72 bg-slate-100 border border-transparent focus:border-slate-300 focus:bg-white rounded-lg pl-8 pr-2 py-1.5 text-xs focus:outline-none transition-all" data-testid="global-search-input" />
        {open && res && (
          <div className="absolute left-0 top-full mt-1.5 w-[420px] bg-white border border-slate-200 rounded-xl shadow-2xl z-50 max-h-[70vh] overflow-y-auto p-1.5 text-xs" data-testid="global-search-results">
            {groups.length === 0 && <div className="p-4 text-center text-slate-400">Sonuç bulunamadı.</div>}
            {groups.map(([title, Icon, items, fmt]) => (
              <div key={title} className="mb-1">
                <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-slate-400 font-semibold flex items-center gap-1"><Icon className="w-3 h-3" /> {title}</div>
                {items.map((it) => { const [l, sub, path] = fmt(it); return <button key={it.id} onClick={() => go(path)} className="w-full text-left px-2.5 py-1.5 rounded-lg hover:bg-slate-50 flex items-center justify-between gap-2" data-testid={`gs-result-${it.id}`}><span className="font-semibold text-slate-800 truncate">{l}</span><span className="text-[10px] text-slate-400 truncate">{sub}</span></button>; })}
              </div>))}
          </div>
        )}
      </div>
      {can("/contacts", "edit") && <button onClick={() => setNewContact(true)} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition" title="Yeni cari aç" data-testid="quick-new-contact-btn"><UserPlus className="w-4 h-4 md:w-3.5 md:h-3.5 text-blue-600" /><span className="hidden md:inline">Yeni Cari</span></button>}
      {can("/orders", "edit") && <button onClick={() => navigate("/orders?new=1")} className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 px-2 md:px-3 py-1.5 rounded-lg text-xs font-medium transition" title="Yeni sipariş" data-testid="quick-new-order-btn"><FileText className="w-4 h-4 md:w-3.5 md:h-3.5 text-amber-600" /><span className="hidden md:inline">Yeni Sipariş</span></button>}
      {newContact && <ContactForm companyId={companyId} onClose={() => setNewContact(false)} onSaved={(c) => { setNewContact(false); navigate(`/contacts?contact_id=${c.id}`); }} />}
    </div>
  );
};
