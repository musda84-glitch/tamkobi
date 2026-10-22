import React, { useLayoutEffect, useRef, useState } from "react";
import { fitChipCount, summaryChips } from "../roleEditorModel";

const CHIP = {
  can: "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-emerald-700",
  cannot: "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-red-700",
  more: "inline-flex shrink-0 items-center whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold leading-4 text-slate-600",
  warn: "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold leading-4 text-amber-700",
};

function Chip({ chip, hidden }) {
  return (
    <span data-chip={chip.label} className={`${hidden ? "hidden" : ""} ${CHIP[chip.tone]}`}>
      {chip.tone === "can" ? "✓" : "✕"} {chip.label}
    </span>
  );
}

/**
 * Rol başlığının altındaki tek satırlık özet şeridi.
 * Etiketler roleSummary cümlelerinden canlı hesaplanır.
 */
export function RoleSummaryStrip({ perms, features, userCount = 0 }) {
  const { can, cannot, chips } = summaryChips(perms, features);
  const chipKey = chips.map((chip) => `${chip.tone}:${chip.label}`).join("|");
  const scrollRef = useRef(null);
  const measureRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [limit, setLimit] = useState(chips.length);

  useLayoutEffect(() => {
    const measure = () => {
      const scroll = scrollRef.current;
      const box = measureRef.current;
      const desktop = typeof window.matchMedia === "function" && window.matchMedia("(min-width: 701px)").matches;
      if (!scroll || !box || !desktop || scroll.clientWidth <= 0) {
        setLimit(chips.length);
        return;
      }
      const label = box.querySelector("[data-strip-label]");
      const nodes = [...box.querySelectorAll("[data-chip]")];
      const more = box.querySelector("[data-more-size]");
      const available = scroll.clientWidth - (label?.offsetWidth || 0) - 6;
      const widths = nodes.map((node) => node.offsetWidth);
      const count = fitChipCount(widths, available, more?.offsetWidth || 40);
      setLimit((prev) => (prev === count ? prev : count));
    };
    measure();
    if (typeof ResizeObserver !== "function") return undefined;
    const observer = new ResizeObserver(measure);
    if (scrollRef.current) observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [chipKey, chips.length]);

  const shown = Math.min(limit, chips.length);
  const hiddenCount = chips.length - shown;
  const warn = userCount > 0 ? `⚠ ${userCount} kullanıcı etkilenir` : "";

  return (
    <div className="sticky top-16 z-20 my-2.5 rounded-xl border border-slate-200 bg-white px-2.5 py-2 shadow-[0_6px_12px_-10px_rgba(15,23,42,0.25)]" data-testid="role-strip">
      <div className="flex min-w-0 items-center gap-1.5">
        <div
          ref={scrollRef}
          className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto max-[700px]:overflow-x-auto min-[701px]:overflow-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          data-testid="role-strip-scroll"
        >
          <b data-strip-label className="shrink-0 whitespace-nowrap text-[12px] font-bold text-slate-700">Bu rol:</b>
          {chips.map((chip, index) => (
            <Chip key={chip.line} chip={chip} hidden={index >= shown} />
          ))}
          {hiddenCount > 0 && <span className={CHIP.more} data-testid="role-strip-more">+{hiddenCount}</span>}
        </div>
        {warn && <span className={CHIP.warn} data-testid="role-strip-warn">{warn}</span>}
        <button
          type="button"
          className="ml-auto shrink-0 whitespace-nowrap pl-1.5 text-[12px] font-bold text-emerald-600"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          data-testid="role-strip-detail"
        >
          Ayrıntı {open ? "▴" : "▾"}
        </button>
      </div>
      <div ref={measureRef} className="pointer-events-none absolute h-0 overflow-hidden opacity-0" aria-hidden="true">
        <b data-strip-label className="inline-block whitespace-nowrap text-[12px] font-bold">Bu rol:</b>
        {chips.map((chip) => <Chip key={`m-${chip.line}`} chip={chip} />)}
        <span data-more-size className={CHIP.more}>+{Math.max(chips.length, 1)}</span>
      </div>
      <div className={`${open ? "mt-2 grid grid-cols-1 gap-4 border-t border-dashed border-slate-200 pt-2 min-[701px]:grid-cols-2" : "hidden"}`} data-testid="role-summary">
        <div>
          <h4 className="m-0 text-[11px] font-extrabold uppercase tracking-wide text-emerald-700">Yapabilir</h4>
          <ul className="mt-1 mb-0 list-disc pl-4 text-[13px] leading-relaxed text-slate-700 marker:text-emerald-600">
            {can.length ? can.map((line) => <li key={line}>{line}</li>) : <li>Açık yetki yok</li>}
          </ul>
        </div>
        <div>
          <h4 className="m-0 text-[11px] font-extrabold uppercase tracking-wide text-red-700">Yapamaz</h4>
          <ul className="mt-1 mb-0 list-disc pl-4 text-[13px] leading-relaxed text-slate-700 marker:text-red-600">
            {cannot.map((line) => <li key={line}>{line}</li>)}
          </ul>
          {userCount > 0 && (
            <div className="mt-2 text-[12px] text-amber-700" data-testid="role-user-warn">
              ⚠ Bu rolde {userCount} kullanıcı var. Değişiklikler &quot;Kaydet&quot; ile uygulanır.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
