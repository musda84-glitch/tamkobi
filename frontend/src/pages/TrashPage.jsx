
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Trash2, RotateCcw, Search, X, Eye, AlertTriangle, Clock } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { useEscape } from "../utils/useEscape";

const fmtDate = (s) => (s ? new Date(s).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");
const fmtVal = (v) => (typeof v === "number" ? v.toLocaleString("tr-TR", { minimumFractionDigits: 2 }) : Array.isArray(v) ? `${v.length} kalem` : String(v));

const DetailModal = ({ id, onClose }) => {
  useEscape(onClose);
  const [d, setD] = useState(null);
  useEffect(() => { axios.get(`${API_URL}/trash/${id}`).then((r) => setD(r.data)).catch(() => toast.error("Detay yüklenemedi.")); }, [id]);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto p-5 space-y-3 text-xs" onClick={(e) => e.stopPropagation()} data-testid="trash-detail-modal">
        <div className="flex items-center justify-between"><b className="text-sm text-slate-900">{d?.type_label} · {d?.label}</b><button onClick={onClose} className="p-1 rounded-lg hover:bg-slate-100" data-testid="trash-detail-close"><X className="w-4 h-4" /></button></div>
        {!d ? <div className="text-slate-400">Yükleniyor…</div> : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {Object.entries(d.doc).filter(([k, v]) => v !== null && v !== "" && typeof v !== "object" || Array.isArray(v)).map(([k, v]) => (
              <div key={k} className="bg-slate-50 rounded-lg px-3 py-2 break-words"><div className="text-[10px] uppercase text-slate-400 font-semibold">{k}</div><div className="text-slate-800">{fmtVal(v)}</div></div>))}
          </div>)}
      </div>
    </div>
  );
};

export default function TrashPage() {
  const { activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "comp_nexus_main_01";
  const [data, setData] = useState(null);
  const [type, setType] = useState("");
  const [q, setQ] = useState("");
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(null);
  const load = useCallback(() => axios.get(`${API_URL}/trash`, { params: { company_id: companyId, entity_type: type || undefined, q: q || undefined } }).then((r) => setData(r.data)).catch(() => toast.error("Çöp kutusu yüklenemedi.")), [companyId, type, q]);
  useEffect(() => { load(); }, [load]);

  const restore = async (it) => {
    setBusy(it.id);
    try { const r = await axios.post(`${API_URL}/trash/${it.id}/restore`); toast.success(r.data.message); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Geri getirilemedi."); } finally { setBusy(null); }
  };
  const purge = async (it) => {
    if (!window.confirm(`"${it.label}" kalıcı olarak silinsin mi? Bu işlem geri alınamaz.`)) return;
    setBusy(it.id);
    try { await axios.delete(`${API_URL}/trash/${it.id}`); toast.success("Kalıcı olarak silindi."); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Silinemedi."); } finally { setBusy(null); }
  };
  const empty = async () => {
    const label = type ? data?.types?.find((t) => t.key === type)?.label : "tüm";
    if (!window.confirm(`Çöp kutusundaki ${label} kayıtlar (${type ? data?.types?.find((t) => t.key === type)?.count : data?.total}) kalıcı olarak silinsin mi?`)) return;
    try { const r = await axios.post(`${API_URL}/trash/empty`, { company_id: companyId, entity_type: type || undefined }); toast.success(r.data.message); setType(""); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Boşaltılamadı."); }
  };

  return (
    <div className="space-y-5" data-testid="trash-page">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight flex items-center gap-2"><Trash2 className="w-6 h-6 text-slate-500" /> Çöp Kutusu</h1>
          <p className="text-xs sm:text-sm text-slate-500">Silinen kayıtlar {data?.retention_days || 30} gün boyunca burada saklanır; geri getirebilir veya kalıcı olarak silebilirsiniz.</p>
        </div>
        {data?.total > 0 && <button onClick={empty} className="px-3 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5" data-testid="trash-empty-btn"><Trash2 className="w-3.5 h-3.5" /> {type ? "Bu Türü Boşalt" : "Çöp Kutusunu Boşalt"}</button>}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button onClick={() => setType("")} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${!type ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`} data-testid="trash-type-all">Tümü ({data?.total ?? 0})</button>
        {(data?.types || []).map((t) => <button key={t.key} onClick={() => setType(t.key)} className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${type === t.key ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-600 border-slate-200"}`} data-testid={`trash-type-${t.key}`}>{t.label} ({t.count})</button>)}
        <div className="relative ml-auto"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ara…" className="pl-8 pr-3 py-2 bg-white border border-slate-200 rounded-xl text-xs w-56" data-testid="trash-search" /></div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-600">
            <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold"><tr><th className="px-4 py-3">Tür</th><th className="px-4 py-3">Kayıt</th><th className="px-4 py-3">Silinme</th><th className="px-4 py-3">Kalan Süre</th><th className="px-4 py-3 text-center">İşlemler</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {!data ? <tr><td colSpan={5} className="p-8 text-center text-slate-400">Yükleniyor…</td></tr> : data.items.length === 0 ? (
                <tr><td colSpan={5} className="p-12 text-center text-slate-400" data-testid="trash-empty-state"><Trash2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />Çöp kutusu boş. Silinen cari, ürün, sipariş, masraf ve diğer kayıtlar burada görünür.</td></tr>
              ) : data.items.map((it) => (
                <tr key={it.id} className="hover:bg-slate-50/60" data-testid={`trash-row-${it.id}`}>
                  <td className="px-4 py-2.5"><span className="inline-block bg-slate-100 text-slate-700 font-semibold px-2 py-0.5 rounded">{it.type_label}</span></td>
                  <td className="px-4 py-2.5"><div className="font-semibold text-slate-900">{it.label}</div><div className="text-[10px] text-slate-400">{it.note}{it.related_count ? ` · +${it.related_count} bağlı kayıt` : ""}{it.has_side_effects ? " · geri getirilince bakiyeler yeniden uygulanır" : ""}</div></td>
                  <td className="px-4 py-2.5 whitespace-nowrap">{fmtDate(it.deleted_at)}</td>
                  <td className="px-4 py-2.5 whitespace-nowrap"><span className={`inline-flex items-center gap-1 ${it.days_left <= 3 ? "text-rose-600 font-bold" : "text-slate-500"}`}>{it.days_left <= 3 ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />} {it.days_left} gün</span></td>
                  <td className="px-4 py-2.5"><div className="flex items-center justify-center gap-1">
                    <button onClick={() => setDetail(it.id)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500" title="Detay" data-testid={`trash-view-${it.id}`}><Eye className="w-4 h-4" /></button>
                    <button onClick={() => restore(it)} disabled={busy === it.id} className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold flex items-center gap-1 disabled:opacity-50" data-testid={`trash-restore-${it.id}`}><RotateCcw className="w-3.5 h-3.5" /> Geri Getir</button>
                    <button onClick={() => purge(it)} disabled={busy === it.id} className="px-2.5 py-1.5 rounded-lg border border-rose-200 text-rose-600 hover:bg-rose-50 font-semibold disabled:opacity-50" data-testid={`trash-purge-${it.id}`}>Kalıcı Sil</button>
                  </div></td>
                </tr>))}
            </tbody>
          </table>
        </div>
      </div>
      {detail && <DetailModal id={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
