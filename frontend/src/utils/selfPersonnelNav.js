/** Self-servis İK menüleri (Benim Sayfam / Mesaim). */
export const SELF_PERSONNEL_PATHS = ["/personelim", "/mesai"];

/** Personel rolünün web menüsünde görebileceği alanlar (mobil sekme / More ile uyumlu). */
export const PERSONEL_MENU_PATHS = [
  "/",
  "/panel",
  "/mesai",
  "/personelim",
  "/atolye",
  "/saha",
  "/communication",
  "/support",
];

export function hasSelfPersonnelRecord(user) {
  return Boolean(user?.employee_id);
}

export function isPersonelRole(user) {
  return String(user?.role || "").trim().toLowerCase() === "personel";
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
  if (!isPersonelRole(user)) return true;
  const p = String(path || "").split("?")[0];
  if (p === "/hesap" || p.startsWith("/hesap/")) return true;
  return PERSONEL_MENU_PATHS.includes(p);
}

/** Firma ayarları / GİB / yeni şirket — personel rolünde kapalı. */
export function personelCanManageCompany(user) {
  return !isPersonelRole(user);
}

/** Header / radial ERP kısayolları (fatura, barkod, virman, arama). */
export function personelCanUseErpShortcuts(user) {
  return !isPersonelRole(user);
}

/** Mobil özet: personel kartı bağlıysa ciro/kâr kartları gizlenir. */
export function showHomeFinanceSummary(user) {
  if (isPersonelRole(user)) return false;
  return !hasSelfPersonnelRecord(user);
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
