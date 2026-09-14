/** Local ERP prefers http://127.0.0.1/ (nginx). localhost and :3000 are other origins for cookies. */

const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

function isLocalHost(hostname) {
  return LOCAL.has(hostname);
}

/**
 * Probe whether the canonical nginx origin answers quickly.
 * If CRA (:3000) is used and nginx is down, do NOT redirect — avoids Chromium -102
 * (ERR_CONNECTION_REFUSED) on http://127.0.0.1/portal.
 */
async function nginxReachable(timeoutMs = 600) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const t = setTimeout(() => ctrl?.abort(), timeoutMs);
  try {
    await fetch("http://127.0.0.1/", {
      method: "HEAD",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl?.signal,
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** @returns {Promise<boolean>} true if a navigation was started */
export async function canonicalizeLocalOrigin() {
  if (typeof window === "undefined") return false;
  const { hostname, port, pathname, search, hash } = window.location;
  if (!isLocalHost(hostname)) return false;

  const wrongHost = hostname !== "127.0.0.1";
  const wrongPort = port === "3000" || port === "8000";
  if (!wrongHost && !wrongPort) return false;

  // Host-only fix (localhost → 127.0.0.1) keeps the same port — safe even without nginx.
  if (wrongHost && !wrongPort) {
    window.location.replace(`http://127.0.0.1${port ? `:${port}` : ""}${pathname}${search}${hash}`);
    return true;
  }

  // Leaving :3000/:8000 for :80 only when nginx is actually up.
  if (wrongPort) {
    const ok = await nginxReachable();
    if (!ok) return false;
    window.location.replace(`http://127.0.0.1${pathname}${search}${hash}`);
    return true;
  }
  return false;
}
