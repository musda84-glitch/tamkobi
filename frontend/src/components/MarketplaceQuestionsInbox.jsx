import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import {
  ChevronRight,
  Loader2,
  MessageCircleQuestion,
  RefreshCw,
} from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { useDataRefresh } from "../utils/dataRefresh";
import { channelTr } from "../utils/labels";

const waitingStatus = (q) => q?.status === "WAITING_FOR_ANSWER";

const shortTime = (s) => {
  if (!s) return "—";
  try {
    return new Date(s).toLocaleString("tr-TR", { dateStyle: "short", timeStyle: "short" });
  } catch {
    return "—";
  }
};

/** Dashboard: son gelen pazaryeri müşteri soruları (kısa liste). */
export function MarketplaceQuestionsInbox({ companyId }) {
  const [items, setItems] = useState([]);
  const [waiting, setWaiting] = useState(0);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const r = await axios.get(`${API_URL}/marketplace/questions`, {
        params: { company_id: companyId },
      });
      const rows = Array.isArray(r.data) ? r.data : [];
      const pending = rows.filter(waitingStatus);
      const sorted = [...rows].sort((a, b) => {
        const aw = waitingStatus(a) ? 0 : 1;
        const bw = waitingStatus(b) ? 0 : 1;
        if (aw !== bw) return aw - bw;
        return String(b.asked_at || "").localeCompare(String(a.asked_at || ""));
      });
      setItems(sorted.slice(0, 6));
      setWaiting(pending.length);
    } catch {
      /* sessiz */
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useDataRefresh(load, { companyId, scopes: ["orders"] });

  return (
    <div className="bg-white rounded-2xl border border-slate-200/90 shadow-sm overflow-hidden" data-testid="marketplace-questions-inbox">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100 bg-slate-50/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative shrink-0">
            <MessageCircleQuestion className="w-4 h-4 text-orange-600" />
            {waiting > 0 && (
              <span className="absolute -top-1.5 -right-1.5 min-w-[1rem] h-4 px-1 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center" data-testid="marketplace-questions-count">
                {waiting > 99 ? "99+" : waiting}
              </span>
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900 truncate">Sipariş Soruları</h2>
            <p className="text-[11px] text-slate-500 truncate">
              {loading ? "Yükleniyor…" : waiting ? `${waiting} cevap bekleyen soru` : "Cevap bekleyen soru yok"}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setLoading(true); load(); }}
          className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-white hover:text-slate-800"
          title="Yenile"
          data-testid="marketplace-questions-refresh"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {loading && items.length === 0 ? (
        <div className="px-4 py-4 text-center text-slate-400 text-xs flex items-center justify-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin" /> Sorular yükleniyor…
        </div>
      ) : items.length === 0 ? (
        <div className="px-4 py-3 text-center text-slate-400 text-xs" data-testid="marketplace-questions-empty">
          Son gelen pazaryeri müşteri sorusu yok.
        </div>
      ) : (
        <ul className="divide-y divide-slate-100 max-h-40 overflow-y-auto" data-testid="marketplace-questions-list">
          {items.map((q) => {
            const id = q.id || q._id || q.external_id;
            const wait = waitingStatus(q);
            return (
              <li key={id} className="px-4 py-2.5 flex items-start gap-2" data-testid={`marketplace-question-${id}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 mb-0.5">
                    <span className="text-[10px] font-semibold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded">{channelTr(q.channel)}</span>
                    {wait && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">Cevap bekliyor</span>}
                    <span className="text-[10px] text-slate-400">{shortTime(q.asked_at)}</span>
                  </div>
                  <div className="text-xs font-bold text-slate-900 truncate">{q.product_name || "Ürün"}</div>
                  <div className="text-[11px] text-slate-600 line-clamp-2" title={q.question}>“{q.question || "—"}”</div>
                </div>
                <Link
                  to="/orders?tab=questions"
                  className="shrink-0 inline-flex items-center gap-0.5 text-[10px] font-bold text-slate-600 hover:text-slate-900 mt-0.5"
                >
                  Aç <ChevronRight className="w-3 h-3" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="px-4 py-2.5 border-t border-slate-100 bg-slate-50/50">
        <Link to="/orders?tab=questions" className="text-[11px] font-bold text-slate-700 hover:text-slate-900 inline-flex items-center gap-1" data-testid="marketplace-questions-see-all">
          Tüm müşteri sorularına git <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}

export default MarketplaceQuestionsInbox;
