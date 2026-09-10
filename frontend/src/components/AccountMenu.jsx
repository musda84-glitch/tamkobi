
import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Building2, ChevronDown, Plus, Settings, UserRound, Wallet, Check, Loader2 } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";

export const AccountMenu = () => {
  const { companies, activeCompany, switchCompany, reloadSession, user, license } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: "", tax_number: "", city: "" });
  const [credits, setCredits] = useState(null);
  const box = useRef(null);
  const cid = activeCompany?.id || activeCompany?._id;
  useEffect(() => {
    const close = (e) => { if (box.current && !box.current.contains(e.target)) { setOpen(false); setAdding(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);
  useEffect(() => {
    if (!cid || !open) return;
    axios.get(`${API_URL}/account/gib-credits`, { params: { company_id: cid } }).then((r) => setCredits(r.data.balance)).catch(() => {});
  }, [cid, open]);
  const mine = (companies || []).filter((c) => c && (c.id || c._id));
  const create = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/license/companies`, { ...form, company_id: cid });
      toast.success(`${r.data.name} hesabınıza eklendi.`);
      setForm({ name: "", tax_number: "", city: "" });
      setAdding(false);
      if (reloadSession) await reloadSession();
      await switchCompany(r.data.id);
      setOpen(false);
      navigate("/hesap?tab=sirketler");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Şirket açılamadı.");
    } finally { setBusy(false); }
  };
  const go = (c) => {
    const id = c.id || c._id;
    if (id !== cid) switchCompany(id);
    setOpen(false);
  };
  const canAdmin = !user?.role || user.role === "admin" || user?.is_super_admin;
  const salesOn = !!license?.gib_credits_sales;
  return (
    <div className="px-3.5 py-3 border-b border-slate-800/60 relative" ref={box} data-testid="account-menu">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full bg-slate-800/80 hover:bg-slate-800 px-3 py-2 rounded-lg text-left flex items-center justify-between border border-slate-700/50 transition text-xs"
        data-testid="company-switcher-dropdown"
      >
        <div className="truncate pr-2 min-w-0">
          <div className="text-[10px] uppercase font-semibold text-emerald-400/80 tracking-wider">Hesap</div>
          <div className="font-medium text-white truncate">{activeCompany?.name || "Şirket seçin"}</div>
        </div>
        <ChevronDown className={`w-4 h-4 text-slate-400 flex-shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-[4.5rem] left-3 right-3 bg-slate-800 border border-slate-700 rounded-xl shadow-xl py-1 z-50 text-xs" data-testid="account-menu-panel">
          <div className="px-3 py-1.5 text-[10px] text-slate-400 font-semibold uppercase">Şirketlerim</div>
          {mine.length === 0 && <div className="px-3 py-2 text-slate-500">Bu hesapta şirket yok.</div>}
          {mine.map((c) => {
            const id = c.id || c._id;
            const on = id === cid;
            return (
              <button key={id} type="button" onClick={() => go(c)} className={`w-full text-left px-3 py-2 hover:bg-slate-700 transition flex items-center justify-between gap-2 ${on ? "text-emerald-400 font-medium bg-slate-700/50" : "text-slate-300"}`} data-testid={`company-opt-${id}`}>
                <span className="truncate flex items-center gap-1.5"><Building2 className="w-3.5 h-3.5 shrink-0 opacity-70" />{c.name}</span>
                {on && <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0" />}
              </button>
            );
          })}
          {canAdmin && !adding && (
            <button type="button" onClick={() => setAdding(true)} className="w-full text-left px-3 py-2 text-emerald-300 hover:bg-slate-700 flex items-center gap-1.5 font-semibold" data-testid="account-add-company">
              <Plus className="w-3.5 h-3.5" /> Yeni şirket aç
            </button>
          )}
          {adding && (
            <form onSubmit={create} className="px-3 py-2 space-y-1.5 border-t border-slate-700" data-testid="account-new-company-form">
              <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ünvan" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white" data-testid="account-new-co-name" />
              <input value={form.tax_number} onChange={(e) => setForm({ ...form, tax_number: e.target.value })} placeholder="VKN" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white" data-testid="account-new-co-tax" />
              <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="Şehir" className="w-full bg-slate-900 border border-slate-600 rounded-lg px-2 py-1.5 text-white" data-testid="account-new-co-city" />
              <div className="flex gap-1.5">
                <button type="submit" disabled={busy} className="flex-1 py-1.5 bg-emerald-600 text-white rounded-lg font-bold disabled:opacity-60 inline-flex items-center justify-center gap-1" data-testid="account-new-co-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Aç</button>
                <button type="button" onClick={() => setAdding(false)} className="px-2 py-1.5 text-slate-400">Vazgeç</button>
              </div>
            </form>
          )}
          <div className="my-1 border-t border-slate-700" />
          {salesOn && (
            <Link to="/hesap?tab=kontor" onClick={() => setOpen(false)} className="flex items-center justify-between px-3 py-2 hover:bg-slate-700 text-slate-200" data-testid="account-go-gib">
              <span className="inline-flex items-center gap-1.5"><Wallet className="w-3.5 h-3.5 text-amber-400" /> GİB Kontör</span>
              <span className="font-bold text-amber-300" data-testid="account-gib-balance">{credits == null ? "…" : `${credits}`}</span>
            </Link>
          )}
          <Link to="/hesap?tab=sirketler" onClick={() => setOpen(false)} className="flex items-center gap-1.5 px-3 py-2 hover:bg-slate-700 text-slate-200" data-testid="account-go-page"><Building2 className="w-3.5 h-3.5" /> Hesabım</Link>
          <Link to="/hesap?tab=profil" onClick={() => setOpen(false)} className="flex items-center gap-1.5 px-3 py-2 hover:bg-slate-700 text-slate-200" data-testid="account-go-profile"><UserRound className="w-3.5 h-3.5" /> Profilim</Link>
          <Link to="/hesap?tab=ayarlar" onClick={() => setOpen(false)} className="flex items-center gap-1.5 px-3 py-2 hover:bg-slate-700 text-slate-200 rounded-b-xl" data-testid="account-go-settings"><Settings className="w-3.5 h-3.5" /> Firma ayarları</Link>
        </div>
      )}
    </div>
  );
};
