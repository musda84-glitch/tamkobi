import React, { useEffect, useRef, useState } from "react";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function ShopfloorPinPad({ operatorName, station, error, busy, onSubmit, onCancel }) {
  const [pin, setPin] = useState("");
  const pinRef = useRef("");
  const busyRef = useRef(!!busy);
  const onSubmitRef = useRef(onSubmit);
  const onCancelRef = useRef(onCancel);
  busyRef.current = !!busy;
  onSubmitRef.current = onSubmit;
  onCancelRef.current = onCancel;

  const clear = () => {
    pinRef.current = "";
    setPin("");
  };

  useEffect(() => () => {
    pinRef.current = "";
  }, []);

  useEffect(() => {
    if (error) clear();
  }, [error]);

  const submit = (value) => {
    if (busyRef.current) return;
    if (!/^[0-9]{4}$/.test(value)) return;
    clear();
    onSubmitRef.current(value);
  };

  const push = (digit) => {
    if (busyRef.current) return;
    const current = pinRef.current;
    if (current.length >= 4) return;
    const next = `${current}${digit}`;
    pinRef.current = next;
    setPin(next);
    if (next.length === 4) submit(next);
  };

  const back = () => {
    if (busyRef.current) return;
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
    setPin(next);
  };

  const cancel = () => {
    clear();
    if (onCancelRef.current) onCancelRef.current();
  };

  const pushRef = useRef(push);
  const backRef = useRef(back);
  const cancelRef = useRef(cancel);
  pushRef.current = push;
  backRef.current = back;
  cancelRef.current = cancel;

  useEffect(() => {
    const onKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key >= "0" && event.key <= "9") {
        event.preventDefault();
        pushRef.current(event.key);
      } else if (event.key === "Backspace") {
        event.preventDefault();
        backRef.current();
      } else if (event.key === "Escape") {
        event.preventDefault();
        cancelRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="space-y-4" data-testid="shopfloor-pin-pad">
      <div>
        <h3 className="font-bold text-slate-900 text-lg">Operatör PIN</h3>
        <p className="text-sm text-slate-600 mt-1" data-testid="shopfloor-pin-operator">
          {operatorName || "Operatör"}
          {station ? ` · ${station}` : ""}
        </p>
      </div>
      <div className="flex items-center justify-center gap-3" data-testid="shopfloor-pin-dots" aria-label="PIN">
        {[0, 1, 2, 3].map((index) => {
          const filled = index < pin.length;
          return (
            <span
              key={index}
              data-testid="shopfloor-pin-dot"
              data-filled={filled ? "1" : "0"}
              className={`inline-flex h-4 w-4 items-center justify-center rounded-full border-2 ${filled ? "border-slate-900 bg-slate-900" : "border-slate-300 bg-white"}`}
            >
              <span className="sr-only">{filled ? "•" : "○"}</span>
            </span>
          );
        })}
      </div>
      {error ? (
        <div className="text-sm font-semibold text-white bg-rose-600 rounded-lg px-3 py-2" data-testid="shopfloor-pin-error" role="alert">
          {error}
        </div>
      ) : null}
      <div className="grid grid-cols-3 gap-2">
        {KEYS.map((digit) => (
          <button
            key={digit}
            type="button"
            disabled={!!busy}
            onClick={() => push(digit)}
            className="py-3 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
            data-testid={`shopfloor-pin-key-${digit}`}
            aria-label={digit}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onClick={cancel}
          className="py-3 rounded-xl border-2 border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700"
          data-testid="shopfloor-pin-cancel"
        >
          Vazgeç
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={() => push("0")}
          className="py-3 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-900 hover:bg-slate-50 disabled:opacity-60"
          data-testid="shopfloor-pin-key-0"
          aria-label="0"
        >
          0
        </button>
        <button
          type="button"
          disabled={!!busy}
          onClick={back}
          className="py-3 rounded-xl border-2 border-slate-200 bg-white text-lg font-bold text-slate-900"
          data-testid="shopfloor-pin-backspace"
          aria-label="Sil"
        >
          ⌫
        </button>
      </div>
    </div>
  );
}
