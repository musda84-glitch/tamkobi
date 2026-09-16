export const DEFAULT_API_BASE = "https://tamkobi.com";
export const API_BASE_KEY = "tamkobi.apiBase";
export const TOKEN_KEY = "tamkobi.accessToken";
export const REMEMBER_EMAIL_KEY = "tamkobi.rememberEmail";

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
