
import React from "react";
import { normalizeLocationSignal } from "../utils/locationConsent";

const TONE = {
  green: "bg-emerald-500",
  red: "bg-rose-500",
  amber: "bg-amber-400",
};

export function LocationSignal({ signal, className = "", testId = "loc-signal" }) {
  const view = normalizeLocationSignal(signal);
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold ${className}`} data-testid={testId} data-tone={view.tone}>
      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${TONE[view.tone] || TONE.amber}`} data-testid={`${testId}-dot`} />
      <span>{view.label}</span>
    </span>
  );
}
