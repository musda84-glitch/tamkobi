import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, put } from "../../api/client";
import { ApiHttpError } from "../../api/errors";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { InvoiceDetailScreen } from "../InvoiceDetailScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
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
    useLocalSearchParams: () => ({ id: "inv-1" }),
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("../../utils/orderShare", () => ({ printInvoiceForm: jest.fn(async () => true) }));

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: null,
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
  class AnimatedValue {
    constructor(public value: number) { this.value = value; }
    setValue(next: number) { this.value = next; }
  }
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
    Animated: {
      Value: AnimatedValue,
      spring: () => ({ start() { /* no-op */ } }),
      View: host("div"),
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: host("input"),
    Image: host("img"),
    Switch: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Linking: { openURL: jest.fn() },
    Share: { share: jest.fn() },
  };
});

const invoice = {
  id: "inv-1",
  invoice_number: "TAS-1",
  status: "draft",
  invoice_type: "sales",
  e_type: "paper",
  contact_name: "Acme",
  currency: "TRY",
  grand_total: 120,
  paid_amount: 0,
  issue_date: "2026-10-01",
  due_date: "2026-10-15",
  items: [{ name: "Kalem", product_name: "Kalem", quantity: 1, unit: "Adet", unit_price: 100, vat_rate: 20 }],
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

function renderDetail() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(InvoiceDetailScreen)); });
  return { container, root };
}

describe("InvoiceDetailScreen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    (get as unknown as jest.Mock).mockReset();
    (put as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("separates loading, a missing invoice, and a failed load", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/invoices/inv-1") return new Promise(() => undefined);
      return Promise.resolve([]);
    });
    const loading = renderDetail();
    await settle();
    expect(findByTestId(loading.container, "inv-detail-loading")).toBeTruthy();
    expect(textOf(loading.container)).not.toContain("Fatura bulunamadı.");
    loading.root.unmount();

    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/invoices/inv-1") return Promise.reject(new ApiHttpError(404, "yok", "bulunamadı"));
      return Promise.resolve([]);
    });
    const missing = renderDetail();
    await settle();
    expect(textOf(missing.container)).toContain("Fatura bulunamadı.");
    expect(findByTestId(missing.container, "inv-detail-retry")).toBeNull();
    expect(findByTestId(missing.container, "inv-detail-loading")).toBeNull();
    missing.root.unmount();

    let fail = true;
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/invoices/inv-1") {
        if (fail) return Promise.reject(new ApiHttpError(500, "kapalı", "Fatura yüklenemedi."));
        return Promise.resolve(invoice);
      }
      return Promise.resolve([]);
    });
    const broken = renderDetail();
    await settle();
    expect(findByTestId(broken.container, "inv-detail-retry")).toBeTruthy();
    expect(textOf(broken.container)).not.toContain("Fatura bulunamadı.");
    fail = false;
    await press(broken.container, "inv-detail-retry");
    expect(textOf(broken.container)).toContain("TAS-1");
    expect(findByTestId(broken.container, "inv-header-total")).toBeTruthy();
    broken.root.unmount();
  });

  it("opens the line sheet from the swipe edit and persists the item", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/invoices/inv-1") return Promise.resolve(invoice);
      return Promise.resolve([]);
    });
    (put as unknown as jest.Mock).mockResolvedValue({});
    const { container, root } = renderDetail();
    await settle();
    expect(findByTestId(container, "inv-line-sheet")).toBeNull();
    await press(container, "inv-item-0-edit");
    expect(findByTestId(container, "inv-line-sheet")).toBeTruthy();
    await press(container, "inv-item-vat-10");
    await press(container, "inv-line-save");
    expect(put).toHaveBeenCalled();
    const body = (put as unknown as jest.Mock).mock.calls[0][2] as { items: Array<{ vat_rate?: number }> };
    expect(body.items[0].vat_rate).toBe(10);
    root.unmount();
  });
});
