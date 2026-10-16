/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import axios from "axios";
import { AccountMenu } from "./AccountMenu";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
  useAuth: () => ({
    companies: [{ id: "c1", name: "Firma" }],
    activeCompany: { id: "c1", name: "Firma" },
    switchCompany: jest.fn(),
    reloadSession: jest.fn(),
    user: { role: "admin", id: "u1" },
    license: { gib_credits_sales: true },
    feature: () => true,
  }),
}));

async function openMenu(gibImpl) {
  axios.get.mockImplementation(gibImpl);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <AccountMenu />
      </MemoryRouter>,
    );
  });
  await act(async () => {
    host.querySelector('[data-testid="company-switcher-dropdown"]').click();
  });
  let badge = null;
  for (let i = 0; i < 8; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    badge = host.querySelector('[data-testid="account-gib-balance"]');
    if (badge && badge.textContent && badge.textContent !== "…") break;
  }
  return {
    host,
    badge,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  axios.get.mockReset();
});

test("enforced false badge shows integrator balance 0 without a warning color", async () => {
  const { badge, cleanup } = await openMenu((url) => {
    const u = String(url);
    if (u.includes("/account/gib-credits")) {
      return Promise.resolve({ data: { balance: 0, enforced: false, integrator_provider: "isnet" } });
    }
    if (u.includes("/e-invoice/integrator-credits")) {
      return Promise.resolve({ data: { balance: 0, provider: "isnet", message: "İşNet" } });
    }
    return Promise.resolve({ data: {} });
  });
  expect(badge?.textContent).toBe("0");
  expect(badge?.className).toMatch(/text-slate-300/);
  expect(badge?.className).not.toMatch(/amber|rose|red/);
  cleanup();
});

test("enforced false badge says Entegratör when integrator balance cannot load", async () => {
  const { badge, cleanup } = await openMenu((url) => {
    const u = String(url);
    if (u.includes("/account/gib-credits")) {
      return Promise.resolve({ data: { balance: 0, enforced: false, integrator_provider: "qnb_efinans" } });
    }
    if (u.includes("/e-invoice/integrator-credits")) {
      return Promise.reject(new Error("network"));
    }
    return Promise.resolve({ data: {} });
  });
  expect(badge?.textContent).toBe("Entegratör");
  expect(badge?.className).not.toMatch(/amber|rose|red/);
  cleanup();
});

test("enforced true badge keeps the platform balance", async () => {
  const { badge, cleanup } = await openMenu((url) => {
    const u = String(url);
    if (u.includes("/account/gib-credits")) {
      return Promise.resolve({ data: { balance: 0, enforced: true, integrator_provider: null } });
    }
    if (u.includes("/e-invoice/integrator-credits")) {
      return Promise.resolve({ data: { balance: 80 } });
    }
    return Promise.resolve({ data: {} });
  });
  expect(badge?.textContent).toBe("0");
  expect(badge?.className).toMatch(/text-amber-300/);
  const integCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/e-invoice/integrator-credits"));
  expect(integCalls).toEqual([]);
  cleanup();
});
