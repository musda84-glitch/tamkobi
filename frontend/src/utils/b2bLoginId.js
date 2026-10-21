export const PORTAL_LOGIN_INVALID = "Portal girişi geçerli bir e-posta ya da 10/11 haneli VKN/TCKN olmalıdır.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Boş, e-posta veya 10/11 haneli VKN/TCKN. VKN rakam olarak döner. */
export function canonicalPortalLogin(value) {
  const raw = String(value || "").trim();
  if (!raw) return { ok: true, value: "" };
  if (raw.includes("@")) {
    const email = raw.toLowerCase();
    if (!EMAIL_RE.test(email)) return { ok: false, value: raw, message: PORTAL_LOGIN_INVALID };
    return { ok: true, value: email };
  }
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return { ok: true, value: digits };
  return { ok: false, value: raw, message: PORTAL_LOGIN_INVALID };
}
