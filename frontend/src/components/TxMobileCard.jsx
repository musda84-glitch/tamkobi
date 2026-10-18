import React, { useEffect, useRef, useState } from "react";

/** Tailwind `md` breakpoint — tables stay on ≥768px. */
export const TX_MOBILE_MAX_PX = 767;

export const TX_WRAP_CLASS =
  "min-w-0 max-w-full break-words [overflow-wrap:anywhere] [word-break:break-word]";

export const TX_NO_OVERFLOW_CLASS = "overflow-x-hidden max-w-full min-w-0";

const inflowBadge = "bg-emerald-50 text-emerald-700";
const outflowBadge = "bg-rose-50 text-rose-700";
const otherBadge = "bg-indigo-50 text-indigo-700";

export function txTypeBadgeClass(kind) {
  const k = String(kind || "").toLowerCase();
  if (k === "inflow" || k === "giriş" || k === "giris" || k === "alacak") return inflowBadge;
  if (k === "outflow" || k === "çıkış" || k === "cikis" || k === "borç" || k === "borc") return outflowBadge;
  return otherBadge;
}

export function TxTypeBadge({ label, kind, className = "", testId }) {
  if (!label) return null;
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap ${txTypeBadgeClass(kind || label)} ${className}`}
      data-testid={testId}
    >
      {label}
    </span>
  );
}

/** 2-line clamp with "Devamı" — length fallback covers JSDOM (no layout). */
export function ClampExpandText({ text, testId = "tx-card-desc", lines = 2, forceMore }) {
  const raw = String(text || "").trim();
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [overflows, setOverflows] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || open) return;
    setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [raw, open, lines]);

  if (!raw) return null;
  const showToggle = open || overflows || forceMore || raw.length > 72;
  const clampCls = open ? "" : (lines === 2 ? "line-clamp-2" : `line-clamp-${lines}`);

  return (
    <div className={`${TX_WRAP_CLASS} text-xs text-slate-600`} data-testid={testId} data-tx-wrap="1">
      <div ref={ref} className={clampCls} data-testid={`${testId}-body`}>{raw}</div>
      {showToggle ? (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="mt-0.5 text-[11px] font-semibold text-indigo-700 hover:text-indigo-900"
          data-testid={`${testId}-more`}
        >
          {open ? "Kısalt" : "Devamı"}
        </button>
      ) : null}
    </div>
  );
}

export function TxMobileCard({
  testId,
  className = "",
  date,
  party,
  badge,
  amount,
  amountClassName = "text-slate-900",
  description,
  extra,
  actions,
  children,
}) {
  return (
    <div
      className={`rounded-xl border border-slate-200 bg-white p-3 space-y-2 ${TX_NO_OVERFLOW_CLASS} ${TX_WRAP_CLASS} ${className}`}
      data-testid={testId}
      data-tx-mobile-card="1"
      data-tx-wrap="1"
    >
      {children || (
        <>
          <div className="flex items-start justify-between gap-2">
            <div className={`flex-1 ${TX_WRAP_CLASS}`}>
              <div className="flex flex-wrap items-center gap-1.5">
                {date ? <span className="font-mono text-[11px] text-slate-500">{date}</span> : null}
                {party ? <span className={`font-semibold text-slate-900 ${TX_WRAP_CLASS}`}>{party}</span> : null}
                {badge}
              </div>
            </div>
            {amount != null && amount !== "" ? (
              <div className={`shrink-0 text-right text-base sm:text-lg font-extrabold tabular-nums leading-tight ${amountClassName}`}>
                {amount}
              </div>
            ) : null}
          </div>
          {typeof description === "string" ? <ClampExpandText text={description} testId={testId ? `${testId}-desc` : "tx-card-desc"} /> : description}
          {extra}
          {actions ? (
            <div className="flex flex-wrap items-center justify-end gap-1 pt-1.5 border-t border-slate-100">
              {actions}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Cards below `md` (768px); table unchanged on desktop. */
export function TxResponsiveList({
  cards,
  table,
  cardsTestId,
  tableWrapTestId,
  empty,
  tableWrapClassName = "hidden md:block overflow-x-auto",
}) {
  const hasCards = cards != null;
  return (
    <div data-tx-responsive-list="1">
      <div
        className={`md:hidden space-y-2 p-3 ${TX_NO_OVERFLOW_CLASS}`}
        data-testid={cardsTestId}
        data-tx-mobile-list="1"
      >
        {hasCards ? cards : empty}
      </div>
      <div className={tableWrapClassName} data-testid={tableWrapTestId}>
        {table}
      </div>
    </div>
  );
}

