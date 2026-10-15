import React from "react";
import { CheckCircle2, MinusCircle, XCircle, X } from "lucide-react";
import { useEscape } from "../utils/useEscape";
import { backdropDismissProps } from "../utils/modalBackdrop";

const OUTCOME = {
  ok: { label: "Tamam", Icon: CheckCircle2, cls: "text-emerald-700 bg-emerald-50", test: "ok" },
  skipped: { label: "Atlandı", Icon: MinusCircle, cls: "text-slate-600 bg-slate-50", test: "skipped" },
  error: { label: "Hata", Icon: XCircle, cls: "text-rose-700 bg-rose-50", test: "error" },
};

export function bulkResultCounts(items = []) {
  return (items || []).reduce(
    (acc, it) => {
      const k = it?.outcome === "ok" || it?.outcome === "skipped" || it?.outcome === "error" ? it.outcome : "error";
      acc[k] += 1;
      return acc;
    },
    { ok: 0, skipped: 0, error: 0 },
  );
}

export function BulkResultModal({
  title = "Toplu işlem sonucu",
  items = [],
  onClose,
}) {
  useEscape(onClose);
  const counts = bulkResultCounts(items);
  return (
    <div
      className="fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-4"
      {...backdropDismissProps(onClose)}
      data-testid="bulk-result-modal"
    >
      <div
        className="bg-white rounded-xl max-w-lg w-full shadow-2xl border border-slate-200 overflow-hidden max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between bg-slate-800 px-4 py-3">
          <h3 className="text-sm font-bold text-white" data-testid="bulk-result-title">{title}</h3>
          <button
            type="button"
            onClick={onClose}
            className="text-white/80 hover:text-white"
            aria-label="Kapat"
            data-testid="bulk-result-close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 py-2 text-xs text-slate-600 flex flex-wrap gap-2 border-b" data-testid="bulk-result-summary">
          <span>{counts.ok} tamam</span>
          <span>{counts.skipped} atlandı</span>
          <span>{counts.error} hata</span>
        </div>
        <ul className="overflow-y-auto p-3 space-y-1.5 text-sm" data-testid="bulk-result-list">
          {(items || []).map((it, i) => {
            const meta = OUTCOME[it.outcome] || OUTCOME.error;
            const Icon = meta.Icon;
            return (
              <li
                key={it.id || `${it.label}-${i}`}
                className={`rounded-lg px-3 py-2 flex items-start gap-2 ${meta.cls}`}
                data-testid={`bulk-result-row-${meta.test}`}
                data-outcome={it.outcome}
              >
                <Icon className="w-4 h-4 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <div className="font-semibold" data-testid="bulk-result-label">{it.label}</div>
                  <div className="text-[11px] opacity-90">
                    {meta.label}
                    {it.reason ? `: ${it.reason}` : ""}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="p-3 border-t flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 bg-slate-900 text-white rounded-lg text-sm font-semibold"
            data-testid="bulk-result-ok"
          >
            Tamam
          </button>
        </div>
      </div>
    </div>
  );
}
