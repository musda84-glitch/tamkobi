import React, { useEffect, useMemo, useState } from "react";
import { useHelpOptional } from "../../context/HelpContext";

function measure(selector) {
  if (typeof document === "undefined" || !selector) return null;
  const el = document.querySelector(selector);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  return { top: r.top, left: r.left, width: r.width, height: r.height };
}

export function PageTour() {
  const help = useHelpOptional();
  const [box, setBox] = useState(null);
  const steps = useMemo(() => {
    const raw = help?.pageHelp?.tour || [];
    return raw.filter((s) => measure(s.selector));
  }, [help?.pageHelp, help?.tourOpen]); // re-filter when opened

  useEffect(() => {
    if (!help?.tourOpen) return undefined;
    const step = steps[help.tourIndex];
    const tick = () => setBox(step ? measure(step.selector) : null);
    tick();
    window.addEventListener("resize", tick);
    window.addEventListener("scroll", tick, true);
    return () => {
      window.removeEventListener("resize", tick);
      window.removeEventListener("scroll", tick, true);
    };
  }, [help?.tourOpen, help?.tourIndex, steps]);

  if (!help?.tourOpen) return null;
  if (!steps.length) {
    return (
      <div className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4" data-testid="help-tour-empty">
        <div className="bg-white rounded-2xl p-5 max-w-sm text-sm">
          <div className="font-bold text-slate-900 mb-1">Tur hedefi yok</div>
          <p className="text-slate-500 text-xs mb-3">Bu ekranda işaretlenecek düğme bulunamadı. Yardım metnini ? menüsünden okuyabilirsiniz.</p>
          <button type="button" className="px-3 py-2 bg-slate-900 text-white rounded-lg text-xs font-semibold" onClick={() => help.stopTour(true)}>Kapat</button>
        </div>
      </div>
    );
  }

  const i = Math.min(help.tourIndex, steps.length - 1);
  const step = steps[i];
  const pad = 8;
  const highlight = box
    ? { top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2 }
    : { top: 80, left: 24, width: 280, height: 48 };
  const bubbleTop = Math.min(window.innerHeight - 180, highlight.top + highlight.height + 12);
  const bubbleLeft = Math.min(window.innerWidth - 320, Math.max(12, highlight.left));

  return (
    <div className="fixed inset-0 z-[90]" data-testid="help-tour-overlay">
      <div className="absolute inset-0 bg-slate-900/55" onClick={() => help.stopTour(false)} />
      <div
        className="absolute rounded-xl ring-2 ring-indigo-400 ring-offset-2 ring-offset-transparent shadow-[0_0_0_9999px_rgba(15,23,42,0.55)] pointer-events-none transition-all"
        style={{ top: highlight.top, left: highlight.left, width: highlight.width, height: highlight.height }}
        data-testid="help-tour-highlight"
      />
      <div
        className="absolute w-72 max-w-[calc(100vw-1.5rem)] bg-white rounded-2xl shadow-2xl border border-slate-200 p-3"
        style={{ top: bubbleTop, left: bubbleLeft }}
        data-testid="help-tour-bubble"
      >
        <div className="text-[10px] uppercase tracking-wider text-indigo-500 font-semibold">
          {i + 1} / {steps.length}
        </div>
        <div className="text-sm font-bold text-slate-900 mt-0.5">{step.title}</div>
        <p className="text-xs text-slate-600 mt-1 leading-relaxed">{step.body}</p>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="text-[11px] text-slate-500 hover:underline"
            data-testid="help-tour-skip"
            onClick={() => help.stopTour(true)}
          >
            Atla
          </button>
          <div className="ml-auto flex gap-1.5">
            {i > 0 && (
              <button
                type="button"
                className="px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold"
                onClick={() => help.setTourIndex(i - 1)}
              >
                Geri
              </button>
            )}
            {i < steps.length - 1 ? (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-[11px] font-semibold"
                data-testid="help-tour-next"
                onClick={() => help.setTourIndex(i + 1)}
              >
                İleri
              </button>
            ) : (
              <button
                type="button"
                className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold"
                data-testid="help-tour-finish"
                onClick={() => help.stopTour(true)}
              >
                Bitir
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
