import "../../test/domSetup";
import React, { act } from "react";
import { get, put } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
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
      onChangeText?: (value: string) => void;
      value?: unknown;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        value: props.value,
        onChangeText: props.onChangeText,
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
  title: "Kapı teklifi",
  contact_id: "c1",
  contact_name: "Acme",
  status: "draft",
  invoice_id: "inv-1",
  items: [{
    name: "Kapı",
    product_id: "p1",
    quantity: 1,
    unit_price: 100,
    vat_rate: 20,
    unit: "Adet",
    description: "Kesim 12 cm",
  }],
};

const SURVEY = {
  id: "s1",
  contact_id: "c1",
  contact_name: "Acme",
  status: "planned",
  address: "Kadıköy",
  survey_date: "2026-10-19",
  notes: "",
  measurements: [{
    name: "Ölçü",
    quantity: 1,
    unit_price: 50,
    vat_rate: 20,
    unit: "Adet",
    description: "Duvar boşluğu",
  }],
};

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function mockGets() {
  (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
    if (path === "/quotes/q1") return Promise.resolve(QUOTE);
    if (path === "/surveys") return Promise.resolve([SURVEY]);
    if (path === "/contacts") return Promise.resolve([{ id: "c1", name: "Acme" }]);
    if (path === "/products") return Promise.resolve([{ id: "p1", name: "Kapı", vat_rate: 20, is_active: true, unit: "Adet", sale_price: 100 }]);
    return Promise.resolve([]);
  });
}

async function renderWork(kind: "quote" | "survey", docId: string) {
  mockGets();
  (put as unknown as jest.Mock).mockClear();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => { root.render(React.createElement(WorkFormScreen, { kind, docId })); });
  await settle();
  return { container, root };
}

async function typeDiscount(container: HTMLElement, value: string) {
  const input = findByTestId(container, "q-item-disc-0");
  await act(async () => { reactProps(input)?.onChangeText?.(value); });
  await settle();
}

function quotePutBody() {
  const calls = (put as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/quotes/q1");
  return calls.at(-1)?.[2] as { items: Array<{ discount_rate?: number; description?: string; vat_rate?: number }> } | undefined;
}

afterAll(() => {
  removeTestNavigator();
});

describe("WorkFormScreen quote line card", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders quote lines on DocLineCard and keeps the saved description", async () => {
    const { container, root } = await renderWork("quote", "q1");
    const card = textOf(findByTestId(container, "q-item-0"));
    expect(card).toContain("Kapı");
    expect(card).toContain("ADET");
    expect(card).toContain("FİYAT");
    expect(card).toContain(fmtMoney(100));
    expect(card).toContain("KDV");
    expect(card).toContain("%20");
    expect(card).toContain("İSK");
    expect(card).toContain("%0");
    expect(card).toContain("Adet");
    expect(card).toContain(fmtMoney(120));
    expect(findByTestId(container, "q-item-del-0")).toBeTruthy();
    expect(findByTestId(container, "q-item-disc-0")).toBeTruthy();
    expect(findByTestId(container, "q-item-note-toggle-0")).toBeNull();
    expect(findByTestId(container, "q-item-note-0")).toBeNull();
    expect(textOf(container)).not.toContain("Satır iskontoları");

    (put as unknown as jest.Mock).mockClear();
    await act(async () => { await reactProps(findByTestId(container, "quote-save"))?.onClick?.(); });
    await settle();
    const body = quotePutBody();
    expect(body?.items[0].description).toBe("Kesim 12 cm");
    expect(body?.items[0].discount_rate).toBe(0);
    root.unmount();
  });

  it("applies a 10% line discount to the total and the quote PUT", async () => {
    const { container, root } = await renderWork("quote", "q1");
    await typeDiscount(container, "10");
    const card = textOf(findByTestId(container, "q-item-0"));
    expect(card).toContain("%10");
    expect(card).toContain(fmtMoney(108));
    expect(textOf(container)).toContain("Satır iskontoları");
    expect(textOf(findByTestId(container, "q-line-discount"))).toContain(fmtMoney(10));
    expect(textOf(findByTestId(container, "q-grand-total"))).toContain(fmtMoney(108));

    (put as unknown as jest.Mock).mockClear();
    await act(async () => { await reactProps(findByTestId(container, "quote-save"))?.onClick?.(); });
    await settle();
    const body = quotePutBody();
    expect(body?.items[0].discount_rate).toBe(10);
    expect(body?.items[0].description).toBe("Kesim 12 cm");
    expect(body?.items[0].vat_rate).toBe(20);
    root.unmount();
  });

  it("clamps a discount above 100 to 100 and a negative discount to 0", async () => {
    const high = await renderWork("quote", "q1");
    await typeDiscount(high.container, "150");
    expect(textOf(findByTestId(high.container, "q-item-0"))).toContain("%100");
    (put as unknown as jest.Mock).mockClear();
    await act(async () => { await reactProps(findByTestId(high.container, "quote-save"))?.onClick?.(); });
    await settle();
    expect(quotePutBody()?.items[0].discount_rate).toBe(100);
    high.root.unmount();

    const low = await renderWork("quote", "q1");
    await typeDiscount(low.container, "-5");
    expect(textOf(findByTestId(low.container, "q-item-0"))).toContain("%0");
    expect(textOf(findByTestId(low.container, "q-grand-total"))).toContain(fmtMoney(120));
    (put as unknown as jest.Mock).mockClear();
    await act(async () => { await reactProps(findByTestId(low.container, "quote-save"))?.onClick?.(); });
    await settle();
    expect(quotePutBody()?.items[0].discount_rate).toBe(0);
    expect(quotePutBody()?.items[0].description).toBe("Kesim 12 cm");
    low.root.unmount();
  });

  it("keeps the description toggle on a survey line", async () => {
    const { container, root } = await renderWork("survey", "s1");
    expect(findByTestId(container, "q-item-0")).toBeNull();
    expect(findByTestId(container, "q-item-note-toggle-0")).toBeTruthy();
    const note = findByTestId(container, "q-item-note-0");
    expect(note).toBeTruthy();
    expect(String(reactProps(note)?.value || "")).toContain("Duvar boşluğu");
    expect(findByTestId(container, "q-item-disc-0")).toBeNull();
    root.unmount();
  });
});
