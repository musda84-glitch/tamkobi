import React from "react";

/** Normalize to 24h HH:MM or HH:MM:SS (strips AM/PM if pasted). */
export function normalizeTime24(raw, { withSeconds = false } = {}) {
  const s = String(raw ?? "").trim();
  if (!s) return "";
  const ampm = /\s*(am|pm|öö|ös)\s*$/i.exec(s);
  let body = ampm ? s.slice(0, ampm.index).trim() : s;
  const m = body.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return s;
  let h = Number(m[1]);
  const min = m[2];
  const sec = m[3] || "00";
  if (ampm) {
    const ap = ampm[1].toLowerCase();
    const isPm = ap === "pm" || ap === "ös";
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
  }
  if (h > 23 || Number(min) > 59 || Number(sec) > 59) return s;
  const hh = String(h).padStart(2, "0");
  return withSeconds ? `${hh}:${min}:${sec}` : `${hh}:${min}`;
}

/**
 * Native time input forced to 24-hour UI (TR locale).
 * `text24` uses a plain text field so AM/PM never appears (OS 12h locale).
 */
export function TimeInput({
  value = "",
  onChange,
  onBlur,
  className = "",
  disabled = false,
  required = false,
  autoFocus = false,
  name,
  title,
  "data-testid": testId,
  step = 60,
  text24 = false,
  ...rest
}) {
  const withSeconds = Number(step) === 1 || Number(step) < 60;
  if (text24) {
    const ph = withSeconds ? "SS:DD:SS" : "SS:DD";
    const pattern = withSeconds
      ? "([01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9]"
      : "([01][0-9]|2[0-3]):[0-5][0-9]";
    return (
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        lang="tr"
        placeholder={ph}
        pattern={pattern}
        value={value || ""}
        disabled={disabled}
        required={required}
        autoFocus={autoFocus}
        name={name}
        title={title || `24 saat (${ph})`}
        className={className}
        data-testid={testId}
        onChange={onChange}
        onBlur={(e) => {
          const next = normalizeTime24(e.target.value, { withSeconds });
          if (next !== e.target.value && onChange) {
            onChange({ ...e, target: { ...e.target, value: next } });
          }
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  }
  return (
    <input
      type="time"
      lang="tr-TR"
      step={step}
      value={value || ""}
      disabled={disabled}
      required={required}
      autoFocus={autoFocus}
      name={name}
      title={title || "24 saat (SS:DD)"}
      className={className}
      data-testid={testId}
      onChange={onChange}
      onBlur={onBlur}
      {...rest}
    />
  );
}

export default TimeInput;
