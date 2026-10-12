/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";

const mockLocation = { pathname: "/", search: "", hash: "" };
jest.mock("react-router-dom", () => ({
  useLocation: () => mockLocation,
}), { virtual: true });

jest.mock("../utils/hosts", () => {
  const actual = jest.requireActual("../utils/hosts");
  return {
    ...actual,
    getHostKind: jest.fn(() => "site"),
    hostUrl: jest.fn((kind, path) => {
      const host = kind === "site" ? "tamkobi.com" : `${kind}.tamkobi.com`;
      return `https://${host}${path}`;
    }),
  };
});

const HostRouteGuard = require("./HostRouteGuard").default;
const { getHostKind, hostUrl } = require("../utils/hosts");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mount() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <HostRouteGuard>
        <div data-testid="child">ok</div>
      </HostRouteGuard>,
    );
  });
  await act(async () => { await Promise.resolve(); });
  return {
    async cleanup() {
      await act(async () => { root.unmount(); });
      host.remove();
    },
  };
}

describe("HostRouteGuard", () => {
  let replaceSpy;

  beforeEach(() => {
    replaceSpy = jest.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        hostname: "tamkobi.com",
        replace: replaceSpy,
        href: "https://tamkobi.com/",
        protocol: "https:",
        search: "",
      },
    });
    getHostKind.mockReturnValue("site");
    hostUrl.mockImplementation((kind, path) => {
      const h = kind === "site" ? "tamkobi.com" : `${kind}.tamkobi.com`;
      return `https://${h}${path}`;
    });
    mockLocation.pathname = "/";
    mockLocation.search = "";
    mockLocation.hash = "";
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("does not redirect when path belongs on host", async () => {
    mockLocation.pathname = "/sistem/giris";
    const m = await mount();
    expect(replaceSpy).not.toHaveBeenCalled();
    await m.cleanup();
  });

  test("redirects panel path from site to app", async () => {
    mockLocation.pathname = "/panel";
    const m = await mount();
    expect(replaceSpy).toHaveBeenCalled();
    const dest = replaceSpy.mock.calls[0][0];
    expect(dest).toContain("app.tamkobi.com");
    expect(dest).toContain("/panel");
    await m.cleanup();
  });

  test("sets robots meta for non-site hosts", async () => {
    getHostKind.mockReturnValue("app");
    mockLocation.pathname = "/panel";
    const m = await mount();
    const robots = document.querySelector('meta[name="robots"]');
    expect(robots?.getAttribute("content")).toBe("noindex,nofollow");
    await m.cleanup();
  });
});
