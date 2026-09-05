import React, { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Users, X, Loader2, Save, Trash2, LayoutTemplate } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const DAYS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const inp = "bg-slate-50 border border-slate-200 rounded-lg p-1.5 text-xs";
const defaultDays = () => Object.fromEntries(DAYS.map((_, i) => [String(i), i < 5 ? { off: false, start: "09:00", end: "18:00", break_minutes: 60 } : { off: true }]));

export const BulkAssignModal = ({ companyId, weekStart, rows, onClose, onDone }) => {
  const departments = Array.from(new Set(rows.map((r) => r.department).filter(Boolean)));
  const [dept, setDept] = useState("all");
  const [templates, setTemplates] = useState([]);
  const [tplId, setTplId] = useState("");
  const [days, setDays] = useState(defaultDays());
  const [skipLeave, setSkipLeave] = useState(true);
  const [overwrite, setOverwrite] = useState(true);
  const [saveName, setSaveName] = useState("");
  const [busy, setBusy] = useState(false);
  const loadTpl = () => axios.get(`${API_URL}/personnel/shift-templates?company_id=${companyId}`).then((r) => setTemplates(r.data)).catch(() => {});
  useEffect(() => { loadTpl(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickTpl = (id) => { setTplId(id); const t = templates.find((x) => x.id === id); if (t) setDays({ ...defaultDays(), ...Object.fromEntries(Object.entries(t.days).map(([k, v]) => [k, v.off ? { off: true } : { off: false, ...v }])) }); };
  const setDay = (i, patch) => setDays({ ...days, [i]: { ...days[i], ...patch } });
  const count = dept === "all" ? rows.length : rows.filter((r) => r.department === dept).length;
  const apply = async () => {
    setBusy(true);
    try {
      if (saveName.trim()) { await axios.post(`${API_URL}/personnel/shift-templates`, { company_id: companyId, name: saveName.trim(), days }); toast.success(`"${saveName.trim()}" şablonu kaydedildi.`); }
      const r = await axios.post(`${API_URL}/personnel/shifts/bulk-assign`, { company_id: companyId, week_start: weekStart, department: dept, days, skip_leave: skipLeave, overwrite });
      (r.data.conflicts?.length ? toast.warning : toast.success)(r.data.message, { duration: 6000 }); onDone(); onClose();
    } catch (err) { toast.error(err.response?.data?.detail || "Atama yapılamadı."); } finally { setBusy(false); }
  };
  const delTpl = async (t) => { if (!window.confirm(`"${t.name}" şablonu silinsin mi?`)) return; try { await axios.delete(`${API_URL}/personnel/shift-templates/${t.id}`); if (tplId === t.id) setTplId(""); loadTpl(); } catch { toast.error("Silinemedi."); } };
  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs shadow-2xl" onClick={(e) => e.stopPropagation()} data-testid="bulk-assign-modal">
        <div className="flex items-center justify-between border-b pb-2"><h3 className="text-sm font-bold flex items-center gap-2"><Users className="w-4 h-4 text-indigo-600" /> Toplu Vardiya Atama — {weekStart} haftası</h3><button onClick={onClose} className="text-slate-400"><X className="w-5 h-5" /></button></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5">Departman</label><select value={dept} onChange={(e) => setDept(e.target.value)} className={`${inp} w-full`} data-testid="bulk-dept"><option value="all">{`Tüm personel (${rows.length})`}</option>{departments.map((d) => <option key={d} value={d}>{`${d} (${rows.filter((r) => r.department === d).length})`}</option>)}</select></div>
          <div><label className="block text-[10px] font-semibold text-slate-500 mb-0.5 flex items-center gap-1"><LayoutTemplate className="w-3 h-3" /> Kayıtlı şablon</label><div className="flex gap-1"><select value={tplId} onChange={(e) => pickTpl(e.target.value)} className={`${inp} flex-1`} data-testid="bulk-template"><option value="">Şablon seç (isteğe bağlı)</option>{templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>{tplId && <button type="button" onClick={() => delTpl(templates.find((t) => t.id === tplId))} className="p-1.5 border rounded-lg text-slate-400 hover:text-rose-600" data-testid="bulk-template-delete"><Trash2 className="w-3.5 h-3.5" /></button>}</div></div>
        </div>
        <div className="border border-slate-200 rounded-xl overflow-hidden" data-testid="bulk-days">
          <table className="w-full"><thead className="bg-slate-50 text-[10px] uppercase text-slate-500"><tr><th className="px-3 py-1.5 text-left">Gün</th><th className="px-3 py-1.5 text-left">Başlangıç</th><th className="px-3 py-1.5 text-left">Bitiş</th><th className="px-3 py-1.5 text-left">Mola</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{DAYS.map((l, i) => { const d = days[String(i)]; return (
              <tr key={l} className={d.off ? "bg-slate-50/60 text-slate-400" : ""} data-testid={`bulk-day-${i}`}>
                <td className="px-3 py-1"><label className="flex items-center gap-2 cursor-pointer font-semibold"><input type="checkbox" checked={!d.off} onChange={(e) => setDay(String(i), e.target.checked ? { off: false, start: d.start || "09:00", end: d.end || "18:00", break_minutes: d.break_minutes ?? 60 } : { off: true })} data-testid={`bulk-on-${i}`} /> {l}{d.off && <span className="text-[9px] font-normal">izin</span>}</label></td>
                <td className="px-3 py-1"><input type="time" disabled={d.off} value={d.start || ""} onChange={(e) => setDay(String(i), { start: e.target.value })} className={inp} data-testid={`bulk-start-${i}`} /></td>
                <td className="px-3 py-1"><input type="time" disabled={d.off} value={d.end || ""} onChange={(e) => setDay(String(i), { end: e.target.value })} className={inp} data-testid={`bulk-end-${i}`} /></td>
                <td className="px-3 py-1"><input type="number" min="0" disabled={d.off} value={d.break_minutes ?? ""} onChange={(e) => setDay(String(i), { break_minutes: Number(e.target.value) })} className={`${inp} w-20`} data-testid={`bulk-break-${i}`} /></td>
              </tr>); })}</tbody></table>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={skipLeave} onChange={(e) => setSkipLeave(e.target.checked)} data-testid="bulk-skip-leave" /> Onaylı izinli günleri atla</label>
          <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} data-testid="bulk-overwrite" /> Mevcut planların üzerine yaz</label>
          <input value={saveName} onChange={(e) => setSaveName(e.target.value)} placeholder="Şablon olarak kaydet (ad, isteğe bağlı)" className={`${inp} flex-1 min-w-[180px]`} data-testid="bulk-save-name" />
        </div>
        <div className="flex justify-between items-center pt-2 border-t"><span className="text-slate-500"><b className="text-slate-900" data-testid="bulk-count">{count}</b> personel × haftanın planlı günleri</span><button onClick={apply} disabled={busy || !count} className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-xl font-semibold disabled:opacity-50" data-testid="bulk-apply">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Haftaya Uygula</button></div>
      </div>
    </div>
  );
};
