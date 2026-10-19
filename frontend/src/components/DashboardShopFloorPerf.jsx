import React, { useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

/**
 * Yönetici özeti: bugünkü atölye performansı. Kapalı başlar, ilk açılışta yüklenir.
 */
export function DashboardShopFloorPerf({ companyId }) {
  const [open, setOpen] = useState(false);
  const [perf, setPerf] = useState(null);
  const [hidden, setHidden] = useState(false);
  const fetched = useRef(false);

  const load = () => {
    if (fetched.current || !companyId) return;
    fetched.current = true;
    axios.get(`${API_URL}/production/work-orders/performance?company_id=${companyId}`)
      .then((r) => setPerf(r.data && typeof r.data === "object" ? r.data : { total_done: 0, operators: [], stations: [] }))
      .catch(() => setHidden(true));
  };

  if (hidden || !companyId) return null;

  const onToggle = () => {
    const next = !open;
    if (next) load();
    setOpen(next);
  };

  const operators = Array.isArray(perf?.operators) ? perf.operators : [];
  const stations = Array.isArray(perf?.stations) ? perf.stations : [];

  return (
    <div className="bg-white border rounded-2xl p-3" data-testid="dashboard-shopfloor-perf">
      <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center justify-between text-sm font-bold text-slate-800"
        data-testid="dashboard-shopfloor-perf-toggle"
      >
        <span>Bugünkü Performans — operatör / istasyon ({perf?.total_done || 0} adım tamamlandı)</span>
        <span className="text-xs text-slate-400">{open ? "Gizle" : "Göster"}</span>
      </button>
      {open && perf && (
        <div className="grid md:grid-cols-2 gap-3 mt-3 text-xs">
          {[["Operatörler", operators], ["İstasyonlar", stations]].map(([title, list]) => (
            <div key={title}>
              <div className="font-semibold text-slate-500 mb-1">{title}</div>
              <table className="w-full">
                <thead className="text-slate-400 uppercase text-[10px] border-b">
                  <tr>
                    <th className="text-left py-1">Ad</th>
                    <th className="text-right py-1">Adım</th>
                    <th className="text-right py-1">Üretim</th>
                    <th className="text-right py-1">Fire %</th>
                    <th className="text-right py-1">Ort. dk</th>
                    <th className="text-right py-1">Hedef Aşımı</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {list.length === 0 && (
                    <tr><td colSpan={6} className="py-3 text-center text-slate-400">Bugün tamamlanan adım yok.</td></tr>
                  )}
                  {list.map((r) => (
                    <tr key={r.name} data-testid={`perf-row-${r.name}`}>
                      <td className="py-1 font-semibold">{r.name}</td>
                      <td className="py-1 text-right">{r.done}</td>
                      <td className="py-1 text-right font-bold">{r.produced}</td>
                      <td className={`py-1 text-right font-semibold ${r.scrap_rate > 5 ? "text-rose-600" : "text-slate-600"}`}>%{r.scrap_rate}</td>
                      <td className="py-1 text-right">{r.avg_min ?? "-"}</td>
                      <td className={`py-1 text-right ${r.over_target ? "text-rose-600 font-bold" : ""}`}>{r.over_target}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default DashboardShopFloorPerf;
