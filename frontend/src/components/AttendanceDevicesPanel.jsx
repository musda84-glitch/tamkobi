import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ShieldCheck, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";

const STATUS = { active: "Kayıtlı", pending: "Onay bekliyor", revoked: "İptal" };

export const AttendanceDevicesPanel = ({ companyId }) => {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState("");
  const load = useCallback(async () => {
    try {
      const r = await axios.get(`${API_URL}/personnel/attendance/devices`, { params: { company_id: companyId } });
      setRows(r.data?.devices || []);
    } catch (err) {
      if (err.response?.status !== 403) toast.error(err.response?.data?.detail || "Cihazlar yüklenemedi.");
    }
  }, [companyId]);
  useEffect(() => { load(); }, [load]);
  const act = async (id, action) => {
    setBusy(id + action);
    try {
      const r = await axios.post(`${API_URL}/personnel/attendance/devices/${encodeURIComponent(id)}/${action}`);
      toast.success(r.data?.message || "Kaydedildi.");
      await load();
    } catch (err) {
      toast.error(err.response?.data?.detail || "İşlem yapılamadı.");
    } finally {
      setBusy("");
    }
  };
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-4 space-y-2" data-testid="attendance-devices">
      <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-indigo-600" /> Kayıtlı telefonlar</h4>
      <p className="text-[11px] text-slate-500">Mesai girişi personelin kayıtlı telefonundan yapılır. Bir cihaz yalnız bir personele bağlanır. Cihaz değişikliği onaydan sonra geçerlidir. Sahte konum, rootlu cihaz veya başka hesabın telefonu reddedilir.</p>
      {!rows.length ? <div className="text-xs text-slate-400" data-testid="attendance-devices-empty">Henüz kayıtlı telefon yok.</div> : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-[10px] uppercase text-slate-500"><tr><th className="py-1 pr-2">Personel</th><th className="py-1 pr-2">Cihaz</th><th className="py-1 pr-2">Durum</th><th className="py-1"></th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((d) => (
                <tr key={d.id} data-testid={`device-row-${d.employee_id}`}>
                  <td className="py-1.5 pr-2 font-semibold">{d.employee_name || d.employee_id}</td>
                  <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-500">{d.label || d.platform || d.device_id}</td>
                  <td className="py-1.5 pr-2">{STATUS[d.status] || d.status}</td>
                  <td className="py-1.5 text-right space-x-1">
                    {d.status === "pending" && <button type="button" disabled={!!busy} onClick={() => act(d.id, "approve")} className="px-2 py-1 rounded-lg bg-emerald-600 text-white font-semibold" data-testid={`device-approve-${d.id}`}>{busy === d.id + "approve" ? <Loader2 className="w-3 h-3 animate-spin inline" /> : "Onayla"}</button>}
                    {d.status !== "revoked" && <button type="button" disabled={!!busy} onClick={() => act(d.id, "revoke")} className="px-2 py-1 rounded-lg border border-slate-200 text-slate-600 font-semibold" data-testid={`device-revoke-${d.id}`}>İptal</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
