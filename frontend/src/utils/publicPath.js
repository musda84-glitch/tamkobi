/** Paths that do not require an ERP session. Keep `/b2b-yonetim` private. */
export function isPublicPath(pathname) {
  const p = pathname || "/";
  if (p === "/" || p === "/login" || p === "/kurulum" || p === "/sso" || p.startsWith("/sso/") || p === "/sifre" || p.startsWith("/sifre/")) return true;
  if (p === "/sistem" || p.startsWith("/sistem/")) return true;
  if (p === "/b2b" || p.startsWith("/b2b/")) return true;
  return (
    p.startsWith("/fiyatlar") ||
    p === "/web" ||
    p.startsWith("/web/") ||
    p.startsWith("/kayit") ||
    p.startsWith("/portal/") ||
    p.startsWith("/teklif/") ||
    p.startsWith("/proje/") ||
    p.startsWith("/ekstre/") ||
    p.startsWith("/davet/") ||
    p.startsWith("/odeme/") ||
    p.startsWith("/yenile/") ||
    p.startsWith("/yasal") ||
    p.startsWith("/hakkimizda") ||
    p.startsWith("/hizmetler") ||
    p.startsWith("/referanslar") ||
    p.startsWith("/iletisim")
  );
}

/** Bilinen ERP / özel paneller — oturum ister. Diğer bilinmeyen yollar 404’e düşer. */
const SESSION_PREFIXES = [
  "/panel",
  "/invoices",
  "/dis-ticaret",
  "/contacts",
  "/banking",
  "/stock",
  "/hizli-satis",
  "/ecommerce",
  "/cargo",
  "/orders",
  "/purchase-orders",
  "/saha",
  "/warehouses",
  "/vehicles",
  "/production",
  "/personnel",
  "/personelim",
  "/mesai",
  "/ai-advisor",
  "/communication",
  "/hesap",
  "/settings",
  "/vpos",
  "/quotes",
  "/projects",
  "/surveys",
  "/support",
  "/accountant",
  "/installments",
  "/atolye",
  "/sayim",
  "/sevk",
  "/reports",
  "/dispatches",
  "/expenses",
  "/loans",
  "/cheques",
  "/trash",
  "/islem-gecmisi",
  "/edoc-inbox",
  "/b2b-yonetim",
  "/yardim",
];

export function requiresSession(pathname) {
  const p = pathname || "/";
  if (isPublicPath(p)) return false;
  return SESSION_PREFIXES.some((x) => p === x || p.startsWith(`${x}/`));
}
