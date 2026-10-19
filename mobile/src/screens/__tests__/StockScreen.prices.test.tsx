import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
import { printProductLabelsPdf } from "../../utils/labelPdf";
import { printProductLabel } from "../../utils/labelPrinter";
import { StockScreen } from "../StockScreen";

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
  sale_price: 0 as number,
  purchase_price: 0,
  last_purchase_price: 40,
  last_purchase_supplier: "Ahmet",
  last_sale_price: 55,
  last_sale_contact: "Ayşe",
  track_stock: true,
  is_active: true,
};

const movements = {
  movements: [{ id: "m1", change: 3, unit_price: 40, reason: "Alış", date: "2026-10-01" }],
  last_purchase_price: 40,
  last_purchase_supplier: "Ahmet",
  last_sale_price: 55,
  last_sale_contact: "Ayşe",
};

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: null as null,
  can: () => true,
  feature: (key: string) => (key === "view_prices" ? viewPrices : true),
};

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
    useLocalSearchParams: () => ({}),
    router: { push: jest.fn(), back: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
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
    const p = String(path);
    if (p.includes("/movements")) return movements;
    if (p.includes("/categories")) return [];
    return [product];
  }),
  post: jest.fn(async () => ({})),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: () => "",
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
  for (let i = 0; i < 10; i += 1) {
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

function renderScreen() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(StockScreen)); });
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

describe("StockScreen view_prices", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    companySeq += 1;
    mockAuth.companyId = `co-${companySeq}`;
    product.sale_price = 0;
    viewPrices = false;
    jest.clearAllMocks();
  });

  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.parentNode?.removeChild(container);
  });

  it("hides prices, keeps quantity, and prints the label without a price when view_prices is false", async () => {
    viewPrices = false;
    product.sale_price = 0;
    ({ container, root } = renderScreen());
    await settle();
    expect(get).toHaveBeenCalled();

    const row = findByTestId(container, "stock-row-p1");
    expect(row).toBeTruthy();
    expect(textOf(row)).not.toContain("₺");
    const qty = findByTestId(container, "stock-qty-p1");
    expect(qty).toBeTruthy();
    expect(textOf(qty)).toContain("12");
    expect(textOf(qty)).toContain("Adet");

    await press(container, "stock-moves-p1");
    const moves = findByTestId(container, "stock-moves-sheet");
    expect(moves).toBeTruthy();
    expect(textOf(moves)).not.toContain("₺");
    expect(textOf(moves)).not.toContain("Son alış");
    expect(textOf(moves)).not.toContain("Son satış");
    const move = textOf(findByTestId(container, "stock-move-m1"));
    expect(move).toContain("+3");
    expect(move).toContain("Alış");
    expect(move).not.toContain("₺");

    await press(container, "stock-label-p1");
    expect(findByTestId(container, "stock-list-label-sheet")).toBeTruthy();
    expect(findByTestId(container, "stock-list-label-sheet-price")).toBeNull();
    expect(textOf(findByTestId(container, "stock-list-label-sheet"))).not.toContain("Fiyatı bas");

    await press(container, "stock-list-label-sheet-phone");
    expect(printProductLabelsPdf).toHaveBeenCalledWith(
      mockAuth.client,
      mockAuth.companyId,
      [expect.objectContaining({ includePrice: false })],
      "print",
      null,
    );

    await press(container, "stock-label-p1");
    await press(container, "stock-list-label-sheet-go");
    expect(printProductLabel).toHaveBeenCalledWith(expect.objectContaining({
      copies: 1,
      product: expect.objectContaining({
        name: "Raf Profil",
        barcode: "8690001111111",
        price: null,
        includePrice: false,
      }),
    }));
  });

  it("keeps the sale price, movement prices, and label price switch when view_prices is true", async () => {
    viewPrices = true;
    product.sale_price = 150;
    ({ container, root } = renderScreen());
    await settle();

    const row = findByTestId(container, "stock-row-p1");
    expect(textOf(row)).toContain(fmtMoney(150));
    expect(textOf(row)).toContain("₺");
    expect(textOf(findByTestId(container, "stock-qty-p1"))).toContain("12");

    await press(container, "stock-moves-p1");
    const moves = textOf(findByTestId(container, "stock-moves-sheet"));
    expect(moves).toContain("Son alış");
    expect(moves).toContain(fmtMoney(40));
    expect(moves).toContain("Son satış");
    expect(moves).toContain(fmtMoney(55));
    expect(textOf(findByTestId(container, "stock-move-m1"))).toContain(fmtMoney(40));

    await press(container, "stock-label-p1");
    expect(findByTestId(container, "stock-list-label-sheet-price")).toBeTruthy();
    expect(textOf(findByTestId(container, "stock-list-label-sheet"))).toContain("Fiyatı bas");

    await press(container, "stock-list-label-sheet-go");
    expect(printProductLabel).toHaveBeenCalledWith(expect.objectContaining({
      product: expect.objectContaining({
        price: 150,
        includePrice: true,
      }),
    }));
  });
});
