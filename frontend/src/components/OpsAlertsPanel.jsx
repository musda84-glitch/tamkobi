import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  AlertTriangle,
  Bell,
  ChevronRight,
  Factory,
  Loader2,
  Package,
  RefreshCw,
  ShoppingBag,
  Truck,
} from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";

const GROUP_META = {
  low_stock: { Icon: Package, tone: "text-amber-700 bg-amber-50 border-amber-100" },
  production: { Icon: Factory, tone: "text-indigo-700 bg-indigo-50 border-indigo-100" },
  shipped: { Icon: Truck, tone: "text-sky-700 bg-sky-50 border-sky-100" },
  new_orders: { Icon: ShoppingBag, tone: "text-emerald-700 bg-emerald-50 border-emerald-100" },
};

/** Dashboard operasyon bildirimleri: stok / üretim / sevk / yeni sipariş */
export function OpsAlertsPanel({ companyId }) {
  const [groups, setGroups] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState("new_orders");

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/dashboard/ops-alerts`, { params: { company_id: companyId } });
      const gs = r.data?.groups || [];
      setGroups(gs);
      setCount(Number(r.data?.count || 0));
      setActive((prev) => {
        if (gs.some((g) => g.key === prev && g.count > 0)) return prev;
        const first = gs.find((g) => g.count > 0);
        return first?.key || gs[0]?.key || prev;
      });
    } catch {
      /* sessiz */
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["orders", "stock", "production"] });

  const current = groups.find((g) => g.key === active) || groups[0];
  const items = current?.items || [];

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden" data-testid="ops-alerts-panel">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <Bell className="w-4 h-4 text-slate-700" />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center" data-testid="ops-alerts-count">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">Operasyon Bildirimleri</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {loading ? "Yükleniyor…" : count ? `${count} kayıt — stok, üretim, sevk, sipariş` : "Bekleyen operasyon uyarısı yok"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:text-slate-800"
          title="Yenile"
          data-testid="ops-alerts-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid="ops-alerts-tabs">
        {groups.map((g) => {
          const meta = GROUP_META[g.key] || GROUP_META.new_orders;
          const Icon = meta.Icon;
          const on = active === g.key;
          return (
            <button
              key={g.key}
              type="button"
              onClick={() => setActive(g.key)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-bold transition-colors ${
                on ? "bg-slate-900 text-white border-slate-900" : `${meta.tone} hover:opacity-90`
              }`}
              data-testid={`ops-tab-${g.key}`}
            >
              <Icon className="w-3 h-3" />
              {g.label}
              <span className={`min-w-[1.1rem] text-center rounded-md px-1 text-[10px] ${on ? "bg-white/20" : "bg-white/70 text-slate-700"}`}>
                {g.count}
              </span>
            </button>
          );
        })}
      </div>

      {loading && items.length === 0 ? (
        <div className="px-4 py-8 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Bildirimler yükleniyor…
        </div>
      ) : !current || current.count === 0 ? (
        <div className="px-4 py-6 text-center text-slate-400 text-xs flex items-center justify-center gap-1.5" data-testid="ops-alerts-empty">
          <AlertTriangle className="w-3.5 h-3.5 opacity-50" /> Bu kategoride kayıt yok.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-64 overflow-y-auto mt-2" data-testid="ops-alerts-list">
          {items.map((it) => (
            <li key={`${current.key}-${it.id}`} className="px-4 py-2.5 flex items-center gap-2" data-testid={`ops-alert-${current.key}-${it.id}`}>
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 truncate">{it.title}</div>
                <div className="text-[11px] text-slate-500 truncate">{it.detail}</div>
              </div>
              <Link
                to={it.path || current.path || "/"}
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 hover:text-slate-900"
              >
                Aç <ChevronRight className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {current?.path && current.count > 0 && (
        <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
          <Link to={current.path} className="text-[11px] font-bold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1" data-testid="ops-alerts-see-all">
            Tümünü gör <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      )}
    </div>
  );
}

export default OpsAlertsPanel;
