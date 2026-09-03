import React, { useEffect, useRef, useState } from "react";
import { Search, ChevronDown, Package } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";

export const SearchSelect = ({ value, onChange, options, placeholder = "Ara...", getLabel, getSub, getImage, testId, className = "" }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  const selected = options.find((o) => o.id === value);
  const ql = q.toLowerCase();
  const filtered = options.filter((o) => !ql || getLabel(o).toLowerCase().includes(ql) || (getSub?.(o) || "").toLowerCase().includes(ql)).slice(0, 50);
  return (
    <div ref={ref} className={`relative ${className}`} data-testid={testId}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1.5 text-left text-xs" data-testid={`${testId}-trigger`}>
        {selected && getImage && (getImage(selected) ? <img src={resolveImageUrl(getImage(selected))} alt="" className="w-6 h-6 rounded object-cover shrink-0" /> : <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><Package className="w-3 h-3" /></span>)}
        <span className={`flex-1 truncate ${selected ? "font-medium text-slate-900" : "text-slate-400"}`}>{selected ? getLabel(selected) : placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full min-w-[280px] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden">
          <div className="relative border-b"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, SKU veya barkod ile ara..." className="w-full pl-8 p-2 text-xs outline-none" data-testid={`${testId}-search`} /></div>
          <div className="max-h-60 overflow-y-auto">
            {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Sonuç yok</div>}
            {filtered.map((o) => (
              <button type="button" key={o.id} onClick={() => { onChange(o.id, o); setOpen(false); setQ(""); }} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50 ${o.id === value ? "bg-emerald-50/60" : ""}`} data-testid={`${testId}-option-${o.id}`}>
                {getImage && (getImage(o) ? <img src={resolveImageUrl(getImage(o))} alt="" className="w-8 h-8 rounded-md object-cover shrink-0 border border-slate-200" /> : <span className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><Package className="w-3.5 h-3.5" /></span>)}
                <div className="flex-1 min-w-0"><div className="font-semibold text-slate-900 truncate">{getLabel(o)}</div>{getSub && <div className="text-[10px] text-slate-500 truncate">{getSub(o)}</div>}</div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
