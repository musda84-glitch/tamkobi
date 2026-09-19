export type PermissionLevel = "none" | "view" | "edit" | string;

export type SessionUser = {
  role?: string;
  permissions?: Record<string, PermissionLevel>;
  features?: Record<string, boolean>;
  employee_id?: string | null;
} | null;

export type License = {
  modules?: Record<string, boolean>;
  addons?: Record<string, boolean>;
} | null;

const LICENSE_KEY: Record<string, string> = { "/panel": "/", "/personelim": "/mesai" };

export function permPath(path: string): string {
  return LICENSE_KEY[path] || path;
}

function permissionLevel(user: SessionUser, path: string): PermissionLevel | undefined {
  return user?.permissions?.[permPath(path)];
}

/** Kullanıcıya bağlı çalışan kartı var mı (Mesaim / Benim Sayfam). */
export function hasSelfPersonnelRecord(user: SessionUser): boolean {
  return Boolean(user?.employee_id);
}

/** Personel & Bordro İK ekranı: anahtar yoksa veya none ise kapalı (Mesaim/Personelim yetmez). */
export function hasPersonnelAccess(user: SessionUser): boolean {
  if (user?.role === "admin") return true;
  const value = permissionLevel(user, "/personnel");
  return value === "view" || value === "edit";
}

export function can(user: SessionUser, path: string, level: "view" | "edit" = "view"): boolean {
  if (user?.role === "admin") return true;
  if (path === "/personnel") {
    if (level === "edit") return permissionLevel(user, path) === "edit";
    return hasPersonnelAccess(user);
  }
  if (!user?.permissions) return true;
  const value = permissionLevel(user, path);
  if (level === "view") return value !== "none";
  return value === "edit";
}

export function moduleOn(license: License, path: string): boolean {
  if (!license?.modules) return true;
  const key = LICENSE_KEY[path] || path;
  return license.modules[key] !== false;
}

/** Personel kaydı yoksa tab çubuğunda Kasa & Banka / Cariler; varsa Mesaim / Benim Sayfam. */
export function showSelfPersonnelTabs(user: SessionUser, license: License): boolean {
  return hasSelfPersonnelRecord(user) && can(user, "/mesai") && moduleOn(license, "/mesai");
}

export function showFinanceSubstituteTabs(user: SessionUser): boolean {
  return !hasSelfPersonnelRecord(user);
}

/** Daha fazla listesi: ayarlar/bildirim herkese; Personel & Bordro yalnız /personnel yetkisinde. */
export function isMoreLinkVisible(link: { path: string }, user: SessionUser, license: License): boolean {
  if (link.path === "/" || link.path === "/settings") return true;
  if (link.path === "/personnel") return hasPersonnelAccess(user) && moduleOn(license, link.path);
  if (link.path === "/personelim" && !hasSelfPersonnelRecord(user)) return false;
  if ((link.path === "/banking" || link.path === "/contacts") && showFinanceSubstituteTabs(user)) return false;
  return can(user, link.path) && moduleOn(license, link.path);
}

export type MobileModule = { key: string; path: string; label: string; tab?: boolean };

export const MOBILE_MODULES: MobileModule[] = [
  { key: "home", path: "/", label: "Özet", tab: true },
  { key: "saha", path: "/saha", label: "Saha", tab: true },
  { key: "stock", path: "/stock", label: "Stok", tab: true },
  { key: "mesai", path: "/mesai", label: "Mesaim", tab: true },
  { key: "personelim", path: "/personelim", label: "Benim Sayfam", tab: true },
  { key: "personnel", path: "/personnel", label: "Personel & Bordro" },
  { key: "sevk", path: "/sevk", label: "Depo Sevkiyat" },
  { key: "atolye", path: "/atolye", label: "Üretim Atölye" },
  { key: "installments", path: "/installments", label: "Taksitler" },
  { key: "cheques", path: "/cheques", label: "Çek & Senet" },
  { key: "contacts", path: "/contacts", label: "Cariler" },
  { key: "invoices", path: "/invoices", label: "Faturalar" },
  { key: "orders", path: "/orders", label: "Siparişler" },
  { key: "banking", path: "/banking", label: "Kasa & Banka" },
  { key: "expenses", path: "/expenses", label: "Masraflar" },
  { key: "quotes", path: "/quotes", label: "Teklifler" },
  { key: "surveys", path: "/surveys", label: "Keşifler" },
  { key: "projects", path: "/projects", label: "Projeler" },
  { key: "notifications", path: "/", label: "Bildirimler" },
];

export function visibleModules(user: SessionUser, license: License): MobileModule[] {
  return MOBILE_MODULES.filter((m) => can(user, m.path) && moduleOn(license, m.path));
}
