import React from "react";
import { Check } from "lucide-react";
import { groupByCategory } from "./saasUi";
import { packQuote } from "../../utils/modulePack";

const tl = (n) => (Number(n) || 0).toLocaleString("tr-TR", { maximumFractionDigits: 0 });

export default function ModulePackBuilder({ catalog = [], selected = [], onChange, yearly = false, testId = "module-pack-builder" }) {
  const groups = groupByCategory(catalog);
  const toggle = (key) => onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  const total = packQuote(catalog, selected, yearly);
  const monthly = packQuote(catalog, selected, false);
  return (
    <div className="space-y-4" data-testid={testId}>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {Object.entries(groups).map(([cat, mods]) => (
          <div key={cat} className="bg-white/5 border border-white/10 rounded-2xl p-4">
            <div className="text-[10px] uppercase tracking-wider text-emerald-400 font-semibold mb-2">{cat}</div>
            <ul className="space-y-1.5">
              {mods.map((m) => {
                const on = selected.includes(m.key);
                return (
                  <li key={m.key}>
                    <button
                      type="button"
                      onClick={() => toggle(m.key)}
                      className={`w-full text-left rounded-xl px-2.5 py-2 border transition ${on ? "bg-emerald-500/15 border-emerald-400/40" : "border-transparent hover:bg-white/5"}`}
                      data-testid={`pack-mod-${m.key.replace("/", "")}`}
                      aria-pressed={on}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className={`text-xs font-semibold leading-tight ${on ? "text-white" : "text-slate-200"}`}>{m.label}</span>
                        <span className={`text-[10px] font-bold shrink-0 ${on ? "text-emerald-300" : "text-slate-500"}`}>{tl(yearly ? m.price_yearly / 12 : m.price_monthly)} ₺</span>
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5 flex items-center gap-1">
                        {on ? <Check className="w-3 h-3 text-emerald-400 shrink-0" /> : null}
                        {m.description}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
      <div className="bg-emerald-500/10 border border-emerald-400/30 rounded-2xl px-4 py-3 flex flex-wrap items-center justify-between gap-3" data-testid="pack-summary">
        <div className="text-sm">
          <span className="font-bold text-white">{selected.length} modül</span>
          <span className="text-slate-400"> seçildi · çekirdek (özet, ayarlar, çöp) dahil</span>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black text-white" data-testid="pack-total">{tl(yearly ? total / 12 : monthly)} ₺<span className="text-xs font-semibold text-slate-400"> /ay</span></div>
          {yearly ? <div className="text-[11px] text-slate-400">yıllık {tl(total)} ₺</div> : null}
        </div>
      </div>
    </div>
  );
}
