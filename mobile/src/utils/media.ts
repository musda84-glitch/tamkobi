import { normalizeApiBase } from "../api/url";

/** Stok / logo görselleri için API köküne göre mutlak URL. */
export function resolveMediaUrl(baseUrl: string, raw?: string | null): string {
  if (!raw) return "";
  const s = String(raw).trim();
  if (!s) return "";
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  const path = s.startsWith("/")
    ? s
    : s.startsWith("api/")
      ? `/${s}`
      : `/api/files/${s.replace(/^\/+/, "")}`;
  return `${normalizeApiBase(baseUrl)}${path}`;
}
