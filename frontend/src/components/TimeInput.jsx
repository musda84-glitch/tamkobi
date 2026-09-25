import React from "react";

/**
 * Native time input forced to 24-hour UI (TR locale).
 * Value remains HH:MM (00–23); Chrome/Safari follow lang for AM/PM vs 24h.
 */
export function TimeInput({
  value = "",
  onChange,
  className = "",
  disabled = false,
  required = false,
  autoFocus = false,
  name,
  title,
  "data-testid": testId,
  step = 60,
  ...rest
}) {
  return (
    <input
      type="time"
      lang="tr"
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
      {...rest}
    />
  );
}

export default TimeInput;
