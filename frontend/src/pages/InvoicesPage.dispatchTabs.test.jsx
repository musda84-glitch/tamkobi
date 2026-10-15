/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { MemoryRouter, useSearchParams } from "react-router-dom";
import InvoicesPage from "./InvoicesPage";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ROWS = [
  {
    id: "out1",
    invoice_number: "IRS-OUT",
    invoice_type: "dispatch",
    e_type: "e_dispatch",
    status: "draft",
    payment_status: "n/a",
    contact_name: "Giden Cari",
    contact_id: "ct-out",
    grand_total: 100,
    currency: "TRY",
    issue_date: "2026-10-01",
  },
  {
    id: "old1",
    invoice_number: "IRS-OLD",
    invoice_type: "dispatch",
    e_type: "paper",
    status: "draft",
    payment_status: "n/a",
    contact_name: "Eski Cari",
    contact_id: "ct-old",
    grand_total: 40,
    currency: "TRY",
    issue_date: "2026-01-15",
  },
  {
    id: "in1",
    invoice_number: "IRS-IN",
    invoice_type: "dispatch",
    e_type: "e_dispatch",
    status: "approved",
    payment_status: "n/a",
    contact_name: "Gelen Cari",
    contact_id: "ct-in",
    source: "edoc_inbox",
    direction: "incoming",
    edoc_id: "ed1",
    grand_total: 80,
    currency: "TRY",
    issue_date: "2026-10-02",
  },
];

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: {} })),
    put: jest.fn(async () => ({ data: {} })),
    delete: jest.fn(async () => ({ data: {} })),
    defaults: {},
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn(), info: jest.fn() } }));
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({ activeCompany: { id: "c1" }, addonOn: () => false, can: () => true }),
}));
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  invoiceTypeFilter: () => ({}),
  cachedList: async (collection) => (collection === "invoices" ? ROWS : []),
  dropCached: async () => {},
}));

function DirProbe() {
  const [params] = useSearchParams();
  return <span data-testid="dir-probe">{params.get("dir") || ""}</span>;
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

let host;
let root;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation(() => Promise.resolve({ data: [] }));
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
  jest.clearAllMocks();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function renderPage(entry = "/dispatches") {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter initialEntries={[entry]}>
        <DirProbe />
        <InvoicesPage initialType="dispatch" lockType />
      </MemoryRouter>,
    );
  });
  await flush();
}

function count(id) {
  return host.querySelector(`[data-testid="dispatch-dir-count-${id}"]`)?.textContent;
}

test("gelen ve giden sekmeleri sayıları ve URL yönünü tutar", async () => {
  await renderPage("/dispatches");
  expect(host.querySelector('[data-testid="dispatch-dir-tabs"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="dispatch-dir-out"]').getAttribute("data-active")).toBe("1");
  expect(count("out")).toBe("2");
  expect(count("in")).toBe("1");
  expect(host.querySelector('[data-testid="invoice-row-IRS-OUT"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="invoice-row-IRS-IN"]')).toBeFalsy();

  await act(async () => {
    host.querySelector('[data-testid="dispatch-dir-in"]').click();
  });
  await flush(2);
  expect(host.querySelector('[data-testid="dir-probe"]').textContent).toBe("in");
  expect(host.querySelector('[data-testid="dispatch-dir-in"]').getAttribute("data-active")).toBe("1");
  expect(host.querySelector('[data-testid="invoice-row-IRS-IN"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="invoice-row-IRS-OUT"]')).toBeFalsy();
  expect(count("out")).toBe("2");
  expect(count("in")).toBe("1");
});

test("arama, tarih ve belge filtresi iki sekmenin sayısını da günceller", async () => {
  await renderPage("/dispatches?dir=out");
  const search = host.querySelector('[data-testid="inv-search"]');
  await act(async () => { setNativeValue(search, "Gelen"); });
  await flush(2);
  expect(count("out")).toBe("0");
  expect(count("in")).toBe("1");
  expect(host.querySelector('[data-testid="invoice-row-IRS-OUT"]')).toBeFalsy();

  await act(async () => { setNativeValue(search, ""); });
  const from = host.querySelector('[data-testid="inv-date-from"]');
  await act(async () => { setNativeValue(from, "2026-10-01"); });
  await flush(2);
  expect(count("out")).toBe("1");
  expect(count("in")).toBe("1");
  expect(host.querySelector('[data-testid="invoice-row-IRS-OLD"]')).toBeFalsy();
  expect(host.querySelector('[data-testid="invoice-row-IRS-OUT"]')).toBeTruthy();

  const etype = host.querySelector('[data-testid="inv-etype-filter"]');
  await act(async () => { setNativeValue(etype, "e_dispatch"); });
  await flush(2);
  expect(count("out")).toBe("1");
  expect(host.querySelector('[data-testid="invoice-row-IRS-OUT"]')).toBeTruthy();
});
