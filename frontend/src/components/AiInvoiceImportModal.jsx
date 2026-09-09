import React, { useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { X, Sparkles, Upload, Loader2, FileText, Plus, Trash2, CheckCircle2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";
import { SearchSelect } from "./SearchSelect";
import { computeLine, emptyLine, fmtMoney, VAT_OPTIONS } from "../utils/documentLines";

const fmt = (n) => fmtMoney(n);
const lineOf = (it) => computeLine(it);

export const AiInvoiceImportModal = ({ companyId, contacts, onClose, onDone }) => {
  useEscape(onClose);
  const ref = useRef(null);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState(null);
  const [draft, setDraft] = useState(null);
  const [contactId, setContactId] = useState("");
  const [saving, setSaving] = useState(false);

  const upload = async (file) => {
    if (!file) return;
    setBusy(true);
    try {
      const fd = new FormData(); fd.append("file", file);
      const r = await axios.post(`${API_URL}/ai/invoice-extract?company_id=${companyId}`, fd);
      setRes(r.data); setDraft(r.data.draft); setContactId(r.data.matched_contact?.id || "");
      toast.success(`AI faturayı okudu (güven: %${Math.round((r.data.draft.confidence || 0) * 100)}). Kontrol edip onaylayın.`);
    } catch (err) { toast.error(err.response?.data?.detail || "PDF işlenemedi."); } finally { setBusy(false); }
  };
  const setItem = (i, k, v) => setDraft((d) => { const items = d.items.map((it, j) => (j === i ? computeLine({ ...it, [k]: v }, k) : it)); return { ...d, items }; });
  const addItem = () => setDraft((d) => ({ ...d, items: [...d.items, emptyLine()] }));
  const rmItem = (i) => setDraft((d) => ({ ...d, items: d.items.filter((_, j) => j !== i) }));
  const sub = draft ? draft.items.reduce((s, it) => s + lineOf(it).total, 0) : 0;
  const vat = draft ? draft.items.reduce((s, it) => s + lineOf(it).vat_amount, 0) : 0;
  const confirm = async () => {
    setSaving(true);
    try {
      const r = await axios.post(`${API_URL}/ai/invoice-extract/confirm`, { company_id: companyId, draft, contact_id: contactId || null, file_url: res?.file_url });
      toast.success(r.data.message); onDone?.(r.data.invoice); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Fatura oluşturulamadı."); } finally { setSaving(false); }
  };
  const sup = draft?.supplier || {};

  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-4xl max-h-[92vh] overflow-y-auto p-6 space-y-4 shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="ai-invoice-modal">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-bold text-slate-900 flex items-center gap-2"><Sparkles className="w-5 h-5 text-violet-600" /> AI ile PDF Faturadan Alış Faturası Oluştur <span className="text-[10px] font-semibold bg-violet-100 text-violet-700 px-2 py-0.5 rounded-full">Claude Sonnet 4.6</span></h3>
          <button onClick={onClose} className="text-slate-400" data-testid="ai-invoice-close"><X className="w-5 h-5" /></button>
        </div>
        {!draft ? (
          <label className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-2xl p-10 cursor-pointer text-sm text-slate-600 ${busy ? "opacity-60" : "hover:bg-violet-50/40 hover:border-violet-400"}`} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); upload(e.dataTransfer.files?.[0]); }} data-testid="ai-invoice-dropzone">
            {busy ? <><Loader2 className="w-8 h-8 animate-spin text-violet-600" /><span>PDF okunuyor ve AI ile analiz ediliyor…</span></> : <><Upload className="w-8 h-8 text-violet-600" /><span className="font-semibold">Tedarikçi fatura PDF'ini sürükleyin veya seçin</span><span className="text-xs text-slate-400">Metin tabanlı e-Arşiv / e-Fatura PDF · max 10 MB. Tedarikçi, kalemler, KDV ve toplamlar otomatik çıkarılır.</span></>}
            <input ref={ref} type="file" accept="application/pdf" className="hidden" onChange={(e) => upload(e.target.files?.[0])} disabled={busy} data-testid="ai-invoice-file" />
          </label>
        ) : (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="md:col-span-2 bg-slate-50 rounded-xl p-3 space-y-2">
                <div className="font-bold text-slate-800 flex items-center gap-1.5"><FileText className="w-4 h-4" /> Tedarikçi</div>
                <div className="grid grid-cols-2 gap-2">
                  <input value={sup.name || ""} onChange={(e) => setDraft({ ...draft, supplier: { ...sup, name: e.target.value } })} placeholder="Ünvan" className="border rounded-lg p-2 col-span-2" data-testid="ai-sup-name" />
                  <input value={sup.tax_number || ""} onChange={(e) => setDraft({ ...draft, supplier: { ...sup, tax_number: e.target.value } })} placeholder="VKN / TCKN" className="border rounded-lg p-2" data-testid="ai-sup-tax" />
                  <input value={sup.tax_office || ""} onChange={(e) => setDraft({ ...draft, supplier: { ...sup, tax_office: e.target.value } })} placeholder="Vergi Dairesi" className="border rounded-lg p-2" />
                </div>
                <div>
                  <label className="block font-semibold text-slate-600 mb-1">Cari eşleştirme {res?.matched_contact && <span className="text-emerald-700">· AI mevcut cariyi buldu</span>}</label>
                  <SearchSelect value={contactId} onChange={setContactId} options={contacts.filter((c) => c.type !== "customer")} getLabel={(c) => c.name} getSub={(c) => c.tax_number_or_id} placeholder="Mevcut tedarikçi seç — boş bırakırsanız yeni cari açılır" testId="ai-contact-select" />
                </div>
              </div>
              <div className="bg-slate-50 rounded-xl p-3 space-y-2">
                <div className="font-bold text-slate-800">Fatura Bilgileri</div>
                <input value={draft.invoice_number || ""} onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })} placeholder="Tedarikçi fatura no" className="w-full border rounded-lg p-2" data-testid="ai-inv-no" />
                <div className="grid grid-cols-2 gap-2"><div><label className="text-[10px] text-slate-500">Tarih</label><input type="date" value={draft.issue_date || ""} onChange={(e) => setDraft({ ...draft, issue_date: e.target.value })} className="w-full border rounded-lg p-2" data-testid="ai-inv-date" /></div><div><label className="text-[10px] text-slate-500">Vade</label><input type="date" value={draft.due_date || ""} onChange={(e) => setDraft({ ...draft, due_date: e.target.value })} className="w-full border rounded-lg p-2" /></div></div>
                <div className="text-[11px] text-slate-500">Güven: <b>%{Math.round((draft.confidence || 0) * 100)}</b> · PDF toplamı: <b>{fmt(draft.grand_total)} {draft.currency || "TRY"}</b></div>
              </div>
            </div>
            <table className="w-full min-w-[900px]" data-testid="ai-items-table">
              <thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1.5">Stok adı</th><th className="w-16">Miktar</th><th className="w-16">Birim</th><th className="w-24">KDV'siz</th><th className="w-24">KDV'li</th><th className="w-16">KDV %</th><th className="w-16">İsk %</th><th className="text-right w-24">Hariç</th><th className="text-right w-24">Dahil</th><th className="w-8"></th></tr></thead>
              <tbody className="divide-y">
                {draft.items.map((it, i) => {
                  const line = lineOf(it);
                  return (
                  <tr key={i} data-testid={`ai-item-${i}`}>
                    <td className="py-1"><input value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} className="w-full border rounded p-1.5" />{it.matched_product && <div className="text-[10px] text-emerald-700">↳ Stok kartı: {it.matched_product}</div>}</td>
                    <td><input type="number" step="any" value={it.quantity} onChange={(e) => setItem(i, "quantity", e.target.value)} className="w-full border rounded p-1.5 text-right" /></td>
                    <td><input value={it.unit} onChange={(e) => setItem(i, "unit", e.target.value)} className="w-full border rounded p-1.5" /></td>
                    <td><input type="number" step="any" value={it.unit_price} onChange={(e) => setItem(i, "unit_price", e.target.value)} className="w-full border rounded p-1.5 text-right" /></td>
                    <td><input type="number" step="any" value={Math.round((line.unit_price_incl || 0) * 10000) / 10000} onChange={(e) => setItem(i, "unit_price_incl", e.target.value)} className="w-full border rounded p-1.5 text-right" /></td>
                    <td><select value={it.vat_rate} onChange={(e) => setItem(i, "vat_rate", e.target.value)} className="w-full border rounded p-1.5">{VAT_OPTIONS.map((v) => <option key={v} value={v}>%{v}</option>)}</select></td>
                    <td><input type="number" step="any" value={it.discount_rate || 0} onChange={(e) => setItem(i, "discount_rate", e.target.value)} className="w-full border rounded p-1.5 text-right" /></td>
                    <td className="text-right font-semibold">{fmt(line.total)}</td>
                    <td className="text-right font-bold">{fmt(line.total_incl)}</td>
                    <td><button onClick={() => rmItem(i)} className="p-1 text-rose-600" data-testid={`ai-item-rm-${i}`}><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
            <div className="flex items-start justify-between">
              <button onClick={addItem} className="flex items-center gap-1 px-2.5 py-1.5 border rounded-lg" data-testid="ai-item-add"><Plus className="w-3.5 h-3.5" /> Kalem ekle</button>
              <div className="text-right space-y-0.5"><div>Ara Toplam (KDV Hariç): <b>{fmt(sub)} ₺</b></div><div>KDV: <b>{fmt(vat)} ₺</b></div><div className="text-sm">Genel Toplam (KDV Dahil): <b data-testid="ai-grand-total">{fmt(sub + vat)} ₺</b>{Math.abs(sub + vat - Number(draft.grand_total || 0)) > 1 && <span className="ml-2 text-[10px] text-amber-700 font-semibold">PDF toplamından farklı ({fmt(draft.grand_total)})</span>}</div></div>
            </div>
            <div className="flex justify-between items-center border-t pt-3">
              <button onClick={() => { setDraft(null); setRes(null); }} className="px-3 py-1.5 border rounded-lg" data-testid="ai-restart">Başka PDF</button>
              <button onClick={confirm} disabled={saving || !draft.items.length} className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 text-white rounded-xl font-bold" data-testid="ai-confirm">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Taslak Alış Faturası Oluştur</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
