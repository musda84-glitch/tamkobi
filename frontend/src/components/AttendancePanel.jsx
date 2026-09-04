import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Clock, LogIn, LogOut, CalendarX2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

export const AttendancePanel = ({ companyId }) => {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const load = useCallback(async () => { try { const r = await axios.get(`${API_URL}/personnel/attendance?company_id=${companyId}&month=${month}`); setData(r.data); } catch { toast.error("Puantaj yüklenemedi."); } }, [companyId, month]);
  useEffect(() => { load(); }, [load]);
  const act = async (employee_id, body) => { try { await axios.post(`${API_URL}/personnel/attendance`, { employee_id, ...body }); load(); } catch (err) { toast.error(err.response?.data?.detail || "Kaydedilemedi."); } };
  if (!data) return null;
  return (
    <div className="space-y-4 text-xs" data-testid="attendance-panel">
      <div className="flex items-center justify-between"><h3 className="text-sm font-bold text-slate-900 flex items-center gap-2"><Clock className="w-4 h-4 text-indigo-600" /> Puantaj — Giriş / Çıkış & Mesai</h3><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-slate-50 border rounded-lg p-1.5" data-testid="attendance-month-input" /></div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><table className="w-full text-left"><thead className="bg-slate-50 border-b text-slate-500 uppercase text-[10px] font-semibold"><tr><th className="px-4 py-2">Çalışan</th><th className="px-4 py-2">Bugün</th><th className="px-4 py-2 text-right">Gün</th><th className="px-4 py-2 text-right">Devamsız</th><th className="px-4 py-2 text-right">İzin</th><th className="px-4 py-2 text-right">Saat</th><th className="px-4 py-2 text-right">Mesai</th><th className="px-4 py-2"></th></tr></thead>
        <tbody className="divide-y divide-slate-100">{data.summary.map((s) => (
          <tr key={s.employee_id} data-testid={`att-row-${s.employee_id}`}>
            <td className="px-4 py-2 font-semibold text-slate-900">{s.employee_name}</td>
            <td className="px-4 py-2 font-mono text-slate-600">{s.today ? `${s.today.check_in || "--:--"} → ${s.today.check_out || "--:--"}${s.today.status !== "present" ? ` (${s.today.status === "absent" ? "Devamsız" : "İzinli"})` : ""}` : "—"}</td>
            <td className="px-4 py-2 text-right font-bold text-emerald-700">{s.days_present}</td><td className="px-4 py-2 text-right text-rose-600">{s.days_absent}</td><td className="px-4 py-2 text-right text-amber-600">{s.days_leave}</td>
            <td className="px-4 py-2 text-right font-bold">{s.total_hours}</td><td className="px-4 py-2 text-right font-bold text-indigo-700">{s.overtime_hours}</td>
            <td className="px-4 py-2"><div className="flex justify-end gap-1">
              <button onClick={() => act(s.employee_id, { action: "check_in" })} className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-lg font-semibold hover:bg-emerald-100" data-testid={`att-in-${s.employee_id}`}><LogIn className="w-3 h-3" /> Giriş</button>
              <button onClick={() => act(s.employee_id, { action: "check_out" })} className="flex items-center gap-1 px-2 py-1 bg-slate-100 text-slate-700 rounded-lg font-semibold hover:bg-slate-200" data-testid={`att-out-${s.employee_id}`}><LogOut className="w-3 h-3" /> Çıkış</button>
              <button onClick={() => act(s.employee_id, { status: "absent" })} className="flex items-center gap-1 px-2 py-1 bg-rose-50 text-rose-700 rounded-lg font-semibold hover:bg-rose-100" data-testid={`att-absent-${s.employee_id}`}><CalendarX2 className="w-3 h-3" /> Devamsız</button>
            </div></td>
          </tr>))}</tbody></table></div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden"><div className="px-4 py-2.5 border-b font-bold text-slate-900">Günlük Kayıtlar ({data.records.length})</div><div className="max-h-72 overflow-y-auto divide-y divide-slate-100">{data.records.map((r) => <div key={r.id} className="px-4 py-2 flex justify-between"><span><b>{r.employee_name}</b> <span className="text-slate-400 font-mono">{r.date}</span></span><span className="font-mono">{r.status === "present" ? `${r.check_in || "--:--"} → ${r.check_out || "--:--"} • ${r.hours || 0} sa${r.overtime_hours ? ` (+${r.overtime_hours} mesai)` : ""}` : r.status === "absent" ? "Devamsız" : "İzinli"}</span></div>)}{data.records.length === 0 && <div className="p-6 text-center text-slate-400">Bu ay kayıt yok.</div>}</div></div>
    </div>
  );
};
