import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { Order } from "../../types";
import { can as canPerm } from "../../utils/permissions";
import { OrderActions } from "../OrderActions";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("expo-linking", () => ({ openURL: jest.fn(), canOpenURL: jest.fn(async () => false) }));
jest.mock("../../utils/orderShare", () => ({
  printOrderForm: jest.fn(async () => true),
  printCargoLabel: jest.fn(async () => "thermal"),
  printInvoiceForm: jest.fn(async () => true),
}));

let session: {
  role: string;
  permissions: Record<string, string>;
  features: Record<string, boolean>;
} = { role: "personel", permissions: {}, features: { portal_orders: true } };

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: { baseUrl: "https://api.test", token: "tok" },
    companyId: "co-1",
    activeCompany: { id: "co-1", name: "Matek" },
    user: session,
    can: (path: string, level?: "view" | "edit" | "delete") => canPerm(session, path, level),
    feature: (key: string) => session.features[key] !== false,
  }),
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(async () => []),
  post: jest.fn(async () => ({ message: "ok" })),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
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
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: unknown) => styles, flatten },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    ActivityIndicator: host("span"),
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    RefreshControl: host("div"),
    Switch: host("input"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (
      props.visible === false ? null : host("div")(props)
    ),
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

const baseOrder: Order = {
  id: "ord-1",
  order_number: "S-1",
  customer_name: "Ayşe",
  channel: "manual",
  order_status: "pending",
  grand_total: 120,
  items: [{ product_name: "Raf", quantity: 1, unit_price: 100, total: 120 }],
};

function renderActions(order: Order = baseOrder, compact = false) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onError = jest.fn();
  act(() => {
    root.render(React.createElement(OrderActions, { order, compact, onError, onMessage: jest.fn(), onChanged: jest.fn() }));
  });
  return { container, root, onError };
}

function idsWithin(node: unknown): string[] {
  const acc: string[] = [];
  const walk = (cur: { getAttribute?: (name: string) => string | null; childNodes?: unknown[] } | null, includeSelf: boolean) => {
    if (!cur) return;
    if (includeSelf) {
      const id = cur.getAttribute?.("data-testid");
      if (id) acc.push(id);
    }
    for (const child of cur.childNodes || []) walk(child as typeof cur, true);
  };
  walk(node as { getAttribute?: (name: string) => string | null; childNodes?: unknown[] }, false);
  return acc;
}

function unmount(root: { unmount: () => void }) {
  act(() => {
    root.unmount();
  });
}

async function press(container: HTMLElement, testId: string) {
  const node = findByTestId(container, testId);
  const props = reactProps(node);
  await act(async () => {
    props?.onClick?.();
  });
}

