export type PermissionLevel = "none" | "view" | "edit" | "delete" | string;

export type SessionUser = {
  role?: string;
  permissions?: Record<string, PermissionLevel>;
  features?: Record<string, boolean>;
  employee_id?: string | null;
  is_super_admin?: boolean;
} | null;

export type License = {
  modules?: Record<string, boolean>;
  addons?: Record<string, boolean>;
} | null;

const LICENSE_KEY: Record<string, string> = { "/panel": "/", "/personelim": "/mesai" };

/** İK portalı / mobil saha. Backend FEATURES ile aynı; kayıt yoksa kapalı. */
export const PORTAL_FIELD_BY_PATH: Record<string, string> = {
  "/atolye": "portal_atolye",
  "/sevk": "portal_pick",
  "/sayim": "portal_sayim",
  "/saha": "portal_saha",
  "/vehicles": "portal_vehicles",
  "/orders": "portal_orders",
};

const PORTAL_FEATURE_KEYS = new Set(Object.values(PORTAL_FIELD_BY_PATH));

/** Web PERSONEL_MENU_PATHS: personel rolü yalnız bu ekranları ve açık saha özelliklerini görür. */
const PERSONEL_MENU_PATHS = new Set([
  "/",
  "/panel",
  "/mesai",
  "/personelim",
  "/communication",
  "/support",
  "/yardim",
]);

function isPersonelRole(user: SessionUser): boolean {
  return String(user?.role || "").trim().toLowerCase() === "personel";
}

export function hasPortalFeature(user: SessionUser, key: string): boolean {
  if (!user || !key) return false;
  if (user.is_super_admin) return true;
  const role = String(user.role || "").trim().toLowerCase();
  if (role === "admin" || role === "owner") return true;
  return user.features?.[key] === true;
}

/** Web personelMenuPathAllowed. Diğer roller için kısıt yok. */
export function personelMenuPathAllowed(path: string, user: SessionUser): boolean {
  if (!user) return false;
  if (!isPersonelRole(user)) return true;
  const p = String(path || "").split("?")[0];
  if (p === "/hesap" || p.startsWith("/hesap/")) return true;
  if (p === "/yardim" || p.startsWith("/yardim/")) return true;
  const fieldKey = PORTAL_FIELD_BY_PATH[permPath(p)] || PORTAL_FIELD_BY_PATH[p];
  if (fieldKey) return hasPortalFeature(user, fieldKey);
  return PERSONEL_MENU_PATHS.has(p) || PERSONEL_MENU_PATHS.has(permPath(p));
}

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
  return value === "view" || value === "edit" || value === "delete";
}

function levelAllows(value: PermissionLevel | undefined, level: "view" | "edit" | "delete"): boolean {
  if (level === "view") return value !== "none" && value != null;
  if (level === "edit") return value === "edit" || value === "delete";
  if (level === "delete") return value === "delete";
  return false;
}

/** Personel + portal_orders. Sipariş ekranında yalnız beş işlem. */
export function isOrderStaffMode(user: SessionUser): boolean {
  return isPersonelRole(user) && hasPortalFeature(user, "portal_orders");
}

/** Kargola: personel sipariş modu, ya da sipariş/kargo düzenleme. */
export function canShipOrder(user: SessionUser): boolean {
  return isOrderStaffMode(user) || can(user, "/orders", "edit") || can(user, "/cargo", "edit");
}

export function can(user: SessionUser, path: string, level: "view" | "edit" | "delete" = "view"): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  const portalKey = PORTAL_FIELD_BY_PATH[permPath(path)];
  if (portalKey && hasPortalFeature(user, portalKey)) {
    // portal_orders personelde yalnız görüntüleme. Diğer roller modül matrisinde kalır.
    if (portalKey === "portal_orders") {
      if (isPersonelRole(user)) return level === "view";
    } else {
      return true;
    }
  }
  if (portalKey && isPersonelRole(user)) return false;
  if (isPersonelRole(user) && !personelMenuPathAllowed(path, user)) return false;
  if (path === "/personnel") {
    if (level === "view") return hasPersonnelAccess(user);
    return levelAllows(permissionLevel(user, path), level);
  }
  if (!user.permissions) return false;
  const value = permissionLevel(user, path);
  // Sunucu backfill: /cheques anahtarı yoksa banka yetkisi geçer.
  if (value == null && path === "/cheques") {
    return can(user, "/banking", level);
  }
  // Sunucu backfill: /purchase-orders yoksa stok yetkisi geçer.
  if (value == null && path === "/purchase-orders") {
    return can(user, "/stock", level);
  }
  if (level === "view") return value !== "none";
  return levelAllows(value, level);
}

