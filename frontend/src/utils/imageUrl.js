import { BACKEND_URL } from "../api/client";

/**
 * Stok / logo / belge görselleri için tarayıcıya güvenli URL.
 * `/api/files/...` yolları nginx proxy üzerinden same-origin kalmalı;
 * build'e yanlışlıkla gömülen localhost BACKEND_URL önizlemeyi kırar.
 */
export function resolveImageUrl(url) {
  if (!url) return "";
  const raw = String(url).trim();
  if (!raw) return "";
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw;

  const path = raw.startsWith("/") ? raw : raw.startsWith("api/") ? `/${raw}` : `/api/files/${raw.replace(/^\/+/, "")}`;

  // BACKEND_URL already reflects REACT_APP_BACKEND_URL ("" = same-origin).
  // Do not fall through with `||` — empty string must stay empty.
  const base = String(BACKEND_URL ?? "").replace(/\/$/, "");
  if (!base) return path;

  if (typeof window !== "undefined" && window.location?.hostname) {
    try {
      const backend = new URL(base, window.location.origin);
      const pageHost = window.location.hostname;
      const backendLoopback = backend.hostname === "127.0.0.1" || backend.hostname === "localhost";
      const pageLoopback = pageHost === "127.0.0.1" || pageHost === "localhost";
      // Üretim hostunda localhost absolute URL → kırık önizleme
      if (backendLoopback && !pageLoopback) return path;
      if (backend.origin === window.location.origin) return path;
    } catch {
      /* ignore invalid base */
    }
  }
  return `${base}${path}`;
}
