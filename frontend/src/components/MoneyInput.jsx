import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef, useState } from "react";
import { getPriceDecimals } from "../utils/money";
import {
  applyMoneyEdit,
  formatMoneyBlur,
  formatMoneyFocus,
  sameMoney,
} from "../utils/trMoneyInput";

export {
  applyMoneyEdit,
  caretFromSignificant,
  formatMoneyBlur,
  formatMoneyFocus,
  formatTypingRaw,
  parseTrNumber,
  parseTrParts,
  significantCount,
} from "../utils/trMoneyInput";

function useMoneyField({
  value,
  onChange,
  decimals,
  maxFractionDigits,
  allowNegative,
  mode,
}) {
  const fraction = maxFractionDigits ?? (mode === "quantity" ? 3 : 4);
  const places = decimals ?? (mode === "quantity" ? 0 : getPriceDecimals());
  const [focused, setFocused] = useState(false);
  const [text, setText] = useState("");
  const [, setTick] = useState(0);
  const textRef = useRef("");
  const inputRef = useRef(null);
  const caretRef = useRef(null);
  const opts = { maxFractionDigits: fraction, allowNegative: !!allowNegative };

  const blurText = formatMoneyBlur(value, places, { maxFractionDigits: fraction });
  const shown = focused ? text : blurText;

  useLayoutEffect(() => {
    const el = inputRef.current;
    const c = caretRef.current;
    if (!focused || !el || c == null) return;
    caretRef.current = null;
    try {
      if (document.activeElement === el && el.selectionStart !== c) el.setSelectionRange(c, c);
    } catch { /* jsdom */ }
  });

  const emit = (next) => {
    if (!onChange) return;
    if (sameMoney(next, value)) return;
    onChange(next);
  };

  const applyRaw = (prev, nextRaw, caret, inputType) => {
    const res = applyMoneyEdit(prev, nextRaw, caret, { ...opts, inputType });
    textRef.current = res.text;
    caretRef.current = res.caret;
    setText(res.text);
    setTick((n) => n + 1);
    emit(res.value);
    return res;
  };

  const onFocus = (e) => {
    const initial = formatMoneyFocus(value, fraction);
    textRef.current = initial;
    setText(initial);
    setFocused(true);
    return initial;
  };

  const onInputChange = (e) => {
    const el = e.target;
    applyRaw(textRef.current, el.value, el.selectionStart ?? el.value.length, e.nativeEvent?.inputType || "");
  };

  const onBlur = () => {
    setFocused(false);
    caretRef.current = null;
  };

  const pushChar = (ch) => {
    const prev = focused ? textRef.current : formatMoneyFocus(value, fraction);
    if (!focused) {
      textRef.current = prev;
      setFocused(true);
    }
    const caret = prev.length;
    applyRaw(prev, prev + ch, caret + 1, "");
    inputRef.current?.focus();
  };

  const backspace = () => {
    const prev = focused ? textRef.current : formatMoneyFocus(value, fraction);
    if (!prev) return;
    if (!focused) {
      textRef.current = prev;
      setFocused(true);
    }
    applyRaw(prev, prev.slice(0, -1), prev.length - 1, "");
    inputRef.current?.focus();
  };

  const setNumber = (n) => {
    const nextText = formatMoneyFocus(n, fraction);
    textRef.current = nextText;
    setText(nextText);
    setFocused(true);
    caretRef.current = nextText.length;
    emit(n == null || n === "" ? null : Number(n));
    inputRef.current?.focus();
  };

  return {
    inputRef,
    shown,
    focused,
    onFocus,
    onInputChange,
    onBlur,
    pushChar,
    backspace,
    setNumber,
    fraction,
  };
}

function pickDomProps(rest) {
  const skip = new Set(["step", "min", "max", "mode", "decimals", "maxFractionDigits", "allowNegative", "selectOnFocus", "live"]);
  const out = {};
  Object.keys(rest || {}).forEach((k) => {
    if (!skip.has(k)) out[k] = rest[k];
  });
  return out;
}

export const MoneyInput = forwardRef(function MoneyInput({
  value,
  onChange,
  onFocus,
  onBlur,
  onKeyDown,
  decimals,
  maxFractionDigits,
  allowNegative = false,
  selectOnFocus = false,
  mode = "money",
  className = "",
  disabled = false,
  required = false,
  autoFocus = false,
  name,
  title,
  placeholder,
  id,
  "data-testid": testId,
  ...rest
}, ref) {
  const field = useMoneyField({ value, onChange, decimals, maxFractionDigits, allowNegative, mode });

  useImperativeHandle(ref, () => ({
    focus: () => field.inputRef.current?.focus(),
    push: (ch) => field.pushChar(ch === "." ? "." : String(ch)),
    backspace: () => field.backspace(),
    setNumber: (n) => field.setNumber(n),
  }), [field]);

  return (
    <input
      ref={field.inputRef}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      lang="tr"
      id={id}
      name={name}
      title={title}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      className={className}
      data-testid={testId}
      value={field.shown}
      onFocus={(e) => {
        field.onFocus(e);
        onFocus?.(e);
        if (selectOnFocus) {
          requestAnimationFrame(() => {
            try { field.inputRef.current?.select(); } catch { /* */ }
          });
        }
      }}
      onChange={field.onInputChange}
      onBlur={(e) => {
        field.onBlur();
        onBlur?.(e);
      }}
      onKeyDown={onKeyDown}
      {...pickDomProps(rest)}
    />
  );
});

export const QuantityInput = forwardRef(function QuantityInput(props, ref) {
  return <MoneyInput {...props} mode="quantity" ref={ref} />;
});

export default MoneyInput;