/** Rol özellik bayrağı (Özellik Yetkileri). Anahtar yoksa backend feature_default ile uyumlu. */
export function feature(user: SessionUser, key: string): boolean {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (PORTAL_FEATURE_KEYS.has(key)) return hasPortalFeature(user, key);
  if (user.features && Object.prototype.hasOwnProperty.call(user.features, key)) {
    return user.features[key] !== false;
  }
  const role = String(user.role || "").trim().toLowerCase();
  // backend/rbac.feature_default — personel/üretimde AI panel ve destek şeridi varsayılan kapalı
  if ((key === "production_ai" || key === "support_bar") && (role === "personel" || role === "production")) {
    return false;
  }
  if (key === "view_prices" && (role === "personel" || role === "production")) return false;
  if ((key === "account_companies" || key === "export_personal_data") && role === "personel") return false;
  return true;
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

/** Özet ciro / kâr / tahsilat kartı: personel kaydı bağlı girişte gizlenir. */
export function showHomeFinanceSummary(user: SessionUser): boolean {
  if (isPersonelRole(user)) return false;
  return !hasSelfPersonnelRecord(user);
}

/** Ana sayfa Yenile karosu: yalnız personel kartı bağlı girişte. */
export function showHomeRefreshTile(user: SessionUser): boolean {
  return hasSelfPersonnelRecord(user);
}

/** Ana sayfa yönetici onay kutusu: admin / müdür / muhasebe veya İK yetkisi. */
export function showHomeApprovals(user: SessionUser): boolean {
  const role = String(user?.role || "").toLowerCase();
  if (role === "admin" || role === "manager" || role === "accountant") return true;
  return hasPersonnelAccess(user);
}

/** Stok kartı formu: yalnız /stock düzenleme (depo / yönetici). Personel ve üretim giremez. */
export function canOpenStockCard(user: SessionUser): boolean {
  return can(user, "/stock", "edit");
}

/** AI Üretim & Reçete: yalnızca yönetici (admin/müdür). Personel / üretim rolü ve personel kartı bağlı girişte gizli (özellik bayrağı açık olsa bile). */
export function showProductionAiAdvisor(user: SessionUser): boolean {
  if (!user) return false;
  if (hasSelfPersonnelRecord(user)) return false;
  const role = String(user.role || "").trim().toLowerCase();
  if (role === "personel" || role === "production") return false;
  return role === "admin" || role === "manager";
}

/** Sevk: Siparişi aç — özellik + Siparişler modül yetkisi. */
export function canSevkOpenOrder(user: SessionUser): boolean {
  return feature(user, "sevk_open_order") && can(user, "/orders");
}

/** Sevk: Taslak fatura — özellik + Faturalar modül yetkisi. */
export function canSevkDraftInvoice(user: SessionUser): boolean {
  return feature(user, "sevk_draft_invoice") && can(user, "/invoices");
}

/** Daha fazla listesi: ayarlar/bildirim herkese; Personel & Bordro yalnız /personnel yetkisinde. */
export function isMoreLinkVisible(link: { path: string }, user: SessionUser, license: License): boolean {
  if (link.path === "/" || link.path === "/settings" || link.path === "/qr-web-login") return true;
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
  { key: "sayim", path: "/sayim", label: "Stok Sayımı" },
  { key: "mesai", path: "/mesai", label: "Mesaim", tab: true },
  { key: "personelim", path: "/personelim", label: "Benim Sayfam", tab: true },
  { key: "personnel", path: "/personnel", label: "Personel & Bordro" },
  { key: "sevk", path: "/sevk", label: "Depo Sevkiyat" },
  { key: "vehicles", path: "/vehicles", label: "Araçlarım" },
  { key: "atolye", path: "/atolye", label: "Üretim Atölye" },
  { key: "production", path: "/production", label: "Üretim & Reçete (BOM)" },
  { key: "installments", path: "/installments", label: "Taksitler" },
  { key: "cheques", path: "/cheques", label: "Çek & Senet" },
  { key: "contacts", path: "/contacts", label: "Cariler" },
  { key: "invoices", path: "/invoices", label: "Faturalar" },
  { key: "edoc", path: "/edoc-inbox", label: "Gelen e-Faturalar" },
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
