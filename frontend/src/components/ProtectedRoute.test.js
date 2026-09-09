import { isPublicPath } from "./ProtectedRoute";

test("marketing, login and platform paths stay public", () => {
  expect(isPublicPath("/")).toBe(true);
  expect(isPublicPath("/login")).toBe(true);
  expect(isPublicPath("/fiyatlar")).toBe(true);
  expect(isPublicPath("/kayit")).toBe(true);
  expect(isPublicPath("/sistem")).toBe(true);
  expect(isPublicPath("/sistem/sirketler")).toBe(true);
  expect(isPublicPath("/b2b/giris")).toBe(true);
});

test("ERP shell paths are not public", () => {
  expect(isPublicPath("/panel")).toBe(false);
  expect(isPublicPath("/invoices")).toBe(false);
  expect(isPublicPath("/b2b-yonetim")).toBe(false);
});
