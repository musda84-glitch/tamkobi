import "../../test/domSetup";
import React, { act } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";
import { get, post } from "../../api/client";
import { ApiHttpError } from "../../api/errors";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { AtolyeScreen, shopfloorOperatorMemory } from "../AtolyeScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
  };
});

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-location", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    return style as Record<string, unknown>;
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      accessibilityState?: { selected?: boolean };
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        accessibilityState: props.accessibilityState,
        onClick: () => { if (!props.disabled) props.onPress?.(); },
      }, props.children);
    };
  const TextInput = Object.assign(
    (props: { testID?: string; value?: string }) => ReactLib.createElement("input", { "data-testid": props.testID, value: props.value ?? "" }),
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
    AppState: {
      addEventListener: (_name: string, handler: (state: string) => void) => {
        const bucket = ((globalThis as any).__atolyeAppState ||= []) as Array<(state: string) => void>;
        bucket.push(handler);
        return {
          remove() {
            const index = bucket.indexOf(handler);
            if (index >= 0) bucket.splice(index, 1);
          },
        };
      },
    },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Image: () => null,
    Switch: host("input"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput,
  };
});

const auth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  user: null as null | {
    id: string;
    name: string;
    role: string;
    account_type?: string;
    shopfloor_stations?: string[];
  },
  baseUrl: "https://api.test",
  can: () => true,
  addonOn: () => false,
  feature: () => false,
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => auth,
  apiErrorMessage: (err: unknown, fallback?: string) => {
    if (err && typeof err === "object" && typeof (err as { detail?: unknown }).detail === "string") {
      return (err as { detail: string }).detail;
    }
    return fallback || "İşlem başarısız.";
  },
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

const PIN = "5829";
const TOKEN = "sfop-token-9f3a7c";
const SESSION_ENDED = "Operatör oturumu sona erdi, yeniden PIN girin.";

const OPERATORS = [
  { operator_type: "employee", id: "e1", name: "Ali Usta", station: "Kesim", has_shopfloor_pin: true },
  { operator_type: "employee", id: "e2", name: "Veli Usta", station: "PVC", has_shopfloor_pin: true },
];

const WORK = [
  { id: "wo-ready", status: "ready", station: "Kesim", order_code: "A1", step_name: "Kesim", step_no: 1, step_count: 1, product_name: "Tabla" },
  { id: "wo-run", status: "in_progress", station: "Kesim", order_code: "A2", step_name: "Bant", step_no: 1, step_count: 1, product_name: "Kapak" },
];

let operators: unknown = OPERATORS;
let unlockMode = "ok";
let actionMode = "ok";
let me: { employee?: { full_name?: string }; tasks?: unknown[] } = { tasks: [] };

function futureExpiry(): string {
  return new Date(Date.now() + 60 * 60 * 1000).toISOString();
}

function installApi() {
  (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    const p = String(path);
    if (p.includes("shopfloor-operators")) return operators;
    if (p.includes("pause-policy")) return { allowed: true, phase: "mesai" };
    if (p.includes("/personnel/me")) return me;
    if (p.includes("shopfloor-settings")) return { group_same_station: false };
    if (p.includes("work-parks")) return { parks: [] };
    if (p.includes("/personnel/employees")) return [{ id: "hidden", full_name: "Gizli Personel" }];
    if (p.includes("/production/work-orders") && !p.includes("stations")) return WORK;
    return [];
  });
  (post as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    const p = String(path);
    if (p.includes("shopfloor-unlock")) {
      if (unlockMode === "401") {
        throw new ApiHttpError(401, "PIN hatalı", "PIN hatalı", { detail: "PIN hatalı", remaining_attempts: 2 });
      }
      if (unlockMode === "423") {
        throw new ApiHttpError(423, "12 dk sonra tekrar deneyin", "12 dk sonra tekrar deneyin", {
          detail: "12 dk sonra tekrar deneyin",
          remaining_attempts: 0,
        });
      }
      if (unlockMode === "429") {
        throw new ApiHttpError(429, "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.", "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.", {
          detail: "Çok fazla deneme. Lütfen daha sonra tekrar deneyin.",
        });
      }
      if (unlockMode === "expired") {
        return {
          operator_token: TOKEN,
          operator_name: "Ali Usta",
          operator_type: "employee",
          operator_id: "e1",
          expires_at: "2000-01-01T00:00:00.000Z",
        };
      }
      return {
        operator_token: TOKEN,
        operator_name: "Ali Usta",
        operator_type: "employee",
        operator_id: "e1",
        expires_at: futureExpiry(),
      };
    }
    if (actionMode === "401" || actionMode === "403") {
      const status = Number(actionMode);
      const detail = "Operatör oturumu geçersiz veya süresi doldu.";
      throw new ApiHttpError(status, detail, detail, { detail });
    }
    return { message: "ok" };
  });
}

