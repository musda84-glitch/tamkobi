
import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Bot, Headset, Save, Building2 } from "lucide-react";
import { API_URL } from "../../context/AuthContext";
import { Toggle } from "./saasUi";

const cred = { withCredentials: true };
const ICONS = { ai: Bot, support: Headset };

export const AddonsPanel = () => {
  const [d, setD] = useState(null);
  const [busy, setBusy] = useState("");
  const load = useCallback(() => axios.get(`${API_URL}/system/addons`, cred).then((r) => setD(r.data)).catch(() => toast.error("Araç listesi alınamadı.")), []);
  useEffect(() => { load(); }, [load]);
  if (!d) return <div className="text-xs text-slate-400">Yükleniyor…</div>;
  const setDefault = async (key, enabled) => {
    setBusy(key);
    try {
      const r = await axios.put(`${API_URL}/system/addons`, { defaults: { [key]: enabled } }, cred);
      setD(r.data);
      toast.success(enabled ? "Tüm müşterilerde varsayılan açık." : "Tüm müşterilerde varsayılan kapalı (şirket özel ayarı hariç).");
    } catch (e) { toast.error(e.response?.data?.detail || "Kaydedilemedi."); } finally { setBusy(""); }
  };
  return (
    <div className="space-y-4 text-xs" data-testid="saas-addons">
      <p className="text-slate-500">Yapay zeka ve destek araçları ERP paketinden bağımsızdır. Aşağıdaki anahtarlar tüm müşteriler için varsayılandır; şirket kartından müşteri özelinde açılıp kapatılabilir.</p>
      {(d.groups || []).map((g) => {
        const Icon = ICONS[g.key] || Bot;
        const mods = (d.catalog || []).filter((m) => m.group === g.key);
        return (
          <section key={g.key} className="bg-white border border-slate-200 rounded-2xl p-4" data-testid={`addon-group-${g.key}`}>
            <h3 className="font-bold text-slate-900 text-sm mb-3 flex items-center gap-2"><Icon className="w-4 h-4 text-amber-500" /> {g.label}</h3>
            <ul className="divide-y">{mods.map((m) => {
              const on = !!d.defaults?.[m.key];
              const inherited = !!d.inherited?.[m.key];
              const n = d.usage?.[m.key] || 0;
              return (
                <li key={m.key} className="py-2.5 flex items-center justify-between gap-3" data-testid={`addon-row-${m.key.replace(".", "-")}`}>
                  <div className="min-w-0">
                    <div className={`font-semibold ${on ? "text-slate-800" : "text-slate-400"}`}>{m.label}{inherited && <span className="ml-1.5 text-[9px] bg-slate-100 text-slate-500 px-1 rounded">paket/varsayılan</span>}</div>
                    <div className="text-[10px] text-slate-400">{m.description}</div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1" title="Aktif şirket sayısı"><Building2 className="w-3 h-3" /> {n}/{d.company_count || 0}</span>
                    <Toggle on={on} disabled={busy === m.key} onChange={(v) => setDefault(m.key, v)} testId={`addon-default-${m.key.replace(".", "-")}`} />
                  </div>
                </li>
              );
            })}</ul>
          </section>
        );
      })}
      <p className="text-[10px] text-slate-400 flex items-center gap-1"><Save className="w-3 h-3" /> Değişiklik anında kaydedilir. Şirketler &amp; Lisanslar → Yönet ile müşteri özelinde override edilir.</p>
    </div>
  );
};

export const AddonToggles = ({ license, busy, onToggle, onInherit }) => {
  const details = license?.addon_details || {};
  const groups = [
    ["ai", "Yapay zeka", Bot],
    ["support", "Destek araçları", Headset],
  ];
  const keys = Object.keys(details);
  if (!keys.length) return null;
  return (
    <section className="bg-white border border-slate-200 rounded-2xl p-4" data-testid="drawer-addons">
      <h3 className="font-bold text-slate-900 text-sm mb-1">AI &amp; Destek araçları</h3>
      <p className="text-[10px] text-slate-500 mb-3">ERP modüllerinden bağımsız. “özel” işaretli olanlar bu müşteri için platform varsayılanından farklıdır.</p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {groups.map(([g, label, Icon]) => {
          const rows = keys.filter((k) => details[k]?.group === g);
          if (!rows.length) return null;
          return (
            <div key={g} className="border border-slate-100 rounded-xl p-3">
              <div className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold mb-2 flex items-center gap-1"><Icon className="w-3 h-3" /> {label}</div>
              <ul className="space-y-2">{rows.map((k) => {
                const row = details[k];
                const on = !!row.enabled;
                const custom = row.source === "company";
                return (
                  <li key={k} className="flex items-center justify-between gap-2" data-testid={`addon-co-${k.replace(".", "-")}`}>
                    <div className="min-w-0">
                      <div className={`font-semibold ${on ? "text-slate-800" : "text-slate-400"} flex items-center gap-1.5`}>{row.label}{custom && <span className="text-[9px] bg-amber-100 text-amber-800 px-1 rounded">özel</span>}</div>
                    </div>
                    <div className="flex items-center gap-1">
                      {custom && <button type="button" disabled={!!busy} onClick={() => onInherit(k)} className="text-[9px] text-slate-500 hover:text-slate-800" data-testid={`addon-inherit-${k.replace(".", "-")}`}>varsayılan</button>}
                      <Toggle on={on} disabled={busy === k} onChange={(v) => onToggle(k, v)} testId={`addon-toggle-${k.replace(".", "-")}`} />
                    </div>
                  </li>
                );
              })}</ul>
            </div>
          );
        })}
      </div>
    </section>
  );
};
