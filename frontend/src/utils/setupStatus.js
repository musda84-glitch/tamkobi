/** Decide whether the first-run wizard should take over the site. */

export const INSTALLED_CACHE_KEY = "tamkobi_installed";

export function readInstalledCache() {
  try {
    return localStorage.getItem(INSTALLED_CACHE_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeInstalledCache(installed) {
  try {
    if (installed) localStorage.setItem(INSTALLED_CACHE_KEY, "1");
    else localStorage.removeItem(INSTALLED_CACHE_KEY);
  } catch {
    /* private mode / disabled storage */
  }
}

/**
 * Only an explicit `{ installed: false }` from the API opens the wizard.
 * Network errors keep a previously installed site up; with no cache they
 * also do not force the installer (a timeout must not take production down).
 */
export function resolveSetupStatus(payload, { error = false, cached = false } = {}) {
  if (!error && payload && typeof payload.installed === "boolean") {
    return { installed: payload.installed, fromCache: false };
  }
  if (cached) return { installed: true, fromCache: true };
  return { installed: true, fromCache: false, unreachable: true };
}
