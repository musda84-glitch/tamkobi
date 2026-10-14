import React, { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import { fmtMoney } from "../utils/money";
import { MoneyInput } from "./MoneyInput";
import {
  normalizeStockPrice,
  parseStockPriceInput,
  stockPriceChanged,
} from "../utils/stockInlinePrice";

/**
 * Stok tablosu alış/satış fiyatı — tıkla, yaz, Enter/blur ile kaydet.
 */
export function StockInlinePrice({
  value,
  currency = "TRY",
  onSave,
  disabled = false,
  bold = false,
  testId,
  title = "Düzenlemek için tıklayın",
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const savedRef = useRef(false);

  const start = (e) => {
    e?.stopPropagation?.();
    if (disabled || busy) return;
    savedRef.current = false;
    setDraft(Number(value) ? value : "");
    setEditing(true);
  };

  const cancel = () => {
    setEditing(false);
    setDraft("");
  };

  const commit = async () => {
    if (savedRef.current) return;
    savedRef.current = true;
    const next = normalizeStockPrice(parseStockPriceInput(draft, Number(value) || 0));
    if (!stockPriceChanged(value, next)) {
      cancel();
      return;
    }
    setBusy(true);
    try {
      await onSave(next);
      setEditing(false);
    } catch {
      savedRef.current = false;
      /* parent toasts */
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <MoneyInput
        autoFocus
        selectOnFocus
        disabled={busy}
        value={draft}
        onChange={setDraft}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onBlur={() => commit()}
        className={`w-24 ml-auto block bg-white border border-indigo-300 rounded-md px-1.5 py-1 text-right text-xs outline-none focus:ring-2 focus:ring-indigo-200 ${bold ? "font-bold text-slate-900" : "font-medium text-slate-700"}`}
        data-testid={testId ? `${testId}-input` : undefined}
        aria-label={title}
      />
    );
  }

  return (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={start}
      title={title}
      className={`group inline-flex items-center justify-end gap-1 w-full text-right rounded-md px-1 py-0.5 -mx-1 hover:bg-indigo-50 hover:ring-1 hover:ring-indigo-200 disabled:opacity-60 ${bold ? "font-bold text-slate-900" : "font-medium text-slate-500"}`}
      data-testid={testId}
    >
      <span>{fmtMoney(value, currency)}</span>
      <Pencil className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 shrink-0" aria-hidden />
    </button>
  );
}

export default StockInlinePrice;
