import "../../test/domSetup";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { homeStartPageKey } from "../../utils/homeStartPage";
import { HomeScreen } from "../HomeScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const WIDTH = 400;

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/ManagerApprovalsPanel", () => ({ ManagerApprovalsPanel: () => null }));
jest.mock("../../components/StaffMessagesPanel", () => ({ StaffMessagesPanel: () => null }));
jest.mock("../../components/NotificationsPanel", () => ({ NotificationsPanel: () => null }));

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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
      }, props.children);
    };
  const ScrollView = ReactLib.forwardRef(function ScrollView(
    props: {
      testID?: string;
      children?: React.ReactNode;
      contentOffset?: { x?: number; y?: number };
      horizontal?: boolean;
      pagingEnabled?: boolean;
      showsHorizontalScrollIndicator?: boolean;
      onMomentumScrollEnd?: (event: { nativeEvent?: { contentOffset?: { x?: number } } }) => void;
    },
    ref: React.Ref<{ scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void }>,
  ) {
    const api = ReactLib.useRef({ scrollTo: jest.fn() });
    ReactLib.useImperativeHandle(ref, () => api.current);
    return ReactLib.createElement("div", {
      "data-testid": props.testID,
      ref: (node: {
        scrollTo?: jest.Mock;
        __pager?: {
          contentOffset?: { x?: number; y?: number };
          horizontal?: boolean;
          pagingEnabled?: boolean;
          showsHorizontalScrollIndicator?: boolean;
          onMomentumScrollEnd?: (event: { nativeEvent?: { contentOffset?: { x?: number } } }) => void;
        };
      } | null) => {
        if (!node) return;
        node.scrollTo = api.current.scrollTo;
        node.__pager = {
          contentOffset: props.contentOffset,
          horizontal: props.horizontal,
          pagingEnabled: props.pagingEnabled,
          showsHorizontalScrollIndicator: props.showsHorizontalScrollIndicator,
          onMomentumScrollEnd: props.onMomentumScrollEnd,
        };
      },
    }, props.children);
  });
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    Image: host("img"),
    ScrollView,
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    AppState: { addEventListener: () => ({ remove() { /* no-op */ } }) },
    useWindowDimensions: () => ({ width: WIDTH, height: 800, scale: 2, fontScale: 1 }),
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "cid-1",
  baseUrl: "https://api.test",
  license: { modules: {} },
  activeCompany: { id: "cid-1", name: "Nexus" },
  user: { id: "uid-1", name: "Mustafa Yılmaz", email: "m@tamkobi.com", role: "admin" } as {
    id: string;
    name: string;
    email: string;
    role: string;
    employee_id?: string;
  },
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "hata",
}));

jest.mock("../../auth/BadgeContext", () => {
  const refresh = jest.fn(async () => undefined);
  return { useBadges: () => ({ live: {}, unread: 0, refresh }) };
});

jest.mock("../../api/client", () => ({
  get: jest.fn(async () => ({})),
  post: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: () => "",
}));

const overview = {
  date: "2026-10-18",
  tasks: [{ key: "pending_orders", label: "Onay bekleyen sipariş", count: 1, path: "/orders" }],
  collections: { total: 10, overdue: 2, not_due: 8 },
  payments: { total: 4, overdue: 1, not_due: 3 },
  drafts: { count: 0, total: 0 },
  invoices: { outgoing: { month: 2, week: 0, today: 0 }, incoming: { month: 0, week: 0, today: 0 } },
  vat: { payable: 0, days_left: 3, month: "2026-10", calculated: 0, deductible: 0 },
};

let startRaw: string | null = null;

function paths() {
  return (get as jest.Mock).mock.calls.map((call) => String(call[1]));
}

function storageKeys() {
  return (AsyncStorage.getItem as jest.Mock).mock.calls.map((call) => String(call[0]));
}

