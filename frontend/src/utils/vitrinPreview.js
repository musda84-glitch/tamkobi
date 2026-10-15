/**
 * Ynt panelindeki vitrin önizlemesi. Göreli "/" veya "/web" ynt host'unda
 * paneli açar; iframe src ve dış bağlantılar yalnızca mutlak canlı adrestir.
 */
import { YNT_HOST, getHostKind, hostnameOf } from "./hosts";

export const DEFAULT_VITRIN_URL = "https://tamkobi.com";
export const VITRIN_PREVIEW_MESSAGE = "tamkobi-vitrin-preview";
/** Iframe yüklenip vitrin hazır sinyali gelmezse (X-Frame-Options / frame-ancestors). */
export const PREVIEW_FRAME_GRACE_MS = 1000;
/** Yükleme hiç bitmezse yedek mesaj. */
export const PREVIEW_FRAME_SAFETY_MS = 8000;

function pageWindow(win) {
  if (win) return win;
  return typeof window !== "undefined" ? window : undefined;
}

function isYntHostName(hostname, win) {
  const host = String(hostname || "").replace(/\.$/, "").toLowerCase();
  if (!host) return false;
  if (host === YNT_HOST) return true;
  try {
    if (getHostKind(win) === "ynt" && host === hostnameOf(win)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

function formatPreviewUrl(url) {
  if (url.pathname === "/" && !url.search && !url.hash) {
    return `${url.protocol}//${url.host}`;
  }
  let href = url.href;
  if (href.endsWith("/") && !url.search && !url.hash) href = href.slice(0, -1);
  return href;
}

/**
 * Canlı adres alanından mutlak http(s) URL. Boş, göreli veya ynt host'u
 * yedek vitrine düşer (varsayılan tamkobi.com); sayfa origin'i asla kullanılmaz.
 * Üçüncü argüman seçili sitenin yedeğidir (ör. taiyazilim.com).
 */
export function resolveVitrinPreviewUrl(publicUrl, win, fallback = DEFAULT_VITRIN_URL) {
  const page = pageWindow(win);
  const safeFallback = fallback || DEFAULT_VITRIN_URL;
  const raw = String(publicUrl ?? "").trim();
  let candidate = raw;
  if (candidate.startsWith("//")) candidate = `https:${candidate}`;
  else if (!raw || raw.startsWith("/") || raw.startsWith("./") || raw.startsWith("../") || raw.startsWith("?") || raw.startsWith("#")) {
    return safeFallback;
  } else if (!/^[a-z][a-z0-9+.-]*:/i.test(candidate)) {
    if (!/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(candidate)) return safeFallback;
    candidate = `https://${candidate}`;
  }
  let url;
  try {
    url = new URL(candidate);
  } catch {
    return safeFallback;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return safeFallback;
  if (!url.hostname || isYntHostName(url.hostname, page)) return safeFallback;
  return formatPreviewUrl(url);
}

/** Vitrin köküne göre mutlak alt sayfa (ör. /kayit). Ynt origin'ine çözülmez. */
export function vitrinChildUrl(publicUrl, path, win, fallback = DEFAULT_VITRIN_URL) {
  const base = resolveVitrinPreviewUrl(publicUrl, win, fallback);
  const u = new URL(base);
  u.pathname = path.startsWith("/") ? path : `/${path}`;
  u.search = "";
  u.hash = "";
  return formatPreviewUrl(u);
}

/**
 * @returns {"readable"|"blank"|"opaque"}
 * readable: same-origin belge gerçekten yüklendi.
 * opaque: cross-origin (başarı da X-Frame-Options da böyle görünebilir).
 * blank: about:blank / boş kabuk.
 */
export function classifyPreviewFrame(frame) {
  if (!frame) return "blank";
  try {
    const framed = frame.contentWindow;
    if (!framed) return "blank";
    let href = "";
    try {
      href = String(framed.location?.href || "");
    } catch {
      return "opaque";
    }
    if (!href || href === "about:blank" || href.startsWith("about:") || href.startsWith("chrome-error:")) {
      return "blank";
    }
    let body = null;
    try {
      body = framed.document?.body || null;
    } catch {
      return "opaque";
    }
    if (!body) return "blank";
    const text = String(body.innerText || body.textContent || "").trim();
    if (!text && (body.childElementCount || 0) === 0) return "blank";
    return "readable";
  } catch {
    return "opaque";
  }
}

/** Vitrin, iframe içindeyse ebeveyne hazır sinyali yollar. Üst pencerede sessiz. */
export function announceVitrinPreview(win) {
  const page = pageWindow(win);
  try {
    if (!page || !page.parent || page.parent === page) return;
    page.parent.postMessage({ type: VITRIN_PREVIEW_MESSAGE }, "*");
  } catch {
    /* parent kapalıysa önizleme yedeği devreye girer */
  }
}
