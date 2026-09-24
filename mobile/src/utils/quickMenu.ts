import type { SessionUser, License } from "./permissions";
import { can, hasSelfPersonnelRecord, moduleOn } from "./permissions";

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
  /** Personel kartı bağlı kullanıcılara özel (atanan görevler). */
  self?: boolean;
};

/**
 * Web hızlı menüdeki işlemler + mevcut mobil modüller.
 * Sekme çubuğundaki (Saha, Mesaim, Personelim) ve hesap menüsündeki (Ayarlar) girişler burada tekrarlanmaz.
 */
export const QUICK_TILES: QuickTile[] = [
  { id: "invoices", label: "Faturalar", path: "/invoices", href: "/invoices", icon: "document-text", tone: "emerald" },
  { id: "edoc", label: "Gelen e-Fatura", path: "/edoc-inbox", href: "/edoc-inbox", icon: "file-tray", tone: "indigo" },
  { id: "contacts", label: "Cariler", path: "/contacts", href: "/contacts", icon: "people", tone: "sky" },
  { id: "orders", label: "Siparişler", path: "/orders", href: "/orders", icon: "cart", tone: "amber" },
  { id: "banking", label: "Banka & Kasa", path: "/banking", href: "/banking", icon: "wallet", tone: "teal" },
  { id: "pay", label: "Tahsilat & Ödeme", path: "/banking", href: "/pay", icon: "cash", tone: "emerald", needsEdit: true },
  { id: "expenses", label: "Masraf", path: "/expenses", href: "/expenses", icon: "receipt", tone: "rose" },
  { id: "cheques", label: "Çek", path: "/cheques", href: "/cheques", icon: "card", tone: "teal" },
  { id: "quotes", label: "Teklif", path: "/quotes", href: "/quotes", icon: "create", tone: "amber" },
  { id: "surveys", label: "Keşif", path: "/surveys", href: "/surveys", icon: "construct", tone: "orange" },
  { id: "projects", label: "Proje", path: "/projects", href: "/projects", icon: "briefcase", tone: "indigo" },
  { id: "stock", label: "Stok", path: "/stock", href: "/stok", icon: "cube", tone: "indigo" },
  { id: "barcode", label: "Barkod", path: "/stock", href: "/stok?scan=1", icon: "barcode", tone: "indigo" },
  { id: "sevk", label: "Sipariş Hazırla", path: "/sevk", href: "/sevk", icon: "cube", tone: "teal" },
  { id: "atolye", label: "Atölye Ekranı", path: "/atolye", href: "/atolye", icon: "build", tone: "orange" },
  { id: "my_tasks", label: "Görevlerim", path: "/personelim", href: "/personelim?tab=gorevler", icon: "checkbox", tone: "indigo", self: true },
  { id: "personnel", label: "Personel", path: "/personnel", href: "/personnel", icon: "people-circle", tone: "violet" },
  { id: "notifications", label: "Bildirimler", path: "/", href: "/notifications", icon: "notifications", tone: "rose", always: true },
];

/** bg: kart zemini, border: ince çerçeve, solid: ikon rozeti, fg: metin / açık zemin ikonu. */
export const QUICK_TONE_COLORS: Record<QuickTone, { bg: string; border: string; solid: string; fg: string }> = {
  emerald: { bg: "#ECFDF5", border: "#A7F3D0", solid: "#059669", fg: "#047857" },
  sky: { bg: "#E0F2FE", border: "#BAE6FD", solid: "#0284C7", fg: "#0369A1" },
  amber: { bg: "#FFFBEB", border: "#FDE68A", solid: "#D97706", fg: "#B45309" },
  indigo: { bg: "#EEF2FF", border: "#C7D2FE", solid: "#4F46E5", fg: "#4338CA" },
  teal: { bg: "#CCFBF1", border: "#99F6E4", solid: "#0D9488", fg: "#0F766E" },
  orange: { bg: "#FFEDD5", border: "#FED7AA", solid: "#EA580C", fg: "#C2410C" },
  violet: { bg: "#EDE9FE", border: "#DDD6FE", solid: "#7C3AED", fg: "#6D28D9" },
  rose: { bg: "#FFF1F2", border: "#FECDD3", solid: "#E11D48", fg: "#BE123C" },
  slate: { bg: "#F8FAFC", border: "#E2E8F0", solid: "#475569", fg: "#334155" },
};

const TASK_PATH_MAP: Record<string, string> = {
  "/": "/",
  "/invoices": "/invoices",
  "/edoc-inbox": "/edoc-inbox",
  "/contacts": "/contacts",
  "/orders": "/orders",
  "/banking": "/banking",
  "/pay": "/pay",
  "/expenses": "/expenses",
  "/quotes": "/quotes",
  "/surveys": "/surveys",
  "/projects": "/projects",
  "/stock": "/stok",
  "/sevk": "/sevk",
  "/atolye": "/atolye",
  "/production": "/atolye",
  "/installments": "/installments",
  "/cheques": "/cheques",
  "/saha": "/saha",
  "/mesai": "/mesai",
  "/personelim": "/personelim",
  "/personnel": "/personnel",
  "/notifications": "/notifications",
  "/settings": "/settings",
  "/search": "/search",
};

/** Bildirim kutucuğu ana ekranda son bildirimleri gösteren geniş panele dönüşür. */
export function splitNotificationsTile(tiles: QuickTile[]): { tiles: QuickTile[]; notifications: QuickTile | null } {
  return {
    tiles: tiles.filter((t) => t.id !== "notifications"),
    notifications: tiles.find((t) => t.id === "notifications") || null,
  };
}

export function visibleQuickTiles(user: SessionUser, license: License): QuickTile[] {
  const seen = new Set<string>();
  return QUICK_TILES.filter((tile) => {
    if (seen.has(tile.id)) return false;
    if (tile.self) {
      if (!hasSelfPersonnelRecord(user) || !can(user, tile.path) || !moduleOn(license, tile.path)) return false;
      seen.add(tile.id);
      return true;
    }
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

const TAB_HREFS = new Set(["/", "/stok", "/saha", "/mesai", "/personelim", "/kasa", "/cariler", "/daha"]);

/** Tab ekranına push yeni stack açıp APK’da çökertmesin; navigate ile sekmeyi değiştir. */
export function hrefNav(href: string): { method: "navigate" | "push"; target: string | { pathname: string; params: Record<string, string> } } {
  const { pathname, params } = splitHref(href || "/");
  const target = params ? { pathname, params } : pathname;
  return { method: TAB_HREFS.has(pathname) ? "navigate" : "push", target };
}
