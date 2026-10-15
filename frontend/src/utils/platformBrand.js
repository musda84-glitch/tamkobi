/**
 * Platform yönetimi markası host kind ile seçilir (hosts.js / YNT_HOST).
 * ynt → TAI Yazılım. Diğer hostlar TamKobi kalır.
 */

import { getHostKind } from "./hosts";

export const TAI_PLATFORM_TITLE = "TAI Yazılım · Platform Yönetimi";
export const TAI_LOGO_SRC = "/brand/tai/tai_yazilim_logo.svg";
export const TAI_FAVICON_ICO = "/brand/tai/favicon.ico";
export const TAI_FAVICON_PNG = "/brand/tai/favicon.png";
export const TAI_APPLE_TOUCH = "/brand/tai/tai-icon-192.png";

const TAM_FAVICON_ICO = "/favicon.ico";
const TAM_FAVICON_PNG = "/favicon.png";
const TAM_APPLE_TOUCH = "/brand/tamkobi-icon-192.png";

export function isYntHost(win = typeof window !== "undefined" ? window : undefined) {
  return getHostKind(win) === "ynt";
}

function upsertLink(doc, { rel, type, href, sizes }) {
  const sel = type ? `link[rel="${rel}"][type="${type}"]` : `link[rel="${rel}"]:not([type])`;
  let el = doc.head?.querySelector(sel);
  if (!el) {
    el = doc.createElement("link");
    el.setAttribute("rel", rel);
    if (type) el.setAttribute("type", type);
    if (sizes) el.setAttribute("sizes", sizes);
    doc.head?.appendChild(el);
  }
  el.setAttribute("href", href);
  return el;
}

/** Favicon, sekme başlığı ve html.ynt-host sınıfı. Renkler ynt.css değişkenlerinde. */
export function applyPlatformDocumentBrand(doc = typeof document !== "undefined" ? document : undefined, win = typeof window !== "undefined" ? window : undefined) {
  if (!doc?.documentElement) return { ynt: false };
  const ynt = isYntHost(win);
  doc.documentElement.classList.toggle("ynt-host", ynt);
  const icons = ynt
    ? { ico: TAI_FAVICON_ICO, png: TAI_FAVICON_PNG, apple: TAI_APPLE_TOUCH }
    : { ico: TAM_FAVICON_ICO, png: TAM_FAVICON_PNG, apple: TAM_APPLE_TOUCH };
  upsertLink(doc, { rel: "icon", href: icons.ico, sizes: "any" });
  upsertLink(doc, { rel: "icon", type: "image/png", href: icons.png });
  upsertLink(doc, { rel: "apple-touch-icon", href: icons.apple });
  if (ynt) doc.title = TAI_PLATFORM_TITLE;
  else if (doc.title === TAI_PLATFORM_TITLE) doc.title = "TamKobi";
  const theme = doc.querySelector('meta[name="theme-color"]');
  if (theme) {
    if (!doc.documentElement.dataset.tamkobiTheme) {
      doc.documentElement.dataset.tamkobiTheme = theme.getAttribute("content") || "";
    }
    if (ynt && typeof win?.getComputedStyle === "function") {
      const navy = win.getComputedStyle(doc.documentElement).getPropertyValue("--ynt-navy").trim();
      if (navy) theme.setAttribute("content", navy);
    } else if (!ynt && doc.documentElement.dataset.tamkobiTheme) {
      theme.setAttribute("content", doc.documentElement.dataset.tamkobiTheme);
    }
  }
  return { ynt, title: ynt ? TAI_PLATFORM_TITLE : null };
}
