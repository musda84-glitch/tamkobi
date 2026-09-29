import { personelMenuPathAllowed } from "../utils/selfPersonnelNav";

/**
 * Destek talepleri (tickets) — lisans eklentisi + rol + paket modülü.
 * Role /support = none iken Talep oluştur gizlenir.
 */
export function supportTicketsAllowed({ user, can, moduleOn, addonOn } = {}) {
  if (!addonOn?.("support.tickets")) return false;
  if (!personelMenuPathAllowed("/support", user)) return false;
  if (typeof can === "function" && !can("/support")) return false;
  if (typeof moduleOn === "function" && !moduleOn("/support")) return false;
  return true;
}

/** Destek iletişim (mailto/tel) — aynı rol/modül kapısı. */
export function supportContactAllowed({ user, can, moduleOn, addonOn, support } = {}) {
  if (!addonOn?.("support.contact")) return false;
  if (!personelMenuPathAllowed("/support", user)) return false;
  if (typeof can === "function" && !can("/support")) return false;
  if (typeof moduleOn === "function" && !moduleOn("/support")) return false;
  return !!(support && (support.email || support.phone));
}
