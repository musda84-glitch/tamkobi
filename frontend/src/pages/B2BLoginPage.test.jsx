/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import B2BLoginPage from "./B2BLoginPage";
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

let host;
let root;
let goSpy;

function setControl(el, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

async function show() {
  root = createRoot(host);
  await act(async () => { root.render(<B2BLoginPage />); });
  await act(async () => { await Promise.resolve(); });
}

async function fillAndSubmit(email = "ali@ornek.test") {
  await act(async () => {
    setControl(host.querySelector('[data-testid="b2b-login-email"]'), email);
    setControl(host.querySelector('[data-testid="b2b-login-password"]'), "gizli-sifre");
  });
  await act(async () => { host.querySelector('[data-testid="b2b-login-submit"]').click(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  sessionStorage.clear();
  localStorage.clear();
  localStorage.setItem("tamkobi_b2b_login_legal", JSON.stringify({ mss: true, obf: true, kvkk: true }));
  axios.post.mockReset();
  goSpy = jest.spyOn(b2bNav, "go").mockImplementation(() => {});
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

test("birden fazla tedarikçi seçiciye gider ve select_token adreste durmaz", async () => {
  axios.post.mockResolvedValue({
    data: {
      suppliers: [
        { contact_id: "cA", company_id: "coA", company_name: "Anadolu", logo_url: "", contact_name: "Ali" },
        { contact_id: "cB", company_id: "coB", company_name: "Ege", logo_url: "", contact_name: "Ali" },
      ],
      select_token: "select-secret",
    },
  });
  await show();
  await fillAndSubmit();
  expect(sessionStorage.getItem("b2b_session")).toBe("select-secret");
  expect(goSpy).toHaveBeenCalledWith("/b2b/tedarikci");
  expect(JSON.stringify(goSpy.mock.calls)).not.toContain("select-secret");
  expect(host.textContent).not.toContain("select-secret");
  expect(axios.post).toHaveBeenCalledWith("/api/public/b2b/login", { email: "ali@ornek.test", password: "gizli-sifre" });
});

test("tek tedarikçi doğrudan portala gider ve seçim oturumu yazılmaz", async () => {
  axios.post.mockResolvedValue({
    data: {
      suppliers: [{ contact_id: "c1", company_id: "co", company_name: "Tek", logo_url: "", contact_name: "Ali" }],
      select_token: "should-not-store",
      redirect: "/portal/only-token",
      token: "only-token",
      name: "Ali",
    },
  });
  await show();
  await fillAndSubmit();
  expect(sessionStorage.getItem("b2b_session")).toBeNull();
  expect(goSpy).toHaveBeenCalledWith("/portal/only-token");
  expect(JSON.stringify(goSpy.mock.calls)).not.toContain("should-not-store");
});
