import "../../test/domSetup";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { homeStartPageKey } from "../../utils/homeStartPage";
import { SettingsScreen } from "../SettingsScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() } }));
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
    return style as Record<string, unknown>;
  };
  const host = (tag: string) =>
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
      }, props.children);
    };
  return {
    Platform: { OS: "android", select: (spec: { android?: unknown; default?: unknown }) => spec.android ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    Image: host("img"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companies: [] as { id: string; name: string }[],
  activeCompany: null as { id: string; name: string } | null,
  switchCompany: jest.fn(async () => undefined),
  companyId: "cid-1",
  user: { id: "uid-1", email: "m@tamkobi.com", name: "Mustafa", role: "admin", phone: "" } as {
    id: string;
    email: string;
    name: string;
    role: string;
    phone?: string;
    employee_id?: string;
  },
  logout: jest.fn(async () => undefined),
  updateProfile: jest.fn(async () => ({ message: "ok" })),
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "hata",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(async () => ({})),
  post: jest.fn(async () => ({})),
  upload: jest.fn(async () => ({})),
  displayFileUrl: () => "",
}));

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

describe("Settings start page", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  beforeEach(() => {
    mockAuth.user = { id: "uid-1", email: "m@tamkobi.com", name: "Mustafa", role: "admin", phone: "" };
    mockAuth.companyId = "cid-1";
    (AsyncStorage.getItem as jest.Mock).mockReset();
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show() {
    await act(async () => { root.render(React.createElement(SettingsScreen)); });
    await flush();
  }

  it("shows the card for a manager and saves Butonlar", async () => {
    await show();
    expect(findByTestId(container, "settings-start-page")).toBeTruthy();
    expect(textOf(findByTestId(container, "settings-start-page"))).toContain("Açılış ekranı");
    expect(textOf(findByTestId(container, "settings-start-page"))).toContain("Genel Bakış");
    expect(textOf(findByTestId(container, "settings-start-page"))).toContain("Butonlar");
    const button = findByTestId(container, "settings-start-tiles");
    await act(async () => { await reactProps(button)?.onClick?.(); });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(homeStartPageKey("uid-1", "cid-1"), "tiles");
    expect(textOf(container)).toContain("Açılış ekranı kaydedildi.");
  });

  it("hides the card for personnel and a self-personnel login", async () => {
    mockAuth.user = { id: "uid-1", email: "a@b.c", name: "Ali", role: "personel", phone: "" };
    await show();
    expect(findByTestId(container, "settings-start-page")).toBeNull();
    expect(findByTestId(container, "settings-printers")).toBeTruthy();
    expect(findByTestId(container, "settings-profile")).toBeTruthy();

    mockAuth.user = { id: "uid-1", email: "a@b.c", name: "Ayşe", role: "admin", phone: "", employee_id: "emp-1" };
    await act(async () => { root.render(React.createElement(SettingsScreen)); });
    await flush();
    expect(findByTestId(container, "settings-start-page")).toBeNull();
  });
});
