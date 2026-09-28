/** Path aliases used for both permission and license module keys. */
export const AUTH_LICENSE_KEY = { "/panel": "/", "/personelim": "/mesai" };

export function authPermPath(path) {
  return AUTH_LICENSE_KEY[path] || path;
}

/**
 * Role/permission check. Fail-closed when there is no user (auth still loading
 * or logged out) so hidden menus cannot flash on refresh / back navigation.
 */
export function canAccessPath(user, path, level = "view", resolvePath = authPermPath) {
  if (!user) return false;
  if (user.role === "admin") return true;
  const perms = user.permissions;
  if (!perms) return false;
  const value = perms[resolvePath(path)];
  if (level === "view") return value !== "none";
  if (level === "edit") return value === "edit" || value === "delete";
  if (level === "delete") return value === "delete";
  return false;
}

/** Feature flags — fail-closed without a session user. */
export function isFeatureEnabled(user, key) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (!user.features) return true;
  return user.features[key] !== false;
}

/** License module gate — fail-closed without a session user. */
export function isModuleEnabled(user, license, path, resolvePath = authPermPath) {
  if (!user) return false;
  if (!license?.modules) return true;
  return license.modules[resolvePath(path)] !== false;
}

/** License addon gate — fail-closed without a session user. */
export function isAddonEnabled(user, license, key) {
  if (!user) return false;
  if (!license?.addons) return true;
  return license.addons[key] !== false;
}

/**
 * Whether the ERP chrome (sidebar/header) may render.
 * Keeps role-gated nav from painting before /auth/me (and Mesaim gate) settle.
 */
export function erpShellReady({ loading, authenticated, user, mesaimReady = true }) {
  if (loading) return false;
  if (!authenticated || !user) return false;
  if (user.employee_id && !mesaimReady) return false;
  return true;
}
