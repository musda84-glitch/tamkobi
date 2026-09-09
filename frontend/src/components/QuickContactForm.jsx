
import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { UserPlus, X } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { LegalConsent, allLegalAccepted, emptyLegalConsent, legalPayload } from "./LegalConsent";

const inputCls = "w-full bg-white border border-slate-200 rounded-lg p-2 text-xs focus:ring-2 focus:ring-emerald-500 outline-none";

export const QuickContactForm = ({ companyId, defaultType = "customer", onCreated, onCancel }) => {
  const [f, setF] = useState({ name: "", tax: "", tax_office: "", phone: "", email: "", address: "", type: defaultType });
  const [busy, setBusy] = useState(false);
  const [consent, setConsent] = useState(emptyLegalConsent());
  const save = async () => {
    if (!f.name.trim()) { toast.error("Ünvan / ad soyad zorunlu."); return; }
    if (f.type !== "supplier" && !allLegalAccepted(consent)) { toast.error("Yasal metinleri onaylamadan müşteri kaydı yapılamaz."); return; }
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/contacts`, { company_id: companyId, type: f.type, name: f.name.trim(), tax_number_or_id: f.tax.trim(), tax_office: f.tax_office.trim(), phone: f.phone.trim(), email: f.email.trim(), address: f.address.trim(), city: "İstanbul", category: f.type === "supplier" ? "Tedarikçi" : "Genel", is_e_invoice_user: f.tax.trim().length === 10, kvkk_accepted: f.type !== "supplier", legal_accept: f.type !== "supplier" ? legalPayload(consent) : undefined });
      toast.success(`${r.data.name} carisi oluşturuldu ve seçildi.`);
      onCreated?.(r.data);
    } catch (err) { toast.error(err.response?.data?.detail || "Cari oluşturulamadı."); } finally { setBusy(false); }
  };
  return (
    <div className="border border-emerald-200 bg-emerald-50/50 rounded-xl p-3 space-y-2 text-xs" data-testid="quick-contact-form">
      <div className="flex items-center justify-between"><div className="font-bold text-emerald-800 flex items-center gap-1.5"><UserPlus className="w-4 h-4" /> Yeni Cari (hızlı kayıt)</div><button type="button" onClick={onCancel} className="text-slate-400 hover:text-slate-700" data-testid="qc-cancel"><X className="w-4 h-4" /></button></div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        <input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ünvan / Ad Soyad *" className={`${inputCls} col-span-2`} autoFocus data-testid="qc-name" />
        <select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={inputCls} data-testid="qc-type"><option value="customer">Müşteri</option><option value="supplier">Tedarikçi</option><option value="both">Müşteri & Tedarikçi</option></select>
        <input value={f.tax} onChange={(e) => setF({ ...f, tax: e.target.value })} placeholder="VKN / TCKN" className={inputCls} data-testid="qc-tax" />
        <input value={f.tax_office} onChange={(e) => setF({ ...f, tax_office: e.target.value })} placeholder="Vergi Dairesi" className={inputCls} />
        <input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="Telefon" className={inputCls} data-testid="qc-phone" />
        <input value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="E-posta" className={inputCls} />
        <input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Adres" className={inputCls} />
      </div>
      {f.type !== "supplier" && <LegalConsent value={consent} onChange={setConsent} prefix="qc-" className="bg-white border border-emerald-200 rounded-xl p-2.5" />}
      <div className="flex justify-end gap-2"><button type="button" onClick={onCancel} className="px-3 py-1.5 border rounded-lg bg-white">İptal</button><button type="button" onClick={save} disabled={busy || !f.name.trim() || (f.type !== "supplier" && !allLegalAccepted(consent))} className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="qc-save">{busy ? "Kaydediliyor…" : "Cariyi Kaydet & Seç"}</button></div>
    </div>
  );
};
