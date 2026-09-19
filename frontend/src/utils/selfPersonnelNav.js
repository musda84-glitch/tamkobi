/** Self-servis İK menüleri (Benim Sayfam / Mesaim). */
export const SELF_PERSONNEL_PATHS = ["/personelim", "/mesai"];

export function hasSelfPersonnelRecord(user) {
  return Boolean(user?.employee_id);
}

export function isSelfPersonnelPath(path) {
  return SELF_PERSONNEL_PATHS.includes(path);
}

/** Personel kartı yoksa Benim Sayfam ve Mesaim menüde durmaz. */
export function selfPersonnelNavAllowed(path, user) {
  if (!isSelfPersonnelPath(path)) return true;
  return hasSelfPersonnelRecord(user);
}
