/**
 * Subdomain host kind helpers (site | app | b2b | ik | ynt).
 * Dev/test override: ?__host=app|b2b|ik|site|ynt on localhost only.
 *
 * /moduller ve /urunler tamkobi.com pazarlama rotalarıdır
 * (marketingSite.TAMKOBI_MARKETING_PATHS). app, b2b ve ik'de açılmaz.
 */

export const ROOT_DOMAIN = (process.env.REACT_APP_ROOT_DOMAIN || "tamkobi.com").replace(/^\.+/, "");
export const YNT_HOST = (process.env.REACT_APP_YNT_HOST || "ynt.taiyazilim.com").replace(/^\.+/, "").toLowerCase();

const KINDS = new Set(["site", "app", "b2b", "ik", "ynt"]);

function stripPort(host) {
  if (!host) return "";
  const h = String(host).toLowerCase();
  if (h.startsWith("[")) {
    const end = h.indexOf("]");
    return end === -1 ? h : h.slice(0, end + 1);
  }
  return h.split(":")[0];
}

export function hostnameOf(win = typeof window !== "undefined" ? window : undefined) {
  try {
    return stripPort(win?.location?.hostname || "");
  } catch {
    return "";
  }
}

function isLocalHost(host) {
  return !host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

/** When true, /sistem* on non-ynt hosts hard-navigates to ynt (nginx is primary). */
export function yntRedirectEnabled() {
  const env = (process.env.REACT_APP_YNT_REDIRECT || "").trim().toLowerCase();
  if (env === "1" || env === "true" || env === "yes") return true;
  try {
    if (typeof window !== "undefined" && window.__TAMKOBI_YNT_REDIRECT__) return true;
  } catch {
    /* ignore */
  }
  return false;
}

/** @returns {"site"|"app"|"b2b"|"ik"|"ynt"} */
export function getHostKind(win = typeof window !== "undefined" ? window : undefined) {
  const host = hostnameOf(win);
  if (isLocalHost(host) && win?.location?.search) {
    try {
      const q = new URLSearchParams(win.location.search).get("__host");
      if (q && KINDS.has(q)) return q;
    } catch {
      /* ignore */
    }
  }
  if (host && host === YNT_HOST) return "ynt";
  const root = ROOT_DOMAIN.toLowerCase();
  if (host === `app.${root}`) return "app";
  if (host === `b2b.${root}`) return "b2b";
  if (host === `ik.${root}`) return "ik";
  if (host === root || host === `www.${root}`) return "site";
  return "site";
}

/** Absolute URL for a host kind + path. */
export function hostUrl(kind, path = "/") {
  const root = ROOT_DOMAIN;
  let host;
  switch (kind) {
    case "app":
      host = `app.${root}`;
      break;
    case "b2b":
      host = `b2b.${root}`;
      break;
    case "ik":
      host = `ik.${root}`;
      break;
    case "ynt":
      host = YNT_HOST;
      break;
    default:
      host = root;
  }
  const p = path.startsWith("/") ? path : `/${path}`;
  const proto =
    typeof window !== "undefined" && window.location?.protocol === "http:" ? "http" : "https";
  // Localhost: stay on same origin with ?__host=
  if (typeof window !== "undefined" && isLocalHost(hostnameOf(window))) {
    const u = new URL(window.location.href);
    u.searchParams.set("__host", kind === "site" ? "site" : kind);
    u.pathname = p;
    return u.toString();
  }
  return `${proto}://${host}${p}`;
}

/** Path prefixes / exact paths allowed on each host. */
export const HOST_ROUTE_RULES = {
  site: [
    /^\/$/,
    /^\/web(\/|$)/,
    /^\/fiyatlar(\/|$)/,
    /^\/kayit(\/|$)/,
    /^\/yasal(\/|$)/,
    /^\/kurulum(\/|$)/,
    /^\/sistem(\/|$)/,
    /^\/sso(\/|$)/,
    /^\/hakkimizda(\/|$)/,
    /^\/hizmetler(\/|$)/,
    /^\/referanslar(\/|$)/,
    /^\/iletisim(\/|$)/,
    /^\/moduller(\/|$)/,
    /^\/urunler(\/|$)/,
  ],
  app: [
    /^\/$/,
    /^\/panel(\/|$)/,
    /^\/invoices(\/|$)/,
    /^\/dis-ticaret(\/|$)/,
    /^\/contacts(\/|$)/,
    /^\/banking(\/|$)/,
    /^\/stock(\/|$)/,
    /^\/hizli-satis(\/|$)/,
    /^\/ecommerce(\/|$)/,
    /^\/cargo(\/|$)/,
    /^\/orders(\/|$)/,
    /^\/purchase-orders(\/|$)/,
    /^\/saha(\/|$)/,
    /^\/warehouses(\/|$)/,
    /^\/vehicles(\/|$)/,
    /^\/production(\/|$)/,
    /^\/personnel(\/|$)/,
    /^\/ai-advisor(\/|$)/,
    /^\/communication(\/|$)/,
    /^\/hesap(\/|$)/,
    /^\/settings(\/|$)/,
    /^\/vpos(\/|$)/,
    /^\/quotes(\/|$)/,
    /^\/projects(\/|$)/,
    /^\/surveys(\/|$)/,
    /^\/support(\/|$)/,
    /^\/accountant(\/|$)/,
    /^\/installments(\/|$)/,
    /^\/reports(\/|$)/,
    /^\/dispatches(\/|$)/,
    /^\/expenses(\/|$)/,
    /^\/loans(\/|$)/,
    /^\/cheques(\/|$)/,
    /^\/trash(\/|$)/,
    /^\/edoc-inbox(\/|$)/,
    /^\/b2b-yonetim(\/|$)/,
    /^\/atolye(\/|$)/,
    /^\/sayim(\/|$)/,
    /^\/sevk(\/|$)/,
    /^\/teklif(\/|$)/,
    /^\/proje(\/|$)/,
    /^\/ekstre(\/|$)/,
    /^\/davet(\/|$)/,
    /^\/sifre(\/|$)/,
    /^\/login(\/|$)/,
    /^\/odeme(\/|$)/,
    /^\/yenile(\/|$)/,
    /^\/sso(\/|$)/,
    /^\/yardim(\/|$)/,
  ],
  b2b: [/^\/$/, /^\/b2b(\/|$)/, /^\/b2b\/tedarikci\/?$/, /^\/portal(\/|$)/],
  ik: [
    /^\/$/,
    /^\/personelim(\/|$)/,
    /^\/mesai(\/|$)/,
    /^\/atolye(\/|$)/,
    /^\/sayim(\/|$)/,
    /^\/sevk(\/|$)/,
    /^\/saha(\/|$)/,
    /^\/vehicles(\/|$)/,
    /^\/login(\/|$)/,
    /^\/sifre(\/|$)/,
    /^\/davet(\/|$)/,
    /^\/yardim(\/|$)/,
  ],
  ynt: [
    /^\/$/,
    /^\/sistem(\/|$)/,
    /^\/sso(\/|$)/,
    /^\/yasal(\/|$)/,
  ],
};

export function pathAllowedOnHost(pathname, kind) {
  const rules = HOST_ROUTE_RULES[kind] || HOST_ROUTE_RULES.site;
  return rules.some((re) => re.test(pathname || "/"));
}

/** Which host should own this path (for redirects). */
export function preferredHostForPath(pathname) {
  const p = pathname || "/";
  if (p.startsWith("/sistem")) {
    return yntRedirectEnabled() ? "ynt" : "site";
  }
  if (
    p === "/moduller" || p.startsWith("/moduller/") ||
    p === "/urunler" || p.startsWith("/urunler/")
  ) {
    return "site";
  }
  if (
    p.startsWith("/web") ||
    p.startsWith("/fiyatlar") ||
    p.startsWith("/kayit") ||
    p.startsWith("/yasal") ||
    p.startsWith("/kurulum") ||
    p.startsWith("/hakkimizda") ||
    p.startsWith("/hizmetler") ||
    p.startsWith("/referanslar") ||
    p.startsWith("/iletisim")
  ) {
    return "site";
  }
  if (p.startsWith("/b2b") || p.startsWith("/portal")) return "b2b";
  if (p.startsWith("/personelim") || p.startsWith("/mesai")) return "ik";
  if (p === "/") return null; // host-specific home
  // Default ERP paths → app
  for (const re of HOST_ROUTE_RULES.app) {
    if (re.test(p) && p !== "/") return "app";
  }
  return null;
}

export function applyRobotsMeta(kind) {
  if (typeof document === "undefined") return;
  let el = document.querySelector('meta[name="robots"]');
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute("name", "robots");
    document.head.appendChild(el);
  }
  if (kind === "site") {
    el.setAttribute("content", "index,follow");
  } else {
    el.setAttribute("content", "noindex,nofollow");
  }
}
