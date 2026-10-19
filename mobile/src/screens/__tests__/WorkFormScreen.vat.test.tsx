import "../../test/domSetup";
import React, { act } from "react";
import { get, put } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { colors } from "../../theme";
import { WorkFormScreen } from "../WorkFormScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactLib = require("react") as typeof import("react");
    ReactLib.useEffect(() => effect(), [effect]);
  },
  useLocalSearchParams: () => ({}),
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn(), canGoBack: () => false },
  Stack: { Screen: () => null },
}));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));
jest.mock("expo-linking", () => ({ openURL: jest.fn(), createURL: jest.fn(() => "tamkobi://") }));
jest.mock("expo-location", () => ({
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 0, longitude: 0 } })),
}));
jest.mock("expo-camera", () => ({
  CameraView: () => null,
  useCameraPermissions: () => [{ granted: true, canAskAgain: false }, jest.fn()],
}));
jest.mock("expo-print", () => ({ printAsync: jest.fn() }));
jest.mock("expo-sharing", () => ({ shareAsync: jest.fn(), isAvailableAsync: jest.fn(async () => false) }));
jest.mock("expo-file-system", () => ({ File: class {}, Paths: {} }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: () => true,
  activeCompany: { id: "co-1", name: "TamKobi" },
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
  upload: jest.fn(),
  fileUrl: (_base: string, url: string) => url,
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
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
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
    Linking: { openURL: jest.fn() },
    Share: { share: jest.fn() },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
    Image: host("img"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

const QUOTE = {
  id: "q1",
  title: "İstisna teklif",
  contact_id: "c1",
  contact_name: "Acme",
  status: "draft",
  invoice_id: "inv-1",
  items: [{ name: "İstisna", product_id: "p0", quantity: 1, unit_price: 100, vat_rate: 0, unit: "Adet" }],
};

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterAll(() => {
  removeTestNavigator();
});

describe("WorkFormScreen quote VAT", () => {
  it("keeps a loaded 0% line on the chip and on the quote PUT", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/quotes/q1") return Promise.resolve(QUOTE);
      if (path === "/contacts") return Promise.resolve([{ id: "c1", name: "Acme" }]);
      if (path === "/products") return Promise.resolve([{ id: "p0", name: "İstisna", vat_rate: 0, is_active: true, unit: "Adet" }]);
      return Promise.resolve([]);
    });
    (put as unknown as jest.Mock).mockClear();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => { root.render(React.createElement(WorkFormScreen, { kind: "quote", docId: "q1" })); });
    await settle();

    const zero = findByTestId(container, "q-item-vat-0-0");
    const twenty = findByTestId(container, "q-item-vat-0-20");
    expect(textOf(zero)).toBe("%0");
    expect(reactProps(zero)?.style?.backgroundColor).toBe(colors.primary);
    expect(reactProps(twenty)?.style?.backgroundColor).toBe("#fff");

    (put as unknown as jest.Mock).mockClear();
    const save = findByTestId(container, "quote-save");
    await act(async () => { await reactProps(save)?.onClick?.(); });
    await settle();

    const quotePuts = (put as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/quotes/q1");
    expect(quotePuts.length).toBeGreaterThan(0);
    const body = quotePuts[0][2] as { items: Array<{ vat_rate?: number }> };
    expect(body.items[0].vat_rate).toBe(0);
    root.unmount();
    container.parentNode?.removeChild(container);
  });
});
