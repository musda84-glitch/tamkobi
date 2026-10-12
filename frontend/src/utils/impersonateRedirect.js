export const ERP_HOME_PATH = "/panel";

const ALLOWED_SSO_HOSTS = new Set([
  "app.tamkobi.com",
  "tamkobi.com",
  "www.tamkobi.com",
  "ik.tamkobi.com",
]);

/** Impersonate API yanıtındaki redirect veya varsayılan panel. */
export function impersonateRedirect(payload) {
  const r = payload && typeof payload.redirect === "string" ? payload.redirect.trim() : "";
  if (!r) return ERP_HOME_PATH;
  if (r.startsWith("/") && !r.startsWith("//")) return r;
  try {
    const u = new URL(r);
    if ((u.protocol === "https:" || u.protocol === "http:") && ALLOWED_SSO_HOSTS.has(u.hostname)) {
      return r;
    }
  } catch {
    /* fall through */
  }
  return ERP_HOME_PATH;
}
