/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { ReconciliationPanel } from "./ReconciliationPanel";
import { formatTrAmount } from "../utils/money";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: {} })),
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

let host;
let root;
let quiet;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  quiet = jest.spyOn(console, "error").mockImplementation(() => {});
  axios.get.mockResolvedValue({
    data: {
      read_only: true,
      summary: { account_count: 0, account_drift: 0, partner_count: 1, partner_drift: 1, contact_count: 0, contact_drift: 0 },
      accounts: [],
      contacts: [],
      partners: [{
        id: "ali",
        ad: "Ali BAL",
        kart_bakiyesi: -716189.78,
        kayitli_bakiye: 716189.78,
        liste_giris: 278400,
        liste_cikis: 994589.78,
        liste_net: -716189.78,
        fark: 1432379.56,
      }],
    },
  });
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  quiet.mockRestore();
  host.remove();
});

test("partner table uses Giriş / Çıkış and kayıtlı bakiye, not lehine / aleyhine", async () => {
  root = createRoot(host);
  await act(async () => {
    root.render(<ReconciliationPanel companyId="co" />);
  });
  const row = host.querySelector('[data-testid="recon-partner-ali"]');
  expect(row).toBeTruthy();
  expect(host.textContent).toMatch(/Giriş/);
  expect(host.textContent).toMatch(/Çıkış/);
  expect(host.textContent).toMatch(/Kayıtlı/);
  expect(host.textContent).not.toMatch(/Lehine/);
  expect(host.textContent).not.toMatch(/Aleyhine/);
  expect(row.textContent).toContain(formatTrAmount(-716189.78));
  expect(row.textContent).toContain(formatTrAmount(278400));
  expect(row.textContent).toContain(formatTrAmount(994589.78));
});
