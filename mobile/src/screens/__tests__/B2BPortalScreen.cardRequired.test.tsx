import "../../test/domSetup";
import React, { act } from "react";
import { ApiHttpError } from "../../api/errors";
import { get, post } from "../../api/client";
import { clickable, findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { Linking } from "react-native";
import { B2BPortalScreen, isB2BCardRequired } from "../B2BPortalScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const openURL = jest.fn(async () => undefined);
  const view = (props: { testID?: string; children?: React.ReactNode }) =>
    ReactLib.createElement("div", { "data-testid": props.testID }, props.children);
  const text = (props: { testID?: string; children?: React.ReactNode }) =>
    ReactLib.createElement("span", { "data-testid": props.testID }, props.children);
  const pressable = (props: { testID?: string; disabled?: boolean; onPress?: () => unknown; children?: React.ReactNode }) =>
    ReactLib.createElement("button", {
      "data-testid": props.testID,
      disabled: !!props.disabled,
      onClick: () => (props.disabled ? undefined : props.onPress?.()),
    }, props.children);
  const TextInput = Object.assign(
    (props: { testID?: string; value?: string; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }),
    { State: { currentlyFocusedInput: () => null } },
  );
  const FlatList = (props: {
    testID?: string;
    data?: unknown[];
    keyExtractor?: (item: any, index: number) => string;
    renderItem: (info: { item: any; index: number }) => React.ReactNode;
    ListHeaderComponent?: React.ReactNode | (() => React.ReactNode);
    ListEmptyComponent?: React.ReactNode | (() => React.ReactNode);
  }) => {
    const data = props.data || [];
    const header = typeof props.ListHeaderComponent === "function" ? props.ListHeaderComponent() : props.ListHeaderComponent;
    const empty = data.length ? null : (typeof props.ListEmptyComponent === "function" ? props.ListEmptyComponent() : props.ListEmptyComponent);
    return ReactLib.createElement(
      "div",
      { "data-testid": props.testID },
      header,
      empty,
      data.map((item, index) => ReactLib.createElement(
        ReactLib.Fragment,
        { key: props.keyExtractor ? props.keyExtractor(item, index) : String(index) },
        props.renderItem({ item, index }),
      )),
    );
  };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => style,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Linking: { openURL, canOpenURL: jest.fn(async () => true) },
    Share: { share: jest.fn(async () => ({ action: "sharedAction" })) },
    Alert: { alert: jest.fn() },
    View: view,
    Text: text,
    Pressable: pressable,
    ScrollView: view,
    KeyboardAvoidingView: view,
    Image: () => null,
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? view({ children: props.children }) : null),
    FlatList,
    TextInput,
    Dimensions: { get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) },
  };
});

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: false }, jest.fn()],
}));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

const mockAuth = {
  client: { baseUrl: "https://portal.test", token: null as string | null },
  b2bToken: "tok-9",
  b2bName: "Bayi",
  logout: jest.fn(),
  baseUrl: "https://portal.test",
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (err: unknown, fallback?: string) => {
    const { apiErrorMessage } = jest.requireActual("../../api/errors") as typeof import("../../api/errors");
    return apiErrorMessage(err, fallback);
  },
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: (_base: string, url?: string | null) => url || "",
}));

const NOTE = "Bu bayide sipariş kartla ödeme sonrası oluşturulur.";
const PAY_URL = "https://portal.test/portal/tok-9/sepet";

function portal(cardOrderRequired: boolean) {
  return {
    contact: { name: "Bayi A.Ş.", balance: 0, discount: 0 },
    company: { name: "TamKobi" },
    products: [{ id: "p1", name: "Vida M8", price: 10, vat_rate: 0, in_stock: true, unit: "Adet" }],
    orders: [],
    invoices: [],
    installments: [],
    settings: {
      allow_orders: true,
      show_prices: true,
      show_stock: true,
      allow_ai_cart: false,
      show_statement: false,
      show_installments: false,
    },
    card_order_required: cardOrderRequired,
  };
}

function orderCalls() {
  return (post as unknown as jest.Mock).mock.calls.filter((call) => String(call[1] || "").includes("/orders"));
}

async function pressId(container: any, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container as any).slice(0, 400)}`);
  const target = clickable(node) || node;
  const props = reactProps(target);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

async function typeId(container: any, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing input ${id}`);
  const props = reactProps(node);
  await act(async () => { await props?.onChange?.({ target: { value } }); });
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("B2B card required errors", () => {
  it("treats HTTP 402 and a card_required detail or body as the web payment case", () => {
    expect(isB2BCardRequired(new ApiHttpError(402, "Bu portalda sipariş için kartla ödeme zorunlu.", "Bu portalda sipariş için kartla ödeme zorunlu."))).toBe(true);
    expect(isB2BCardRequired(new ApiHttpError(400, { card_required: true }, "kart"))).toBe(true);
    expect(isB2BCardRequired({ status: 409, body: { card_required: true } })).toBe(true);
    expect(isB2BCardRequired({ response: { status: 400, data: { detail: { card_required: true } } } })).toBe(true);
    expect(isB2BCardRequired(new ApiHttpError(400, "Sepet boş.", "Sepet boş."))).toBe(false);
  });
});

describe("B2BPortalScreen card required", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (Linking.openURL as unknown as jest.Mock).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show(cardOrderRequired: boolean) {
    (get as unknown as jest.Mock).mockImplementation(async () => portal(cardOrderRequired));
    (post as unknown as jest.Mock).mockResolvedValue({ message: "ok" });
    await act(async () => { root.render(React.createElement(B2BPortalScreen)); });
    await act(async () => { await Promise.resolve(); });
  }

  it("shows the web payment card and does not post /orders when the portal requires a card", async () => {
    await show(true);
    await pressId(container, "b2b-add-p1");
    await pressId(container, "b2b-cart-btn");
    expect(textOf(container)).toContain(NOTE);
    expect(textOf(container)).toContain("Web'de öde");
    expect(findByTestId(container, "b2b-order-submit")).toBeNull();
    expect(orderCalls()).toHaveLength(0);
    await pressId(container, "b2b-card-order-pay-pay");
    expect(Linking.openURL).toHaveBeenCalledWith(PAY_URL);
    expect(textOf(container)).toContain("Vida M8");
  });

  it("keeps the cart when /orders answers 402 card_required and opens the same web pay url", async () => {
    await show(false);
    await pressId(container, "b2b-add-p1");
    await pressId(container, "b2b-cart-btn");
    await typeId(container, "b2b-order-note", "kapıya bırak");
    (post as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("/orders")) {
        const err = new ApiHttpError(402, { card_required: true }, "Bu portalda sipariş için kartla ödeme zorunlu.");
        throw err;
      }
      return { message: "ok" };
    });
    await pressId(container, "b2b-order-submit");
    expect(orderCalls()).toHaveLength(1);
    expect(textOf(container)).toContain(NOTE);
    expect(textOf(container)).toContain("Web'de öde");
    expect(textOf(container)).toContain("Vida M8");
    expect(textOf(container)).not.toContain("Sipariş gönderildi");
    const note = findByTestId(container, "b2b-order-note");
    expect(reactProps(note)?.value ?? note?.value).toBe("kapıya bırak");
    await pressId(container, "b2b-card-order-required-pay");
    expect(Linking.openURL).toHaveBeenCalledWith(PAY_URL);
  });
});
