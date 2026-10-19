import "../../test/domSetup";
import React, { act } from "react";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { colors } from "../../theme";
import { printPickProductLabels } from "../../utils/pickLabelPrint";
import { SevkPickScreen } from "../SevkPickScreen";

jest.mock("../../utils/pickLabelPrint", () => ({
  printPickProductLabels: jest.fn(async () => ({ count: 1, ok: true })),
}));

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const BASE = "https://api.test";

let allowEdit = true;

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useLocalSearchParams: () => ({ id: "pick-42", name: "SIP-42" }),
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: false, canAskAgain: false }, jest.fn()],
}));
jest.mock("expo-file-system", () => ({ File: class File {}, Paths: {} }));
jest.mock("expo-print", () => ({ printAsync: jest.fn() }));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn(), isAvailableAsync: jest.fn(async () => false) }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
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
      children?: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        "aria-label": props.accessibilityLabel,
      }, props.children);
    };
  const TextInput = Object.assign(
    (props: { testID?: string; value?: string; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }),
    { State: { currentlyFocusedInput: () => null } },
  );
  const Image = (props: { source?: { uri?: string }; style?: unknown; onError?: () => void }) =>
    ReactLib.createElement("img", {
      source: props.source,
      src: props.source?.uri || "",
      style: flatten(props.style),
    });
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
    Image,
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput,
  };
});

const mockAuth = {
  client: { baseUrl: BASE, token: "tok" },
  companyId: "co-1",
  user: null as null,
  activeCompany: null as null,
  baseUrl: BASE,
  can: (_path?: string, level?: string) => (level === "edit" ? allowEdit : true),
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => {
  const actual = jest.requireActual("../../api/url") as typeof import("../../api/url");
  return {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(async () => ({})),
    displayFileUrl: actual.displayFileUrl,
  };
});

