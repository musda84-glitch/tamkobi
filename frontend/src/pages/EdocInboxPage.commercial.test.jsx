/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MemoryRouter } from "react-router-dom";
import EdocInboxPage from "./EdocInboxPage";
import { GIB_ACCEPT_CONFIRM, GIB_RED_OPTION_LABEL, DISPATCH_PROCESS_LABEL, istanbulDateISO } from "../utils/edocInbox";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(async () => ({ data: [] })),
    post: jest.fn(async () => ({ data: { message: "ok" } })),
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
  useAuth: () => ({ activeCompany: { id: "c1" } }),
}));

function shiftISO(iso, days) {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

function doc(partial) {
  return {
    id: partial.id,
    status: "pending",
    kind: "invoice",
    number: partial.number || partial.id,
    issue_date: partial.issue_date,
    profile: partial.profile,
    grand_total: 120,
    subtotal: 100,
    vat_total: 20,
    supplier: { name: "Tedarikçi", tax_id: "1111111111" },
    lines: [{ name: "Kalem", quantity: 1, unit_price: 100, total: 100, product_id: "p1", product_name: "Kalem" }],
    matched_lines: 1,
    contact_id: "cnt",
    contact_name: "Tedarikçi",
    commercial_response: partial.commercial_response,
    ...partial,
  };
}

let host;
let root;
let items;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

beforeEach(() => {
  items = [];
  host = document.createElement("div");
  document.body.appendChild(host);
  axios.get.mockImplementation((url) => {
    if (String(url).includes("/edocs/inbox")) {
      return Promise.resolve({ data: { items, counts: { pending: items.length, rejected: 0, ignored: 0 } } });
    }
    return Promise.resolve({ data: [] });
  });
  axios.post.mockResolvedValue({ data: { message: "ok" } });
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

async function renderPage() {
  root = createRoot(host);
  await act(async () => {
    root.render(
      <MemoryRouter>
        <EdocInboxPage />
      </MemoryRouter>,
    );
  });
  await flush();
}

function setNativeValue(el, value) {
  const proto = Object.getPrototypeOf(el);
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  desc.set.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

test("TICARI süre içi KABUL diyaloğu ve RED seçeneği görünür", async () => {
  const today = istanbulDateISO();
  items = [doc({ id: "tic", profile: "TICARIFATURA", issue_date: today })];
  const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);
  await renderPage();
  await act(async () => { host.querySelector('[data-testid="edoc-item-tic"]').click(); });
  await flush(2);

  expect(host.querySelector('[data-testid="edoc-gib-accept"]')).toBeTruthy();
  expect(host.querySelector('[data-testid="edoc-commercial-tic"]').textContent).toMatch(/Yanıt bekliyor \(\d+ gün\)/);
  expect(host.querySelector('[data-testid="edoc-commercial-detail"]').textContent).toMatch(/Yanıt bekliyor/);

  await act(async () => { host.querySelector('[data-testid="edoc-gib-accept"]').click(); });
  expect(confirmSpy).toHaveBeenCalledWith(GIB_ACCEPT_CONFIRM);
  expect(axios.post).not.toHaveBeenCalled();

  confirmSpy.mockReturnValue(true);
  await act(async () => { host.querySelector('[data-testid="edoc-gib-accept"]').click(); });
  await flush(3);
  const kabul = axios.post.mock.calls.find((c) => String(c[0]).endsWith("/respond"));
  expect(kabul[1]).toEqual({ approval: "KABUL" });

  await act(async () => { host.querySelector('[data-testid="edoc-reject"]').click(); });
  await flush(1);
  const box = host.querySelector('[data-testid="edoc-reject-gib"]');
  expect(box.checked).toBe(true);
  expect(host.textContent).toContain(GIB_RED_OPTION_LABEL);
  await act(async () => { host.querySelector('[data-testid="edoc-reject-confirm"]').click(); });
  expect(toast.error).toHaveBeenCalled();
  expect(axios.post.mock.calls.filter((c) => String(c[0]).includes("/respond") && c[1].approval === "RED")).toHaveLength(0);

  const reason = host.querySelector('[data-testid="edoc-reject-reason"]');
  await act(async () => { setNativeValue(reason, "fiyat hatalı"); });
  await act(async () => { host.querySelector('[data-testid="edoc-reject-confirm"]').click(); });
  await flush(3);
  const red = axios.post.mock.calls.find((c) => c[1]?.approval === "RED");
  expect(red[1]).toEqual({ approval: "RED", reason: "fiyat hatalı" });
  confirmSpy.mockRestore();
});

test("TEMEL, süresi geçmiş ve irsaliyede GİB KABUL gizlenir; irsaliye butonu yeniden adlandırılır", async () => {
  const today = istanbulDateISO();
  const expired = shiftISO(today, -9);
  items = [
    doc({ id: "temel", profile: "TEMELFATURA", issue_date: today }),
    doc({ id: "eski", profile: "TICARIFATURA", issue_date: expired }),
    doc({ id: "irs", kind: "dispatch", profile: "TEMELIRSALIYE", issue_date: today, number: "IRS1" }),
  ];
  const promptSpy = jest.spyOn(window, "prompt").mockReturnValue(null);
  await renderPage();

  await act(async () => { host.querySelector('[data-testid="edoc-item-temel"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="edoc-gib-accept"]')).toBeNull();
  expect(host.querySelector('[data-testid="edoc-process"]').textContent).toContain("Gelen faturaya al");
  await act(async () => { host.querySelector('[data-testid="edoc-reject"]').click(); });
  expect(promptSpy).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="edoc-reject-dialog"]')).toBeNull();

  await act(async () => { host.querySelector('[data-testid="edoc-kind-dispatch"]').click(); });
  await flush(2);
  await act(async () => { host.querySelector('[data-testid="edoc-item-irs"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="edoc-gib-accept"]')).toBeNull();
  expect(host.querySelector('[data-testid="edoc-process"]').textContent).toContain(DISPATCH_PROCESS_LABEL);

  axios.post.mockResolvedValue({ data: { message: "Gelen irsaliye içeri alındı: IRS1" } });
  await act(async () => { host.querySelector('[data-testid="edoc-process"]').click(); });
  await flush(3);
  expect(toast.success).toHaveBeenCalledWith("Gelen irsaliye alındı");
  const processCall = axios.post.mock.calls.find((c) => String(c[0]).endsWith("/process"));
  expect(processCall[0]).toContain("/edocs/inbox/irs/process");

  await act(async () => { host.querySelector('[data-testid="edoc-kind-dispatch"]').click(); });
  await flush(2);
  await act(async () => { host.querySelector('[data-testid="edoc-item-eski"]').click(); });
  await flush(2);
  expect(host.querySelector('[data-testid="edoc-gib-accept"]')).toBeNull();
  promptSpy.mockRestore();
});
