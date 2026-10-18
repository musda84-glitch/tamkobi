import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { History, Search } from "lucide-react";
import { API_URL, useAuth } from "../context/AuthContext";
import { ExportButtons } from "../components/ExportButtons";
import { activeCompanyId } from "../utils/activeCompanyId";
import NoCompanyNotice from "../components/NoCompanyNotice";

const inputCls = "bg-white border border-slate-200 rounded-lg px-2.5 py-1.5 text-xs";

const fmtDate = (s) => {
  if (!s) return "—";
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

const COLUMNS = [
  { key: "at", label: "Zaman", value: (r) => fmtDate(r.at) },
  { key: "user_name", label: "Kullanıcı" },
  { key: "module_label", label: "Modül" },
  { key: "action_label", label: "İşlem" },
  { key: "record_label", label: "Kayıt", value: (r) => r.record_no ? `${r.record_label || ""} ${r.record_no}`.trim() : (r.record_label || "") },
  { key: "summary", label: "Özet" },
  { key: "ip", label: "IP" },
  { key: "source", label: "Kaynak", value: (r) => (r.source === "mobile" ? "Mobil" : "Web") },
];

export default function CompanyAuditPage() {
  const { activeCompany, user } = useAuth();
  const navigate = useNavigate();
  const companyId = activeCompanyId(activeCompany);
  const [filters, setFilters] = useState({ user_id: "", module: "", action: "", date_from: "", date_to: "", q: "" });
  const [applied, setApplied] = useState(filters);
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const params = useMemo(() => ({
    company_id: companyId,
    user_id: applied.user_id || undefined,
    module: applied.module || undefined,
    action: applied.action || undefined,
    date_from: applied.date_from || undefined,
    date_to: applied.date_to || undefined,
    q: applied.q || undefined,
    limit: 200,
  }), [companyId, applied]);

  const load = useCallback(() => {
    if (!companyId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    axios.get(`${API_URL}/company-audit`, { params })
      .then((r) => setData(r.data))
      .catch((err) => {
        const status = err.response?.status;
        const detail = err.response?.data?.detail || "İşlem geçmişi yüklenemedi.";
        setData(null);
        setError(status === 403 ? "Bu ekranı görme yetkiniz yok." : detail);
        if (status !== 403) toast.error(typeof detail === "string" ? detail : "İşlem geçmişi yüklenemedi.");
      })
      .finally(() => setLoading(false));
  }, [companyId, params]);

  useEffect(() => { load(); }, [load]);

  const set = (key, value) => setFilters((prev) => ({ ...prev, [key]: value }));
  const apply = (e) => {
    e?.preventDefault();
    setApplied(filters);
  };

  const loadExport = async () => {
    const r = await axios.get(`${API_URL}/company-audit`, { params: { ...params, limit: 5000 } });
    return r.data?.items || [];
  };

  const items = data?.items || [];
  const openRow = (row) => {
    if (row.href) navigate(row.href);
  };

  return (
    <div className="p-4 md:p-6 space-y-4" data-testid="company-audit-page">
      {!companyId && <NoCompanyNotice />}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold text-slate-900 flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-600" /> İşlem Geçmişi
          </h1>
          <p className="text-xs text-slate-500 mt-1" data-testid="company-audit-retention">
            Firma kullanıcıları ve personelin işlemleri. Kayıtlar düzenlenemez ve silinemez; {data?.retention_days || 365} gün saklanır.
            {user?.name ? ` Görüntüleyen: ${user.name}.` : ""}
          </p>
        </div>
        <ExportButtons rows={items} columns={COLUMNS} filename="islem_gecmisi" title="İşlem Geçmişi" company={activeCompany?.name} loadRows={loadExport} />
      </div>

      <form onSubmit={apply} className="bg-white border border-slate-200 rounded-2xl p-3 flex flex-wrap gap-2 items-end" data-testid="company-audit-filters">
        <label className="text-[11px] text-slate-500 font-semibold">Başlangıç
          <input type="date" value={filters.date_from} onChange={(e) => set("date_from", e.target.value)} className={`${inputCls} block mt-1`} data-testid="audit-date-from" />
        </label>
        <label className="text-[11px] text-slate-500 font-semibold">Bitiş
          <input type="date" value={filters.date_to} onChange={(e) => set("date_to", e.target.value)} className={`${inputCls} block mt-1`} data-testid="audit-date-to" />
        </label>
        <label className="text-[11px] text-slate-500 font-semibold">Kullanıcı
          <select value={filters.user_id} onChange={(e) => set("user_id", e.target.value)} className={`${inputCls} block mt-1 min-w-[140px]`} data-testid="audit-filter-user">
            <option value="">Tümü</option>
            {(data?.actors || []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-500 font-semibold">Modül
          <select value={filters.module} onChange={(e) => set("module", e.target.value)} className={`${inputCls} block mt-1 min-w-[140px]`} data-testid="audit-filter-module">
            <option value="">Tümü</option>
            {(data?.modules || []).map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-500 font-semibold">İşlem
          <select value={filters.action} onChange={(e) => set("action", e.target.value)} className={`${inputCls} block mt-1 min-w-[140px]`} data-testid="audit-filter-action">
            <option value="">Tümü</option>
            {(data?.actions || []).map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </label>
        <label className="text-[11px] text-slate-500 font-semibold flex-1 min-w-[180px]">Ara
          <span className="relative block mt-1">
            <Search className="w-3.5 h-3.5 absolute left-2 top-2 text-slate-400" />
            <input value={filters.q} onChange={(e) => set("q", e.target.value)} placeholder="Kayıt, özet, kullanıcı" className={`${inputCls} w-full pl-7`} data-testid="audit-search" />
          </span>
        </label>
        <button type="submit" className="px-3 py-1.5 bg-slate-900 text-white rounded-lg text-xs font-semibold" data-testid="audit-apply">Filtrele</button>
      </form>

      {error ? (
        <div className="bg-rose-50 border border-rose-200 text-rose-700 rounded-xl px-4 py-3 text-sm" data-testid="company-audit-error">{error}</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-2xl overflow-auto" data-testid="company-audit-table">
          <table className="w-full min-w-[860px] text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase text-[10px]">
              <tr>
                <th className="px-3 py-2 text-left">Zaman</th>
                <th className="px-3 py-2 text-left">Kullanıcı</th>
                <th className="px-3 py-2 text-left">Modül</th>
                <th className="px-3 py-2 text-left">İşlem</th>
                <th className="px-3 py-2 text-left">Kayıt</th>
                <th className="px-3 py-2 text-left">Özet</th>
                <th className="px-3 py-2 text-left">IP</th>
                <th className="px-3 py-2 text-left">Kaynak</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {loading && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Yükleniyor…</td></tr>}
              {!loading && items.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-400">Kayıt yok.</td></tr>}
              {items.map((row) => (
                <tr
                  key={row.id}
                  onClick={() => openRow(row)}
                  className={row.href ? "hover:bg-indigo-50/60 cursor-pointer" : "hover:bg-slate-50"}
                  data-testid="audit-row"
                  data-href={row.href || ""}
                >
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">{fmtDate(row.at)}</td>
                  <td className="px-3 py-2 font-semibold text-slate-800">{row.user_name || "—"}</td>
                  <td className="px-3 py-2">{row.module_label || row.module}</td>
                  <td className="px-3 py-2"><span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 font-semibold">{row.action_label || row.action}</span></td>
                  <td className="px-3 py-2">{row.record_label || "—"}{row.record_no ? <span className="text-slate-400"> · {row.record_no}</span> : null}</td>
                  <td className="px-3 py-2 text-slate-700">{row.summary}</td>
                  <td className="px-3 py-2 font-mono text-slate-400">{row.ip || "—"}</td>
                  <td className="px-3 py-2">{row.source === "mobile" ? "Mobil" : "Web"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
