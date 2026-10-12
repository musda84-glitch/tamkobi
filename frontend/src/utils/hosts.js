/**
 * Subdomain host kind helpers (site | app | b2b | ik).
 * Dev/test override: ?__host=app|b2b|ik|site on localhost only.
 */

export const ROOT_DOMAIN = (process.env.REACT_APP_ROOT_DOMAIN || "tamkobi.com").replace(/^\.+/, "");

const KINDS = new Set(["site", "app", "b2b", "ik"]);

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

/** @returns {"site"|"app"|"b2b"|"ik"} */
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
  ],
  b2b: [/^\/$/, /^\/b2b(\/|$)/, /^\/portal(\/|$)/],
  ik: [
    /^\/$/,
    /^\/personelim(\/|$)/,
    /^\/mesai(\/|$)/,
    /^\/login(\/|$)/,
    /^\/sifre(\/|$)/,
    /^\/davet(\/|$)/,
  ],
};

export function pathAllowedOnHost(pathname, kind) {
  const rules = HOST_ROUTE_RULES[kind] || HOST_ROUTE_RULES.site;
  return rules.some((re) => re.test(pathname || "/"));
}

/** Which host should own this path (for redirects). */
export function preferredHostForPath(pathname) {
  const p = pathname || "/";
  if (
    p.startsWith("/sistem") ||
    p.startsWith("/web") ||
    p.startsWith("/fiyatlar") ||
    p.startsWith("/kayit") ||
    p.startsWith("/yasal") ||
    p.startsWith("/kurulum")
  ) {
    return "site";
  }
  if (p.startsWith("/b2b") || p.startsWith("/portal")) return "b2b";
  if (p.startsWith("/personelim") || p.startsWith("/mesai")) return "ik";
  if (p === "/" ) return null; // host-specific home
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
