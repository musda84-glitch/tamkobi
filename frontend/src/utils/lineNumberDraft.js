/** Fatura / sipariş satırındaki miktar-fiyat: odaklanınca boş, yazılınca parse. */

export function lineDraftKey(index, field) {
  return `${index}:${field}`;
}

export function lineNumberShown(drafts, key, stored) {
  if (drafts && Object.prototype.hasOwnProperty.call(drafts, key)) {
    return String(drafts[key] ?? "");
  }
  if (stored == null || stored === "") return "";
  return String(stored);
}

export function lineNumberOnFocus() {
  return "";
}

export function parseLineNumber(raw, emptyFallback = 0) {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s || s === "-" || s === "." || s === "-.") return emptyFallback;
  const x = Number(s);
  return Number.isFinite(x) ? x : emptyFallback;
}

export function lineNumberCommit(raw, emptyFallback = 0) {
  if (String(raw ?? "").trim() === "") return null;
  return parseLineNumber(raw, emptyFallback);
}
