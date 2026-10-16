/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { GibCreditsPanel } from "./AccountPage";

jest.mock("axios");
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "http://test/api",
  useAuth: () => ({}),
}));
jest.mock("./SettingsPage", () => ({ __esModule: true, default: () => null }));

const LEDGER = [{ id: "led1", type: "welcome", credits: 50, note: "Hoş geldin" }];

function wallet(overrides) {
  return {
    company_id: "c1",
    wallet_id: "w1",
    balance: 0,
    sales_enabled: true,
    packs: [{ id: "gib_100", name: "100 Kontör", credits: 100, price: 250, tagline: "küçük", popular: false }],
    ledger: LEDGER,
    integrator_provider: null,
    enforced: true,
    ...overrides,
  };
}

async function renderPanel(gib, integrator) {
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/account/gib-credits")) return Promise.resolve({ data: gib });
    if (u.includes("/e-invoice/integrator-credits")) {
      if (integrator instanceof Error) return Promise.reject(integrator);
      return Promise.resolve({ data: integrator });
    }
    if (u.includes("/payments/providers")) return Promise.resolve({ data: { stripe: true, paytr: false } });
    return Promise.resolve({ data: {} });
  });
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(<GibCreditsPanel companyId="c1" />);
  });
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  return {
    host,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

beforeEach(() => {
  axios.get.mockReset();
});

test("enforced false shows integrator notice and balance, dims platform wallet", async () => {
  const { host, cleanup } = await renderPanel(
    wallet({ enforced: false, integrator_provider: "isnet", balance: 0 }),
    { balance: 42, provider: "isnet", message: "İşNet SOAP kontör bakiyesi" },
  );
  const notice = host.querySelector('[data-testid="gib-integrator-notice"]');
  expect(notice?.textContent).toMatch(/e-Belgeleriniz İşNet üzerinden gönderiliyor/);
  expect(notice?.textContent).toMatch(/kontör entegratörünüzden düşer/);
  expect(notice?.textContent).toMatch(/TamKobi kontörü yalnız simüle\/platform gönderiminde kullanılır/);
  const integ = host.querySelector('[data-testid="gib-integrator-balance"]');
  expect(integ?.textContent).toMatch(/42/);
  expect(host.querySelector('[data-testid="gib-platform-label"]')?.textContent).toBe("TamKobi platform kontörü");
  expect(host.querySelector('[data-testid="gib-platform-wallet"]')?.className).toMatch(/opacity-60/);
  expect(host.querySelector('[data-testid="gib-balance"]')?.textContent).toMatch(/0/);
  expect(host.querySelector('[data-testid="gib-led-led1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="gib-pack-gib_100"]')).not.toBeNull();
  expect(host.textContent).not.toMatch(/Her e-fatura veya e-arşiv gönderimi 1 kontör düşer/);
  const integCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/e-invoice/integrator-credits"));
  expect(integCalls.length).toBeGreaterThan(0);
  expect(integCalls[0][1]).toEqual({ params: { company_id: "c1" } });
  cleanup();
});

test("enforced false shows integrator error message when the balance cannot load", async () => {
  const err = new Error("fail");
  err.response = { data: { detail: "Entegratör kontör sorgusu başarısız." } };
  const { host, cleanup } = await renderPanel(
    wallet({ enforced: false, integrator_provider: "isnet", balance: 0 }),
    err,
  );
  expect(host.querySelector('[data-testid="gib-integrator-balance-error"]')?.textContent)
    .toBe("Entegratör kontör sorgusu başarısız.");
  expect(host.querySelector('[data-testid="gib-platform-label"]')?.textContent).toBe("TamKobi platform kontörü");
  cleanup();
});

test("enforced true keeps the platform wallet view and skips integrator credits", async () => {
  const { host, cleanup } = await renderPanel(wallet({ enforced: true, balance: 7 }), { balance: 99 });
  expect(host.querySelector('[data-testid="gib-integrator-notice"]')).toBeNull();
  expect(host.querySelector('[data-testid="gib-platform-label"]')?.textContent).toBe("GİB e-Fatura / e-Arşiv kontörü");
  expect(host.querySelector('[data-testid="gib-platform-wallet"]')?.className).not.toMatch(/opacity-60/);
  expect(host.querySelector('[data-testid="gib-balance"]')?.textContent).toMatch(/7/);
  expect(host.textContent).toMatch(/Her e-fatura veya e-arşiv gönderimi 1 kontör düşer/);
  expect(host.querySelector('[data-testid="gib-led-led1"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="gib-pack-gib_100"]')).not.toBeNull();
  const integCalls = axios.get.mock.calls.filter((c) => String(c[0]).includes("/e-invoice/integrator-credits"));
  expect(integCalls).toEqual([]);
  cleanup();
});
