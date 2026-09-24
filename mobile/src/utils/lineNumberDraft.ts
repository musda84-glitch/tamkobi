/** Fatura / teklif satırındaki miktar-fiyat: odaklanınca boş, yazılınca parse. */

export function lineDraftKey(index: number, field: string): string {
  return `${index}:${field}`;
}

/** Draft varsa onu göster ("" boş kalır); yoksa kayıtlı sayıyı stringle. */
export function lineNumberShown(
  drafts: Record<string, string> | null | undefined,
  key: string,
  stored: unknown,
): string {
  if (drafts && Object.prototype.hasOwnProperty.call(drafts, key)) {
    return String(drafts[key] ?? "");
  }
  if (stored == null || stored === "") return "";
  return String(stored);
}

export function lineNumberOnFocus(): string {
  return "";
}

export function parseLineNumber(raw: unknown, emptyFallback = 0): number {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!s || s === "-" || s === "." || s === "-.") return emptyFallback;
  const x = Number(s);
  return Number.isFinite(x) ? x : emptyFallback;
}

/** Boş bırakılıp çıkılırsa önceki kayıt korunur (null). */
export function lineNumberCommit(raw: unknown, emptyFallback = 0): number | null {
  if (String(raw ?? "").trim() === "") return null;
  return parseLineNumber(raw, emptyFallback);
}
