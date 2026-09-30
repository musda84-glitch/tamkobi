/** ERP ana sayfa — `/` halka açık site; destek girişinden sonra buraya yönlen. */
export const ERP_HOME_PATH = "/panel";

/** Impersonate API yanıtındaki redirect veya varsayılan panel. */
export function impersonateRedirect(payload) {
  const r = payload && typeof payload.redirect === "string" ? payload.redirect.trim() : "";
  return r.startsWith("/") ? r : ERP_HOME_PATH;
}
