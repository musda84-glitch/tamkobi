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
