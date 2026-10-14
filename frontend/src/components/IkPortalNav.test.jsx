/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { IK_PORTAL_LINKS } from "../utils/portalFields";
import IkLayout from "./IkLayout";
import { IK_NAV_META, ikNavActive } from "./IkPortalNav";

const mockAuth = jest.fn();

jest.mock("../context/AuthContext", () => ({
  useAuth: () => mockAuth(),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const admin = {
  role: "admin",
  name: "Ayşe Yılmaz",
  features: {},
};

function mount(entry, user) {
  mockAuth.mockReturnValue({ user, logout: jest.fn() });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <IkLayout>
          <div data-testid="page">içerik</div>
        </IkLayout>
      </MemoryRouter>,
    );
  });
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

function iconNames(root) {
  return [...root.querySelectorAll("[data-icon]")].map((el) => el.getAttribute("data-icon"));
}

describe("IK portal nav", () => {
  test("every portal link has an icon and a single-line short label", () => {
    expect(IK_PORTAL_LINKS.map((link) => link.to)).toEqual([
      "/personelim",
      "/mesai",
      "/atolye",
      "/sevk",
      "/sayim",
      "/saha",
      "/vehicles",
    ]);
    IK_PORTAL_LINKS.forEach((link) => {
      const meta = IK_NAV_META[link.to];
      expect(meta?.icon).toBeTruthy();
      expect(meta.iconName).toEqual(expect.any(String));
      expect(meta.shortLabel).toEqual(expect.any(String));
      expect(meta.shortLabel).not.toMatch(/\s/);
    });
    expect(IK_NAV_META["/sevk"].shortLabel).toBe("Toplama");
    expect(IK_NAV_META["/sayim"].shortLabel).toBe("Sayım");
    expect(IK_NAV_META["/atolye"].withWrench).toBe(true);
  });

  test("active path matches the link and its nested routes", () => {
    expect(ikNavActive("/sayim", "/sayim")).toBe(true);
    expect(ikNavActive("/sayim/oturum", "/sayim")).toBe(true);
    expect(ikNavActive("/mesai", "/mesaim")).toBe(false);
    expect(ikNavActive("/personelim", "/mesai")).toBe(false);
  });

  test("role permissions still hide ungranted field links", async () => {
    const personel = { role: "personel", employee_id: "e1", name: "Ali", features: {} };
    const view = await mount("/atolye", personel);
    const desktop = view.host.querySelector("[data-testid='ik-nav']");
    const labels = [...desktop.querySelectorAll("a")].map((a) => a.getAttribute("aria-label"));
    expect(labels).toEqual(["Personelim", "Mesaim"]);
    expect(view.host.querySelector("[data-testid='ik-nav-sevk']")).toBeNull();
    expect(view.host.querySelector("[data-testid='ik-nav-sayim']")).toBeNull();
    expect(view.host.querySelector("[data-testid='ik-portal-denied']")).not.toBeNull();
    expect(view.host.querySelector("[data-testid='page']")).toBeNull();
    await view.cleanup();
  });

  test("granted features appear without opening the rest", async () => {
    const personel = {
      role: "personel",
      name: "Ali",
      features: { portal_sayim: true },
    };
    const view = await mount("/sayim", personel);
    const labels = [...view.host.querySelectorAll("[data-testid='ik-nav'] a")].map((a) => a.getAttribute("aria-label"));
    expect(labels).toEqual(["Personelim", "Mesaim", "Stok Sayımı"]);
    expect(view.host.querySelector("[data-testid='ik-nav-sayim']").getAttribute("data-active")).toBe("true");
    expect(view.host.querySelector("[data-testid='ik-nav-personelim']").getAttribute("data-active")).toBe("false");
    expect(view.host.querySelector("[data-testid='page']")).not.toBeNull();
    await view.cleanup();
  });

  test("desktop tabs and mobile shortcuts stay single-line and equal height", async () => {
    const view = await mount("/sevk/paket", admin);
    const desktop = view.host.querySelector("[data-testid='ik-nav']");
    const mobile = view.host.querySelector("[data-testid='ik-nav-mobile']");
    const desktopLinks = [...desktop.querySelectorAll("a")];
    const mobileLinks = [...mobile.querySelectorAll("a")];

    expect(desktopLinks.map((a) => a.getAttribute("aria-label"))).toEqual([
      "Personelim",
      "Mesaim",
      "Atölye",
      "Sipariş Toplama",
      "Stok Sayımı",
      "Saha Sipariş",
      "Araçlarım",
    ]);
    const desktopParts = desktopLinks.map((a) =>
      [...a.querySelectorAll("span.leading-none")].map((span) => `${span.className.includes("lg:hidden") ? "short" : "full"}:${span.textContent}`),
    );
    expect(desktopParts).toEqual([
      ["full:Personelim"],
      ["full:Mesaim"],
      ["full:Atölye"],
      ["short:Toplama", "full:Sipariş Toplama"],
      ["short:Sayım", "full:Stok Sayımı"],
      ["short:Saha", "full:Saha Sipariş"],
      ["short:Araç", "full:Araçlarım"],
    ]);
    expect(mobileLinks.map((a) => a.querySelector("span.leading-none").textContent)).toEqual([
      "Personelim",
      "Mesaim",
      "Atölye",
      "Toplama",
      "Sayım",
      "Saha",
      "Araç",
    ]);

    desktopLinks.forEach((a) => {
      expect(a.className).toContain("h-11");
      expect(a.className).toContain("whitespace-nowrap");
      expect(a.className).toContain("shrink-0");
      expect(a.className).not.toContain("flex-col");
    });
    mobileLinks.forEach((a) => {
      expect(a.className).toContain("h-16");
      expect(a.className).toContain("whitespace-nowrap");
      expect(a.className).toContain("flex-col");
      expect(a.className).toContain("shrink-0");
      expect(a.className).toContain("grow");
      expect(a.className).not.toContain("flex-1");
    });

    expect(desktop.className).toContain("md:block");
    expect(desktop.querySelector("div").className).toContain("flex-nowrap");
    expect(desktop.querySelector("div").className).toContain("overflow-x-auto");
    expect(mobile.className).toContain("md:hidden");
    expect(mobile.querySelector("div").className).toContain("overflow-x-auto");

    const sevk = view.host.querySelector("[data-testid='ik-nav-sevk']");
    expect(sevk.getAttribute("aria-current")).toBe("page");
    expect(sevk.className).toContain("bg-slate-900");
    expect(view.host.querySelector("[data-testid='ik-nav-mobile-sevk']").getAttribute("data-active")).toBe("true");
    expect(view.host.querySelector("[data-testid='ik-nav-mesai']").className).not.toContain("bg-slate-900");

    expect(iconNames(desktop)).toEqual([
      "user",
      "clock",
      "factory",
      "wrench",
      "package-check",
      "clipboard-list",
      "shopping-cart",
      "car",
    ]);
    expect(iconNames(mobile)).toEqual(iconNames(desktop));

    expect(desktop.innerHTML).toMatchSnapshot();
    expect(mobile.innerHTML).toMatchSnapshot();
    await view.cleanup();
  });
});