async function flush() {
  for (let i = 0; i < 10; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("HomeScreen start page", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  beforeEach(() => {
    startRaw = null;
    mockAuth.user = { id: "uid-1", name: "Mustafa Yılmaz", email: "m@tamkobi.com", role: "admin" };
    mockAuth.companyId = "cid-1";
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => (
      String(key).includes("start_page") ? startRaw : null
    ));
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("/dashboard/manager-summary")) {
        return { production: { open: 1, late: 0, completed_this_month: 1 }, projects: { active: 1, overdue: 0, budget_total: 10, cost_total: 5 } };
      }
      if (String(path).includes("/dashboard/stats")) {
        return { monthly_sales: 1000, today_sales: 20, total_bank_balance: 5, total_receivables: 0, total_payables: 0, net_profit: 1, monthly_expenses: 1, low_stock_count: 0, low_stock_products: [] };
      }
      if (String(path).includes("/dashboard/overview")) return overview;
      if (String(path).includes("/notifications")) return [];
      return {};
    });
    (get as jest.Mock).mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show() {
    await act(async () => { root.render(React.createElement(HomeScreen)); });
    await flush();
  }

  it("opens page 0 Genel Bakış when the manager has no saved start page", async () => {
    await show();
    const pager = findByTestId(container, "home-pager");
    expect(pager).toBeTruthy();
    expect(pager.__pager?.horizontal).toBe(true);
    expect(pager.__pager?.pagingEnabled).toBe(true);
    expect(pager.__pager?.showsHorizontalScrollIndicator).toBe(false);
    expect(pager.__pager?.contentOffset?.x).toBe(0);
    expect(pager.scrollTo).toHaveBeenCalledWith({ x: 0, y: 0, animated: false });
    expect(findByTestId(container, "home-overview")).toBeTruthy();
    expect(textOf(container)).toContain("Merhaba, Mustafa");
    expect(reactProps(findByTestId(container, "home-pager-dot-0"))?.style?.width).toBe(16);
    expect(storageKeys().some((key) => key === homeStartPageKey("uid-1", "cid-1"))).toBe(true);
    expect(paths().some((path) => path.includes("manager-summary"))).toBe(true);
  });

  it("opens page 1 at x = width when the saved start page is tiles", async () => {
    startRaw = "tiles";
    await show();
    const pager = findByTestId(container, "home-pager");
    expect(pager.__pager?.contentOffset?.x).toBe(WIDTH);
    expect(pager.scrollTo).toHaveBeenCalledWith({ x: WIDTH, y: 0, animated: false });
    expect(findByTestId(container, "home-page-tiles")).toBeTruthy();
    expect(findByTestId(container, "home-quick-menu")).toBeTruthy();
    expect(reactProps(findByTestId(container, "home-pager-dot-1"))?.style?.width).toBe(16);
    await act(async () => {
      pager.__pager?.onMomentumScrollEnd?.({ nativeEvent: { contentOffset: { x: 0 } } });
    });
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it("keeps the current screen for personnel and self-personnel without reading the start page", async () => {
    mockAuth.user = { id: "uid-1", name: "Ali", email: "a@b.c", role: "personel" };
    await show();
    expect(findByTestId(container, "home-pager")).toBeNull();
    expect(findByTestId(container, "home-quick-menu")).toBeTruthy();
    expect(storageKeys().some((key) => key.includes("start_page"))).toBe(false);
    expect(paths().some((path) => path.includes("manager-summary"))).toBe(false);

    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    (get as jest.Mock).mockClear();
    (AsyncStorage.getItem as jest.Mock).mockClear();
    mockAuth.user = { id: "uid-1", name: "Ayşe", email: "a@b.c", role: "admin", employee_id: "emp-1" };
    await show();
    expect(findByTestId(container, "home-pager")).toBeNull();
    expect(findByTestId(container, "home-quick-menu")).toBeTruthy();
    expect(storageKeys().some((key) => key.includes("start_page"))).toBe(false);
    expect(paths().some((path) => path.includes("manager-summary"))).toBe(false);
  });
});
