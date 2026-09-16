import type { SessionUser, License } from "./permissions";
import { can, moduleOn } from "./permissions";

export type QuickTone = "emerald" | "sky" | "amber" | "indigo" | "teal" | "orange" | "violet" | "rose" | "slate";

export type QuickTile = {
  id: string;
  label: string;
  /** RBAC / lisans yolu (web menü path). */
  path: string;
  /** expo-router hedefi. */
  href: string;
  icon: string;
  tone: QuickTone;
  /** Bildirim, arama, ayarlar gibi herkese açık kısayollar. */
  always?: boolean;
  needsEdit?: boolean;
};

/** Web hızlı menüdeki işlemler + mevcut mobil modüller. */
export const QUICK_TILES: QuickTile[] = [
  { id: "invoices", label: "Faturalar", path: "/invoices", href: "/invoices", icon: "document-text", tone: "emerald" },
  { id: "contacts", label: "Cariler", path: "/contacts", href: "/contacts", icon: "people", tone: "sky" },
  { id: "orders", label: "Siparişler", path: "/orders", href: "/orders", icon: "cart", tone: "amber" },
  { id: "stock", label: "Stok", path: "/stock", href: "/stok", icon: "cube", tone: "indigo" },
  { id: "barcode", label: "Barkod", path: "/stock", href: "/stok?scan=1", icon: "barcode", tone: "indigo" },
  { id: "saha", label: "Saha", path: "/saha", href: "/saha", icon: "phone-portrait", tone: "orange" },
  { id: "mesai", label: "Mesaim", path: "/mesai", href: "/mesai", icon: "time", tone: "teal" },
  { id: "personelim", label: "Personelim", path: "/personelim", href: "/personelim", icon: "person", tone: "violet" },
  { id: "search", label: "Ara", path: "/", href: "/search", icon: "search", tone: "slate", always: true },
  { id: "notifications", label: "Bildirimler", path: "/", href: "/notifications", icon: "notifications", tone: "rose", always: true },
  { id: "settings", label: "Ayarlar", path: "/settings", href: "/settings", icon: "settings", tone: "slate", always: true },
];

export const QUICK_TONE_COLORS: Record<QuickTone, { bg: string; fg: string }> = {
  emerald: { bg: "#ECFDF5", fg: "#047857" },
  sky: { bg: "#E0F2FE", fg: "#0369A1" },
  amber: { bg: "#FFFBEB", fg: "#B45309" },
  indigo: { bg: "#EEF2FF", fg: "#4338CA" },
  teal: { bg: "#CCFBF1", fg: "#0F766E" },
  orange: { bg: "#FFEDD5", fg: "#C2410C" },
  violet: { bg: "#EDE9FE", fg: "#6D28D9" },
  rose: { bg: "#FFF1F2", fg: "#BE123C" },
  slate: { bg: "#F1F5F9", fg: "#334155" },
};

const TASK_PATH_MAP: Record<string, string> = {
  "/invoices": "/invoices",
  "/contacts": "/contacts",
  "/orders": "/orders",
  "/stock": "/stok",
  "/saha": "/saha",
  "/mesai": "/mesai",
  "/personelim": "/personelim",
  "/personnel": "/personelim",
  "/notifications": "/notifications",
  "/settings": "/settings",
  "/search": "/search",
};

export function visibleQuickTiles(user: SessionUser, license: License): QuickTile[] {
  const seen = new Set<string>();
  return QUICK_TILES.filter((tile) => {
    if (seen.has(tile.id)) return false;
    if (!tile.always && (!can(user, tile.path, tile.needsEdit ? "edit" : "view") || !moduleOn(license, tile.path))) {
      return false;
    }
    seen.add(tile.id);
    return true;
  });
}

/** Dashboard görev path'ini mobilde açılabilen bir rotaya çevirir. */
export function resolveMobilePath(path?: string | null): string | null {
  if (!path) return null;
  const p = path.split("?")[0];
  return TASK_PATH_MAP[p] || null;
}

export function splitHref(href: string): { pathname: string; params?: Record<string, string> } {
  const [pathname, qs] = href.split("?");
  if (!qs) return { pathname };
  const params: Record<string, string> = {};
  for (const part of qs.split("&")) {
    const [k, v] = part.split("=");
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || "");
  }
  return { pathname, params };
}
