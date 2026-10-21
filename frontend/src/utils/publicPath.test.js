
import { isPublicPath, requiresSession } from "./publicPath";

test("marketing, login and platform paths stay public", () => {
  expect(isPublicPath("/")).toBe(true);
  expect(isPublicPath("/login")).toBe(true);
  expect(isPublicPath("/sso")).toBe(true);
  expect(isPublicPath("/sso/")).toBe(true);
  expect(isPublicPath("/sifre/abc")).toBe(true);
  expect(isPublicPath("/kurulum")).toBe(true);
  expect(isPublicPath("/fiyatlar")).toBe(true);
  expect(isPublicPath("/web")).toBe(true);
  expect(isPublicPath("/kayit")).toBe(true);
  expect(isPublicPath("/sistem")).toBe(true);
  expect(isPublicPath("/sistem/sirketler")).toBe(true);
  expect(isPublicPath("/b2b/giris")).toBe(true);
  expect(isPublicPath("/teklif/abc")).toBe(true);
  expect(isPublicPath("/proje/abc")).toBe(true);
  expect(isPublicPath("/ekstre/abc")).toBe(true);
  expect(isPublicPath("/yasal/kvkk")).toBe(true);
  expect(isPublicPath("/hakkimizda")).toBe(true);
  expect(isPublicPath("/hizmetler")).toBe(true);
  expect(isPublicPath("/referanslar")).toBe(true);
  expect(isPublicPath("/iletisim")).toBe(true);
});

test("ERP shell paths are not public", () => {
  expect(isPublicPath("/panel")).toBe(false);
  expect(isPublicPath("/invoices")).toBe(false);
  expect(isPublicPath("/b2b-yonetim")).toBe(false);
});

test("unknown paths skip login so SPA 404 can render", () => {
  expect(requiresSession("/bu-yol-yok")).toBe(false);
  expect(requiresSession("/panel")).toBe(true);
  expect(requiresSession("/invoices")).toBe(true);
  expect(requiresSession("/yardim")).toBe(true);
  expect(requiresSession("/vpos/result/abc")).toBe(true);
  expect(requiresSession("/yasal/kvkk")).toBe(false);
  expect(requiresSession("/sso")).toBe(false);
});
