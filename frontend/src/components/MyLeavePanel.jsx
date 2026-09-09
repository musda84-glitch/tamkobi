
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { CalendarDays, Plus, Loader2, Trash2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const STATUS = { pending: ["Bekliyor", "bg-amber-100 text-amber-700"], approved: ["Onaylandı", "bg-emerald-100 text-emerald-700"], rejected: ["Reddedildi", "bg-rose-100 text-rose-700"] };
const inp = "bg-slate-50 border border-slate-200 rounded-lg p-2 text-sm sm:text-xs";

export const MyLeavePanel = ({ enabled }) => {
  const [d, setD] = useState(null);
  const [f, setF] = useState({ type: "annual", start_date: "", end_date: "", reason: "" });
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => axios.get(`${API_URL}/personnel/leaves/me`, { withCredentials: true }).then((r) => setD(r.data)).catch(() => {}), []);
  useEffect(() => { if (enabled) load(); }, [load, enabled]);
  if (!enabled || !d?.employee) return null;
  const days = f.start_date && f.end_date ? Math.max(0, Math.round((new Date(f.end_date) - new Date(f.start_date)) / 86400000) + 1) : 0;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true);
    try { await axios.post(`${API_URL}/personnel/leaves/self`, f, { withCredentials: true }); toast.success("İzin talebiniz yöneticiye iletildi."); setF({ type: "annual", start_date: "", end_date: "", reason: "" }); setOpen(false); load(); }
    catch (err) { toast.error(err.response?.data?.detail || "Talep gönderilemedi."); } finally { setBusy(false); }
  };
  const cancel = async (l) => { if (!window.confirm("Talep iptal edilsin mi?")) return; try { await axios.delete(`${API_URL}/personnel/leaves/self/${l.id}`, { withCredentials: true }); toast.success("Talep iptal edildi."); load(); } catch (err) { toast.error(err.response?.data?.detail || "İptal edilemedi."); } };
  const b = d.balance;
  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden" data-testid="my-leave-panel">
      <div className="px-4 py-2.5 border-b flex flex-wrap items-center justify-between gap-2">
        <span className="font-bold text-slate-900 text-sm flex items-center gap-2"><CalendarDays className="w-4 h-4 text-amber-500" /> İzin Taleplerim</span>
        <div className="flex items-center gap-3 text-xs"><span className="text-slate-500">Yıllık izin: <b className="text-slate-900" data-testid="my-leave-remaining">{b.remaining}</b>/{b.annual} gün kaldı{b.pending_days ? <span className="text-amber-600"> · {b.pending_days} gün bekliyor</span> : null}</span><button onClick={() => setOpen(!open)} className="flex items-center gap-1 px-3 py-1.5 bg-slate-900 text-white rounded-lg font-semibold" data-testid="my-leave-new"><Plus className="w-3.5 h-3.5" /> İzin Talebi</button></div>
      </div>
      {open && (
        <form onSubmit={submit} className="p-4 border-b bg-amber-50/40 grid grid-cols-2 sm:grid-cols-5 gap-2 text-xs items-end" data-testid="my-leave-form">
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Tür</label><select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} className={`${inp} w-full`} data-testid="my-leave-type">{Object.entries(d.types).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Başlangıç</label><input type="date" required value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value, end_date: f.end_date || e.target.value })} className={`${inp} w-full`} data-testid="my-leave-start" /></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Bitiş</label><input type="date" required value={f.end_date} min={f.start_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} className={`${inp} w-full`} data-testid="my-leave-end" /></div>
          <div className="col-span-2 sm:col-span-1"><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Açıklama</label><input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="ops." className={`${inp} w-full`} data-testid="my-leave-reason" /></div>
          <button type="submit" disabled={busy || !days} className="col-span-2 sm:col-span-1 flex items-center justify-center gap-1 px-3 py-2 bg-emerald-600 text-white rounded-lg font-semibold disabled:opacity-50" data-testid="my-leave-submit">{busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null} Gönder{days ? ` (${days} gün)` : ""}</button>
        </form>
      )}
      <div className="divide-y divide-slate-100 text-xs max-h-64 overflow-y-auto">
        {d.leaves.length === 0 && <div className="p-6 text-center text-slate-400">Henüz izin talebiniz yok.</div>}
        {d.leaves.map((l) => { const [lbl, cls] = STATUS[l.status] || [l.status, "bg-slate-100"]; return (
          <div key={l.id} className="px-4 py-2 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid={`my-leave-${l.id}`}>
            <span className="font-semibold">{d.types[l.type] || l.type}</span><span className="font-mono text-slate-600">{l.start_date} → {l.end_date}</span><span className="text-slate-500">{l.days} gün</span>{l.reason && <span className="text-slate-400 truncate max-w-[200px]">{l.reason}</span>}
            <span className={`ml-auto text-[10px] font-bold px-1.5 py-0.5 rounded ${cls}`} data-testid={`my-leave-status-${l.id}`}>{lbl}</span>
            {l.decision_note && <span className="text-[10px] text-slate-500 w-full sm:w-auto">Yönetici: {l.decision_note}</span>}
            {l.status === "pending" && <button onClick={() => cancel(l)} className="text-slate-400 hover:text-rose-600 p-1" title="İptal" data-testid={`my-leave-cancel-${l.id}`}><Trash2 className="w-3.5 h-3.5" /></button>}
          </div>); })}
      </div>
    </div>
  );
};
