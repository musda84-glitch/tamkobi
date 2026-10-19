import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** Yatay durum çipleri (sheet'e girmez). */
export const mobileChipRowClass = "flex gap-2 overflow-x-auto -mx-4 px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const mobileChipClass = (selected) =>
  `shrink-0 h-9 rounded-full px-3 text-xs font-semibold ${selected ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-600"}`;

/** Sheet içindeki select/input. */
export const mobileFilterFieldClass = "w-full h-11 rounded-xl bg-white border border-slate-200 px-3 text-sm text-slate-700 outline-none focus:ring-2 focus:ring-emerald-500";

export function MobileFilterField({ label, children }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

/**
 * Telefon filtreleri. Açık sheet document.body'ye portal olur;
 * kapalıyken children mount edilmez (masaüstü testid'leri tek kalır).
 */
export function MobileFilterSheet({ activeCount = 0, onClear, onApply, children }) {
  const [open, setOpen] = useState(false);
  const count = Number(activeCount) || 0;
  const active = count > 0;

  const close = () => setOpen(false);
  const apply = () => {
    onApply?.();
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const sheet = open ? (
    <div className="sm:hidden">
      <div
        className="fixed inset-0 z-50 bg-black/40"
        onClick={close}
        data-testid="mobile-filter-backdrop"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Filtreler (${count})`}
        className="fixed bottom-0 inset-x-0 z-50 flex max-h-[78vh] flex-col rounded-t-2xl bg-white shadow-2xl"
        data-testid="mobile-filter-sheet"
      >
        <div className="flex justify-center pt-2" aria-hidden="true">
          <div className="h-1.5 w-10 rounded-full bg-slate-300" data-testid="mobile-filter-handle" />
        </div>
        <div className="flex items-center justify-between gap-3 px-4 py-2">
          <h2 className="text-base font-semibold text-slate-900" data-testid="mobile-filter-title">
            {`Filtreler (${count})`}
          </h2>
          <button
            type="button"
            onClick={close}
            aria-label="Kapat"
            className="flex h-9 w-9 items-center justify-center rounded-full text-lg text-slate-500 hover:bg-slate-100"
            data-testid="mobile-filter-close"
          >
            ✕
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-3">
          {children}
        </div>
        <div className="grid grid-cols-2 gap-2 border-t border-slate-100 p-4">
          <button
            type="button"
            onClick={() => onClear?.()}
            className="h-11 rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700"
            data-testid="mobile-filter-clear"
          >
            Temizle
          </button>
          <button
            type="button"
            onClick={apply}
            className="h-11 rounded-xl bg-emerald-600 text-sm font-semibold text-white"
            data-testid="mobile-filter-apply"
          >
            Uygula
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border px-3 text-sm font-semibold ${
          active
            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
            : "border-slate-200 bg-white text-slate-700"
        }`}
        data-testid="mobile-filter-button"
        data-active={active ? "1" : "0"}
      >
        {"Filtreler"}
        {active && (
          <>
            {" "}
            <span
              className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-emerald-600 px-1.5 text-[11px] font-bold leading-none text-white"
              data-testid="mobile-filter-badge"
            >
              {`(${count})`}
            </span>
          </>
        )}
      </button>
      {sheet && createPortal(sheet, document.body)}
    </>
  );
}
