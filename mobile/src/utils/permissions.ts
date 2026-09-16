export type PermissionLevel = "none" | "view" | "edit" | string;

export type SessionUser = {
  role?: string;
  permissions?: Record<string, PermissionLevel>;
  features?: Record<string, boolean>;
} | null;

export type License = {
  modules?: Record<string, boolean>;
  addons?: Record<string, boolean>;
} | null;

const LICENSE_KEY: Record<string, string> = { "/panel": "/", "/personelim": "/mesai" };

export function permPath(path: string): string {
  return LICENSE_KEY[path] || path;
}

export function can(user: SessionUser, path: string, level: "view" | "edit" = "view"): boolean {
  if (!user?.permissions || user.role === "admin") return true;
  const value = user.permissions[permPath(path)];
  if (level === "view") return value !== "none";
  return value === "edit";
}

export function moduleOn(license: License, path: string): boolean {
  if (!license?.modules) return true;
  return license.modules[LICENSE_KEY[path] || path] !== false;
}

export type MobileModule = { key: string; path: string; label: string; tab?: boolean };

export const MOBILE_MODULES: MobileModule[] = [
  { key: "home", path: "/", label: "Özet", tab: true },
  { key: "saha", path: "/saha", label: "Saha", tab: true },
  { key: "stock", path: "/stock", label: "Stok", tab: true },
  { key: "mesai", path: "/mesai", label: "Mesaim", tab: true },
  { key: "personelim", path: "/personelim", label: "Personelim", tab: true },
  { key: "contacts", path: "/contacts", label: "Cariler" },
  { key: "invoices", path: "/invoices", label: "Faturalar" },
  { key: "orders", path: "/orders", label: "Siparişler" },
  { key: "notifications", path: "/", label: "Bildirimler" },
];

export function visibleModules(user: SessionUser, license: License): MobileModule[] {
  return MOBILE_MODULES.filter((m) => can(user, m.path) && moduleOn(license, m.path));
}
