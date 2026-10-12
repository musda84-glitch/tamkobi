import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { ScrollText } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { inputCls } from "./saasUi";

const cred = { withCredentials: true };

export const PlatformAuditPanel = () => {
  const [entries, setEntries] = useState(null);
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");

  const load = useCallback(() => {
    const params = {};
    if (action.trim()) params.action = action.trim();
    if (actorId.trim()) params.actor_id = actorId.trim();
    axios
      .get(`${API_URL}/platform/admin/audit`, { ...cred, params })
      .then((r) => setEntries(r.data.entries || []))
      .catch((e) => toast.error(e.response?.data?.detail || "Denetim kaydı alınamadı."));
  }, [action, actorId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!entries) return <div className="text-xs text-slate-400">Yükleniyor…</div>;

  return (
    <div className="space-y-4 text-xs" data-testid="platform-audit">
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Aksiyon</label>
          <input value={action} onChange={(e) => setAction(e.target.value)} className={inputCls} placeholder="api_key.create" data-testid="paudit-action" />
        </div>
        <div>
          <label className="block font-semibold text-slate-700 mb-1">Actor ID</label>
          <input value={actorId} onChange={(e) => setActorId(e.target.value)} className={inputCls} data-testid="paudit-actor" />
        </div>
        <button type="button" onClick={load} className="px-3 py-2 bg-slate-900 text-white rounded-xl font-bold flex items-center gap-1.5" data-testid="paudit-filter">
          <ScrollText className="w-3.5 h-3.5" /> Filtrele
        </button>
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[800px]" data-testid="paudit-table">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Zaman</th>
              <th className="px-3 py-2.5 text-left">Actor</th>
              <th className="px-3 py-2.5 text-left">Aksiyon</th>
              <th className="px-3 py-2.5 text-left">Hedef</th>
              <th className="px-3 py-2.5 text-left">IP</th>
              <th className="px-3 py-2.5 text-left">Detay</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-slate-400">
                  Kayıt yok.
                </td>
              </tr>
            )}
            {entries.map((e) => (
              <tr key={e.id || e._id}>
                <td className="px-3 py-2 whitespace-nowrap">{e.at}</td>
                <td className="px-3 py-2 font-mono text-[10px]">
                  {e.actor_type}:{e.actor_id}
                </td>
                <td className="px-3 py-2">{e.action}</td>
                <td className="px-3 py-2">
                  {e.target_type}:{e.target_id}
                </td>
                <td className="px-3 py-2">{e.ip || "—"}</td>
                <td className="px-3 py-2 font-mono text-[10px] max-w-xs truncate">{JSON.stringify(e.details || {})}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};
