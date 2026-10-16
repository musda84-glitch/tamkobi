/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { useInvoiceLineExpand } from "./useInvoiceLineExpand";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => ({
  __esModule: true,
  default: { get: jest.fn() },
}));

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn() },
}));

jest.mock("../context/AuthContext", () => ({ API_URL: "/api" }));

function Harness({ apiRef }) {
  const api = useInvoiceLineExpand();
  apiRef.current = api;
  return (
    <div>
      <span data-testid="expanded">{api.expandedId || ""}</span>
      <span data-testid="loading">{api.loadingId || ""}</span>
    </div>
  );
}

let host;
let root;
let apiRef;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  apiRef = { current: null };
  axios.get.mockReset();
  toast.error.mockReset();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

async function mount() {
  await act(async () => {
    root.render(<Harness apiRef={apiRef} />);
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

const withItems = {
  id: "inv-1",
  invoice_number: "F-1",
  currency: "TRY",
  items: [{ name: "Kalem", quantity: 1, unit: "ad", unit_price: 10, vat_rate: 20, total: 12 }],
};

const bare = { id: "inv-2", invoice_number: "F-2", currency: "USD" };
const other = { id: "inv-3", invoice_number: "F-3" };

test("items varsa axios çağrılmaz", async () => {
  await mount();
  await act(async () => { await apiRef.current.toggle(withItems); });
  expect(axios.get).not.toHaveBeenCalled();
  expect(apiRef.current.isOpen("inv-1")).toBe(true);
  expect(apiRef.current.itemsFor(withItems)).toEqual(withItems.items);
  expect(host.querySelector("[data-testid=loading]").textContent).toBe("");
});

test("items yoksa tek GET, ikinci açılışta önbellek", async () => {
  const fetched = [{ name: "Uzaktan", quantity: 2, unit: "kg", unit_price: 5, total_incl: 12 }];
  axios.get.mockResolvedValue({ data: { items: fetched } });
  await mount();
  await act(async () => { await apiRef.current.toggle(bare); });
  await flush();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledWith("/api/invoices/inv-2");
  expect(apiRef.current.itemsFor(bare)).toEqual(fetched);

  await act(async () => { await apiRef.current.toggle(bare); });
  expect(apiRef.current.isOpen("inv-2")).toBe(false);
  await act(async () => { await apiRef.current.toggle(bare); });
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(apiRef.current.isOpen("inv-2")).toBe(true);
  expect(apiRef.current.itemsFor(bare)).toEqual(fetched);
});

test("teklif satırı /quotes üzerinden bir kez yüklenir", async () => {
  axios.get.mockResolvedValue({ data: { items: [{ name: "Teklif kalemi", quantity: 1, total: 3 }] } });
  await mount();
  await act(async () => { await apiRef.current.toggle({ id: "q1", invoice_number: "TKF-1", _is_quote: true }); });
  await flush();
  expect(axios.get).toHaveBeenCalledTimes(1);
  expect(axios.get).toHaveBeenCalledWith("/api/quotes/q1");
});

test("hata toast ve boş liste", async () => {
  axios.get.mockRejectedValue(new Error("nope"));
  await mount();
  await act(async () => { await apiRef.current.toggle(bare); });
  await flush();
  expect(toast.error).toHaveBeenCalledWith("Kalemler yüklenemedi.");
  expect(apiRef.current.itemsFor(bare)).toEqual([]);
  expect(apiRef.current.isOpen("inv-2")).toBe(true);
  await act(async () => { await apiRef.current.toggle(bare); });
  await act(async () => { await apiRef.current.toggle(bare); });
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("aynı anda tek satır açık kalır", async () => {
  axios.get.mockResolvedValue({ data: { items: [] } });
  await mount();
  await act(async () => { await apiRef.current.toggle(withItems); });
  await act(async () => { await apiRef.current.toggle(other); });
  await flush();
  expect(apiRef.current.isOpen("inv-1")).toBe(false);
  expect(apiRef.current.isOpen("inv-3")).toBe(true);
  expect(apiRef.current.expandedId).toBe("inv-3");
});

test("hızlı çift tık ikinci fetch açmaz", async () => {
  let resolveGet;
  axios.get.mockImplementation(() => new Promise((resolve) => { resolveGet = resolve; }));
  await mount();
  await act(async () => {
    const first = apiRef.current.toggle(bare);
    const second = apiRef.current.toggle(bare);
    await Promise.resolve();
    resolveGet({ data: { items: [{ name: "A", quantity: 1, total: 1 }] } });
    await first;
    await second;
  });
  expect(axios.get).toHaveBeenCalledTimes(1);
});

test("setItems önbelleği günceller", async () => {
  await mount();
  const next = [{ name: "Eşleşen", quantity: 1, product_id: "p1", total: 8 }];
  await act(async () => { apiRef.current.setItems("inv-2", next); });
  expect(apiRef.current.itemsFor(bare)).toEqual(next);
});
