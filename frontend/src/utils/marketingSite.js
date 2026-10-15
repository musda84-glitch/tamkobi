/**
 * Pazarlama sitesi: Host başlığına göre tamkobi | tai.
 * Önizleme sorgusu (?site=&onizleme=1) yalnız localhost ve ynt panelinde.
 */
import { YNT_HOST, hostnameOf } from "./hosts";

export const TAI_HOSTS = ["taiyazilim.com", "www.taiyazilim.com"];
export const TAMKOBI_HOSTS = ["tamkobi.com", "www.tamkobi.com"];

export const TAI_PAGE_PATHS = ["/hakkimizda", "/hizmetler", "/referanslar", "/iletisim"];

const PAGE_BY_PATH = {
  "/": "home",
  "/hakkimizda": "about",
  "/hizmetler": "services",
  "/referanslar": "references",
  "/iletisim": "contact",
};

function isLocalHost(host) {
  return !host || host === "localhost" || host === "127.0.0.1" || host.endsWith(".localhost");
}

/** @returns {"tamkobi"|"tai"} */
export function marketingSlug(hostname, search = "") {
  const host = String(hostname || "").toLowerCase().split(":")[0];
  if (TAI_HOSTS.includes(host)) return "tai";
  if (TAMKOBI_HOSTS.includes(host)) return "tamkobi";
  if (isLocalHost(host) || host === YNT_HOST) {
    try {
      const q = new URLSearchParams(search || "").get("site");
      if (q === "tai" || q === "tamkobi") return q;
    } catch {
      /* ignore */
    }
  }
  return "tamkobi";
}

export function marketingSlugFromLocation(win = typeof window !== "undefined" ? window : undefined) {
  return marketingSlug(hostnameOf(win), win?.location?.search || "");
}

export function isSitePreviewSearch(search) {
  try {
    const q = new URLSearchParams(search || "");
    const site = q.get("site");
    return q.get("onizleme") === "1" && (site === "tai" || site === "tamkobi");
  } catch {
    return false;
  }
}

/** Paket vitrini yalnız tamkobi.com kaydında. */
export function showsPackageVitrin(slug) {
  return slug === "tamkobi";
}

export function taiPageKey(pathname) {
  return PAGE_BY_PATH[pathname || "/"] || "home";
}

export function publishedCards(list) {
  return (Array.isArray(list) ? list : [])
    .filter((row) => row && row.published !== false)
    .slice()
    .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.title || "").localeCompare(String(b.title || ""), "tr"));
}
