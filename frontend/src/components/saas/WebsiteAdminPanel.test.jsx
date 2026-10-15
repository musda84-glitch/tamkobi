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

function settingsMock() {
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
}

async function renderPanel(plans = []) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<WebsiteAdminPanel plans={plans} onChanged={() => {}} />);
  });
  for (let i = 0; i < 12; i += 1) {
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
    settingsMock();
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

const TAI_CONTENT = {
  pages: {
    home: { seo_title: "TAI", seo_description: "Kurumsal", hero_title: "Hero", hero_text: "Metin", hero_image: "", published: true },
    about: { seo_title: "", seo_description: "", title: "Hakkımızda", text: "", image: "", published: true },
    services: { seo_title: "", seo_description: "", title: "Hizmetler", text: "", published: true },
    references: { seo_title: "", seo_description: "", title: "Referanslar", text: "", published: true },
    contact: { seo_title: "", seo_description: "", title: "İletişim", text: "", email: "info@taiyazilim.com", phone: "", address: "", published: true },
  },
  services: [],
  references: [],
  products: [{ id: "prd_tamkobi", title: "TamKobi", text: "ERP", image: "", href: "https://tamkobi.com", sort: 0, published: true }],
};

describe("WebsiteAdminPanel site seçici", () => {
  beforeEach(() => {
    mockLocation("ynt.taiyazilim.com");
    axios.get.mockImplementation((url) => {
      const u = String(url);
      if (u.includes("/inquiries")) {
        return Promise.resolve({ data: [{ id: "inq_1", name: "Ada", email: "ada@ornek.com", message: "Merhaba", mail_status: "sent" }] });
      }
      if (u.includes("/system/sites/tai")) {
        return Promise.resolve({
          data: {
            slug: "tai",
            brand_name: "TAI Yazılım",
            public_url: "https://taiyazilim.com",
            theme: "corporate",
            active: true,
            content: TAI_CONTENT,
          },
        });
      }
      if (u.includes("/system/sites")) {
        return Promise.resolve({
          data: [
            { slug: "tamkobi", brand_name: "TamKobi", public_url: "https://tamkobi.com", theme: "vitrin", active: true },
            { slug: "tai", brand_name: "TAI Yazılım", public_url: "https://taiyazilim.com", theme: "corporate", active: true },
          ],
        });
      }
      if (u.includes("/system/settings")) {
        return Promise.resolve({ data: { brand_name: "TamKobi", public_url: "https://tamkobi.com" } });
      }
      if (u.includes("/public/plans")) return Promise.resolve({ data: { plans: [], trial_days: 14 } });
      if (u.includes("/system/plans")) {
        return Promise.resolve({ data: [{ id: "plan_pro", name: "Pro", is_public: true, price_monthly: 100, modules: ["a"], color: "emerald" }] });
      }
      return Promise.resolve({ data: {} });
    });
    axios.put.mockResolvedValue({ data: {} });
  });

  test("site seçici paket vitrinini TamKobi'de tutar ve TAI önizlemesi taiyazilim.com olur", async () => {
    const view = await renderPanel([{ id: "plan_pro", name: "Pro", is_public: true, price_monthly: 100, modules: ["a"], color: "emerald" }]);
    try {
      expect(view.host.querySelector('[data-testid="site-switch-tamkobi"]').textContent).toBe("TamKobi");
      expect(view.host.querySelector('[data-testid="site-switch-tai"]').textContent).toBe("TAI Yazılım");
      expect(view.host.querySelector('[data-testid="web-plan-toggles"]')).not.toBeNull();
      expect(view.host.querySelector('[data-testid="tai-content-editor"]')).toBeNull();
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://tamkobi.com");
      expect(view.host.querySelector('[data-testid="web-open-site"]').getAttribute("href")).toBe("https://tamkobi.com");
      expect(view.host.querySelector('[data-testid="web-open-signup"]').getAttribute("href")).toBe("https://tamkobi.com/kayit");

      await act(async () => {
        view.host.querySelector('[data-testid="site-switch-tai"]').click();
      });
      for (let i = 0; i < 8; i += 1) {
        await act(async () => { await Promise.resolve(); });
      }

      const frame = view.host.querySelector('[data-testid="web-preview-frame"]');
      expect(view.host.querySelector('[data-testid="web-plan-toggles"]')).toBeNull();
      expect(view.host.querySelector('[data-testid="tai-content-editor"]')).not.toBeNull();
      expect(view.host.querySelector('[data-testid="site-inquiries"]').textContent).toContain("Gelen talepler");
      expect(view.host.querySelector('[data-testid="inquiry-inq_1"]').textContent).toContain("Ada");
      expect(frame.getAttribute("src")).toBe("https://taiyazilim.com");
      expect(frame.getAttribute("src").startsWith("/")).toBe(false);
      expect(frame.getAttribute("src")).not.toContain("ynt.taiyazilim.com");
      expect(view.host.querySelector('[data-testid="web-open-site"]').getAttribute("href")).toBe("https://taiyazilim.com");
      expect(view.host.querySelector('[data-testid="web-open-signup"]')).toBeNull();
      expect(view.host.querySelector('[data-testid="tai-hero-title"]').value).toBe("Hero");

      const input = view.host.querySelector('[data-testid="web-public-url"]');
      await act(async () => {
        setNativeValue(input, "/iletisim");
      });
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://taiyazilim.com");

      await act(async () => {
        view.host.querySelector('[data-testid="site-switch-tamkobi"]').click();
      });
      expect(view.host.querySelector('[data-testid="web-plan-toggles"]')).not.toBeNull();
      expect(view.host.querySelector('[data-testid="web-brand-name"]').value).toBe("TamKobi");
      expect(view.host.querySelector('[data-testid="web-preview-frame"]').getAttribute("src")).toBe("https://tamkobi.com");
    } finally {
      await view.cleanup();
    }
  });
});
