/**
 * @jest-environment jsdom
 */
import axios from "axios";
import { toast } from "sonner";
import {
  B2B_PORTAL_MAP_KEY,
  B2B_SESSION_KEY,
  b2bNav,
  clearB2BSession,
  contactPortalToken,
  isSafeB2BPath,
  logoutB2B,
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

test("logoutB2B sunucu hatasında da haritayı siler, sepeti ve panel anahtarını bırakır", async () => {
  writeB2BSession("select-secret", "ali@ornek.test");
  localStorage.setItem(B2B_PORTAL_MAP_KEY, JSON.stringify({ cA: "tok-a" }));
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  localStorage.setItem("b2b_held_carts_tok-a", JSON.stringify([{ id: "h1" }]));
  localStorage.setItem("token", "panel-local");
  sessionStorage.setItem("token", "panel-session");
  document.cookie = "tamkobi_app=stay";
  const post = jest.spyOn(axios, "post").mockRejectedValue(new Error("down"));
  const go = jest.spyOn(b2bNav, "go").mockImplementation(() => {});
  const message = jest.spyOn(toast, "message").mockImplementation(() => {});
  logoutB2B();
  await Promise.resolve();
  expect(post).toHaveBeenCalledWith("/api/public/b2b/logout", {}, {
    headers: { Authorization: "B2bSession select-secret" },
  });
  expect(sessionStorage.getItem(B2B_SESSION_KEY)).toBeNull();
  expect(sessionStorage.getItem("b2b_session_email")).toBeNull();
  expect(localStorage.getItem(B2B_PORTAL_MAP_KEY)).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("b2b_held_carts_tok-a")).toContain("h1");
  expect(localStorage.getItem("token")).toBe("panel-local");
  expect(sessionStorage.getItem("token")).toBe("panel-session");
  expect(document.cookie).toContain("tamkobi_app=stay");
  expect(go).toHaveBeenCalledWith("/b2b/giris");
  expect(message).toHaveBeenCalledWith("Sepetiniz bu cihazda saklandı.");
  post.mockRestore();
  go.mockRestore();
  message.mockRestore();
});
