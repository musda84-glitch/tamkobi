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
  "/mesajlar",
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

/**
 * Giriş yapılmamış kimlik ekranları (giriş, şifre sıfırlama, kayıt, davet, QR girişi
 * LoginPage modu olarak /login altında). Senkron çubuğu burada çizilmez.
 */
export function isGuestAuthPath(pathname) {
  const p = pathname || "/";
  if (p === "/login" || p === "/kayit" || p.startsWith("/kayit/")) return true;
  if (p === "/kurulum") return true;
  if (p === "/sso" || p.startsWith("/sso/")) return true;
  if (p === "/sifre" || p.startsWith("/sifre/")) return true;
  if (p === "/b2b/giris" || p === "/b2b/sifre" || p.startsWith("/b2b/sifre/")) return true;
  if (p === "/sistem/giris" || p === "/sistem/2fa-kurulum") return true;
  if (p.startsWith("/davet/")) return true;
  return false;
}
