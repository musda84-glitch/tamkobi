/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { WebsiteAdminPanel } from "./WebsiteAdminPanel";
import { PREVIEW_FRAME_SAFETY_MS, VITRIN_PREVIEW_MESSAGE } from "../../utils/vitrinPreview";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../../context/AuthContext", () => ({ API_URL: "http://test/api" }));
jest.mock("react-router-dom", () => {
  const ReactLib = require("react");
  return {
    Link: ({ to, children, ...rest }) => ReactLib.createElement("a", { href: typeof to === "string" ? to : "/", ...rest }, children),
  };
}, { virtual: true });

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let publicUrl = "";

function mockLocation(hostname) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hostname,
      host: hostname,
      origin: `https://${hostname}`,
      protocol: "https:",
      href: `https://${hostname}/sistem/web`,
      pathname: "/sistem/web",
      search: "",
      hash: "",
    },
  });
}

function setNativeValue(input, value) {
  const desc = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  desc.set.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function renderPanel() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<WebsiteAdminPanel plans={[]} onChanged={() => {}} />);
  });
  for (let i = 0; i < 10; i += 1) {
    if (host.querySelector('[data-testid="web-preview-frame"]')) break;
    await act(async () => {
      await Promise.resolve();
    });
  }
  return {
    host,
    async cleanup() {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    },
  };
}

describe("WebsiteAdminPanel canlı önizleme", () => {
  beforeEach(() => {
    publicUrl = "";
    mockLocation("ynt.taiyazilim.com");
    axios.get.mockImplementation((url) => {
      const path = String(url);
      if (path.includes("/system/settings")) {
        return Promise.resolve({ data: { brand_name: "TamKobi", public_url: publicUrl } });
      }
      if (path.includes("/public/plans")) return Promise.resolve({ data: { plans: [], trial_days: 14 } });
      if (path.includes("/system/plans")) return Promise.resolve({ data: [] });
      return Promise.resolve({ data: {} });
    });
    axios.put.mockResolvedValue({ data: {} });
  });

  function expectLiveAddress(host, expected) {
    const frame = host.querySelector('[data-testid="web-preview-frame"]');
    const open = host.querySelector('[data-testid="web-open-site"]');
    const full = host.querySelector('[data-testid="web-preview-fullscreen"]');
    expect(frame).not.toBeNull();
    expect(frame.getAttribute("src")).toBe(expected);
    expect(frame.getAttribute("src").startsWith("/")).toBe(false);
    expect(frame.getAttribute("src")).not.toContain("ynt.taiyazilim.com");
    expect(frame.src).not.toContain("ynt.taiyazilim.com");
    expect(frame.src.endsWith("/web")).toBe(false);
    expect(open.getAttribute("href")).toBe(expected);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(full.getAttribute("href")).toBe(expected);
    expect(full.getAttribute("target")).toBe("_blank");
    expect(host.querySelector('[data-testid="web-local-preview"]').getAttribute("href")).toBe(expected);
    const signup = new URL(expected);
    signup.pathname = "/kayit";
    signup.search = "";
    signup.hash = "";
    expect(host.querySelector('[data-testid="web-open-signup"]').getAttribute("href")).toBe(signup.href);
  }

  test("iframe src canlı adrestir; ynt host'unda göreli /web kullanılmaz", async () => {
    publicUrl = "";
    const view = await renderPanel();
    try {
      expectLiveAddress(view.host, "https://tamkobi.com");
      expect(view.host.querySelector('[data-testid="web-public-url"]').getAttribute("placeholder")).toBe("https://tamkobi.com");
    } finally {
      await view.cleanup();
    }
  });

  test("Canlı adres alanındaki mutlak URL iframe, Tam ekran ve Siteyi aç için aynıdır", async () => {
    publicUrl = "https://magaza.example/vitrin/";
    const view = await renderPanel();
    try {
      expectLiveAddress(view.host, "https://magaza.example/vitrin");
      const input = view.host.querySelector('[data-testid="web-public-url"]');
      await act(async () => {
        setNativeValue(input, "https://yeni.example");
      });
      expectLiveAddress(view.host, "https://yeni.example");
      await act(async () => {
        setNativeValue(input, "/web");
      });
      expectLiveAddress(view.host, "https://tamkobi.com");
    } finally {
      await view.cleanup();
    }
  });

  test("önizleme yüklenemezse Siteyi aç yeni sekmede aynı adresi açar", async () => {
    jest.useFakeTimers();
    publicUrl = "https://tamkobi.com";
    const view = await renderPanel();
    try {
      expect(view.host.querySelector('[data-testid="web-preview-blocked"]')).toBeNull();
      await act(async () => {
        jest.advanceTimersByTime(PREVIEW_FRAME_SAFETY_MS);
      });
      const blocked = view.host.querySelector('[data-testid="web-preview-blocked"]');
      expect(blocked).not.toBeNull();
      expect(blocked.textContent).toContain("Önizleme gösterilemiyor, Siteyi aç");
      const open = view.host.querySelector('[data-testid="web-preview-blocked-open"]');
      expect(open.getAttribute("href")).toBe("https://tamkobi.com");
      expect(open.getAttribute("target")).toBe("_blank");
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://tamkobi.com");
      expect(view.host.querySelector('[data-testid="web-preview-fullscreen"]').getAttribute("href")).toBe("https://tamkobi.com");
    } finally {
      await view.cleanup();
      jest.useRealTimers();
    }
  });

  test("vitrin hazır sinyali gelirse yedek mesaj gösterilmez", async () => {
    jest.useFakeTimers();
    publicUrl = "https://tamkobi.com/";
    const view = await renderPanel();
    try {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: "https://tamkobi.com",
          data: { type: VITRIN_PREVIEW_MESSAGE },
        }));
      });
      await act(async () => {
        jest.advanceTimersByTime(PREVIEW_FRAME_SAFETY_MS);
      });
      expect(view.host.querySelector('[data-testid="web-preview-blocked"]')).toBeNull();
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://tamkobi.com");
    } finally {
      await view.cleanup();
      jest.useRealTimers();
    }
  });

  test("ynt origin'inden gelen sinyal önizlemeyi açmaz", async () => {
    jest.useFakeTimers();
    publicUrl = "";
    const view = await renderPanel();
    try {
      await act(async () => {
        window.dispatchEvent(new MessageEvent("message", {
          origin: "https://ynt.taiyazilim.com",
          data: { type: VITRIN_PREVIEW_MESSAGE },
        }));
        jest.advanceTimersByTime(PREVIEW_FRAME_SAFETY_MS);
      });
      expect(view.host.querySelector('[data-testid="web-preview-blocked"]')).not.toBeNull();
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://tamkobi.com");
    } finally {
      await view.cleanup();
      jest.useRealTimers();
    }
  });
});
