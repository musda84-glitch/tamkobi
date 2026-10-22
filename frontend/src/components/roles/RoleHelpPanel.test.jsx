/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { RoleHelpImage } from "./RoleHelpImage";
import { RoleHelpPanel } from "./RoleHelpPanel";
import { ROLE_HELP_SECTIONS, roleHelpImages } from "./roleHelpContent";
import { UsersRolesPanel } from "../UsersRolesPanel";

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "/api", useAuth: () => ({ user: { id: "admin" } }) }));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MODULE_TITLES = ROLE_HELP_SECTIONS.flatMap((section) => (section.modules || []).map((mod) => mod.title));

let host;
let root;

function installGets() {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/users")) return Promise.resolve({ data: { users: [], invites: [], assignable_companies: [] } });
    if (u.includes("/roles")) return Promise.resolve({ data: { roles: [{ id: "r1", code: "sales", name: "Satış", permissions: {}, features: {} }], modules: [], levels: [], policies: {} } });
    return Promise.resolve({ data: [] });
  });
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  installGets();
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  document.body.style.overflow = "";
});

async function render(node) {
  root = createRoot(host);
  await act(async () => { root.render(node); });
}

async function renderRolesPage() {
  await render(<UsersRolesPanel companyId="c1" />);
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function panel() {
  return document.querySelector('[data-testid="role-help-panel"]');
}

test("roller sekmesindeki açıklama paneli açılır ve kapanır", async () => {
  await renderRolesPage();
  expect(host.querySelector('[data-testid="role-help-open"]')).toBeNull();
  expect(panel()).toBeNull();

  await act(async () => { host.querySelector('[data-testid="ur-tab-roles"]').click(); });
  expect(host.querySelector('[data-testid="role-help-open"]').textContent).toContain("Açıklama");
  await act(async () => { host.querySelector('[data-testid="role-help-open"]').click(); });
  expect(panel()).not.toBeNull();
  expect(panel().getAttribute("role")).toBe("dialog");
  expect(panel().textContent).toContain("Roller ve yetkiler");

  await act(async () => { document.querySelector('[data-testid="role-help-close"]').click(); });
  expect(panel()).toBeNull();

  await act(async () => { host.querySelector('[data-testid="role-help-open"]').click(); });
  await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
  expect(panel()).toBeNull();

  await act(async () => { host.querySelector('[data-testid="role-help-open"]').click(); });
  const backdrop = document.querySelector('[data-testid="role-help-backdrop"]');
  await act(async () => {
    backdrop.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(panel()).toBeNull();
});

test("panel tüm bölümleri ve görselleri gerçek boyutlarıyla basar", async () => {
  await render(<RoleHelpPanel onClose={() => {}} />);
  for (const section of ROLE_HELP_SECTIONS) {
    const node = document.querySelector(`[data-testid="role-help-section-${section.id}"]`);
    expect(node).not.toBeNull();
    expect(node.textContent).toContain(section.title);
  }
  for (const title of MODULE_TITLES) {
    expect(panel().textContent).toContain(title);
  }
  expect(document.querySelector('[data-testid="role-help-level-none"]').textContent).toContain("Kapalı");
  expect(document.querySelector('[data-testid="role-help-level-view"]').textContent).toContain("Görür");
  expect(document.querySelector('[data-testid="role-help-level-edit"]').textContent).toContain("Ekler/Düzenler");
  expect(document.querySelector('[data-testid="role-help-level-delete"]').textContent).toContain("Siler");
  expect(panel().textContent).toContain("RBAC_GET_ENFORCE");
  expect(panel().textContent).toContain("/api/e-invoice/create");

  const images = roleHelpImages();
  const nodes = [...document.querySelectorAll('[data-testid="role-help-image"]')];
  expect(nodes).toHaveLength(images.length);
  for (const image of images) {
    const node = nodes.find((el) => String(el.getAttribute("src") || "").endsWith(`/${image.file}`));
    expect(node).toBeTruthy();
    expect(node.getAttribute("alt")).toBe(image.alt);
    expect(node.getAttribute("width")).toBe(String(image.width));
    expect(node.getAttribute("height")).toBe(String(image.height));
    expect(node.getAttribute("loading")).toBe("lazy");
  }
  expect(document.querySelector('[data-testid="role-help-image-placeholder"]')).toBeNull();
});

test("görsel yüklenemezse yer tutucu kalır", async () => {
  await render(<RoleHelpPanel onClose={() => {}} />);
  const target = [...document.querySelectorAll('[data-testid="role-help-image"]')].find((el) => String(el.getAttribute("src")).endsWith("/fatura-gorur.png"));
  expect(target).toBeTruthy();
  await act(async () => { target.dispatchEvent(new Event("error")); });
  expect(document.querySelector('[data-testid="role-help-image-placeholder"]')).not.toBeNull();
  expect(document.body.textContent).toContain("Ekran görüntüsü yer tutucu");
  expect(document.body.textContent).toContain("Yeni Fatura butonu gizli");
  expect([...document.querySelectorAll('[data-testid="role-help-image"]')].some((el) => String(el.getAttribute("src")).endsWith("/fatura-gorur.png"))).toBe(false);

  await act(async () => { root.unmount(); });
  root = null;
  await render(<RoleHelpImage alt="Eksik ekran görüntüsü" width={640} height={900} />);
  expect(document.querySelector('[data-testid="role-help-image"]')).toBeNull();
  expect(document.querySelector('[data-testid="role-help-image-placeholder"]').textContent).toContain("Eksik ekran görüntüsü");
});
