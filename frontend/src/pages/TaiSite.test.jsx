/**
 * @jest-environment jsdom
 */
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { HelmetProvider } from "react-helmet-async";
import { MemoryRouter } from "react-router-dom";

jest.mock("axios", () => ({
  __esModule: true,
  default: {
    get: () => Promise.resolve({ data: {} }),
    post: () => Promise.resolve({ data: { ok: true } }),
  },
}));

jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
}));

import TaiSite from "./TaiSite";
import { TAI_LOGO_SRC, TAI_OG_IMAGE } from "../utils/platformBrand";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
HelmetProvider.canUseDOM = true;

function setHost(hostname) {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      hostname,
      pathname: "/",
      search: "",
      hash: "",
      protocol: "https:",
      href: `https://${hostname}/`,
      origin: `https://${hostname}`,
      host: hostname,
    },
  });
}

async function render(node) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(node);
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

describe("TAI site logo", () => {
  beforeEach(() => {
    document.head.innerHTML = "";
    document.title = "";
  });

  test("header and footer share the horizontal wordmark", async () => {
    setHost("taiyazilim.com");
    const view = await render(
      <HelmetProvider>
        <MemoryRouter>
          <TaiSite />
        </MemoryRouter>
      </HelmetProvider>,
    );
    const header = view.host.querySelector('[data-testid="tai-brand"] img');
    const footer = view.host.querySelector('[data-testid="tai-footer"] img');
    expect(header).toBeTruthy();
    expect(footer).toBeTruthy();
    expect(header.getAttribute("alt")).toBe("TAI Yazılım");
    expect(footer.getAttribute("alt")).toBe("TAI Yazılım");
    expect(header.getAttribute("src")).toBe(TAI_LOGO_SRC);
    expect(footer.getAttribute("src")).toBe(header.getAttribute("src"));
    expect(header.className).toContain("h-10");
    expect(header.className).toContain("sm:h-14");
    expect(footer.className).toContain("h-9");
    expect(footer.className).toContain("sm:h-11");
    expect(view.host.querySelector("[data-tai-icon]")).toBeNull();
    const image = document.head.querySelector('meta[property="og:image"]');
    expect(image.getAttribute("content")).toContain(TAI_OG_IMAGE);
    expect(document.head.querySelector('meta[property="og:image:width"]').getAttribute("content")).toBe("1200");
    expect(document.head.querySelector('meta[property="og:image:height"]').getAttribute("content")).toBe("1200");
    await view.cleanup();
  });
});
