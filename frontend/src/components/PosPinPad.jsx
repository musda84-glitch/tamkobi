import { useState } from "react";
import { Delete, Loader2 } from "lucide-react";
import { normalizePin, pinIsValid } from "../utils/posCashier";

export function PosPinPad({
  title = "Kasiyer PIN",
  hint,
  cashiers,
  selectedId,
  onSelect,
  onSubmit,
  onCancel,
  busy,
  error,
  testId = "pos-pin-pad",
}) {
  const [pin, setPin] = useState("");
  const digits = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "del"];
  const push = (d) => {
    if (d === "del") {
      setPin((p) => p.slice(0, -1));
      return;
    }
    if (!d) return;
    setPin((p) => normalizePin(p + d));
  };
  const needUser = Array.isArray(cashiers) && cashiers.length > 0;
  const canSubmit = pinIsValid(pin) && !busy && (!needUser || !!selectedId);
  const submit = (e) => {
    e?.preventDefault?.();
    if (!canSubmit) return;
    onSubmit?.(pin);
  };
  return (
    <div className="fixed inset-0 z-[200] bg-slate-900/70 flex items-center justify-center p-4" data-testid={testId}>
      <form onSubmit={submit} className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className="px-4 py-3 border-b">
          <h3 className="font-bold text-slate-900">{title}</h3>
          {hint ? <p className="text-xs text-slate-500 mt-0.5">{hint}</p> : null}
        </div>
        {Array.isArray(cashiers) && cashiers.length > 0 && (
          <div className="px-4 py-2 flex flex-wrap gap-1.5 border-b bg-slate-50" data-testid="pos-cashier-list">
            {cashiers.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => onSelect?.(c)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border ${selectedId === c.id ? "bg-emerald-600 text-white border-emerald-600" : "bg-white border-slate-200 text-slate-700"}`}
                data-testid={`pos-cashier-${c.id}`}
              >
                {c.name}
              </button>
            ))}
          </div>
        )}
        <div className="px-4 pt-4">
          <div className="h-12 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center tracking-[0.6em] text-xl font-black text-slate-800" data-testid="pos-pin-dots">
            {"•".repeat(pin.length) || "····"}
          </div>
          {error ? <p className="text-xs text-rose-600 font-semibold mt-2" data-testid="pos-pin-error">{error}</p> : null}
        </div>
        <div className="grid grid-cols-3 gap-2 p-4">
          {digits.map((d, i) => (
            <button
              key={`${d}-${i}`}
              type="button"
              disabled={!d}
              onClick={() => push(d)}
              className={`min-h-14 rounded-xl border font-black text-lg ${d === "del" ? "bg-slate-100 border-slate-200" : "bg-white border-slate-200 hover:bg-emerald-50"} disabled:opacity-0`}
              data-testid={d === "del" ? "pos-pin-del" : d ? `pos-pin-${d}` : undefined}
            >
              {d === "del" ? <Delete className="w-5 h-5 mx-auto" /> : d}
            </button>
          ))}
        </div>
        <div className="px-4 pb-4 flex gap-2">
          {onCancel ? (
            <button type="button" onClick={onCancel} className="flex-1 rounded-xl border border-slate-200 py-3 font-semibold text-slate-600" data-testid="pos-pin-cancel">
              Vazgeç
            </button>
          ) : null}
          <button type="submit" disabled={!canSubmit} className="flex-1 rounded-xl bg-emerald-600 text-white font-bold py-3 disabled:opacity-50 inline-flex items-center justify-center gap-2" data-testid="pos-pin-submit">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Giriş
          </button>
        </div>
      </form>
    </div>
  );
}
