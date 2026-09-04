import React, { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Search, Loader2, UserPlus, ShieldCheck, FlaskConical } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const GibContactLookup = ({ companyId, onSelect }) => {
  const [taxId, setTaxId] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [draft, setDraft] = useState({ name: "", tax_office: "" });

  const lookup = async () => {
    setBusy(true);
    try {
      const r = await axios.get(`${API_URL}/gib/lookup?tax_id=${encodeURIComponent(taxId)}&company_id=${companyId}`);
      setRes(r.data);
      if (r.data.local_contact) { onSelect(r.data.local_contact, r.data.suggested_e_type); toast.success(`${r.data.local_contact.name} seçildi.`); }
    } catch (err) { toast.error(err.response?.data?.detail || "Sorgulama başarısız."); setRes(null); } finally { setBusy(false); }
  };

  const createContact = async () => {
    if (!draft.name.trim()) { toast.error("Cari unvanı girin."); return; }
    try {
      const r = await axios.post(`${API_URL}/contacts`, { company_id: companyId, type: "customer", name: draft.name.trim(), tax_number_or_id: res.tax_id, tax_office: draft.tax_office || null, is_e_invoice_user: res.is_e_invoice_user });
      toast.success("Cari oluşturuldu ve seçildi.");
      onSelect(r.data, res.suggested_e_type);
      setRes(null); setTaxId("");
    } catch (err) { toast.error(err.response?.data?.detail || "Cari oluşturulamadı."); }
  };

  return (
    <div className="space-y-2" data-testid="gib-lookup">
      <div className="flex gap-1.5">
        <input value={taxId} onChange={(e) => setTaxId(e.target.value.replace(/\D/g, "").slice(0, 11))} placeholder="VKN / TCKN ile GİB'den getir" className="flex-1 bg-white border border-slate-200 rounded-lg p-2 font-mono" data-testid="gib-taxid-input" onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); lookup(); } }} />
        <button type="button" onClick={lookup} disabled={busy || taxId.length < 10} className="flex items-center gap-1 px-3 py-2 bg-slate-900 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="gib-lookup-btn">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} GİB</button>
      </div>
      {res && !res.local_contact && (
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3 space-y-2" data-testid="gib-lookup-result">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${res.is_e_invoice_user ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-blue-50 text-blue-700 border border-blue-200"}`}><ShieldCheck className="w-3 h-3" /> {res.is_e_invoice_user ? "E-FATURA MÜKELLEFİ" : "E-ARŞİV"}</span>
            {res.source === "simulated" && <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200 rounded-md px-2 py-0.5"><FlaskConical className="w-3 h-3" /> SİMÜLE</span>}
            <span className="font-mono text-slate-500">{res.kind}: {res.tax_id}</span>
          </div>
          <p className="text-[11px] text-slate-500">{res.message}</p>
          <div className="grid grid-cols-2 gap-1.5">
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="Cari unvanı *" className="bg-white border border-slate-200 rounded-lg p-2" data-testid="gib-new-name-input" />
            <input value={draft.tax_office} onChange={(e) => setDraft({ ...draft, tax_office: e.target.value })} placeholder="Vergi dairesi" className="bg-white border border-slate-200 rounded-lg p-2" data-testid="gib-new-office-input" />
          </div>
          <button type="button" onClick={createContact} className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="gib-create-contact-btn"><UserPlus className="w-3.5 h-3.5" /> Cari Oluştur & Seç</button>
        </div>
      )}
    </div>
  );
};
