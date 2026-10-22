/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { RoleEditor } from "./RoleEditor";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    put: jest.fn(async () => ({ data: {} })),
    post: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
  },
}));
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

const SALES = {
  id: "role_sales",
  code: "sales",
  name: "Satış",
  is_system: true,
  user_count: 2,
  permissions: {
    "/invoices": "view",
    "/edoc-inbox": "view",
    "/dispatches": "view",
    "/dis-ticaret": "view",
    "/orders": "edit",
    "/quotes": "edit",
    "/contacts": "edit",
    "/settings": "none",
    "/production": "none",
    "/atolye": "none",
    "/personnel": "none",
    "/mesai": "view",
    "/kontor": "none",
  },
  features: { view_prices: true },
};

function rolesData(extra = {}) {
  return {
    roles: [SALES],
    modules: [{ key: "/kontor", label: "Kontör", wired: true }],
    features: [
      { key: "view_prices", label: "Fiyatları görebilir", help: "Kapalıysa tutarlar gizlenir", group: "detail" },
    ],
    ...extra,
  };
}

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.put.mockClear();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function renderEditor(data = rolesData()) {
  root = createRoot(host);
  await act(async () => {
    root.render(<RoleEditor companyId="c1" rolesData={data} reload={jest.fn(async () => {})} />);
  });
}

test("kargo araması satırı süzer, özet görür seviyesini ve kaydet gövdesini yazar", async () => {
  await renderEditor();
  expect(host.querySelector("[data-testid='role-summary']").textContent).toContain("Faturaları görür; yeni fatura kesemez");
  expect(host.querySelector("[data-testid='role-user-warn']").textContent).toContain("2 kullanıcı");

  const input = host.querySelector("[data-testid='role-search']");
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
    setter.call(input, "kargo");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(host.querySelector("[data-testid='perm-row-/orders']")).not.toBeNull();
  expect(host.querySelector("[data-testid='perm-row-/invoices']")).toBeNull();
  expect(host.textContent.toLocaleLowerCase("tr")).toContain("kargo");

  await act(async () => {
    setterClear(input);
  });
  await act(async () => {
    host.querySelector("[data-testid='perm-/invoices-edit']").click();
  });
  await act(async () => {
    host.querySelector("[data-testid='role-save']").click();
  });
  await flush();
  expect(axios.put).toHaveBeenCalledWith("/api/roles/role_sales", expect.objectContaining({
    permissions: expect.objectContaining({
      "/invoices": "edit",
      "/edoc-inbox": "edit",
      "/dispatches": "edit",
      "/dis-ticaret": "edit",
    }),
  }));
});

function setterClear(input) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  setter.call(input, "");
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

test("bağsız satır gizlenir ve 390px düzeni taşma sınıflarını taşır", async () => {
  await renderEditor(rolesData({
    modules: [{ key: "/kontor", label: "Kontör", wired: false }],
  }));
  const editor = host.querySelector("[data-testid='role-editor']");
  expect(editor.className).toMatch(/overflow-x-hidden/);
  expect(editor.className).toMatch(/max-w-full/);
  const row = host.querySelector("[data-testid='perm-row-/invoices']");
  expect(row.className).toMatch(/flex-col/);
  expect(row.className).toMatch(/min-w-0/);
  const segment = host.querySelector("[data-testid='perm-/invoices']");
  expect(segment.className).toMatch(/flex-wrap/);
  expect(segment.className).toMatch(/max-w-full/);
  expect(host.querySelector("[data-testid='perm-row-/kontor']")).toBeNull();
  expect(host.querySelector("[data-testid='role-open-only']").className).toMatch(/hidden/);
});

test("yardım çekmecesi görür seviyesinde yeni fatura kesilemeyeceğini söyler", async () => {
  await renderEditor();
  await act(async () => {
    host.querySelector("[data-testid='role-help-group-finans']").click();
  });
  const drawer = host.querySelector("[data-testid='role-help-drawer']");
  expect(drawer.textContent).toContain("Görür");
  expect(drawer.textContent).toContain("yeni fatura kesemez");
});
