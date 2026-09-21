import React from "react";

/** RN View/Pressable crashes if a number/object is rendered as a raw text node. */
export function listRowText(value: unknown): string {
  if (value == null || value === false) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && "name" in (value as object)) {
    return listRowText((value as { name?: unknown }).name);
  }
  return "";
}

export function isListRowNode(value: unknown): value is React.ReactElement {
  return React.isValidElement(value);
}