function paths(): string[] {
  return (get as jest.Mock).mock.calls.map((call) => String(call[1]));
}

function posts(part: string): unknown[][] {
  return (post as jest.Mock).mock.calls.filter((call) => String(call[1]).includes(part));
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  delete g.__atolyeAppState;
  removeTestNavigator();
});

describe("AtolyeScreen operator PIN", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    operators = OPERATORS;
    unlockMode = "ok";
    actionMode = "ok";
    me = { employee: { full_name: "Başka Kişi" }, tasks: [] };
    auth.user = {
      id: "u-atolye",
      name: "Kesim Tablet",
      role: "production",
      account_type: "atolye",
      shopfloor_stations: ["Kesim"],
    };
    shopfloorOperatorMemory.clear();
    (globalThis as any).__atolyeAppState = [];
    (get as jest.Mock).mockReset();
    (post as jest.Mock).mockReset();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (SecureStore.setItemAsync as jest.Mock).mockClear();
    installApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    shopfloorOperatorMemory.clear();
  });

  async function settle() {
    for (let i = 0; i < 16; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  }

  async function renderScreen() {
    await act(async () => { root.render(React.createElement(AtolyeScreen)); });
    await settle();
  }

  async function clickId(id: string) {
    await act(async () => {
      const props = reactProps(findByTestId(container, id));
      if (!props || props.disabled) return;
      await props.onClick?.();
    });
  }

  async function enterPin(pin = PIN) {
    for (const digit of pin) {
      await clickId(`shopfloor-pin-key-${digit}`);
    }
    await settle();
  }

  async function login() {
    await clickId("shopfloor-operator-card-e1");
    expect(findByTestId(container, "shopfloor-pinpad")).toBeTruthy();
    await enterPin();
  }

  function expectHeader(part: string) {
    const call = posts(part)[0];
    expect(call).toBeTruthy();
    expect(call[2]).toEqual(expect.objectContaining({ operator_name: "Ali Usta" }));
    expect(call[4]).toEqual({ "X-Shopfloor-Operator": TOKEN });
    expect(JSON.stringify(call[2])).not.toContain("password");
  }

  it("lists shopfloor operators and signs actions with the operator token", async () => {
    await renderScreen();
    expect(paths().some((path) => path.includes("shopfloor-operators"))).toBe(true);
    expect(paths().some((path) => path.includes("/personnel/employees"))).toBe(false);
    expect(textOf(findByTestId(container, "shopfloor-atolye-account"))).toContain("Kesim Tablet · Atölye kullanıcısı");
    expect(findByTestId(container, "shopfloor-station-badge-Kesim")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-operator-card-e1"))).toContain("Ali Usta");
    expect(textOf(findByTestId(container, "shopfloor-operator-card-e1"))).toContain("Kesim");
    expect(textOf(findByTestId(container, "shopfloor-operator-card-e1"))).toContain("PIN tanımlı");
    expect(textOf(findByTestId(container, "shopfloor-operator-card-e2"))).toContain("Veli Usta");
    expect(textOf(container)).not.toContain("Başka Kişi");
    expect(textOf(container)).not.toContain("Gizli Personel");
    expect(findByTestId(container, "wo-need-operator-wo-ready")).toBeTruthy();

    await login();
    const unlock = posts("shopfloor-unlock")[0];
    expect(unlock[2]).toEqual({
      company_id: "co-1",
      operator_type: "employee",
      operator_id: "e1",
      pin: PIN,
    });
    expect(unlock[2]).not.toHaveProperty("password");
    expect(findByTestId(container, "shopfloor-pin-modal")).toBeNull();
    expect(findByTestId(container, "shopfloor-no-operator")).toBeNull();
    expect(textOf(findByTestId(container, "shopfloor-operator-chip"))).toContain("Ali Usta");
    expect(textOf(container)).not.toContain(PIN);
    expect(textOf(container)).not.toContain(TOKEN);
    expect(shopfloorOperatorMemory.get("co-1:u-atolye")?.token).toBe(TOKEN);

    await clickId("wo-start-wo-ready");
    await clickId("wo-pause-wo-run");
    await clickId("wo-finish-wo-run");
    await settle();
    await clickId("wo-finish-confirm");
    await settle();
    await clickId("wo-trash-wo-ready");
    await settle();
    await clickId("wo-trash-request-confirm");
    await settle();

    expectHeader("/start");
    expectHeader("/pause");
    expectHeader("/finish");
    expectHeader("trash-request");
    expect(get).toHaveBeenCalledWith(
      expect.anything(),
      "/production/work-orders/pause-policy",
      expect.objectContaining({ company_id: "co-1", operator_name: "Ali Usta" }),
    );
  });

  it("shows remaining attempts, lock and rate-limit copy", async () => {
    unlockMode = "401";
    await renderScreen();
    await login();
    expect(textOf(findByTestId(container, "shopfloor-pin-error"))).toContain("2 deneme hakkınız kaldı");
    expect(findByTestId(container, "shopfloor-pin-modal")).toBeTruthy();

    unlockMode = "423";
    await clickId("shopfloor-operator-card-e1");
    await enterPin();
    expect(textOf(findByTestId(container, "shopfloor-pin-error"))).toContain("12 dk sonra tekrar deneyin");
    expect(textOf(findByTestId(container, "shopfloor-pin-error"))).not.toContain("deneme hakkınız kaldı");

    unlockMode = "429";
    await enterPin();
    expect(textOf(findByTestId(container, "shopfloor-pin-error"))).toContain("Çok fazla deneme");
  });

  it("opens the picker and skips the action when the token is already expired", async () => {
    unlockMode = "expired";
    await renderScreen();
    await login();
    expect(textOf(container)).toContain(SESSION_ENDED);
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
    expect(findByTestId(container, "shopfloor-pin-modal")).toBeNull();
    expect(shopfloorOperatorMemory.size).toBe(0);
    expect(posts("/start")).toHaveLength(0);

    unlockMode = "ok";
    await login();
    const session = shopfloorOperatorMemory.get("co-1:u-atolye");
    expect(session).toBeTruthy();
    session!.expires_at = "2000-01-01T00:00:00.000Z";
    const before = (post as jest.Mock).mock.calls.length;
    await clickId("wo-start-wo-ready");
    await settle();
    const extra = (post as jest.Mock).mock.calls.slice(before);
    expect(extra.some((call) => String(call[1]).includes("/start"))).toBe(false);
    expect(textOf(container)).toContain(SESSION_ENDED);
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
  });

  it.each(["401", "403"])("clears the session when an action returns %s", async (status) => {
    await renderScreen();
    await login();
    actionMode = status;
    await clickId("wo-start-wo-ready");
    await settle();
    expect(posts("/start")).toHaveLength(1);
    expect(posts("/start")[0][4]).toEqual({ "X-Shopfloor-Operator": TOKEN });
    expect(textOf(container)).toContain(SESSION_ENDED);
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
    expect(shopfloorOperatorMemory.size).toBe(0);
  });

  it("drops the session when the app becomes active after expiry", async () => {
    await renderScreen();
    await login();
    const session = shopfloorOperatorMemory.get("co-1:u-atolye");
    session!.expires_at = "2000-01-01T00:00:00.000Z";
    const bucket = (globalThis as any).__atolyeAppState as Array<(state: string) => void>;
    await act(async () => {
      bucket.forEach((fn) => fn("active"));
    });
    await settle();
    expect(textOf(container)).toContain(SESSION_ENDED);
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
    expect(posts("/start")).toHaveLength(0);
  });

  it("shows the empty operator message and değiştir clears the session", async () => {
    operators = [];
    await renderScreen();
    expect(textOf(findByTestId(container, "shopfloor-operators-empty"))).toContain("PIN tanımlı ve mesaiye giriş yapmış operatör yok");

    operators = OPERATORS;
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderScreen();
    await login();
    await clickId("shopfloor-operator-change");
    await settle();
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
    expect(shopfloorOperatorMemory.size).toBe(0);
    expect(textOf(container)).not.toContain(SESSION_ENDED);
    const before = (post as jest.Mock).mock.calls.length;
    await clickId("wo-start-wo-ready");
    expect((post as jest.Mock).mock.calls.slice(before).some((call) => String(call[1]).includes("/start"))).toBe(false);
  });

  it("does not ask a standard user or a manager for a PIN", async () => {
    auth.user = { id: "u-std", name: "Hesap Adı", role: "user", account_type: "standard" };
    me = { employee: { full_name: "Ali Usta" }, tasks: [] };
    await renderScreen();
    expect(paths().some((path) => path.includes("shopfloor-operators"))).toBe(false);
    expect(posts("shopfloor-unlock")).toHaveLength(0);
    expect(findByTestId(container, "shopfloor-no-operator")).toBeNull();
    expect(findByTestId(container, "shopfloor-pinpad")).toBeNull();
    expect(findByTestId(container, "shopfloor-atolye-banner")).toBeNull();
    expect(textOf(findByTestId(container, "shopfloor-operator-chip"))).toContain("Operatör: Ali Usta");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
    expect(findByTestId(container, "wo-need-operator-wo-ready")).toBeNull();
    await clickId("wo-start-wo-ready");
    const start = posts("/start")[0];
    expect(start).toHaveLength(3);
    expect(start[2]).toEqual(expect.objectContaining({ operator_name: "Ali Usta" }));
    expect(JSON.stringify(start)).not.toContain("X-Shopfloor-Operator");

    auth.user = { id: "u-mgr", name: "Ayşe Yönetici", role: "admin", account_type: "standard", shopfloor_stations: ["Kesim"] };
    me = { tasks: [] };
    (get as jest.Mock).mockClear();
    (post as jest.Mock).mockClear();
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderScreen();
    expect(paths().some((path) => path.includes("shopfloor-operators"))).toBe(false);
    expect(posts("shopfloor-unlock")).toHaveLength(0);
    expect(findByTestId(container, "shopfloor-pinpad")).toBeNull();
    expect(findByTestId(container, "shopfloor-operator")).toBeNull();
    expect(textOf(findByTestId(container, "shopfloor-operator-chip"))).toContain("Operatör: Ayşe Yönetici");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
    await clickId("wo-start-wo-ready");
    const managerStart = posts("/start")[0];
    expect(managerStart).toHaveLength(3);
    expect(managerStart[2]).toEqual(expect.objectContaining({ operator_name: "Ayşe Yönetici" }));
  });

  it("does not log or persist the PIN or operator token", async () => {
    const log = jest.spyOn(console, "log").mockImplementation(() => {});
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      await renderScreen();
      await login();
      await clickId("wo-start-wo-ready");
      await settle();
      const blobs = [log, warn, error].map((spy) => JSON.stringify(spy.mock.calls));
      for (const blob of blobs) {
        expect(blob).not.toContain(PIN);
        expect(blob).not.toContain(TOKEN);
      }
      const stored = JSON.stringify([
        ...(AsyncStorage.setItem as jest.Mock).mock.calls,
        ...(SecureStore.setItemAsync as jest.Mock).mock.calls,
      ]);
      expect(stored).not.toContain(PIN);
      expect(stored).not.toContain(TOKEN);
      expect(stored).not.toContain("nx_sf_op");
      expect(stored).not.toContain("shopfloor-operator");
      expect(textOf(container)).not.toContain(PIN);
      expect(textOf(container)).not.toContain(TOKEN);
    } finally {
      log.mockRestore();
      warn.mockRestore();
      error.mockRestore();
    }
  });
});
