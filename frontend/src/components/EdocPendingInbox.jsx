import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ChevronRight,
  FileText,
  Inbox,
  Loader2,
  RefreshCw,
} from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { uniqueInboxItems } from "../utils/edocInbox";
import { fmtDate, formatTrAmount } from "../utils/money";

/** Dashboard: bekleyen gelen e-belgeler (kısa liste). */
export function EdocPendingInbox({ companyId }) {
  const [items, setItems] = useState([]);
  const [count, setCount] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/edocs/inbox`, {
        params: { company_id: companyId, status: "pending" },
      });
      const list = uniqueInboxItems(r.data?.items || []);
      setItems(list.slice(0, 8));
      setCount(Number(r.data?.counts?.pending ?? list.length) || list.length);
    } catch {
      /* sessiz */
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["invoices", "einvoice"] });

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden" data-testid="edoc-pending-inbox">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <Inbox className="w-4 h-4 text-indigo-600" />
            {count > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center" data-testid="edoc-pending-count">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">e Belgeler (bekleyen)</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {loading ? "Yükleniyor…" : count ? `${count} belge onay / eşleme bekliyor` : "Bekleyen e-belge yok"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:text-slate-800"
          title="Yenile"
          data-testid="edoc-pending-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="px-4 py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Belgeler yükleniyor…
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-3 text-center text-slate-400 text-xs" data-testid="edoc-pending-empty">
          Bekleyen gelen e-fatura veya e-irsaliye yok.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-36 overflow-y-auto" data-testid="edoc-pending-list">
          {items.map((d) => (
            <li key={d.id} className="px-4 py-2.5 flex items-center gap-2" data-testid={`edoc-pending-${d.id}`}>
              <FileText className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="text-xs font-bold text-slate-900 truncate">{d.supplier?.name || "Tedarikçi ?"}</div>
                <div className="text-[11px] text-slate-500 truncate">
                  {d.kind === "dispatch" ? "e-İrsaliye" : "e-Fatura"} · {d.number || "—"} · {fmtDate(d.issue_date)}
                  {" · "}{formatTrAmount(Number(d.grand_total) || 0)} ₺
                </div>
              </div>
              <Link
                to="/edoc-inbox"
                className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 hover:text-slate-900"
              >
                Aç <ChevronRight className="w-3 h-3" />
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
        <Link to="/edoc-inbox" className="text-[11px] font-bold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1" data-testid="edoc-pending-see-all">
          Gelen e-belgelere git <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

export default EdocPendingInbox;
