/**
 * Her giriş noktası deklanşöre iner; onScan hâlâ kodu olduğu gibi alır.
 * Adet, ekranın kendi çarpanından ya da 5*barkod ayrıştırmasından gelir.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import axios from "axios";
import { toast } from "sonner";
import { MemoryRouter, Route, Routes } from "react-router-dom";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("axios", () => {
  const impl = {
    get: jest.fn(() => Promise.resolve({ data: [] })),
    post: jest.fn(() => Promise.resolve({ data: {} })),
    put: jest.fn(() => Promise.resolve({ data: {} })),
    delete: jest.fn(() => Promise.resolve({ data: {} })),
    isCancel: () => false,
    defaults: { withCredentials: false },
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } },
  };
  return { __esModule: true, default: impl, ...impl };
});
jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), message: jest.fn(), info: jest.fn(), warning: jest.fn() },
}));
const mockCompany = { id: "c1", _id: "c1" };
const mockUser = { id: "u1", name: "Ada" };
const mockCan = () => true;
const mockAddon = () => false;
jest.mock("../context/AuthContext", () => ({
  API_URL: "/api",
  useAuth: () => ({
    activeCompany: mockCompany,
    user: mockUser,
    addonOn: mockAddon,
    can: mockCan,
  }),
}));
jest.mock("../context/PosSessionContext", () => ({
  usePosSession: () => ({
    session: { rules: {} },
    rules: {},
    terminalId: "t1",
    headers: {},
    reload: jest.fn(),
    shift: null,
  }),
}));
jest.mock("../utils/imageUrl", () => ({ resolveImageUrl: (url) => url || "",
  listImageUrl: (u) => u || "",
  listThumbUrl: (u) => u || "",
  cardThumbUrl: (u) => u || "",
}));
jest.mock("../utils/productImages", () => ({
  productListImageUrl: () => "",
  productCardImageUrl: (p) => (p && p.image_url) || "",
}));
jest.mock("../utils/dataRefresh", () => ({ useDataRefresh: () => {}, notifyDataChanged: jest.fn() }));
jest.mock("../utils/dataSync", () => ({
  __esModule: true,
  cachedList: async (collection, _cid, opts) => {
    const rows = collection === "products" ? (globalThis.__products || []) : [];
    opts?.onCached?.(rows);
    return rows;
  },
  productFilter: () => () => true,
  patchCached: async () => {},
  dropCached: async () => {},
  invoiceTypeFilter: () => ({}),
}));
jest.mock("../components/CameraScanner", () => {
  const ReactLib = require("react");
  return {
    CameraScanner: (props) => {
      globalThis.__cam = props;
      return ReactLib.createElement("div", {
        "data-testid": "camera-scanner-mounted",
        "data-title": props.title || "",
        "data-qty": props.qtyEnabled ? "1" : "0",
      });
    },
    ScanButton: (props) => {
      globalThis.__scan = props;
      return ReactLib.createElement("button", {
        type: "button",
        "data-testid": "camera-scan-btn",
        "data-title": props.title || "",
        "data-qty": props.qtyEnabled ? "1" : "0",
      }, props.label || "scan");
    },
  };
});

const PRODUCT = {
  id: "p1",
  name: "Kalem",
  sku: "KLM",
  barcode: "8690123456789",
  sale_price: 12,
  purchase_price: 6,
  vat_rate: 20,
  unit: "Adet",
  is_active: true,
  stock_quantity: 8,
  category: "Kırtasiye",
};

const COUNT = {
  id: "cnt1",
  name: "Akşam sayımı",
  status: "open",
  warehouse_name: "Depo",
  created_at: "2026-10-22T08:00:00.000Z",
  items: [],
};

const PICK = {
  order_id: "ord-1",
  order_number: "SIP-100",
  customer_name: "Ada",
  city: "İstanbul",
  items: [{
    product_id: "p1",
    product_name: "Kalem",
    sku: "KLM",
    barcode: "8690123456789",
    line_index: 0,
    ordered_qty: 10,
    picked_qty: 0,
  }],
  progress: { picked: 0, ordered: 10, complete: false },
};

jest.setTimeout(30000);

let host;
let root;

beforeAll(() => {
  global.IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.matchMedia = window.matchMedia || (() => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }));
  window.scrollTo = () => {};
});

beforeEach(() => {
  const origError = console.error;
  jest.spyOn(console, "error").mockImplementation((msg, ...rest) => {
    if (String(msg).includes("cannot be a child of")) return;
    origError(msg, ...rest);
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  localStorage.clear();
  globalThis.__products = [PRODUCT];
  globalThis.__scan = null;
  globalThis.__cam = null;
  globalThis.__posts = [];
  toast.success.mockClear();
  toast.error.mockClear();
  axios.get.mockImplementation((url) => {
    const u = String(url);
    if (u.includes("/public/b2b/suppliers")) return Promise.resolve({ data: { suppliers: [] } });
    if (u.includes("/public/b2b/")) {
      return Promise.resolve({
        data: {
          contact: { name: "Acme", balance: 0, discount: 0 },
          company: { name: "Firma", price_decimals: 2 },
          products: [{ ...PRODUCT, price: 12, price_gross: 14.4, list_price: 12, in_stock: true }],
          orders: [],
          invoices: [],
          installments: [],
          settings: { show_stock: true, show_prices: true, allow_orders: true, show_statement: false, show_installments: false, allow_ai_cart: false },
          legal: [],
        },
      });
    }
    if (u.includes("/products/barcode/")) {
      const code = decodeURIComponent(u.split("/products/barcode/")[1].split("?")[0]);
      if (code === PRODUCT.barcode) return Promise.resolve({ data: { ...PRODUCT } });
      const err = new Error("yok");
      err.response = { status: 404, data: { detail: "yok" } };
      return Promise.reject(err);
    }
    if (u.includes("/warehouses/stock-counts/")) return Promise.resolve({ data: { ...COUNT, items: [] } });
    if (u.includes("/warehouses/stock-counts")) return Promise.resolve({ data: [{ ...COUNT }] });
    if (u.includes("/warehouses")) return Promise.resolve({ data: [] });
    if (u.includes("/order-picks/")) return Promise.resolve({ data: PICK });
    if (u.includes("/products")) return Promise.resolve({ data: [PRODUCT] });
    if (u.includes("/orders")) return Promise.resolve({ data: [] });
    return Promise.resolve({ data: [] });
  });
  axios.post.mockImplementation((url, body) => {
    globalThis.__posts.push({ url: String(url), body });
    if (String(url).includes("/stock-counts/") && String(url).includes("/scan")) {
      return Promise.resolve({
        data: {
          message: "sayıldı",
          item: { product_name: "Kalem", sku: "KLM", barcode: body.barcode, expected: 0, counted: body.quantity, scanned: true, product_id: "p1", variant_id: null },
        },
      });
    }
    if (String(url).includes("/order-picks/")) return Promise.resolve({ data: { ...PICK, message: "toplandı" } });
    return Promise.resolve({ data: {} });
  });
  axios.put.mockResolvedValue({ data: {} });
});

afterEach(() => {
  console.error.mockRestore();
  act(() => { root.unmount(); });
  host.remove();
});

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    await act(async () => { await Promise.resolve(); });
  }
}

async function show(node) {
  await act(async () => { root.render(node); });
  await flush();
}

function postsTo(part) {
  return globalThis.__posts.filter((p) => p.url.includes(part));
}

test("saha satışı kameradan gelen kodu ve adet çarpanını aynen kullanır", async () => {
  const FieldSalesPage = require("./FieldSalesPage").default;
  await show(<MemoryRouter><FieldSalesPage /></MemoryRouter>);
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.qtyEnabled).toBe(true);
  expect(globalThis.__scan.title).toBe("Barkod okut");
  await act(async () => { globalThis.__scan.onQtyChange("4"); });
  await act(async () => { globalThis.__scan.onScan("5*8690123456789"); });
  await flush(4);
  const barcodeGets = axios.get.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/products/barcode/"));
  expect(barcodeGets.some((u) => u.includes(`/products/barcode/${encodeURIComponent("5*8690123456789")}`))).toBe(true);
  expect(toast.error).toHaveBeenCalledWith("Barkod bulunamadı: 5*8690123456789");
  await act(async () => { globalThis.__scan.onScan(PRODUCT.barcode); });
  await flush(2);
  expect(toast.success).toHaveBeenCalledWith("Kalem sepete eklendi (4)");
  expect(host.querySelector('[data-testid="saha-qty-0"]').value).toBe("4");
});

test("B2B portalı kodu ayrıştırmadan adet çarpanıyla sepete ekler", async () => {
  const B2BPortalPage = require("./B2BPortalPage").default;
  await show(
    <MemoryRouter initialEntries={["/portal/tok-scan"]}>
      <Routes>
        <Route path="/portal/:token/*" element={<B2BPortalPage />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.qtyEnabled).toBe(true);
  expect(globalThis.__scan.title).toBe("Barkod okut");
  await act(async () => { globalThis.__scan.onQtyChange("4"); });
  await act(async () => { globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  await flush(2);
  expect(toast.error.mock.calls.some((c) => String(c[0]).includes(`5*${PRODUCT.barcode}`))).toBe(true);
  expect(localStorage.getItem("b2b_cart_tok-scan") || "").not.toContain(PRODUCT.id);
  await act(async () => { globalThis.__scan.onScan(PRODUCT.barcode); });
  await flush(2);
  const cart = JSON.parse(localStorage.getItem("b2b_cart_tok-scan"));
  expect(Object.values(cart)[0]).toEqual(expect.objectContaining({ productId: PRODUCT.id, qty: 4 }));
  expect(toast.success).toHaveBeenCalledWith("Kalem sepete eklendi (4)");
});

test("hızlı satış 5*barkod ayrıştırmasını ve tek kamera düğmesini korur", async () => {
  const QuickSalePage = require("./QuickSalePage").default;
  await show(<MemoryRouter><QuickSalePage /></MemoryRouter>);
  const buttons = [...host.querySelectorAll("button")].filter((b) => b.textContent.trim() === "Kamera");
  expect(buttons).toHaveLength(1);
  expect(buttons[0].getAttribute("data-testid")).toBe("camera-scan-btn");
  expect(globalThis.__scan.qtyEnabled).toBe(true);
  expect(globalThis.__scan.title).toBe("Barkod okut");
  await act(async () => { globalThis.__scan.onQtyChange(2); });
  await act(async () => { await globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  await flush(4);
  expect(host.querySelector('[data-testid="pos-scan-status"]').textContent).toContain("Kalem ×5");
});

test("stok barkod ekranı 5*barkod miktarını faturaya taşır", async () => {
  const StockBarcodePage = require("./StockBarcodePage").default;
  await show(
    <MemoryRouter initialEntries={["/stok?scan=true"]}>
      <StockBarcodePage />
    </MemoryRouter>,
  );
  expect(host.textContent).toContain("Dokununca tek, basılı tutunca seri");
  expect(host.textContent).not.toContain("Seri okumada");
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.qtyEnabled).toBe(true);
  expect(globalThis.__scan.title).toBe("Barkod okut");
  await act(async () => { globalThis.__scan.onQtyChange("2"); });
  await act(async () => { globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  await flush(4);
  const lookup = axios.get.mock.calls.map((c) => String(c[0])).find((u) => u.includes("/products/barcode/"));
  expect(lookup).toContain(`/products/barcode/${PRODUCT.barcode}`);
  expect(lookup).not.toContain("5*");
  expect(host.querySelector('[data-testid="scanner-qty-input"]').value).toBe("5");
});

test("fatura kalemi barkodla +1 eklenir, 5* öneki ayrılmaz", async () => {
  const InvoicesPage = require("./InvoicesPage").default;
  await show(<MemoryRouter><InvoicesPage /></MemoryRouter>);
  await act(async () => { host.querySelector('[data-testid="create-new-invoice-btn"]').click(); });
  await flush(4);
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.label).toBe("Barkodla Ekle");
  expect(globalThis.__scan.qtyEnabled).toBeFalsy();
  await act(async () => { globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  expect(toast.error).toHaveBeenCalledWith(`Barkod eşleşmedi: 5*${PRODUCT.barcode}`);
  await act(async () => { globalThis.__scan.onScan(PRODUCT.barcode); });
  expect(toast.success).toHaveBeenCalledWith("Kalem eklendi");
  await act(async () => { globalThis.__scan.onScan(PRODUCT.barcode); });
  expect(toast.success).toHaveBeenCalledWith("Kalem miktarı +1");
});

test("sipariş toplama kod ve adet çarpanını tarama isteğine yazar", async () => {
  const OrderPickKioskPage = require("./OrderPickKioskPage").default;
  await show(
    <MemoryRouter initialEntries={["/?order=ord-1"]}>
      <OrderPickKioskPage />
    </MemoryRouter>,
  );
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.qtyEnabled).toBeFalsy();
  const qty = host.querySelector('[data-testid="pick-scan-qty"]');
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  await act(async () => {
    proto.set.call(qty, "4");
    qty.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { await globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  await flush(4);
  expect(postsTo("/order-picks/")[0].body).toEqual({ barcode: `5*${PRODUCT.barcode}`, quantity: 4 });
});

test("sayım kiosku tek barkod düğmesiyle kod ve adedi gönderir", async () => {
  const StockCountKioskPage = require("./StockCountKioskPage").default;
  await show(<MemoryRouter><StockCountKioskPage /></MemoryRouter>);
  await act(async () => { host.querySelector('[data-testid="kiosk-open-cnt1"]').click(); });
  await flush(4);
  expect(host.querySelector('[data-testid="kiosk-serial-btn"]')).toBeNull();
  expect(host.querySelectorAll('[data-testid="kiosk-camera-btn"]')).toHaveLength(1);
  await act(async () => { host.querySelector('[data-testid="kiosk-camera-btn"]').click(); });
  expect(host.querySelector('[data-testid="camera-scanner-mounted"]').getAttribute("data-title")).toBe("Sayım — barkod okut");
  expect(globalThis.__cam.qtyEnabled).toBe(true);
  await act(async () => { globalThis.__cam.onQtyChange("3"); });
  await act(async () => { await globalThis.__cam.onScan(`5*${PRODUCT.barcode}`); });
  await flush(4);
  expect(postsTo("/scan")[0].body).toEqual({ barcode: `5*${PRODUCT.barcode}`, quantity: 3 });
});

test("sayım paneli tek okut düğmesiyle kod ve adedi gönderir", async () => {
  const { StockCountPanel } = require("../components/StockCountPanel");
  await show(<MemoryRouter><StockCountPanel companyId="c1" warehouses={[]} /></MemoryRouter>);
  await act(async () => { host.querySelector('[data-testid="stock-count-item-cnt1"]').click(); });
  await flush(4);
  expect(host.querySelectorAll('[data-testid="camera-scan-btn"]')).toHaveLength(1);
  expect(globalThis.__scan.label).toBe("Okut");
  expect(globalThis.__scan.qtyEnabled).toBe(true);
  expect(globalThis.__scan.title).toBe("Sayım — barkod okut");
  await act(async () => { globalThis.__scan.onQtyChange("6"); });
  await act(async () => { await globalThis.__scan.onScan(`5*${PRODUCT.barcode}`); });
  await flush(4);
  expect(postsTo("/scan")[0].body).toEqual({ barcode: `5*${PRODUCT.barcode}`, quantity: 6 });
});
