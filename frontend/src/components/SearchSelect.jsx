
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Search, ChevronDown, Package } from "lucide-react";
import { resolveImageUrl } from "../utils/imageUrl";

const placeMenu = (anchor, wide) => {
  const rect = anchor.getBoundingClientRect();
  const width = Math.max(rect.width, wide ? 340 : 280);
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
  const below = window.innerHeight - rect.bottom;
  const openUp = below < 240 && rect.top > below;
  return {
    left,
    width,
    top: openUp ? undefined : rect.bottom + 4,
    bottom: openUp ? window.innerHeight - rect.top + 4 : undefined,
    maxHeight: Math.max(160, Math.min(320, openUp ? rect.top - 16 : below - 16)),
  };
};

export const SearchSelect = ({ value, onChange, options, placeholder = "Ara...", getLabel, getSub, getExtra, getImage, testId, className = "", inline = false }) => {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [box, setBox] = useState(null);
  const ref = useRef(null);
  const menuRef = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current?.contains(e.target) || menuRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);
  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const update = () => setBox(placeMenu(ref.current, !!getExtra));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, getExtra]);
  const selected = options.find((o) => o.id === value);
  const ql = q.toLowerCase();
  const filtered = options.filter((o) => {
    if (!ql) return true;
    const extra = typeof getExtra === "function" ? getExtra(o) : "";
    const extraText = typeof extra === "string" ? extra : "";
    return getLabel(o).toLowerCase().includes(ql) || (getSub?.(o) || "").toLowerCase().includes(ql) || extraText.toLowerCase().includes(ql);
  }).slice(0, 50);
  const panel = (
    <>
      <div className="relative border-b"><Search className="w-3.5 h-3.5 absolute left-2.5 top-2.5 text-slate-400" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ad, SKU veya barkod ile ara..." className="w-full pl-8 p-2 text-xs outline-none" data-testid={testId ? `${testId}-search` : undefined} /></div>
      <div className="max-h-48 overflow-y-auto">
        {filtered.length === 0 && <div className="p-3 text-xs text-slate-400 text-center">Sonuç yok</div>}
        {filtered.map((o) => (
          <button type="button" key={o.id || getLabel(o)} onClick={() => { onChange(o.id, o); setOpen(false); setQ(""); }} className={`w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-emerald-50 ${o.id === value ? "bg-emerald-50/60" : ""}`} data-testid={testId ? `${testId}-option-${o.id}` : undefined}>
            {getImage && (getImage(o) ? <img src={resolveImageUrl(getImage(o))} alt="" className="w-8 h-8 rounded-md object-cover shrink-0 border border-slate-200" /> : <span className="w-8 h-8 rounded-md bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><Package className="w-3.5 h-3.5" /></span>)}
            <div className="flex-1 min-w-0"><div className="font-semibold text-slate-900 truncate">{getLabel(o)}</div>{getSub && <div className="text-[10px] text-slate-500 truncate">{getSub(o)}</div>}{getExtra && <div className="text-[10px] text-amber-800 mt-0.5 leading-snug" data-testid={testId ? `${testId}-cost-${o.id}` : undefined}>{getExtra(o)}</div>}</div>
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div ref={ref} className={`relative ${className}`} data-testid={testId}>
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 bg-white border border-slate-200 rounded-lg p-1.5 text-left text-xs" data-testid={testId ? `${testId}-trigger` : undefined}>
        {selected && getImage && (getImage(selected) ? <img src={resolveImageUrl(getImage(selected))} alt="" className="w-6 h-6 rounded object-cover shrink-0" /> : <span className="w-6 h-6 rounded bg-slate-100 flex items-center justify-center text-slate-400 shrink-0"><Package className="w-3 h-3" /></span>)}
        <span className={`flex-1 truncate ${selected ? "font-medium text-slate-900" : "text-slate-400"}`}>{selected ? getLabel(selected) : placeholder}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
      </button>
      {open && inline && (
        <div ref={menuRef} className="mt-1 w-full min-w-[280px] bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden" data-testid={testId ? `${testId}-menu` : undefined}>
          {panel}
        </div>
      )}
      {open && !inline && box && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] bg-white border border-slate-200 rounded-xl shadow-xl overflow-hidden"
          style={{ top: box.top, bottom: box.bottom, left: box.left, width: box.width, maxHeight: box.maxHeight }}
          data-testid={testId ? `${testId}-menu` : undefined}
        >
          {panel}
        </div>,
        document.body
      )}
    </div>
  );
};
