import { hasPortalFeature, portalFeatureKey } from "./portalFields";

/** Self-servis İK menüleri (Benim Sayfam / Mesaim). */
export const SELF_PERSONNEL_PATHS = ["/personelim", "/mesai"];

/** Personel rolünün web menüsünde görebileceği alanlar. Saha modülleri özellik iznine bağlıdır. */
export const PERSONEL_MENU_PATHS = [
  "/",
  "/panel",
  "/mesajlar",
  "/mesai",
  "/personelim",
  "/communication",
  "/support",
  "/yardim",
];

export function hasSelfPersonnelRecord(user) {
  return Boolean(user?.employee_id);
}

export function isPersonelRole(user) {
  return String(user?.role || "").trim().toLowerCase() === "personel";
}

/** Personel sipariş modunda kalan işlemler (mobil OrderActions staffToolbar ile aynı). */
export const ORDER_STAFF_ACTIONS = ["print", "missing", "produce", "cargo", "label"];

/** Personel + portal_orders. Sipariş ekranında yalnız beş işlem. Auth yokken kapalı. */
export function isOrderStaffMode(user) {
  return isPersonelRole(user) && hasPortalFeature(user, "portal_orders");
}

export function isSelfPersonnelPath(path) {
  return SELF_PERSONNEL_PATHS.includes(path);
}

/** Personel kartı yoksa Benim Sayfam ve Mesaim menüde durmaz. */
export function selfPersonnelNavAllowed(path, user) {
  if (!isSelfPersonnelPath(path)) return true;
  return hasSelfPersonnelRecord(user);
}

/**
 * Personel rolü yalnızca kendi modüllerini görür (mobildeki gibi).
 * Diğer roller için kısıt yok.
 */
export function personelMenuPathAllowed(path, user) {
  // Fail-closed while auth is loading so the full ERP menu cannot flash.
  if (!user) return false;
  if (!isPersonelRole(user)) return true;
  const p = String(path || "").split("?")[0];
  if (p === "/hesap" || p.startsWith("/hesap/")) return true;
  if (p === "/yardim" || p.startsWith("/yardim/")) return true;
  const fieldKey = portalFeatureKey(p);
  if (fieldKey) return hasPortalFeature(user, fieldKey);
  return PERSONEL_MENU_PATHS.includes(p);
}

/** Firma ayarları / GİB / yeni şirket — personel rolünde kapalı. */
export function personelCanManageCompany(user) {
  return !isPersonelRole(user);
}

/** Header / radial ERP kısayolları (fatura, barkod, virman, arama). */
export function personelCanUseErpShortcuts(user) {
  if (!user) return false;
  return !isPersonelRole(user);
}

/** Mobil özet: personel kartı bağlıysa ciro/kâr kartları gizlenir. */
export function showHomeFinanceSummary(user) {
  if (isPersonelRole(user)) return false;
  return !hasSelfPersonnelRecord(user);
}

/** AI Üretim & Reçete: yalnızca yönetici (admin/müdür). Personel / üretim ve personel kartı bağlı girişte gizli. */
export function showProductionAiAdvisor(user) {
  if (!user) return false;
  if (hasSelfPersonnelRecord(user)) return false;
  const role = String(user.role || "").trim().toLowerCase();
  if (role === "personel" || role === "production") return false;
  return role === "admin" || role === "manager";
}

/** Hesap sayfası sekmeleri — personel yalnız profil (+ çoklu şirkette geçiş). */
export function personelAccountTabs(user, companyCount = 1) {
  if (!isPersonelRole(user)) {
    return ["profil", "sirketler", "kontor", "paket", "ayarlar"];
  }
  const tabs = ["profil"];
  if (Number(companyCount) > 1) tabs.push("sirketler");
  return tabs;
}
