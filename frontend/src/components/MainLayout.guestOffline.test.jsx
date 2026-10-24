/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import MainLayout from "./MainLayout";
import { setOnlineForTests } from "../offline/policy";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockAuthState = {
  user: null,
  activeCompany: null,
  logout: jest.fn(),
  feature: () => false,
  license: { modules: {} },
  moduleOn: () => true,
  addonOn: () => false,
  can: () => false,
  loading: false,
  authenticated: false,
  menuItems: [],
  moveModulePath: jest.fn(),
  permPath: (p) => p,
  companies: [],
};

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: {},
    interceptors: { response: { use: jest.fn() }, request: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() } }));
jest.mock("react-helmet-async", () => ({ Helmet: () => null }));
jest.mock("../utils/dataSync", () => ({ warmupPanelCache: jest.fn() }));
jest.mock("../hooks/useNavCounts", () => ({ useNavCounts: () => ({}) }));
jest.mock("../context/PosSessionContext", () => ({ usePosSession: () => ({ session: null }) }));
jest.mock("../context/MesaimGateContext", () => ({ useMesaimGate: () => ({ locked: false, ready: true }) }));
jest.mock("./HeaderQuickActions", () => ({ HeaderQuickActions: () => null, GlobalSearch: () => null }));
jest.mock("./RadialQuickMenu", () => ({ RadialQuickMenu: () => null }));
jest.mock("./NotificationBell", () => ({ NotificationBell: () => null }));
jest.mock("./help/HelpButton", () => ({ HelpButton: () => null }));
jest.mock("./DataExportPanel", () => ({ DataExportIconButton: () => null }));
jest.mock("./SupportContactBar", () => ({ SupportContactBar: () => null }));
jest.mock("./AccountMenu", () => ({ AccountMenu: () => null }));
jest.mock("./AppSidebarNav", () => () => null);
jest.mock("./TamKobiMark", () => () => null);
jest.mock("./BuildStamp", () => ({ BuildStamp: () => null }));
jest.mock("./saas/LicenseWidgets", () => ({ LicenseBadge: () => null, ModuleLockedPanel: () => null }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => mockAuthState,
}));

afterEach(() => setOnlineForTests(null));

async function renderAt(path) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[path]}>
        <MainLayout>
          <div data-testid="guest-screen">ekran</div>
        </MainLayout>
      </MemoryRouter>,
    );
  });
  return {
    host,
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

function expectNoSyncBar(host) {
  expect(host.querySelector('[data-testid="offline-status-bar"]')).toBeNull();
  expect(host.textContent).not.toMatch(/Çevrimiçi|Bekleyen|Son senkron/);
}

test.each(["/login", "/kayit", "/sifre/token", "/sistem/giris"])(
  "%s çevrimiçiyken senkron çubuğu ve uyarı yok",
  async (path) => {
    setOnlineForTests(true);
    const { host, cleanup } = await renderAt(path);
    expectNoSyncBar(host);
    expect(host.querySelector('[data-testid="guest-offline-notice"]')).toBeNull();
    expect(host.querySelector('[data-testid="guest-screen"]')).toBeTruthy();
    await cleanup();
  },
);

test.each(["/login", "/kayit", "/sifre/token"])(
  "%s çevrimdışıyken kısa uyarı var, senkron çubuğu yok",
  async (path) => {
    setOnlineForTests(false);
    const { host, cleanup } = await renderAt(path);
    expect(host.querySelector('[data-testid="offline-status-bar"]')).toBeNull();
    const notice = host.querySelector('[data-testid="guest-offline-notice"]');
    expect(notice?.textContent).toMatch(/İnternet bağlantısı yok/);
    expect(host.textContent).not.toMatch(/Bekleyen|Son senkron/);
    await cleanup();
  },
);

test("pazarlama sayfasında çevrimdışı uyarı da yok", async () => {
  setOnlineForTests(false);
  const { host, cleanup } = await renderAt("/web");
  expectNoSyncBar(host);
  expect(host.querySelector('[data-testid="guest-offline-notice"]')).toBeNull();
  await cleanup();
});
