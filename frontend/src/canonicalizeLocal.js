/** Local ERP lives at http://127.0.0.1/ — localhost and :3000 are other origins. */
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function canonicalizeLocalOrigin() {
  if (typeof window === "undefined") return;
  const { hostname, port, pathname, search, hash } = window.location;
  if (!LOCAL.has(hostname)) return;
  const wrongHost = hostname !== "127.0.0.1";
  const wrongPort = port === "3000" || port === "8000";
  if (!wrongHost && !wrongPort) return;
  window.location.replace(`http://127.0.0.1${pathname}${search}${hash}`);
}
