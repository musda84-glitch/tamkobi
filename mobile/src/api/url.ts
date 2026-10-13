export const DEFAULT_API_BASE = "https://tamkobi.com";
export const API_BASE_KEY = "tamkobi.apiBase";

export function extraApiUrl(extra?: { apiUrl?: unknown } | null): string | undefined {
  const raw = extra?.apiUrl;
  return typeof raw === "string" && raw.trim() ? raw.trim() : undefined;
}

export const TOKEN_KEY = "tamkobi.accessToken";
export const REMEMBER_EMAIL_KEY = "tamkobi.rememberEmail";
export const SESSION_KIND_KEY = "tamkobi.sessionKind";
export const SESSION_CACHE_KEY = "tamkobi.sessionCache";
export const B2B_TOKEN_KEY = "tamkobi.b2bToken";
export const B2B_NAME_KEY = "tamkobi.b2bName";
export const REMEMBER_B2B_EMAIL_KEY = "tamkobi.rememberB2bEmail";

/** Origin only, no trailing slash, no /api suffix. */
export function normalizeApiBase(input: string | null | undefined, fallback = DEFAULT_API_BASE): string {
  let raw = (input || "").trim();
  if (!raw) return fallback.replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(raw)) raw = `https://${raw}`;
  try {
    const url = new URL(raw);
    let path = url.pathname.replace(/\/+$/, "");
    if (path.endsWith("/api")) path = path.slice(0, -4);
    const origin = `${url.protocol}//${url.host}`;
    return (origin + path).replace(/\/+$/, "") || fallback;
  } catch {
    return fallback.replace(/\/+$/, "");
  }
}

export function apiRoot(base: string): string {
  return `${normalizeApiBase(base)}/api`;
}

export const API_BASE_HEADER = "x-tamkobi-api-base";

declare const __DEV__: boolean | undefined;

function devWebOrigin(): string | null {
  if (typeof __DEV__ !== "undefined" && __DEV__ === false) return null;
  if (typeof document === "undefined" || typeof window === "undefined") return null;
  const origin = window.location?.origin;
  return origin && /^https?:/i.test(origin) ? origin : null;
}

/**
 * Tarayıcı önizlemesinde ERP farklı origin olduğu için CORS'a takılıyor.
 * Dev sunucusu /api'yi aynı origin üzerinden geçiriyor (metro.config.js); cihaz ve
 * üretim derlemesi doğrudan API'ye gider.
 */
export function requestTarget(base: string, path: string): { url: string; proxiedBase?: string } {
  const resolved = resolveApiBase(base);
  const direct = `${apiRoot(resolved)}${path}`;
  const origin = devWebOrigin();
  if (!origin) return { url: direct };
  const normalized = normalizeApiBase(resolved);
  if (normalized === origin) return { url: direct };
  return { url: `${origin}/api${path}`, proxiedBase: normalized };
}

/**
 * Sunucu `/api/files/...` gibi göreli yol döner; mobilde <Image> mutlak URL ister.
 * Web resolveImageUrl karşılığı.
 */
export function fileUrl(base: string, url?: string | null): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:|file:)/i.test(raw)) return raw;
  const origin = normalizeApiBase(base);
  if (raw.startsWith("/")) return `${origin}${raw}`;
  if (raw.startsWith("api/")) return `${origin}/${raw}`;
  return `${apiRoot(base)}/files/${raw.replace(/^\/+/, "")}`;
}

/**
 * Web önizlemede /api/files same-origin kalsın (Metro proxy).
 * CDN / data / blob adreslerine dokunulmaz.
 */
export function displayFileUrl(base: string, url?: string | null, sameOrigin = false): string {
  const absolute = fileUrl(base, url);
  if (!absolute || !sameOrigin) return absolute;
  try {
    const parsed = new URL(absolute);
    if (parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/files/")) {
      return `${parsed.pathname}${parsed.search}`;
    }
  } catch {
    /* keep absolute */
  }
  return absolute;
}

/** Kalıcı yönlendirmede kabul edilen üretim hostları (yalnızca https). */
export const ALLOWED_API_REDIRECT_HOSTS = new Set([
  "tamkobi.com",
  "app.tamkobi.com",
  "b2b.tamkobi.com",
  "ik.tamkobi.com",
]);

export function isAllowedApiRedirectHost(host: string | null | undefined): boolean {
  const h = String(host || "").trim().toLowerCase();
  return ALLOWED_API_REDIRECT_HOSTS.has(h);
}

/** https + izinli host; http düşüşü ve yabancı host reddedilir. */
export function isAllowedApiRedirectUrl(absoluteUrl: string | null | undefined): boolean {
  try {
    const u = new URL(String(absoluteUrl || "").trim());
    if (u.protocol !== "https:") return false;
    return isAllowedApiRedirectHost(u.host);
  } catch {
    return false;
  }
}

export function isPermanentRedirect(status: number): boolean {
  return status === 301 || status === 308;
}

/**
 * 301/308 Location → yeni API origin (host değiştiyse).
 * Yalnızca https + izinli host; aksi halde null (kaydetme / token gönderme).
 * Relative Location aynı host’ta kalır → null.
 */
export function redirectBaseFromLocation(
  location: string | null | undefined,
  currentBase: string,
): string | null {
  const raw = String(location || "").trim();
  if (!raw) return null;
  const current = normalizeApiBase(currentBase);
  try {
    const abs = /^https?:\/\//i.test(raw) ? raw : new URL(raw, `${current}/`).href;
    const parsed = new URL(abs);
    if (parsed.protocol !== "https:") return null;
    if (!isAllowedApiRedirectHost(parsed.host)) return null;
    const next = normalizeApiBase(`${parsed.protocol}//${parsed.host}`);
    if (!next || next === current) return null;
    return next;
  } catch {
    return null;
  }
}

/**
 * RN fetch redirect:"manual" desteklemeyebilir — final res.url host değiştiyse
 * (izinliyse) yeni base döner.
 */
export function redirectBaseFromFinalUrl(
  finalUrl: string | null | undefined,
  currentBase: string,
  redirected?: boolean,
): string | null {
  const raw = String(finalUrl || "").trim();
  if (!raw) return null;
  const current = normalizeApiBase(currentBase);
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "https:") return null;
    if (!isAllowedApiRedirectHost(parsed.host)) return null;
    const next = normalizeApiBase(`${parsed.protocol}//${parsed.host}`);
    if (!next || next === current) return null;
    // redirected bayrağı yoksa bile host farkı yeterli
    if (redirected === false && next === current) return null;
    return next;
  } catch {
    return null;
  }
}

/** Oturum içinde 301/308 sonrası tercih edilen base (AsyncStorage ile birlikte). */
let sessionRedirectBase: string | null = null;

export function applyRedirectedApiBase(base: string): string {
  sessionRedirectBase = normalizeApiBase(base);
  return sessionRedirectBase;
}

export function resolveApiBase(base: string): string {
  return sessionRedirectBase || normalizeApiBase(base);
}

export function clearRedirectedApiBase(): void {
  sessionRedirectBase = null;
}
