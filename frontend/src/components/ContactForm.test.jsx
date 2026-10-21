/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { ContactForm } from "./ContactForm";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockDelete = jest.fn();
const mockGet = jest.fn();
const mockPut = jest.fn();
const mockPost = jest.fn();

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: (...a) => mockGet(...a),
    put: (...a) => mockPut(...a),
    post: (...a) => mockPost(...a),
    delete: (...a) => mockDelete(...a),
  },
}));

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (u) => u || "" }));
jest.mock("../utils/compressImage", () => ({ compressImageFile: async (f) => f }));
jest.mock("../utils/modalBackdrop", () => ({ backdropDismissProps: () => ({}) }));
jest.mock("./GibContactLookup", () => ({ GibContactLookup: () => <div data-testid="gib" /> }));

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mockDelete.mockReset();
  mockGet.mockReset();
  mockPut.mockReset();
  mockPost.mockReset();
  window.confirm = jest.fn(() => true);
});

afterEach(() => {
  act(() => root.unmount());
  document.querySelectorAll("[data-testid='contact-form-overlay']").forEach((n) => n.remove());
  host.remove();
});

const contact = {
  id: "cnt_1",
  name: "KAVRAM İŞ GÜVENLİK",
  tax_number_or_id: "1234567890",
  type: "customer",
  is_active: true,
};

test("edit form shows aktif/pasif toggle and delete", async () => {
  await act(async () => {
    root.render(<ContactForm companyId="c1" contact={contact} onClose={() => {}} />);
  });
  expect(document.querySelector("[data-testid='cf-active-toggle']")).not.toBeNull();
  expect(document.querySelector("[data-testid='cf-active-badge']")?.textContent).toMatch(/Aktif/i);
  expect(document.querySelector("[data-testid='cf-delete']")).not.toBeNull();
});

test("pasif button marks contact inactive", async () => {
  await act(async () => {
    root.render(<ContactForm companyId="c1" contact={contact} onClose={() => {}} />);
  });
  await act(async () => {
    document.querySelector("[data-testid='cf-active-off']").click();
  });
  expect(document.querySelector("[data-testid='cf-active-badge']")?.textContent).toMatch(/Pasif/i);
});

test("delete calls API after confirm", async () => {
  mockDelete.mockResolvedValue({ data: { status: "success", message: "silindi" } });
  const onSaved = jest.fn();
  await act(async () => {
    root.render(<ContactForm companyId="c1" contact={contact} onClose={() => {}} onSaved={onSaved} />);
  });
  await act(async () => {
    document.querySelector("[data-testid='cf-delete']").click();
  });
  expect(window.confirm).toHaveBeenCalled();
  expect(mockDelete).toHaveBeenCalledWith("/api/contacts/cnt_1");
});

test("new form has no delete button", async () => {
  await act(async () => {
    root.render(<ContactForm companyId="c1" onClose={() => {}} />);
  });
  expect(document.querySelector("[data-testid='cf-delete']")).toBeNull();
});

function setControl(el, value) {
  const proto = window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

test("portal giriş alanı e-posta veya VKN kabul eder", async () => {
  mockGet.mockResolvedValue({ data: {} });
  mockPut.mockResolvedValue({ data: { id: "cnt_1" } });
  await act(async () => {
    root.render(<ContactForm companyId="c1" contact={contact} onClose={() => {}} />);
  });
  await act(async () => {
    document.querySelector("[data-testid='cf-tab-b2b']").click();
  });
  const field = document.querySelector("[data-testid='cf-b2b_login_email']");
  expect(field.getAttribute("type")).toBe("text");
  expect(field.getAttribute("inputmode")).toBeNull();
  expect(document.querySelector("[data-testid='cf-b2b-login-hint']").textContent).toBe(
    "Boş bırakılırsa cari e-postası; carinin VKN/TCKN'si ile de giriş yapılabilir.",
  );
  expect(document.body.textContent).toContain("Portal Giriş E-postası / VKN");

  await act(async () => { setControl(field, "abc"); });
  await act(async () => { document.querySelector("[data-testid='cf-save']").click(); });
  expect(document.querySelector("[data-testid='cf-b2b-login-error']").textContent).toMatch(/VKN/);
  expect(mockPut).not.toHaveBeenCalled();

  await act(async () => { setControl(document.querySelector("[data-testid='cf-b2b_login_email']"), "123 456 7890"); });
  await act(async () => { document.querySelector("[data-testid='cf-save']").click(); });
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
  expect(document.querySelector("[data-testid='cf-b2b-login-error']")).toBeNull();
  expect(mockPut).toHaveBeenCalled();
  const body = mockPut.mock.calls[0][1];
  expect(body.b2b_login_email).toBe("1234567890");
});
