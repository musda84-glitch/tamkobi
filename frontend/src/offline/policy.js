/** Çevrimdışı süre, kritik yazma ve yalnızca çevrimiçi işlemler. */

export const DEFAULT_OFFLINE_MAX_MINUTES = 10;
export const BACKOFF_MS = [1000, 2000, 4000, 8000];

const ONLINE_ONLY = [
  { test: /\/einvoice|e-arsiv|e-archive|\/edoc|\/gib\b|isnet/i, label: "e-Fatura / e-Arşiv" },
  { test: /\/vpos|\/paytr|\/iyzico|\/payments?\b/i, label: "ödeme / sanal POS" },
  { test: /\/banking|\/bank\/|\/loans|\/cheques/i, label: "banka" },
  { test: /\/ai\/|\/ai-|invoice-extract|cart-extract/i, label: "AI" },
];

let forcedOnline = null;

export function setOnlineForTests(value) {
  forcedOnline = value;
}

export function isOnline() {
  if (forcedOnline != null) return !!forcedOnline;
  if (typeof navigator === "undefined") return true;
  return navigator.onLine !== false;
}

export function clampOfflineMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_OFFLINE_MAX_MINUTES;
  return Math.max(1, Math.min(720, Math.round(n)));
}

export function remainingMs({ offlineSince, maxMinutes, now = Date.now() } = {}) {
  const max = clampOfflineMinutes(maxMinutes) * 60 * 1000;
  if (!offlineSince) return max;
  return Math.max(0, max - (now - Number(offlineSince)));
}

export function criticalBlock({ online, offlineSince, maxMinutes, now, critical }) {
  if (!critical || online) return null;
  const left = remainingMs({ offlineSince, maxMinutes, now });
  if (left > 0) return null;
  return {
    code: "OFFLINE_EXPIRED",
    message: "Çevrimdışı süre doldu. Yeni satış ve stok düşümü durduruldu. Kuyruktaki işlemler duruyor.",
  };
}

export function onlineOnlyBlock(url, { online = isOnline() } = {}) {
  if (online) return null;
  const text = String(url || "");
  const hit = ONLINE_ONLY.find((row) => row.test.test(text));
  if (!hit) return null;
  return {
    code: "OFFLINE_ONLINE_ONLY",
    message: `${hit.label} çevrimdışıyken kapalı. Bağlantı gelince yeniden deneyin.`,
  };
}

export function newIdempotencyKey() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (ch) => {
    const rnd = Math.floor(Math.random() * 16);
    return (ch === "x" ? rnd : (rnd & 0x3) | 0x8).toString(16);
  });
}
