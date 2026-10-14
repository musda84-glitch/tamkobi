import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { API_URL } from "../../context/AuthContext";

function fmtWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR");
}

/**
 * Platform (ynt) firma detayındaki SMS sekmesi: salt okunur özet.
 * Operatör kimliği, şifre ve gönderim firma panelinde (Ayarlar → SMS) yönetilir.
 */
export default function CompanySmsSummary({ companyId }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!companyId) return;
    setLoading(true);
    try {
      const r = await axios.get(`${API_URL}/system/companies/${companyId}/sms`);
      setData(r.data || {});
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SMS özeti alınamadı");
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const connected = Boolean(data?.connected);
  const operator = data?.operator || "—";

  return (
    <div className="space-y-4" data-testid="company-sms-summary">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs text-slate-500 max-w-xl">
          Operatör kullanıcı adı, şifre ve gönderici başlığı üye şirkete aittir. Firma yöneticisi
          bunları kendi panelinde, Ayarlar → SMS üzerinden yönetir. Bu ekran yalnızca durum özetidir.
        </p>
        <button type="button" onClick={load} disabled={loading} className="px-3 py-1.5 border rounded-lg font-bold inline-flex items-center gap-1.5 shrink-0 disabled:opacity-60" data-testid="company-sms-summary-refresh">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} /> Yenile
        </button>
      </div>

      {loading && !data ? (
        <div className="text-sm text-slate-400">Yükleniyor…</div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="company-sms-connected">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Bağlantı</div>
            <div className={`mt-1 text-sm font-semibold ${connected ? "text-emerald-700" : "text-slate-500"}`}>
              {connected ? "Bağlı" : "Bağlı değil"}
            </div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="company-sms-operator">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Operatör</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{operator}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="company-sms-last-sent">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Son gönderim</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{fmtWhen(data?.last_sent_at)}</div>
          </div>
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3" data-testid="company-sms-errors">
            <div className="text-[10px] uppercase tracking-wide text-slate-400 font-semibold">Hata sayısı</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">{data?.error_count ?? 0}</div>
          </div>
        </div>
      )}
    </div>
  );
}