const session = {
  id: "pick-42",
  order_number: "SIP-42",
  customer_name: "Deniz Ticaret",
  status: "picking",
  order_status: "confirmed",
  channel: "manual",
  items: [
    {
      line_index: 0,
      product_id: "p1",
      product_name: "Vida M8",
      sku: "SKU-1",
      barcode: "8690001",
      ordered_qty: 5,
      picked_qty: 3,
      unit: "adet",
      image_url: "/uploads/x.jpg",
    },
    {
      line_index: 1,
      product_id: "p2",
      product_name: "Somun M8",
      sku: "SKU-2",
      ordered_qty: 4,
      picked_qty: 4,
      unit: "adet",
    },
    {
      line_index: 2,
      product_id: "p3",
      product_name: "Profil",
      sku: "SKU-3",
      ordered_qty: 12,
      picked_qty: 1,
      unit: "kg",
    },
  ],
  progress: { ordered: 20, picked: 9, missing_lines: 2, complete: false },
};

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function pressId(container: any, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const props = reactProps(node);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("SevkPickScreen keypad", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    allowEdit = true;
    (printPickProductLabels as jest.Mock).mockClear();
    (printPickProductLabels as jest.Mock).mockResolvedValue({ count: 1, ok: true });
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (get as unknown as jest.Mock).mockResolvedValue(session);
    (post as unknown as jest.Mock).mockResolvedValue({ ...session, items: session.items });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show() {
    await act(async () => { root.render(React.createElement(SevkPickScreen)); });
    await flush();
  }

  it("paints missing lines orange and finished lines green", async () => {
    await show();
    const missing = findByTestId(container, "sevk-line-0");
    expect(reactProps(missing)?.style?.borderLeftWidth).toBe(4);
    expect(reactProps(missing)?.style?.borderLeftColor).toBe("#F59E0B");
    expect(textOf(missing)).toContain("2 eksik");
    expect(textOf(missing)).toContain("3/5");

    const done = findByTestId(container, "sevk-line-1");
    expect(reactProps(done)?.style?.borderLeftColor).toBe(colors.primary);
    expect(reactProps(done)?.style?.backgroundColor).toBe(colors.emerald50);
    expect(textOf(done)).toContain("✓ Tamam");
    expect(textOf(done)).toContain("4/4");
    expect(textOf(missing)).toContain("SKU-1 · 8690001");
    expect(textOf(missing)).not.toContain("kaldı");
  });

  it("shows picked progress from the session, not a client recount", async () => {
    await show();
    expect(textOf(container)).toContain("Deniz Ticaret · 3 kalem · 9 / 20 adet toplandı");
    expect(textOf(container)).toContain("%45");
  });

  it("opens one keypad and posts the typed quantity", async () => {
    await show();
    expect(findByTestId(container, "sevk-keypad-2")).toBeNull();
    await pressId(container, "sevk-qty-2");
    expect(findByTestId(container, "sevk-keypad-2")).toBeTruthy();
    expect(textOf(findByTestId(container, "sevk-keypad-2"))).toContain("↑ Adede dokun, istediğin sayıyı yaz");
    expect(textOf(findByTestId(container, "sevk-qty-2"))).toContain("1 kg");

    await pressId(container, "sevk-keypad-key-8-2");
    expect(textOf(findByTestId(container, "sevk-qty-2"))).toContain("8 kg");
    await pressId(container, "sevk-keypad-ok-2");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", {
      line_index: 2,
      product_id: "p3",
      product_name: "Profil",
      picked_qty: 8,
    });
    expect(findByTestId(container, "sevk-keypad-2")).toBeNull();
  });

  it("clamps an over-order entry and keeps the excess message", async () => {
    await show();
    await pressId(container, "sevk-qty-0");
    await pressId(container, "sevk-keypad-key-9-0");
    await pressId(container, "sevk-keypad-ok-0");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", {
      line_index: 0,
      product_id: "p1",
      product_name: "Vida M8",
      picked_qty: 5,
    });
    expect(textOf(container)).toContain("Vida M8: siparişte 5 adet var, 3 okutuldu.");
  });

  it("deletes the last typed digit with backspace", async () => {
    await show();
    await pressId(container, "sevk-qty-2");
    await pressId(container, "sevk-keypad-key-8-2");
    await pressId(container, "sevk-keypad-key-2-2");
    expect(textOf(findByTestId(container, "sevk-qty-2"))).toContain("82 kg");
    await pressId(container, "sevk-keypad-key-⌫-2");
    expect(textOf(findByTestId(container, "sevk-qty-2"))).toContain("8 kg");
    await pressId(container, "sevk-keypad-ok-2");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", expect.objectContaining({
      line_index: 2,
      picked_qty: 8,
    }));
  });

  it("drops an unconfirmed draft when another row is tapped", async () => {
    await show();
    await pressId(container, "sevk-qty-2");
    await pressId(container, "sevk-keypad-key-8-2");
    await pressId(container, "sevk-line-0");
    expect(post).not.toHaveBeenCalled();
    expect(findByTestId(container, "sevk-keypad-2")).toBeNull();
    expect(textOf(findByTestId(container, "sevk-qty-2"))).toContain("1 kg");
  });

  it("shows the decimal key only for decimal units", async () => {
    await show();
    await pressId(container, "sevk-qty-0");
    expect(findByTestId(container, "sevk-keypad-key-,-0")).toBeNull();
    await pressId(container, "sevk-qty-2");
    expect(findByTestId(container, "sevk-keypad-0")).toBeNull();
    expect(findByTestId(container, "sevk-keypad-key-,-2")).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
  });

  it("keeps minus, plus and all on the adjust endpoint", async () => {
    await show();
    expect(reactProps(findByTestId(container, "sevk-all-2"))?.style?.backgroundColor).toBe(colors.indigo);
    expect(reactProps(findByTestId(container, "sevk-all-1"))?.style?.backgroundColor).toBe(colors.muted);
    await pressId(container, "sevk-minus-0");
    expect(post).toHaveBeenLastCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", expect.objectContaining({
      line_index: 0,
      product_name: "Vida M8",
      picked_qty: 2,
    }));
    await pressId(container, "sevk-plus-0");
    expect(post).toHaveBeenLastCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", expect.objectContaining({
      line_index: 0,
      picked_qty: 4,
    }));
    await pressId(container, "sevk-all-0");
    expect(post).toHaveBeenLastCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", expect.objectContaining({
      line_index: 0,
      picked_qty: 5,
    }));
    expect(findByTestId(container, "sevk-label-0")).toBeTruthy();
  });

  it("names the box label and sends product labels through printPickProductLabels", async () => {
    await show();
    const ship = findByTestId(container, "sevk-ship-label");
    expect(ship).toBeTruthy();
    expect(ship.getAttribute("aria-label")).toBe("Koli etiketi bas");
    expect(textOf(container)).toContain("Etiket yazdır");
    expect(findByTestId(container, "sevk-print-labels")).toBeTruthy();

    await pressId(container, "sevk-ship-label");
    await flush();
    expect(textOf(container)).toContain("Koli etiketi bas");
    expect(findByTestId(container, "sevk-ship-sheet")).toBeTruthy();

    await pressId(container, "sevk-print-labels");
    await flush();
    expect(printPickProductLabels).toHaveBeenCalledTimes(1);
    expect(printPickProductLabels).toHaveBeenCalledWith(
      session.items,
      null,
      "SIP-42",
      expect.objectContaining({ client: mockAuth.client }),
    );
  });

  it("hides the keypad and the button row when the user cannot edit", async () => {
    allowEdit = false;
    await show();
    expect(findByTestId(container, "sevk-keypad-0")).toBeNull();
    expect(findByTestId(container, "sevk-qty-0")).toBeNull();
    expect(findByTestId(container, "sevk-minus-0")).toBeNull();
    expect(findByTestId(container, "sevk-plus-0")).toBeNull();
    expect(findByTestId(container, "sevk-all-0")).toBeNull();
    expect(findByTestId(container, "sevk-label-0")).toBeNull();
    expect(textOf(container)).toContain("2 eksik");
    expect(textOf(container)).toContain("✓ Tamam");
    expect(findByTestId(container, "sevk-line-thumb-0")).toBeTruthy();
  });
});
