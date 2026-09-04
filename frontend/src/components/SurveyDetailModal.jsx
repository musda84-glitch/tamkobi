import React, { useState } from "react";
import { useEscape } from "../utils/useEscape";
import axios from "axios";
import { toast } from "sonner";
import { X, Navigation, Ruler, Calendar, User, MapPin } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { resolveImageUrl } from "../utils/imageUrl";

const fmt = (n) => (n || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
const STATUSES = [["planned", "Planlandı"], ["done", "Yapıldı"], ["quoted", "Teklif Verildi"], ["cancelled", "İptal"]];

export const SurveyDetailModal = ({ survey, onClose, onChanged }) => {
  useEscape(onClose);
  const [notes, setNotes] = useState(survey.notes || "");
  const [status, setStatus] = useState(survey.status || "planned");
  const save = async () => {
    try { await axios.put(`${API_URL}/surveys/${survey.id}`, { notes, status }); toast.success("Keşif güncellendi."); onChanged?.(); onClose(); }
    catch (err) { toast.error(err.response?.data?.detail || "Güncellenemedi."); }
  };
  const ms = survey.measurements || [];
  const est = ms.reduce((s, m) => s + Number(m.quantity || 0) * Number(m.unit_price || 0), 0);
  return (
    <div className="fixed inset-0 z-[60] bg-slate-900/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl max-w-2xl w-full p-5 space-y-3 text-xs shadow-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} data-testid="survey-detail-modal">
        <div className="flex justify-between items-start border-b pb-2">
          <div><h3 className="text-sm font-bold text-slate-900 flex items-center gap-1.5"><Ruler className="w-4 h-4 text-emerald-600" /> Keşif {survey.survey_number}</h3><p className="text-slate-500">{survey.contact_name}</p></div>
          <button onClick={onClose} className="text-slate-400" data-testid="survey-detail-close"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-slate-50 rounded-xl p-2.5 flex items-center gap-2"><Calendar className="w-4 h-4 text-slate-400" /><div><div className="text-[10px] uppercase text-slate-400 font-semibold">Tarih</div><div className="font-semibold">{survey.survey_date}</div></div></div>
          <div className="bg-slate-50 rounded-xl p-2.5 flex items-center gap-2"><User className="w-4 h-4 text-slate-400" /><div><div className="text-[10px] uppercase text-slate-400 font-semibold">Görevli</div><div className="font-semibold">{survey.assigned_to || "—"}</div></div></div>
          <div className="bg-slate-50 rounded-xl p-2.5 flex items-center gap-2 col-span-2"><MapPin className="w-4 h-4 text-slate-400 shrink-0" /><div className="min-w-0"><div className="text-[10px] uppercase text-slate-400 font-semibold">Adres</div><div className="font-semibold">{survey.address || "—"} {survey.location_url && <a href={survey.location_url} target="_blank" rel="noreferrer" className="text-rose-600 inline-flex items-center gap-0.5 ml-1 hover:underline"><Navigation className="w-3 h-3" /> Konum</a>}</div></div></div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-400 font-semibold mb-1">Ölçüler / Metraj ({ms.length})</div>
          {ms.length === 0 ? <div className="text-slate-400 py-2">Ölçü girilmemiş.</div> : (
            <table className="w-full"><thead className="text-slate-500 uppercase text-[10px] border-b"><tr><th className="text-left py-1">Kalem</th><th className="py-1 text-right">Miktar</th><th className="py-1 text-right">Birim Fiyat</th><th className="py-1 text-right">Tahmini</th></tr></thead>
              <tbody className="divide-y divide-slate-100">{ms.map((m, i) => <tr key={i} data-testid={`survey-measure-${i}`}><td className="py-1 font-semibold">{m.name}</td><td className="py-1 text-right">{m.quantity} {m.unit}</td><td className="py-1 text-right">{fmt(m.unit_price)} ₺</td><td className="py-1 text-right font-bold">{fmt(Number(m.quantity || 0) * Number(m.unit_price || 0))} ₺</td></tr>)}</tbody>
              <tfoot><tr className="border-t"><td colSpan={3} className="py-1 font-bold text-right">Tahmini Toplam</td><td className="py-1 text-right font-bold text-emerald-700">{fmt(est)} ₺</td></tr></tfoot></table>
          )}
        </div>
        {(survey.images || []).length > 0 && <div><div className="text-[10px] uppercase text-slate-400 font-semibold mb-1">Fotoğraflar</div><div className="grid grid-cols-4 gap-2">{survey.images.map((img) => <a key={img} href={resolveImageUrl(img)} target="_blank" rel="noreferrer"><img src={resolveImageUrl(img)} alt="" className="w-full h-20 object-cover rounded-lg border" /></a>)}</div></div>}
        <div className="grid grid-cols-3 gap-2">
          <div className="col-span-2"><label className="block font-semibold mb-1">Notlar</label><textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="survey-notes-input" /></div>
          <div><label className="block font-semibold mb-1">Durum</label><select value={status} onChange={(e) => setStatus(e.target.value)} className="w-full bg-slate-50 border rounded-lg p-2" data-testid="survey-status-select">{STATUSES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>{survey.quote_id && <div className="text-[10px] text-emerald-700 mt-1">Teklife çevrildi</div>}</div>
        </div>
        <div className="flex justify-end gap-2 border-t pt-2"><button onClick={onClose} className="px-3 py-1.5 border rounded-lg">Kapat</button><button onClick={save} className="px-4 py-1.5 bg-emerald-600 text-white rounded-lg font-semibold" data-testid="survey-detail-save">Kaydet</button></div>
      </div>
    </div>
  );
};
