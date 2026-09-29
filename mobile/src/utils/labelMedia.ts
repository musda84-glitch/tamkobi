import { resolveMediaUrl } from "./media";

/** Relative /api/files… → absolute for print windows (about:blank). */
export function absolutizeLabelUrl(url: string | null | undefined, mediaBase?: string | null): string {
  const raw = String(url || "").trim();
  if (!raw) return "";
  if (/^(data:|blob:)/i.test(raw)) return raw;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (mediaBase) return resolveMediaUrl(mediaBase, raw);
  if (typeof window !== "undefined" && window.location?.origin) {
    try {
      return new URL(raw.startsWith("/") ? raw : `/${raw}`, window.location.origin).href;
    } catch {
      return raw;
    }
  }
  return raw;
}

/** Fetch image → data URL so thermal/print HTML does not lose remote assets. */
export async function imageUrlToDataUrl(
  url: string | null | undefined,
  mediaBase?: string | null,
  token?: string | null,
): Promise<string> {
  const abs = absolutizeLabelUrl(url, mediaBase);
  if (!abs) return "";
  if (abs.startsWith("data:")) return abs;
  try {
    const headers: Record<string, string> = {};
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(abs, {
      credentials: "include",
      mode: "cors",
      headers,
    });
    if (!res.ok) return abs;
    const blob = await res.blob();
    if (typeof FileReader === "undefined") return abs;
    return await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : abs);
      reader.onerror = () => resolve(abs);
      reader.readAsDataURL(blob);
    });
  } catch {
    return abs;
  }
}

/** Rewrite every <img src="…"> in label HTML to embedded data URLs when possible. */
export async function embedLabelHtmlImages(
  html: string,
  mediaBase?: string | null,
  token?: string | null,
): Promise<string> {
  const src = String(html || "");
  if (!src.includes("<img")) return src;
  const re = /(<img\b[^>]*?\bsrc=["'])([^"']+)(["'])/gi;
  const matches = [...src.matchAll(re)];
  if (!matches.length) return src;
  const unique = [...new Set(matches.map((m) => m[2]))];
  const mapped = new Map<string, string>();
  await Promise.all(unique.map(async (u) => {
    mapped.set(u, await imageUrlToDataUrl(u, mediaBase, token));
  }));
  return src.replace(re, (_, a, url, c) => `${a}${mapped.get(url) || url}${c}`);
}
