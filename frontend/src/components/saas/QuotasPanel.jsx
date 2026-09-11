
import React, { useCallback, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Gauge, Loader2, Save, Search, Package, Users, Building2, Image } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { fmtBytes, inputCls, PlanChip, StatusBadge, QuotaBar } from "./saasUi";

const cred = { withCredentials: true };
const FIELDS = [
  { key: "product_limit", used: "product_count", label: "Stok kartı", icon: Package },
  { key: "contact_limit", used: "contact_count", label: "Cari kart", icon: Users },
  { key: "company_limit", used: "company_count", label: "Şirket", icon: Building2 },
  { key: "storage_limit_mb", used: "storage_bytes", label: "Resim (MB)", icon: Image, storage: true },
];

const emptyForm = () => ({ product_limit: "", contact_limit: "", company_limit: "", storage_limit_mb: "" });

const fromRow = (r) => {
  const ov = r.overrides || {};
  const f = emptyForm();
  for (const k of Object.keys(f)) f[k] = ov[k] === 0 || ov[k] ? String(ov[k]) : "";
  return f;
};

export const QuotasPanel = ({ onOpenCompany }) => {
  const [data, setData] = useState(null);
  const [q, setQ] = useState("");
  const [forms, setForms] = useState({});
  const [busy, setBusy] = useState("");
  const load = useCallback(() => axios.get(`${API_URL}/system/quotas`, cred).then((r) => {
    setData(r.data);
    const next = {};
    (r.data.quotas || []).forEach((row) => { next[row.id] = fromRow(row); });
    setForms(next);
  }).catch((e) => toast.error(e.response?.data?.detail || "Kotalar alınamadı.")), []);
  useEffect(() => { load(); }, [load]);
  const rows = useMemo(() => {
    const list = data?.quotas || [];
    const s = q.trim().toLowerCase();
    if (!s) return list;
    return list.filter((r) => (r.name || "").toLowerCase().includes(s) || (r.plan_name || "").toLowerCase().includes(s));
  }, [data, q]);
  const save = async (row) => {
    const f = forms[row.id] || emptyForm();
    setBusy(row.id);
    try {
      const payload = {};
      for (const k of Object.keys(emptyForm())) payload[k] = f[k] === "" ? null : Number(f[k]);
      await axios.put(`${API_URL}/system/companies/${row.id}/license`, payload, cred);
      toast.success(`${row.name} kotaları güncellendi.`);
      await load();
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  if (!data) return <div className="text-xs text-slate-400 p-6" data-testid="quotas-loading">Yükleniyor…</div>;
  return (
    <div className="space-y-4 text-xs" data-testid="saas-quotas">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-slate-600 max-w-3xl">Her müşteri lisansı için stok kartı, cari kart, şirket sayısı ve resim depolama kotalarını tanımlayın. Boş alan paketten gelir; <b>0 = sınırsız</b>. Kullanım, lisans altındaki tüm şirketlerin toplamıdır.</p>
        </div>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-2.5" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Müşteri veya paket ara" className={inputCls + " pl-8 w-64 bg-white"} data-testid="quotas-search" />
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {FIELDS.map((f) => {
          const Icon = f.icon;
          const limited = rows.filter((r) => r[f.key] > 0).length;
          return (
            <div key={f.key} className="bg-white border border-slate-200 rounded-2xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold flex items-center gap-1.5"><Icon className="w-3.5 h-3.5" />{f.label}</div>
              <div className="text-lg font-bold text-slate-900 mt-1">{limited}/{rows.length}</div>
              <div className="text-[10px] text-slate-400">lisans kotası tanımlı</div>
            </div>
          );
        })}
      </div>
      <div className="bg-white border border-slate-200 rounded-2xl overflow-x-auto">
        <table className="w-full min-w-[1080px]">
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wider text-slate-500">
            <tr>
              <th className="px-3 py-2.5 text-left">Müşteri</th>
              {FIELDS.map((f) => <th key={f.key} className="px-3 py-2.5 text-left">{f.label}</th>)}
              <th className="px-3 py-2.5 text-right"> </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-400">Kayıt yok.</td></tr>
            ) : rows.map((r) => {
              const f = forms[r.id] || emptyForm();
              const set = (k, v) => setForms((prev) => ({ ...prev, [r.id]: { ...(prev[r.id] || emptyForm()), [k]: v } }));
              return (
                <tr key={r.id} className="align-top" data-testid={`quota-row-${r.id}`}>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => onOpenCompany && onOpenCompany(r.id)} className="text-left font-semibold text-slate-900 hover:underline" data-testid={`quota-open-${r.id}`}>{r.name}</button>
                    <div className="flex items-center gap-1.5 mt-1"><PlanChip name={r.plan_name} color={r.plan_color} /><StatusBadge status={r.status} /></div>
                  </td>
                  {FIELDS.map((col) => {
                    const used = col.storage ? Number(r.storage_bytes || 0) / (1024 * 1024) : r[col.used];
                    const limit = r[col.key];
                    const planDef = r.plan_defaults?.[col.key] ?? 0;
                    return (
                      <td key={col.key} className="px-3 py-3 w-44">
                        <QuotaBar used={col.storage ? Number(used.toFixed(1)) : used} limit={limit} testId={`quota-bar-${col.key}-${r.id}`} />
                        {col.storage && <div className="text-[10px] text-slate-400 mt-0.5">{fmtBytes(r.storage_bytes)} kullanılıyor</div>}
                        <label className="block text-[10px] text-slate-500 mt-1.5 mb-0.5">Özel limit (boş = paket: {planDef || "∞"})</label>
                        <input type="number" min={0} value={f[col.key]} onChange={(e) => set(col.key, e.target.value)} className={inputCls} placeholder={planDef ? String(planDef) : "sınırsız"} data-testid={`quota-${col.key}-${r.id}`} />
                      </td>
                    );
                  })}
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <button type="button" disabled={busy === r.id} onClick={() => save(r)} className="px-3 py-1.5 bg-slate-900 text-white rounded-lg font-bold inline-flex items-center gap-1 disabled:opacity-60" data-testid={`quota-save-${r.id}`}>
                      {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Kaydet
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[10px] text-slate-400 flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> Limit aşıldığında stok/cari oluşturma ve resim yükleme 403 döner; mevcut kayıtlar silinmez.</p>
    </div>
  );
};
