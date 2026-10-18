import React, { useEffect, useRef, useState } from "react";

function toDraft(value) {
  if (value == null || value === "") return "";
  const n = Number(value);
  return Number.isFinite(n) ? String(n) : "";
}

function limitedQty(draft, max) {
  const raw = Number(draft);
  const n = Number.isFinite(raw) ? raw : 0;
  const cap = Number(max);
  return Number.isFinite(cap) ? Math.min(n, cap) : n;
}

export default function QtyKeypad({ value, max, onConfirm, onCancel }) {
  const rootRef = useRef(null);
  const [draft, setDraft] = useState(() => toDraft(value));
  const freshRef = useRef(true);
  const draftRef = useRef(draft);
  const maxRef = useRef(max);
  const confirmRef = useRef(onConfirm);
  const cancelRef = useRef(onCancel);
  draftRef.current = draft;
  maxRef.current = max;
  confirmRef.current = onConfirm;
  cancelRef.current = onCancel;

  const pushDigit = (digit) => {
    setDraft((prev) => {
      if (freshRef.current) {
        freshRef.current = false;
        return String(digit);
      }
      if (String(prev).length >= 8) return prev;
      return `${prev}${digit}`.replace(/^0+(?=\d)/, "");
    });
  };

  const backspace = () => {
    freshRef.current = false;
    setDraft((prev) => prev.slice(0, -1));
  };

  const confirm = () => {
    confirmRef.current(limitedQty(draftRef.current, maxRef.current));
  };

  const cancel = () => {
    cancelRef.current();
  };

  const pushRef = useRef(pushDigit);
  const backRef = useRef(backspace);
  const confirmActionRef = useRef(confirm);
  const cancelActionRef = useRef(cancel);
  pushRef.current = pushDigit;
  backRef.current = backspace;
  confirmActionRef.current = confirm;
  cancelActionRef.current = cancel;

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const testId = e.target?.getAttribute?.("data-testid") || "";
      if (String(testId).startsWith("pick-qty-input")) return;
      const digit = e.key >= "0" && e.key <= "9";
      const back = e.key === "Backspace";
      const enter = e.key === "Enter";
      const esc = e.key === "Escape";
      if (!digit && !back && !enter && !esc) return;
      e.preventDefault();
      e.stopPropagation();
      if (digit) pushRef.current(e.key);
      else if (back) backRef.current();
      else if (enter) confirmActionRef.current();
      else cancelActionRef.current();
    };
    const onPointerDown = (e) => {
      const root = rootRef.current;
      if (root && root.contains(e.target)) return;
      cancelActionRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, []);

  const keepFocus = (e) => {
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Adet tuş takımı"
      className="w-full max-w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-xl"
      onMouseDown={keepFocus}
    >
      <div
        className="rounded-xl bg-slate-50 px-3 py-2 text-center text-lg font-black tabular-nums text-slate-900"
        data-testid="pick-keypad-display"
      >
        {draft} / {max} en çok
      </div>
      <div className="mt-2 grid grid-cols-3 gap-1.5">
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((digit) => (
          <button
            key={digit}
            type="button"
            className="h-11 rounded-xl bg-slate-100 text-lg font-black text-slate-900"
            data-testid={`pick-keypad-key-${digit}`}
            onMouseDown={keepFocus}
            onClick={() => pushDigit(digit)}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          aria-label="Sil"
          className="h-11 rounded-xl bg-slate-200 text-lg font-black text-slate-700"
          data-testid="pick-keypad-back"
          onMouseDown={keepFocus}
          onClick={backspace}
        >
          ⌫
        </button>
        <button
          type="button"
          className="h-11 rounded-xl bg-slate-100 text-lg font-black text-slate-900"
          data-testid="pick-keypad-key-0"
          onMouseDown={keepFocus}
          onClick={() => pushDigit("0")}
        >
          0
        </button>
        <button
          type="button"
          aria-label="Onayla"
          className="h-11 rounded-xl bg-emerald-600 text-lg font-black text-white"
          data-testid="pick-keypad-ok"
          onMouseDown={keepFocus}
          onClick={confirm}
        >
          ✓
        </button>
      </div>
      <p className="mt-2 break-words text-center text-[11px] leading-snug text-slate-500">
        {`Klavyeden de yazılır · Enter = onayla · Esc = vazgeç · fazlası ${max}'e indirilir`}
      </p>
    </div>
  );
}
