export const COLUMN_WIDTH_STORAGE_PREFIX = "tamkobi.colwidths.";

export function columnWidthStorageKey(tableId) {
  return `${COLUMN_WIDTH_STORAGE_PREFIX}${tableId}`;
}

export function clampColumnWidth(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(Math.min(max, Math.max(min, n)));
}

/** Saved widths override defaults; unknown or out-of-range values are dropped. */
export function mergeColumnWidths(defaults, saved, limits) {
  const next = { ...defaults };
  if (!saved || typeof saved !== "object") return next;
  for (const key of Object.keys(defaults)) {
    const min = limits.min?.[key] ?? 48;
    const max = limits.max?.[key] ?? 900;
    const clamped = clampColumnWidth(saved[key], min, max);
    if (clamped != null) next[key] = clamped;
  }
  return next;
}

export function readColumnWidths(tableId, defaults, limits) {
  try {
    const raw = localStorage.getItem(columnWidthStorageKey(tableId));
    if (!raw) return { ...defaults };
    return mergeColumnWidths(defaults, JSON.parse(raw), limits);
  } catch {
    return { ...defaults };
  }
}

export function writeColumnWidths(tableId, widths) {
  try {
    localStorage.setItem(columnWidthStorageKey(tableId), JSON.stringify(widths));
  } catch {
    /* private mode / quota */
  }
}
