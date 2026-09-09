/** Paths that do not require an ERP session. Keep `/b2b-yonetim` private. */
export function isPublicPath(pathname) {
  const p = pathname || "/";
  if (p === "/" || p === "/login") return true;
  if (p === "/sistem" || p.startsWith("/sistem/")) return true;
  if (p === "/b2b" || p.startsWith("/b2b/")) return true;
  return (
    p.startsWith("/fiyatlar") ||
    p.startsWith("/kayit") ||
    p.startsWith("/portal/") ||
    p.startsWith("/teklif/") ||
    p.startsWith("/davet/") ||
    p.startsWith("/odeme/") ||
    p.startsWith("/yenile/")
  );
}
