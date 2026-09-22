export const REMEMBER_ERP_KEY = "tamkobi_remember_email";
export const REMEMBER_B2B_KEY = "tamkobi_remember_b2b_email";
export const REMEMBER_SYS_KEY = "tamkobi_remember_system_email";

export function loadRememberedEmail(key) {
  try {
    return (localStorage.getItem(key) || "").trim();
  } catch {
    return "";
  }
}

export function saveRememberedEmail(key, email) {
  try {
    const value = (email || "").trim().toLowerCase();
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

export function clearRememberedEmail(key) {
  saveRememberedEmail(key, "");
}
