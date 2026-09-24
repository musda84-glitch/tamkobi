/** Adet çarpan: boş string yazılabilir; parse edilince en az 1. */
export function parseScanQtyInput(raw?: string | number | null): number {
  return Math.max(1, parseInt(String(raw ?? "").replace(/\D/g, ""), 10) || 1);
}

/** null/undefined → "1"; "" boş kalır ki odaklanınca yazılabilsin. */
export function scanQtyShown(raw?: string | null): string {
  return raw == null ? "1" : String(raw);
}

export function scanQtyOnFocus(): string {
  return "";
}

export function scanQtyOnBlur(raw?: string | null): string {
  return String(parseScanQtyInput(raw));
}
