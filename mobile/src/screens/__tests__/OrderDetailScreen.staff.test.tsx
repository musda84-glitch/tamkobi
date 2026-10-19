import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
import { can as canPerm } from "../../utils/permissions";
import { OrderDetailScreen } from "../OrderDetailScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ id: "ord-1" }),
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(), canOpenURL: jest.fn(async () => false) }));
jest.mock("../../utils/orderShare", () => ({
  printOrderForm: jest.fn(async () => true),
  printCargoLabel: jest.fn(async () => "thermal"),
  printInvoiceForm: jest.fn(async () => true),
}));

const session = {
  role: "personel",
  permissions: { "/orders": "none", "/cargo": "none", "/saha": "edit" },
  features: { portal_orders: true, portal_saha: true, view_prices: false, order_cargo_label: true, order_more_actions: true },
};
const authClient = { baseUrl: "https://api.test", token: "tok" };
const activeCompany = { id: "co-1", name: "Matek" };

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: authClient,
    companyId: "co-1",
    activeCompany,
    user: session,
    can: (path: string, level?: "view" | "edit" | "delete") => canPerm(session, path, level),
    feature: (key: string) => session.features[key as keyof typeof session.features] !== false,
  }),
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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, { "data-testid": props.testID, style: flatten(props.style), onClick: props.onPress }, props.children);
    };
  class AnimatedValue {
    constructor(public value: number) { this.value = value; }
    setValue(next: number) { this.value = next; }
  }
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: unknown) => styles, flatten },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    ActivityIndicator: host("span"),
    Animated: { Value: AnimatedValue, spring: () => ({ start() { /* no-op */ } }), View: host("div") },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    Image: host("img"),
    KeyboardAvoidingView: host("div"),
    RefreshControl: host("div"),
    Switch: host("input"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

const order = {
  id: "ord-1",
  order_number: "S-1",
  customer_name: "Ayşe",
  channel: "manual",
  order_status: "pending",
  order_date: "2026-10-01",
  grand_total: 17550,
  total_amount: 17550,
  cancel_request: { status: "pending", reason: "vazgeçti" },
  items: [{ product_name: "Koltuk", quantity: 1, unit_price: 14625, total: 14625, total_incl: 17550 }],
};

describe("OrderDetailScreen staff mode", () => {
  afterAll(() => {
    removeTestNavigator();
  });

  it("hides swipe delete, cancel actions, and prices", async () => {
    (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("/products")) return [];
      return order;
    });
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(OrderDetailScreen));
    });
    expect(findByTestId(container, "order-item-0-del")).toBeNull();
    expect(findByTestId(container, "order-accept-cancel-btn")).toBeNull();
    expect(findByTestId(container, "order-reject-cancel-btn")).toBeNull();
    expect(textOf(container)).not.toContain("Kalemi silmek için satırı sola kaydırın.");
    expect(textOf(container)).not.toContain(fmtMoney(17550));
    expect(textOf(container)).not.toContain(fmtMoney(14625));
    expect(textOf(container)).toContain("Koltuk");
    expect(findByTestId(container, "order-notify-missing-S-1")).toBeTruthy();
    act(() => {
      root.unmount();
    });
  });
});
