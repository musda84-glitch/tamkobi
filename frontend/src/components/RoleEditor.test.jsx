/**
 * @jest-environment jsdom
 */
import React from "react";
import fs from "fs";
import path from "path";
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

test("özet şeridi ayrı bileşendedir ve sağ sütun yoktur", () => {
  const editor = fs.readFileSync(path.join(__dirname, "RoleEditor.jsx"), "utf8");
  const panel = fs.readFileSync(path.join(__dirname, "roles/RoleSummaryPanel.jsx"), "utf8");
  expect(editor).toMatch(/RoleSummaryStrip/);
  expect(editor).not.toMatch(/role-summary-side|260px/);
  expect(editor).toMatch(/210px_minmax\(0,1fr\)/);
  expect(panel).toMatch(/Bu rol:/);
  expect(panel).toMatch(/summaryChips/);
  expect(panel).toMatch(/Yapabilir/);
  expect(panel).toMatch(/Yapamaz/);
  expect(panel).toMatch(/role-user-warn/);
  expect(panel).toMatch(/role-strip-warn/);
  expect(panel).toMatch(/role-strip-detail/);
});

test("1280px düzeninde segment tek satırda kalır ve grup başlığı çakışmaz", async () => {
  await renderEditor(rolesData({
    roles: [{
      ...SALES,
      permissions: { ...SALES.permissions, "/invoices": "view", "/edoc-inbox": "edit" },
    }],
  }));
  const editor = host.querySelector("[data-testid='role-editor']");
  expect(editor.className).toMatch(/min-\[701px\]:grid-cols-\[210px_minmax\(0,1fr\)\]/);
  expect(editor.className).not.toMatch(/260px/);
  expect(host.querySelector("[data-testid='role-summary-side']")).toBeNull();

  const segment = host.querySelector("[data-testid='perm-/invoices']");
  expect(segment.className).toMatch(/whitespace-nowrap/);
  expect(segment.className).toMatch(/flex-nowrap/);
  segment.querySelectorAll("button").forEach((button) => {
    expect(button.className).toMatch(/whitespace-nowrap/);
    expect(button.textContent).not.toMatch(/\n/);
  });

  const label = host.querySelector("[data-testid='role-group-label-finans']");
  const all = host.querySelector("[data-testid='role-group-all-finans']");
  const help = host.querySelector("[data-testid='role-help-group-finans']");
  expect(label.textContent).toContain("Finans");
  expect(all.textContent).toContain("Grubun tümü:");
  expect(help.textContent).toContain("Açıklama");
  expect(all.contains(label)).toBe(false);
  expect(label.contains(all)).toBe(false);
  expect(all.contains(help)).toBe(false);
  expect(label.className).toMatch(/whitespace-nowrap/);
  expect(all.className).toMatch(/whitespace-nowrap/);
  expect(help.className).toMatch(/whitespace-nowrap/);
  expect(label.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  const row = host.querySelector("[data-testid='perm-row-/invoices']");
  expect(row.className).toMatch(/min-\[701px\]:flex-row/);
  expect(row.querySelector("button").className).toMatch(/whitespace-nowrap/);
  expect(row.querySelector("small").className).toMatch(/whitespace-nowrap/);
  const mixed = host.querySelector("[data-testid='perm-mixed-/invoices']");
  expect(mixed.className).toMatch(/shrink-0/);
  expect(mixed.className).toMatch(/text-\[10px\]/);
  expect(mixed.parentElement.className).toMatch(/items-center/);

  const strip = host.querySelector("[data-testid='role-strip']");
  expect(strip.className).toMatch(/sticky/);
  const scroll = host.querySelector("[data-testid='role-strip-scroll']");
  const warn = host.querySelector("[data-testid='role-strip-warn']");
  const detail = host.querySelector("[data-testid='role-strip-detail']");
  expect(scroll.contains(warn)).toBe(false);
  expect(scroll.contains(detail)).toBe(false);
  expect(scroll.className).toMatch(/overflow-x-auto/);
  expect(scroll.className).toMatch(/min-\[701px\]:overflow-hidden/);
  expect(warn.className).toMatch(/shrink-0/);
  expect(detail.className).toMatch(/shrink-0/);
  expect(warn.textContent).toContain("2 kullanıcı etkilenir");
});

test("ayrıntı açılınca tam cümleler ve uyarı görünür, yetki değişince etiket güncellenir", async () => {
  await renderEditor();
  const strip = host.querySelector("[data-testid='role-strip']");
  expect(strip.textContent).toContain("✓ Faturaları görür");
  expect(strip.textContent).toContain("✕ Silemez");
  expect(host.querySelector("[data-testid='role-summary']").className).toMatch(/hidden/);

  await act(async () => {
    host.querySelector("[data-testid='role-strip-detail']").click();
  });
  const summary = host.querySelector("[data-testid='role-summary']");
  expect(summary.className).not.toMatch(/\bhidden\b/);
  expect(summary.className).toMatch(/min-\[701px\]:grid-cols-2/);
  expect(summary.textContent).toContain("Faturaları görür; yeni fatura kesemez");
  expect(summary.textContent).toContain("Yapabilir");
  expect(summary.textContent).toContain("Yapamaz");
  expect(host.querySelector("[data-testid='role-user-warn']").textContent).toContain("2 kullanıcı");
  expect(host.querySelector("[data-testid='role-user-warn']").textContent).toContain("Kaydet");
  expect(host.querySelector("[data-testid='role-strip-detail']").textContent).toContain("▴");

  await act(async () => {
    host.querySelector("[data-testid='perm-/invoices-edit']").click();
  });
  expect(host.querySelector("[data-testid='role-strip']").textContent).toContain("✓ Fatura keser");
  expect(host.querySelector("[data-testid='role-summary']").textContent).toContain("Fatura kesebilir, e-Fatura gönderebilir");
});

test("kullanıcısı olmayan rolde turuncu uyarı etiketi yoktur", async () => {
  await renderEditor(rolesData({
    roles: [{ ...SALES, user_count: 0 }],
  }));
  expect(host.querySelector("[data-testid='role-strip-warn']")).toBeNull();
  expect(host.querySelector("[data-testid='role-user-warn']")).toBeNull();
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
