/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "fs";
import { join } from "path";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: () => Promise.resolve({ data: {} }),
    post: () => Promise.resolve({ data: {} }),
    defaults: { withCredentials: false },
    interceptors: { response: { use: () => {} }, request: { use: () => {} } },
  },
}));

const mockAuthState = {
  user: null,
  authenticated: false,
  loading: false,
  login: jest.fn(),
  applySession: jest.fn(),
  refreshLicense: jest.fn(),
  logout: jest.fn(),
};

jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
  useAuth: () => mockAuthState,
}));

import SystemLoginPage from "../pages/SystemLoginPage";
import LoginPage from "../pages/LoginPage";
import { SystemLayout } from "./saas/SystemLayout";
import { TAI_PLATFORM_TITLE, TAI_LOGO_SRC } from "../utils/platformBrand";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HelmetProvider.canUseDOM = true;

function setHost(hostname, pathname) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hostname,
      pathname,
      search: "",
      hash: "",
      protocol: "https:",
      href: `https://${hostname}${pathname}`,
      origin: `https://${hostname}`,
      replace: jest.fn(),
      assign: jest.fn(),
    },
  });
}

async function render(node) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HelmetProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </HelmetProvider>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return {
    host,
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

describe("platform brand by host", () => {
  beforeEach(() => {
    document.documentElement.className = "";
    document.title = "TamKobi";
    document.head.innerHTML = "";
    mockAuthState.user = null;
    mockAuthState.authenticated = false;
    mockAuthState.loading = false;
  });

  test("ynt host shows the TAI logo and platform title", async () => {
    setHost("ynt.taiyazilim.com", "/sistem/giris");
    const login = await render(<SystemLoginPage />);
    const logo = login.host.querySelector('[data-testid="tai-logo"]');
    expect(logo).toBeTruthy();
    expect(logo.getAttribute("src")).toBe(TAI_LOGO_SRC);
    expect(logo.getAttribute("alt")).toMatch(/TAI/);
    expect(login.host.querySelector('[data-testid="sys-login-brand"]').textContent).toBe(TAI_PLATFORM_TITLE);
    expect(login.host.querySelector('[data-testid="tamkobi-mark"]')).toBeNull();
    expect(document.title).toBe(TAI_PLATFORM_TITLE);
    expect(document.documentElement.classList.contains("ynt-host")).toBe(true);
    const png = document.querySelector('link[rel="icon"][type="image/png"]');
    expect(png.getAttribute("href")).toBe("/brand/tai/favicon.png");
    await login.cleanup();

    mockAuthState.user = { name: "Yönetici", is_super_admin: true, requires_2fa_setup: false };
    mockAuthState.authenticated = true;
    setHost("ynt.taiyazilim.com", "/sistem");
    const layout = await render(
      <SystemLayout>
        <div>panel</div>
      </SystemLayout>,
    );
    expect(layout.host.querySelector('[data-testid="tai-logo"]').getAttribute("src")).toContain("tai_yazilim_logo.svg");
    expect(layout.host.querySelector('[data-testid="sys-brand"]').textContent).toBe("TAI Yazılım · Platform Yönetimi");
    expect(document.title).toBe("TAI Yazılım · Platform Yönetimi");
    await layout.cleanup();
  });

  test("app host keeps the TamKobi mark", async () => {
    setHost("app.tamkobi.com", "/login");
    document.title = "Panel | TamKobi";
    const view = await render(<LoginPage />);
    const mark = view.host.querySelector('[data-testid="tamkobi-mark"]');
    expect(mark).toBeTruthy();
    expect(mark.getAttribute("aria-label")).toBe("TamKobi");
    expect(view.host.querySelector('[data-testid="login-brand"]').textContent).toMatch(/Tam/);
    expect(view.host.querySelector('[data-testid="login-brand"]').textContent).toMatch(/Kobi/);
    expect(view.host.querySelector('[data-testid="tai-logo"]')).toBeNull();
    expect(view.host.textContent).not.toContain("TAI Yazılım · Platform Yönetimi");
    expect(document.documentElement.classList.contains("ynt-host")).toBe(false);
    expect(document.title).toBe("Panel | TamKobi");
    await view.cleanup();
  });

  test("ynt theme file defines the navy and red CSS variables", () => {
    const css = readFileSync(join(__dirname, "../theme/ynt.css"), "utf8");
    expect(css).toContain("--ynt-navy: #13295B");
    expect(css).toContain("--ynt-red: #CC1F26");
    expect(css).toContain("html.ynt-host");
    const brand = readFileSync(join(__dirname, "PlatformBrand.jsx"), "utf8");
    expect(brand).not.toMatch(/#13295B|#CC1F26/i);
    const svg = readFileSync(join(__dirname, "../../public/brand/tai/tai_yazilim_logo.svg"), "utf8");
    expect(svg).toContain("#13295B");
    expect(svg).toContain("#CC1F26");
    for (const name of ["tai-icon-512.png", "tai-icon-192.png", "favicon.png", "favicon.ico"]) {
      const buf = readFileSync(join(__dirname, "../../public/brand/tai", name));
      expect(buf.length).toBeGreaterThan(32);
    }
  });
});
