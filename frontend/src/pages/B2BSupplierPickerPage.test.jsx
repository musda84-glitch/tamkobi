/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import B2BSupplierPickerPage from "./B2BSupplierPickerPage";
import { b2bNav } from "../utils/b2bSession";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

const SUPPLIERS = [
  { contact_id: "cA", company_id: "coA", company_name: "Anadolu Gıda Dağıtım A.Ş.", logo_url: "", contact_name: "Örnek Market Ltd. Şti." },
  { contact_id: "cB", company_id: "coB", company_name: "Ege Temizlik Ürünleri San. Tic.", logo_url: "https://cdn.example/ege.png", contact_name: "Örnek Market - Merkez" },
];

let host;
let root;
let goSpy;

async function show() {
  root = createRoot(host);
  await act(async () => { root.render(<B2BSupplierPickerPage />); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  sessionStorage.clear();
  localStorage.clear();
  axios.get.mockReset();
  axios.post.mockReset();
  goSpy = jest.spyOn(b2bNav, "go").mockImplementation(() => {});
  sessionStorage.setItem("b2b_session", "select-secret");
  sessionStorage.setItem("b2b_session_email", "satinalma@ornekmarket.com.tr");
});

afterEach(() => {
  goSpy.mockRestore();
  if (root) {
    act(() => root.unmount());
    root = null;
  }
  host.remove();
  sessionStorage.clear();
  localStorage.clear();
});

test("oturum yoksa girişe döner", async () => {
  sessionStorage.clear();
  axios.get.mockResolvedValue({ data: { suppliers: SUPPLIERS } });
  await show();
  expect(goSpy).toHaveBeenCalledWith("/b2b/giris");
  expect(axios.get).not.toHaveBeenCalled();
});

test("seçim select-supplier çağırır ve portal yoluna gider", async () => {
  axios.get.mockResolvedValue({ data: { suppliers: SUPPLIERS } });
  axios.post.mockResolvedValue({ data: { redirect: "/portal/tok-b" } });
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 3, note: "" } }));
  localStorage.setItem("b2b_contact_portals", JSON.stringify({ cA: "tok-a" }));
  await show();
  expect(host.querySelector('[data-testid="b2b-supplier-count"]').textContent).toContain("2 tedarikçi");
  expect(host.querySelector('[data-testid="b2b-supplier-cart-cA"]').textContent).toBe("Sepette 3 ürün");
  expect(host.querySelector('[data-testid="b2b-supplier-cB"] img').getAttribute("src")).toBe("https://cdn.example/ege.png");
  expect(axios.get).toHaveBeenCalledWith("/api/public/b2b/suppliers", {
    headers: { Authorization: "B2bSession select-secret" },
  });
  expect(String(axios.get.mock.calls[0][0])).not.toContain("select-secret");
  await act(async () => { host.querySelector('[data-testid="b2b-supplier-enter-cB"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(axios.post).toHaveBeenCalledWith("/api/public/b2b/select-supplier", {
    select_token: "select-secret",
    contact_id: "cB",
  });
  expect(String(axios.post.mock.calls[0][0])).not.toContain("?");
  expect(goSpy).toHaveBeenCalledWith("/portal/tok-b");
  expect(JSON.stringify(goSpy.mock.calls)).not.toContain("select-secret");
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("b2b_cart_tok-b")).toBeNull();
});

test("403 hata mesajını gösterir ve yönlendirmez", async () => {
  axios.get.mockResolvedValue({ data: { suppliers: SUPPLIERS } });
  axios.post.mockRejectedValue({
    response: { status: 403, data: { detail: "Bu cari bu oturuma bağlı değil." } },
  });
  await show();
  await act(async () => { host.querySelector('[data-testid="b2b-supplier-enter-cA"]').click(); });
  await act(async () => { await Promise.resolve(); });
  expect(host.querySelector('[data-testid="b2b-supplier-error"]').textContent).toBe("Bu cari bu oturuma bağlı değil.");
  expect(goSpy).not.toHaveBeenCalled();
  expect(sessionStorage.getItem("b2b_session")).toBe("select-secret");
});

test("boş liste erişim mesajını gösterir", async () => {
  axios.get.mockResolvedValue({ data: { suppliers: [] } });
  await show();
  expect(host.querySelector('[data-testid="b2b-supplier-empty"]').textContent).toBe(
    "B2B erişiminiz tanımlı değil. Tedarikçinizle iletişime geçin.",
  );
  expect(host.querySelector('[data-testid="b2b-tamkobi-logo"]').getAttribute("src")).toBe("/brand/tamkobi-mark.svg");
});

test("çıkış seçim oturumunu siler, sepeti ve çerezi bırakır", async () => {
  axios.get.mockResolvedValue({ data: { suppliers: SUPPLIERS } });
  axios.post.mockResolvedValue({ data: { status: "success" } });
  localStorage.setItem("b2b_cart_tok-a", JSON.stringify({ p1: { productId: "p1", qty: 2, note: "" } }));
  localStorage.setItem("b2b_contact_portals", JSON.stringify({ cA: "tok-a" }));
  localStorage.setItem("b2b_held_carts_tok-a", JSON.stringify([{ id: "h1", cart: { p1: { productId: "p1", qty: 1, note: "" } } }]));
  sessionStorage.setItem("tamkobi_access_token", "panel-session");
  localStorage.setItem("tamkobi_access_token", "panel-local");
  document.cookie = "tamkobi_app=stay";
  await show();
  await act(async () => { host.querySelector('[data-testid="b2b-logout"]').click(); });
  expect(sessionStorage.getItem("b2b_session")).toBeNull();
  expect(sessionStorage.getItem("b2b_session_email")).toBeNull();
  expect(localStorage.getItem("b2b_contact_portals")).toBeNull();
  expect(localStorage.getItem("b2b_cart_tok-a")).toContain("p1");
  expect(localStorage.getItem("b2b_held_carts_tok-a")).toContain("h1");
  expect(sessionStorage.getItem("tamkobi_access_token")).toBeNull();
  expect(localStorage.getItem("tamkobi_access_token")).toBeNull();
  expect(document.cookie).toContain("tamkobi_app=stay");
  expect(goSpy).toHaveBeenCalledWith("/b2b/giris");
  expect(axios.post).toHaveBeenCalledWith(
    "/api/auth/logout",
    {},
    { withCredentials: true, headers: undefined },
  );
  expect(axios.post).toHaveBeenCalledWith(
    "/api/public/b2b/logout",
    { select_token: "select-secret" },
    { withCredentials: true, headers: { Authorization: "B2BSession select-secret" } },
  );
});
