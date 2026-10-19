import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { printProductLabelsPdf } from "../../utils/labelPdf";
import { printProductLabel } from "../../utils/labelPrinter";
import { ProductFormScreen } from "../ProductFormScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let viewPrices = true;
let companySeq = 0;

const product = {
  id: "p1",
  name: "Raf Profil",
  sku: "RAF-1",
  barcode: "8690001111111",
  type: "product",
  category: "Raf",
  unit: "Adet",
  stock_quantity: 12,
  min_stock_alert: 5,
  sale_price: 150,
  purchase_price: 80,
  vat_rate: 20,
  track_stock: true,
  is_active: true,
};

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: { name: "TamKobi" } as { name: string },
  can: (path?: string) => path === "/stock" || path == null,
  feature: (key: string) => (key === "view_prices" ? viewPrices : true),
};

jest.mock("expo-router", () => ({
  router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({}),
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));
jest.mock("expo-linking", () => ({ createURL: () => "", parse: () => ({}) }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(async (_client: unknown, path: string) => {
    if (String(path).includes("/units")) return [{ name: "Adet" }];
    return product;
  }),
  post: jest.fn(async () => ({})),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: () => "",
  upload: jest.fn(async () => ({})),
  fileUrl: () => "",
}));

jest.mock("../../utils/labelPdf", () => ({
  printProductLabelsPdf: jest.fn(async () => true),
}));

jest.mock("../../utils/labelPrinter", () => {
  const actual = jest.requireActual("../../utils/labelPrinter") as typeof import("../../utils/labelPrinter");
  return {
    ...actual,
    resolveLabelPrinter: jest.fn(async () => ({
      ...actual.defaultLabelPrinter(),
      host: "10.0.0.8",
      port: 9100,
      source: "device" as const,
    })),
    saveLabelPrinter: jest.fn(async (settings: unknown) => settings),
    printProductLabel: jest.fn(async () => ({ bytes: 8 })),
  };
});

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (typeof style === "function") return flatten((style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
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
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
        onChangeText: props.onChangeText,
        "aria-label": props.accessibilityLabel,
      }, props.children);
    };
  const TextInput = Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } });
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
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (
      props.visible === false ? null : host("div")(props)
    ),
    TextInput,
    Image: host("img"),
    Switch: host("input"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

async function settle() {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 800)}`);
  const props = reactProps(node);
  await act(async () => { await (props?.onClick || props?.onPress)?.(); });
  await settle();
}

function renderForm() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(ProductFormScreen, { productId: "p1" })); });
  return { container, root };
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("ProductFormScreen stock-tcp-sheet view_prices", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    companySeq += 1;
    mockAuth.companyId = `co-form-${companySeq}`;
    product.sale_price = 150;
    viewPrices = false;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.parentNode?.removeChild(container);
  });

  it("hides the price switch and prints without a price when view_prices is false", async () => {
    viewPrices = false;
    product.sale_price = 150;
    ({ container, root } = renderForm());
    await settle();
    expect(get).toHaveBeenCalled();
    expect(findByTestId(container, "stock-qty")).toBeTruthy();
    expect(textOf(container)).toContain("8690001111111");

    await press(container, "stock-label-tcp");
    expect(findByTestId(container, "stock-tcp-sheet")).toBeTruthy();
    expect(findByTestId(container, "stock-tcp-sheet-price")).toBeNull();
    expect(textOf(findByTestId(container, "stock-tcp-sheet"))).not.toContain("Fiyatı bas");

    await press(container, "stock-tcp-sheet-go");
    expect(printProductLabel).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({
        name: "Raf Profil",
        barcode: "8690001111111",
        price: null,
        includePrice: false,
      }),
    }));

    await press(container, "stock-label-tcp");
    await press(container, "stock-tcp-sheet-pdf");
    expect(printProductLabelsPdf).toHaveBeenCalledWith(
      mockAuth.client,
      mockAuth.companyId,
      [expect.objectContaining({ includePrice: false })],
      "pdf",
      mockAuth.activeCompany,
    );
  });

  it("keeps the price switch and prints the sale price when view_prices is true", async () => {
    viewPrices = true;
    product.sale_price = 150;
    ({ container, root } = renderForm());
    await settle();

    await press(container, "stock-label-tcp");
    expect(findByTestId(container, "stock-tcp-sheet-price")).toBeTruthy();
    expect(textOf(findByTestId(container, "stock-tcp-sheet"))).toContain("Fiyatı bas");

    await press(container, "stock-tcp-sheet-go");
    expect(printProductLabel).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({
        price: 150,
        includePrice: true,
      }),
    }));
  });
});
