/** İK portalı ve mobil saha özellikleri. Anahtarlar backend FEATURES ile aynı; varsayılan kapalı. */
export const PORTAL_FIELD_BY_PATH = {
  "/atolye": "portal_atolye",
  "/sevk": "portal_pick",
  "/sayim": "portal_sayim",
  "/saha": "portal_saha",
  "/vehicles": "portal_vehicles",
  "/orders": "portal_orders",
};

export const IK_PORTAL_LINKS = [
  { to: "/personelim", label: "Personelim", always: true },
  { to: "/mesai", label: "Mesaim", always: true },
  { to: "/atolye", label: "Atölye", feature: "portal_atolye" },
  { to: "/sevk", label: "Sipariş Toplama", feature: "portal_pick" },
  { to: "/sayim", label: "Stok Sayımı", feature: "portal_sayim" },
  { to: "/saha", label: "Saha Sipariş", feature: "portal_saha" },
  { to: "/vehicles", label: "Araçlarım", feature: "portal_vehicles" },
  { to: "/orders", label: "Siparişler", feature: "portal_orders" },
];

export function portalFeatureKey(path) {
  const p = String(path || "").split("?")[0];
  return PORTAL_FIELD_BY_PATH[p] || null;
}

export function isPersonelRoleCode(user) {
  return String(user?.role || "").trim().toLowerCase() === "personel";
}

/** Özellik kaydı yoksa kapalı. Yönetici her zaman açık. */
export function hasPortalFeature(user, key) {
  if (!user || !key) return false;
  if (user.is_super_admin) return true;
  const role = String(user.role || "").trim().toLowerCase();
  if (role === "admin" || role === "owner") return true;
  return user.features?.[key] === true;
}

export function visibleIkLinks(user) {
  return IK_PORTAL_LINKS.filter((link) => link.always || hasPortalFeature(user, link.feature));
}

export function ikFieldDenied(pathname, user) {
  const key = portalFeatureKey(pathname);
  if (!key || !user) return false;
  if (hasPortalFeature(user, key)) return false;
  return isPersonelRoleCode(user);
}
