import React from "react";

/** RN View/Pressable crashes if a number/object is rendered as a raw text node. */
export function listRowText(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    if (React.isValidElement(value)) return "";
    const o = value as Record<string, unknown>;
    const next = o.name ?? o.tr ?? o.title ?? o.label ?? o.value;
    if (next != null && next !== value) return listRowText(next);
  }
  return "";
}

export function isListRowNode(value: unknown): value is React.ReactElement {
  return React.isValidElement(value);
}
