import "../../test/domSetup";
import React, { act } from "react";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { SevkPickScreen } from "../SevkPickScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const BASE = "https://api.test";

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
  can: () => true,
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
  customer_name: "Cari A.Ş.",
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
      ordered_qty: 4,
      picked_qty: 1,
      image_url: "/uploads/x.jpg",
    },
    {
      line_index: 1,
      product_id: "p2",
      product_name: "Somun M8",
      sku: "SKU-2",
      ordered_qty: 2,
      picked_qty: 0,
    },
  ],
  progress: { ordered: 6, picked: 1, missing_lines: 2, complete: false },
};

function findTag(node: any, tag: string): any {
  if (!node) return null;
  if (String(node.tagName || node.nodeName || "").toUpperCase() === tag) return node;
  for (const child of node.childNodes || []) {
    const hit = findTag(child, tag);
    if (hit) return hit;
  }
  return null;
}

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

describe("SevkPickScreen line thumbnails", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
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

  it("resolves a relative image_url and shows a placeholder when the line has none", async () => {
    await show();
    const withPhoto = findByTestId(container, "sevk-line-thumb-0");
    expect(withPhoto).toBeTruthy();
    expect(withPhoto.getAttribute("aria-label")).toBe("Ürün görseli");
    expect(reactProps(withPhoto)?.style?.pointerEvents).toBe("none");
    const img = findTag(withPhoto, "IMG");
    expect(img).toBeTruthy();
    const uri = String(reactProps(img)?.source?.uri || "");
    expect(uri).toBe(`${mockAuth.client.baseUrl}/uploads/x.jpg`);
    expect(uri.startsWith(mockAuth.client.baseUrl)).toBe(true);

    const missing = findByTestId(container, "sevk-line-thumb-1");
    expect(missing).toBeTruthy();
    expect(missing.getAttribute("aria-label")).toBe("Ürün görseli yok");
    expect(findTag(missing, "IMG")).toBeNull();
  });

  it("keeps product text, scan and label controls, and posts the same adjust payload", async () => {
    await show();
    expect(textOf(container)).toContain("Vida M8");
    expect(textOf(container)).toContain("Somun M8");
    expect(textOf(container)).toContain("1/4");
    expect(textOf(container)).toContain("0/2");
    expect(findByTestId(container, "sevk-label-0")).toBeTruthy();
    expect(findByTestId(container, "sevk-scan-btn")).toBeTruthy();

    await pressId(container, "sevk-plus-0");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/order-picks/pick-42/adjust", {
      line_index: 0,
      product_id: "p1",
      product_name: "Vida M8",
      picked_qty: 2,
    });
  });
});
