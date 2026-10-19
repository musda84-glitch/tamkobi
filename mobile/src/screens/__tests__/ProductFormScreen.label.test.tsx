import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { defaultLabelPrinter, printProductLabel, resolveLabelPrinter } from "../../utils/labelPrinter";
import { ProductFormScreen } from "../ProductFormScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn(), navigate: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("expo-file-system", () => ({ File: class File {}, Paths: {} }));
jest.mock("expo-print", () => ({ printAsync: jest.fn() }));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn(), isAvailableAsync: jest.fn(async () => false) }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("../../utils/labelPrinter", () => {
  const actual = jest.requireActual("../../utils/labelPrinter") as typeof import("../../utils/labelPrinter");
  return {
    ...actual,
    resolveLabelPrinter: jest.fn(),
    printProductLabel: jest.fn(async () => ({ bytes: 1 })),
    saveLabelPrinter: jest.fn(async (settings: Partial<import("../../utils/labelPrinter").LabelPrinterSettings>) => ({
      ...actual.defaultLabelPrinter(),
      ...settings,
    })),
  };
});

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: { id: "co-1", name: "TamKobi" },
  can: () => true,
  feature: () => true,
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
  upload: jest.fn(async () => ({})),
  fileUrl: (base: string, path: string) => `${base}${path}`,
}));

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
      children?: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
      value?: string;
      placeholder?: string;
      keyboardType?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        value: props.value,
        placeholder: props.placeholder,
        keyboardType: props.keyboardType,
        "aria-label": props.accessibilityLabel,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
      }, props.children);
    };
  const TextInput = Object.assign(
    (props: {
      testID?: string;
      value?: string;
      placeholder?: string;
      keyboardType?: string;
      onChangeText?: (value: string) => void;
    }) => ReactLib.createElement("input", {
      "data-testid": props.testID,
      value: props.value ?? "",
      placeholder: props.placeholder,
      keyboardType: props.keyboardType,
      onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
    }),
    { State: { currentlyFocusedInput: () => null } },
  );
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    Share: { share: jest.fn(async () => ({ action: "sharedAction" })) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Switch: host("input"),
    Image: host("img"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (
      props.visible === false ? null : host("div")(props)
    ),
    TextInput,
  };
});

const product = {
  id: "p1",
  name: "Vida M8",
  sku: "SKU-1",
  barcode: "8690001",
  sale_price: 12.5,
  vat_rate: 20,
  type: "product",
  category: "Genel",
  unit: "Adet",
};

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
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

describe("ProductFormScreen label print", () => {
  beforeEach(() => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/products/units")) return Promise.resolve([]);
      if (String(path).startsWith("/products/")) return Promise.resolve(product);
      return Promise.resolve({});
    });
    (resolveLabelPrinter as unknown as jest.Mock).mockReset();
    (printProductLabel as unknown as jest.Mock).mockReset();
    (printProductLabel as unknown as jest.Mock).mockResolvedValue({ bytes: 1 });
  });

  afterEach(async () => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("hides the old ethernet button and opens the IP sheet without a saved printer", async () => {
    (resolveLabelPrinter as unknown as jest.Mock).mockResolvedValue({
      ...defaultLabelPrinter(),
      source: "none",
    });
    const { container, root } = renderForm();
    await settle();

    expect(findByTestId(container, "stock-label-print")).toBeNull();
    expect(findByTestId(container, "stock-label-menu")).toBeNull();
    expect(findByTestId(container, "stock-label-tcp")).toBeTruthy();
    expect(findByTestId(container, "stock-tcp-sheet")).toBeNull();

    await press(container, "stock-label-tcp");

    expect(findByTestId(container, "stock-label-print")).toBeNull();
    expect(findByTestId(container, "stock-label-menu")).toBeNull();
    expect(findByTestId(container, "stock-tcp-sheet")).toBeTruthy();
    expect(findByTestId(container, "stock-tcp-sheet-host")).toBeTruthy();
    expect(textOf(container)).toContain("YAZICI IP");
    expect(textOf(container)).toContain("Fiyatı bas");
    expect(textOf(container)).toContain("Telefondan yazdır");
    expect(textOf(container)).toContain("PDF paylaş");

    await act(async () => { root.unmount(); });
  });

  it("prints with the printer resolved for Etiket bas", async () => {
    const settings = {
      ...defaultLabelPrinter(),
      host: "10.4.4.4",
      port: 9100,
      source: "device" as const,
    };
    (resolveLabelPrinter as unknown as jest.Mock).mockResolvedValue(settings);
    const { container, root } = renderForm();
    await settle();

    await press(container, "stock-label-tcp");
    expect(findByTestId(container, "stock-tcp-sheet")).toBeTruthy();
    expect(findByTestId(container, "stock-tcp-sheet-host")).toBeNull();
    expect(textOf(container)).toContain("Yazıcı: 10.4.4.4:9100");
    const go = findByTestId(container, "stock-tcp-sheet-go");
    expect(reactProps(go)?.["aria-label"]).toBe("Etiket bas");

    await press(container, "stock-tcp-sheet-go");

    expect(printProductLabel).toHaveBeenCalledWith({
      settings,
      copies: 1,
      product: {
        name: "Vida M8",
        sku: "SKU-1",
        barcode: "8690001",
        price: 12.5,
        includePrice: true,
      },
    });

    await act(async () => { root.unmount(); });
  });
});
