import { listThumbUrl, resolveImageUrl } from "./imageUrl";

/** Yazdırma satırı ekranda 44–64 px. Saklanan küçük dosya 200 px; 300 px ayrı anahtar olur. */
export const PRINT_THUMB_EDGE = 200;

const liveThumbs = new Map();

export function printMediaUrl(v) {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "object") {
    const u = v.url ?? v.image_url ?? v.thumbnail_url ?? v.src ?? "";
    return u == null ? "" : String(u).trim();
  }
  return String(v).trim();
}

/** Satır görseli stok kartından önce gelir. */
export function printItemImageRef(it = {}, prod = {}) {
  return (
    printMediaUrl(it.thumbnail_url) || printMediaUrl(it.image_url)
    || printMediaUrl(prod.thumbnail_url) || printMediaUrl(prod.image_url)
    || (Array.isArray(it.images) && printMediaUrl(it.images[0]))
    || (Array.isArray(prod.images) && printMediaUrl(prod.images[0]))
    || ""
  );
}

export function printThumbUrl(raw) {
  const resolved = resolveImageUrl(raw);
  if (!resolved) return "";
  try {
    const u = new URL(resolved, typeof window !== "undefined" ? window.location.origin : "http://localhost");
    if (u.pathname.startsWith("/api/files/")) return listThumbUrl(resolved);
    if (/unsplash\.com|images\.pexels\.com|cloudinary\.com/i.test(u.hostname) || u.searchParams.has("w")) {
      u.searchParams.set("w", "128");
      if (!u.searchParams.has("q") && /unsplash/i.test(u.hostname)) u.searchParams.set("q", "60");
      return u.toString();
    }
  } catch { /* keep */ }
  return resolved;
}

export function printLineThumbUrls(items, resolveProd) {
  const out = [];
  const seen = new Set();
  for (const it of items || []) {
    const prod = resolveProd ? resolveProd(it) : {};
    const src = printThumbUrl(printItemImageRef(it, prod));
    if (!src || seen.has(src)) continue;
    seen.add(src);
    out.push(src);
  }
  return out;
}

/** Aynı adresi ikinci kez başlatmaz. Biten isteği boş src ile kesmez. */
export function preloadPrintThumbs(srcs) {
  const wanted = [];
  const seen = new Set();
  for (const src of srcs || []) {
    if (!src || seen.has(src)) continue;
    seen.add(src);
    wanted.push(src);
  }
  if (typeof Image === "undefined") return wanted.length;
  for (const src of wanted) {
    if (liveThumbs.has(src)) continue;
    const img = new Image();
    img.decoding = "async";
    img.fetchPriority = "high";
    img.src = src;
    liveThumbs.set(src, img);
  }
  return wanted.length;
}

/** Listede kalan adreslerin yüklemesi sürer. */
export function releasePrintThumbs(keep) {
  const keepSet = keep instanceof Set ? keep : new Set(keep || []);
  for (const [src, img] of liveThumbs) {
    if (keepSet.has(src)) continue;
    img.src = "";
    liveThumbs.delete(src);
  }
}
