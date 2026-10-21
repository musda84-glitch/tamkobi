/**
 * @jest-environment jsdom
 */
import {
  B2B_PORTAL_MAP_KEY,
  B2B_SESSION_KEY,
  clearB2BSession,
  contactPortalToken,
  isSafeB2BPath,
  rememberContactPortal,
  storedCartUnits,
  writeB2BSession,
} from "./b2bSession";

beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});

test("güvenli yol select_token ve sorgu dizesini reddeder", () => {
  expect(isSafeB2BPath("/b2b/tedarikci")).toBe(true);
  expect(isSafeB2BPath("/b2b/giris")).toBe(true);
  expect(isSafeB2BPath("/portal/tok-a")).toBe(true);
  expect(isSafeB2BPath("/b2b/tedarikci?select_token=abc")).toBe(false);
  expect(isSafeB2BPath("/portal/tok-a?select_token=abc")).toBe(false);
  expect(isSafeB2BPath("https://evil.example/portal/tok")).toBe(false);
  expect(isSafeB2BPath("//evil.example/b2b/giris")).toBe(false);
});

test("sepet adedi yalnız ilgili portal token anahtarını okur", () => {
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 3, note: "" } }));
  localStorage.setItem("b2b_cart_tok-b", JSON.stringify({ p9: { productId: "p9", qty: 1, note: "" } }));
  rememberContactPortal("cA", "tok-a");
  rememberContactPortal("cB", "tok-b");
  expect(contactPortalToken("cA")).toBe("tok-a");
  expect(storedCartUnits("tok-a")).toBe(3);
  expect(storedCartUnits("tok-b")).toBe(1);
  expect(localStorage.getItem(B2B_PORTAL_MAP_KEY)).not.toContain("select_token");
});

test("oturum temizliği sepeti ve çerezi bırakır", () => {
  writeB2BSession("select-secret", "ali@ornek.test");
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  document.cookie = "tamkobi_app=stay";
  clearB2BSession();
  expect(sessionStorage.getItem(B2B_SESSION_KEY)).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(document.cookie).toContain("tamkobi_app=stay");
});