describe("OrderActions staff orders", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    session = {
      role: "personel",
      permissions: { "/orders": "none", "/cargo": "none" },
      features: { portal_orders: true, order_cargo_label: true, order_more_actions: true, view_prices: false },
    };
    (get as jest.Mock).mockReset().mockResolvedValue([]);
    (post as jest.Mock).mockReset().mockResolvedValue({ message: "ok" });
    (Alert.alert as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("shows only the five staff actions on the detail and compact toolbars", () => {
    const detail = renderActions();
    const bar = findByTestId(detail.container, "order-actions-S-1");
    expect(idsWithin(bar)).toEqual([
      "print-order-btn-S-1",
      "order-notify-missing-S-1",
      "order-produce-choice-S-1",
      "order-cargo-ord-1",
      "order-label-ord-1",
    ]);
    expect(findByTestId(detail.container, "order-delete-ord-1")).toBeNull();
    expect(findByTestId(detail.container, "order-approve-ord-1")).toBeNull();
    expect(findByTestId(detail.container, "order-primary-S-1")).toBeNull();
    expect(findByTestId(detail.container, "order-more-btn-S-1")).toBeNull();
    unmount(detail.root);

    const compact = renderActions(baseOrder, true);
    expect(idsWithin(findByTestId(compact.container, "order-actions-S-1"))).toEqual([
      "print-order-btn-S-1",
      "order-notify-missing-S-1",
      "order-produce-choice-S-1",
      "order-cargo-ord-1",
      "order-label-ord-1",
    ]);
    unmount(compact.root);
  });

  it("opens a produce choice sheet that calls the two production endpoints", async () => {
    const view = renderActions();
    await press(view.container, "order-produce-choice-S-1");
    const sheet = findByTestId(view.container, "order-produce-choice-sheet-S-1");
    expect(textOf(sheet)).toContain("Eksik ürünleri üretime al");
    expect(textOf(sheet)).toContain("Üretim emri ver");

    await press(view.container, "order-produce-missing-S-1");
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text?: string; onPress?: () => void }[];
    await act(async () => {
      buttons.find((b) => b.text === "Tamam")?.onPress?.();
    });
    expect(post).toHaveBeenCalledWith(expect.anything(), "/order-picks/ord-1/to-production", {});

    (get as jest.Mock).mockResolvedValueOnce([]);
    await press(view.container, "order-produce-choice-S-1");
    await press(view.container, "order-produce-btn-S-1");
    expect(get).toHaveBeenCalledWith(expect.anything(), "/production/work-orders/stations", { company_id: "co-1" });
    const input = findByTestId(view.container, "order-produce-station-input-S-1");
    await act(async () => {
      reactProps(input)?.onChangeText?.("Kesim");
    });
    await press(view.container, "order-produce-recipe-submit-S-1");
    expect(post).toHaveBeenCalledWith(
      expect.anything(),
      "/orders/ord-1/production-recipe",
      { station: "Kesim", default_station: "Kesim" },
    );
    unmount(view.root);
  });

  it("reports missing lines and ships only from the ship sheet", async () => {
    const view = renderActions();
    await press(view.container, "order-notify-missing-S-1");
    expect(post).toHaveBeenCalledWith(expect.anything(), "/order-picks/ord-1/notify-missing", {});

    await press(view.container, "order-cargo-ord-1");
    expect(findByTestId(view.container, "order-ship-submit-S-1")).toBeTruthy();
    expect(findByTestId(view.container, "order-warehouse-ship-S-1")).toBeTruthy();
    expect(findByTestId(view.container, "order-cargo-save-ord-1")).toBeNull();
    expect(get).toHaveBeenCalledWith(expect.anything(), "/integrations/cargo", { company_id: "co-1" });
    unmount(view.root);
  });

  it("does not call cargo APIs when the order is already shipped", async () => {
    const tracked = renderActions({ ...baseOrder, cargo_tracking_number: "TR1" });
    await press(tracked.container, "order-cargo-ord-1");
    expect(tracked.onError).toHaveBeenCalledWith("Bu sipariş zaten kargolandı.");
    expect(post).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
    expect(findByTestId(tracked.container, "order-label-ord-1")).toBeTruthy();
    unmount(tracked.root);

    const warehouse = renderActions({ ...baseOrder, warehouse_shipped: true });
    await press(warehouse.container, "order-cargo-ord-1");
    expect(warehouse.onError).toHaveBeenCalledWith("Bu sipariş zaten kargolandı.");
    expect(get).not.toHaveBeenCalled();
    unmount(warehouse.root);
  });

  it("keeps the sales toolbar and hides Kargola when the role cannot ship", () => {
    session = {
      role: "sales",
      permissions: { "/orders": "edit", "/cargo": "edit", "/invoices": "edit" },
      features: { order_cargo_label: true, order_more_actions: true, view_prices: true },
    };
    const sales = renderActions();
    expect(findByTestId(sales.container, "order-cargo-ord-1")).toBeTruthy();
    expect(findByTestId(sales.container, "print-order-btn-S-1")).toBeTruthy();
    expect(findByTestId(sales.container, "order-primary-S-1")).toBeTruthy();
    expect(findByTestId(sales.container, "order-approve-ord-1")).toBeTruthy();
    expect(findByTestId(sales.container, "order-produce-btn-S-1")).toBeTruthy();
    expect(findByTestId(sales.container, "order-more-btn-S-1")).toBeTruthy();
    expect(findByTestId(sales.container, "order-notify-missing-S-1")).toBeNull();
    expect(findByTestId(sales.container, "order-produce-choice-S-1")).toBeNull();
    unmount(sales.root);

    session = {
      role: "accountant",
      permissions: { "/orders": "view", "/cargo": "none", "/invoices": "edit" },
      features: { order_cargo_label: true, order_more_actions: true },
    };
    const viewer = renderActions();
    expect(findByTestId(viewer.container, "order-cargo-ord-1")).toBeNull();
    expect(findByTestId(viewer.container, "print-order-btn-S-1")).toBeTruthy();
    expect(findByTestId(viewer.container, "order-primary-S-1")).toBeTruthy();
    expect(findByTestId(viewer.container, "order-produce-btn-S-1")).toBeTruthy();
    expect(findByTestId(viewer.container, "order-more-btn-S-1")).toBeTruthy();
    expect(findByTestId(viewer.container, "order-approve-ord-1")).toBeNull();
    unmount(viewer.root);
  });
});
