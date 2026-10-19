import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post, put } from "../../api/client";
import { ApiHttpError } from "../../api/errors";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { frequentInvoiceProductsKey, INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS } from "../../utils/invoiceProductPick";
import { fmtMoney } from "../../utils/money";
import { InvoiceFormScreen } from "../InvoiceFormScreen";

const mockStore = new Map<string, string>();
let mockScanCode = "869-A";

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async (key: string) => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key: string, value: string) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async (key: string) => { mockStore.delete(key); }),
}));

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/BarcodeScannerModal", () => ({
  BarcodeScannerModal: (props: { visible?: boolean; onScan?: (code: string) => void }) => {
    if (!props.visible) return null;
    const ReactLib = require("react") as typeof import("react");
    return ReactLib.createElement("button", {
      "data-testid": "barcode-mock-scan",
      onClick: () => props.onScan?.(mockScanCode),
    }, "oku");
  },
}));

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: () => true,
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(async () => ({})),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: () => "",
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    if (typeof style === "object") return style as Record<string, unknown>;
    return undefined;
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      disabled?: boolean;
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
        onChangeText: props.onChangeText,
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: unknown) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: host("input"),
    Image: host("img"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 400)}`);
  const props = reactProps(node);
  await act(async () => { await (props?.onClick || props?.onPress)?.(); });
  await settle();
}

function renderForm(invoiceId?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(InvoiceFormScreen, invoiceId ? { invoiceId } : {})); });
  return { container, root };
}

describe("InvoiceFormScreen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    mockStore.clear();
    mockAuth.companyId = "co-1";
    mockScanCode = "869-A";
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (put as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    jest.useRealTimers();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("locks the editor while an existing invoice is loading", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) return new Promise(() => undefined);
      return Promise.resolve([]);
    });
    const { container, root } = renderForm("inv-9");
    await settle();
    expect(findByTestId(container, "inv-form-loading")).toBeTruthy();
    expect(textOf(container)).toContain("Yükleniyor…");
    expect(reactProps(findByTestId(container, "save-invoice-btn"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(container, "issue-invoice-btn"))?.disabled).toBe(true);
    root.unmount();
  });

  it("shows a retry when the invoice fails to load", async () => {
    let fail = true;
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) {
        if (fail) return Promise.reject(new ApiHttpError(500, "kapalı", "Fatura yüklenemedi."));
        return Promise.resolve({
          id: "inv-9",
          status: "draft",
          invoice_type: "sales",
          e_type: "paper",
          contact_id: "c1",
          contact_name: "Acme",
          items: [{ name: "Kalem", quantity: 1, unit_price: 10, vat_rate: 20 }],
        });
      }
      return Promise.resolve([]);
    });
    const { container, root } = renderForm("inv-9");
    await settle();
    expect(textOf(container)).toContain("Fatura yüklenemedi.");
    expect(findByTestId(container, "inv-form-loading")).toBeNull();
    fail = false;
    await press(container, "inv-form-retry");
    expect(textOf(container)).toContain("Taslak Düzenle");
    expect(findByTestId(container, "inv-form-retry")).toBeNull();
    expect(reactProps(findByTestId(container, "save-invoice-btn"))?.disabled).toBe(false);
    root.unmount();
  });

  it("titles a new invoice Yeni Fatura and runs save and issue from the fixed bar", async () => {
    (get as unknown as jest.Mock).mockResolvedValue([]);
    const { container, root } = renderForm();
    await settle();
    expect(textOf(container)).toContain("Yeni Fatura");
    expect(textOf(container)).not.toContain("Yeni Fatura Düzenle");
    expect(findByTestId(container, "save-invoice-btn")).toBeTruthy();
    expect(textOf(findByTestId(container, "issue-invoice-btn"))).toContain("Faturalaştır");
    await press(container, "save-invoice-btn");
    expect(textOf(container)).toContain("Lütfen bir cari seçiniz.");
    expect(post).not.toHaveBeenCalled();
    await press(container, "issue-invoice-btn");
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe("Fatura kes");
    root.unmount();
  });

  it("calls approve once when saving an already approved invoice", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) {
        return Promise.resolve({
          id: "inv-9",
          status: "approved",
          invoice_type: "sales",
          e_type: "paper",
          contact_id: "c1",
          contact_name: "Acme",
          items: [{ name: "Kalem", quantity: 1, unit_price: 10, vat_rate: 20 }],
        });
      }
      return Promise.resolve([]);
    });
    (put as unknown as jest.Mock).mockResolvedValue({ id: "inv-9", status: "approved" });
    (post as unknown as jest.Mock).mockResolvedValue({ status: "success", message: "Fatura zaten onaylı." });
    const { container, root } = renderForm("inv-9");
    await settle();
    expect(textOf(container)).toContain("Kaydet & Onayla");
    await press(container, "save-invoice-btn");
    expect(put).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/invoices/inv-9/approve");
    root.unmount();
  });

  it("does not download the full product list when the form opens", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) {
        return Promise.resolve({
          id: "inv-9",
          status: "draft",
          invoice_type: "sales",
          contact_id: "c1",
          contact_name: "Acme",
          items: [{ product_id: "p9", name: "Kalem", quantity: 1, unit_price: 10, vat_rate: 20 }],
        });
      }
      if (path === "/products") return Promise.resolve([{ id: "p9", name: "Kalem", unit: "Adet", vat_rate: 20 }]);
      return Promise.resolve([]);
    });
    const { container, root } = renderForm("inv-9");
    await settle();
    const productCalls = (get as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/products");
    expect(productCalls.length).toBeGreaterThan(0);
    expect(productCalls.every((call) => call[2]?.ids || call[2]?.page)).toBe(true);
    expect(productCalls.some((call) => call[2]?.ids === "p9" && call[2]?.lite === 1)).toBe(true);
    expect(textOf(container)).toContain("Taslak Düzenle");
    root.unmount();
  });

  function pageOf(items: unknown[], extra: Record<string, unknown> = {}) {
    return { items, total: items.length, page: extra.page || 1, page_size: 30, has_more: !!extra.has_more, summary: {} };
  }

  const vida = {
    id: "p1",
    name: "Vida",
    sku: "VD",
    barcode: "869",
    unit: "Adet",
    sale_price: 100,
    purchase_price: 80,
    last_purchase_price: 55,
    vat_rate: 8,
    stock_quantity: 12,
    min_stock_alert: 5,
  };
  const somun = {
    id: "p2",
    name: "Somun",
    sku: "SM",
    unit: "Kg",
    sale_price: 40,
    vat_rate: 1,
    stock_quantity: 0,
    type: "goods",
  };

  function productCalls() {
    return (get as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/products");
  }

  async function typeSearch(container: HTMLElement, value: string) {
    const node = findByTestId(container, "inv-prod-search");
    await act(async () => { reactProps(node)?.onChangeText?.(value); });
  }

  it("searches products on the server after 300ms and appends the next page", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string, query?: { q?: string; page?: number }) => {
      if (path !== "/products") return Promise.resolve([]);
      if (query?.q === "vida" && query.page === 2) return Promise.resolve(pageOf([somun], { page: 2, has_more: false }));
      if (query?.q === "vida") return Promise.resolve(pageOf([vida], { has_more: true }));
      return Promise.resolve(pageOf([]));
    });
    const { container, root } = renderForm();
    await settle();
    expect(productCalls()).toHaveLength(0);
    await press(container, "inv-product-open");
    expect(findByTestId(container, "inv-product-sheet")).toBeTruthy();
    expect(textOf(container)).toContain("Ürün ekle");
    jest.useFakeTimers();
    await typeSearch(container, "vida");
    expect(productCalls().some((call) => call[2]?.q === "vida")).toBe(false);
    await act(async () => { jest.advanceTimersByTime(INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS - 1); });
    expect(productCalls().some((call) => call[2]?.q === "vida")).toBe(false);
    await act(async () => { jest.advanceTimersByTime(1); });
    await settle();
    const search = productCalls().filter((call) => call[2]?.q === "vida");
    expect(search.at(-1)?.[2]).toMatchObject({ q: "vida", page: 1, page_size: 30, lite: 1, active: "active", company_id: "co-1" });
    expect(textOf(container)).toContain("ARAMA SONUÇLARI");
    expect(textOf(container)).toContain("VD · Adet · KDV %8");
    await press(container, "inv-pick-more");
    expect(productCalls().filter((call) => call[2]?.q === "vida" && call[2]?.page === 2)).toHaveLength(1);
    expect(textOf(container)).toContain("Somun");
    root.unmount();
  });

  it("drops a slower search when a newer query is already showing", async () => {
    let releaseFirst: (value: unknown) => void = () => undefined;
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string, query?: { q?: string }) => {
      if (path === "/products" && query?.q === "a") return new Promise((resolve) => { releaseFirst = resolve; });
      if (path === "/products" && query?.q === "ab") return Promise.resolve(pageOf([{ ...somun, name: "Altıgen" }]));
      if (path === "/products") return Promise.resolve(pageOf([]));
      return Promise.resolve([]);
    });
    const { container, root } = renderForm();
    await settle();
    await press(container, "inv-product-open");
    jest.useFakeTimers();
    await typeSearch(container, "a");
    await act(async () => { jest.advanceTimersByTime(INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS); });
    await typeSearch(container, "ab");
    await act(async () => { jest.advanceTimersByTime(INVOICE_PRODUCT_SEARCH_DEBOUNCE_MS); });
    await settle();
    expect(textOf(container)).toContain("Altıgen");
    releaseFirst(pageOf([{ ...vida, name: "Eski sonuc" }]));
    await settle();
    expect(textOf(container)).toContain("Altıgen");
    expect(textOf(container)).not.toContain("Eski sonuc");
    root.unmount();
  });

  it("selects quantities, adds priced lines, and bumps a product already on the invoice", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string, query?: { ids?: string }) => {
      if (path !== "/products") return Promise.resolve([]);
      if (query?.ids) return Promise.resolve([]);
      return Promise.resolve(pageOf([vida, somun]));
    });
    const { container, root } = renderForm();
    await settle();
    await press(container, "inv-product-open");
    expect(textOf(findByTestId(container, "inv-pick-add"))).toContain("0 ürün ekle (0 adet)");
    await press(container, "inv-pick-plus-p1");
    expect(findByTestId(container, "inv-pick-plus-p1")).toBeNull();
    expect(textOf(findByTestId(container, "inv-pick-qty-p1"))).toContain("1");
    await press(container, "inv-pick-dec-p1");
    expect(findByTestId(container, "inv-pick-plus-p1")).toBeTruthy();
    await press(container, "inv-pick-plus-p1");
    await press(container, "inv-pick-inc-p1");
    await press(container, "inv-pick-plus-p2");
    expect(textOf(findByTestId(container, "inv-pick-add"))).toContain("2 ürün ekle (3 adet)");
    await press(container, "inv-pick-add");
    const first = textOf(findByTestId(container, "inv-item-0"));
    const second = textOf(findByTestId(container, "inv-item-1"));
    expect(first).toContain("Vida");
    expect(first).toContain(fmtMoney(100));
    expect(first).toContain("%8");
    expect(first).toContain("2");
    expect(second).toContain("Somun");
    expect(second).toContain(fmtMoney(40));
    expect(second).toContain("%1");
    await press(container, "inv-product-open");
    expect(textOf(container)).toContain("SIK KULLANILANLAR");
    expect(textOf(container)).toContain("faturada 2");
    await press(container, "inv-pick-plus-p1");
    await press(container, "inv-pick-add");
    expect(textOf(findByTestId(container, "inv-item-0"))).toContain("3");
    expect(findByTestId(container, "inv-item-2")).toBeNull();
    const saved = JSON.parse(mockStore.get(frequentInvoiceProductsKey("co-1")) || "[]") as Array<{ id?: string }>;
    expect(saved.map((row) => row.id)).toEqual(expect.arrayContaining(["p1", "p2"]));
    root.unmount();
  });

  it("shows the purchase price on a purchase invoice line", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path !== "/products") return Promise.resolve([]);
      return Promise.resolve(pageOf([vida]));
    });
    const { container, root } = renderForm();
    await settle();
    await press(container, "inv-type-purchase");
    await press(container, "inv-product-open");
    expect(textOf(findByTestId(container, "prod-pick-p1"))).toContain(fmtMoney(55));
    expect(textOf(findByTestId(container, "prod-pick-p1"))).not.toContain(fmtMoney(100));
    await press(container, "inv-pick-plus-p1");
    await press(container, "inv-pick-add");
    const line = textOf(findByTestId(container, "inv-item-0"));
    expect(line).toContain(fmtMoney(55));
    expect(line).not.toContain(fmtMoney(100));
    expect(line).toContain("%8");
    root.unmount();
  });

  it("keeps the scanner open, stacks repeat scans, and reports a miss", async () => {
    const masa = {
      id: "masa",
      name: "Masa",
      sku: "MS",
      barcode: "869",
      unit: "Adet",
      sale_price: 100,
      vat_rate: 20,
      variants: [{ name: "Meşe", sku: "MS-A", barcode: "869-A", price: 150 }],
    };
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/products/barcode/")) return Promise.resolve(masa);
      if (path === "/products") return Promise.resolve(pageOf([]));
      return Promise.resolve([]);
    });
    const { container, root } = renderForm();
    await settle();
    await press(container, "inv-product-open");
    await press(container, "inv-scan");
    await press(container, "barcode-mock-scan");
    await press(container, "barcode-mock-scan");
    expect(findByTestId(container, "barcode-mock-scan")).toBeTruthy();
    const calls = (get as unknown as jest.Mock).mock.calls.filter((call) => String(call[1]).startsWith("/products/barcode/"));
    expect(calls).toHaveLength(2);
    expect(String(calls[0][1])).toContain("869-A");
    const line = textOf(findByTestId(container, "inv-item-0"));
    expect(line).toContain("Masa - Meşe");
    expect(line).toContain(fmtMoney(150));
    expect(findByTestId(container, "inv-item-1")).toBeNull();
    expect(textOf(container)).toContain("📷 Masa - Meşe +1 → faturada 2 Adet");
    mockScanCode = "YOK";
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/products/barcode/")) return Promise.reject(new ApiHttpError(404, "yok", "Barkod ile eşleşen ürün bulunamadı."));
      return Promise.resolve(pageOf([]));
    });
    await press(container, "barcode-mock-scan");
    expect(textOf(container)).toContain("Barkod eşleşmedi: YOK");
    expect(findByTestId(container, "inv-item-1")).toBeNull();
    root.unmount();
  });

  it("opens a blank line and a service line from the sheet", async () => {
    (get as unknown as jest.Mock).mockResolvedValue([]);
    const { container, root } = renderForm();
    await settle();
    await press(container, "inv-product-open");
    expect(findByTestId(container, "inv-free-line")).toBeTruthy();
    await press(container, "inv-add-line");
    expect(findByTestId(container, "inv-line-sheet")).toBeTruthy();
    expect(textOf(container)).toContain("Satırı düzenle");
    expect(textOf(container)).toContain("ÜRÜN ADI");
    expect(textOf(container)).not.toContain("HİZMET ADI");
    await press(container, "inv-line-sheet-close");
    await press(container, "inv-product-open");
    await press(container, "inv-service-line");
    expect(textOf(container)).toContain("HİZMET ADI");
    expect(textOf(findByTestId(container, "inv-line-sheet"))).toContain("Satırı düzenle");
    root.unmount();
  });

  it("shows frequent products for the active company when the search is empty", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string, query?: { company_id?: string; ids?: string }) => {
      if (path !== "/products") return Promise.resolve([]);
      if (query?.ids) return Promise.resolve([]);
      if (query?.company_id === "co-2") return Promise.resolve(pageOf([]));
      return Promise.resolve(pageOf([vida]));
    });
    const first = renderForm();
    await settle();
    await press(first.container, "inv-product-open");
    await press(first.container, "inv-pick-plus-p1");
    await press(first.container, "inv-pick-add");
    await settle();
    expect(mockStore.has(frequentInvoiceProductsKey("co-1"))).toBe(true);
    await press(first.container, "inv-product-open");
    expect(textOf(first.container)).toContain("SIK KULLANILANLAR");
    expect(textOf(findByTestId(first.container, "prod-pick-p1"))).toContain("Vida");
    first.root.unmount();

    mockAuth.companyId = "co-2";
    const second = renderForm();
    await settle();
    await press(second.container, "inv-product-open");
    expect(textOf(second.container)).toContain("ARAMA SONUÇLARI");
    expect(textOf(second.container)).not.toContain("SIK KULLANILANLAR");
    expect(findByTestId(second.container, "prod-pick-p1")).toBeNull();
    second.root.unmount();
  });
});
