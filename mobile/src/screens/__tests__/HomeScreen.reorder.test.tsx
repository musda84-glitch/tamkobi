import "../../test/domSetup";
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator } from "../../test/domSetup";
import { DEFAULT_OVERVIEW_SECTION_ORDER } from "../../components/home/overviewSections";
import { HomeScreen } from "../HomeScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const WIDTH = 400;
const backHandlers: Array<() => boolean | undefined> = [];

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
jest.mock("../../components/NotificationsPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    NotificationsPanel: () => ReactLib.createElement("div", { "data-testid": "home-notifications-panel" }),
  };
});

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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, { "data-testid": props.testID, style: flatten(props.style) }, props.children);
    };
  const ScrollView = ReactLib.forwardRef(function ScrollView(
    props: {
      testID?: string;
      children?: React.ReactNode;
      contentOffset?: { x?: number; y?: number };
      horizontal?: boolean;
      pagingEnabled?: boolean;
      scrollEnabled?: boolean;
      refreshControl?: unknown;
      showsHorizontalScrollIndicator?: boolean;
      onMomentumScrollEnd?: (event: { nativeEvent?: { contentOffset?: { x?: number } } }) => void;
    },
    ref: React.Ref<{ scrollTo: (opts: { x?: number; y?: number; animated?: boolean }) => void }>,
  ) {
    const api = ReactLib.useRef({ scrollTo: jest.fn() });
    ReactLib.useImperativeHandle(ref, () => api.current);
    return ReactLib.createElement("div", {
      "data-testid": props.testID,
      "data-scroll-enabled": props.scrollEnabled === false ? "false" : "true",
      "data-refresh": props.refreshControl ? "yes" : "no",
      ref: (node: { __pager?: { scrollEnabled?: boolean; refreshControl?: boolean } } | null) => {
        if (!node) return;
        node.__pager = {
          scrollEnabled: props.scrollEnabled !== false,
          refreshControl: Boolean(props.refreshControl),
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
    BackHandler: {
      addEventListener: (_event: string, handler: () => boolean | undefined) => {
        backHandlers.push(handler);
        return {
          remove() {
            const index = backHandlers.indexOf(handler);
            if (index >= 0) backHandlers.splice(index, 1);
          },
        };
      },
      exitApp() { /* no-op */ },
    },
    View: host("div"),
    Text: host("span"),
    Pressable(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      onLongPress?: () => void;
      disabled?: boolean;
    }) {
      return ReactLib.createElement("button", {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        ...(typeof props.onLongPress === "function" ? { onLongPress: props.onLongPress } : {}),
        disabled: props.disabled,
      }, props.children);
    },
    Image: host("img"),
    ScrollView,
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => ReactLib.createElement("div", { "data-testid": "refresh-control" }),
    AppState: { addEventListener: () => ({ remove() { /* no-op */ } }) },
    PanResponder: { create: () => ({ panHandlers: {} }) },
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

let orderRaw: string | null = null;
let quickOrderRaw: string | null = null;
let hiddenRaw: string | null = null;

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

describe("HomeScreen reorder", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  beforeEach(() => {
    orderRaw = null;
    quickOrderRaw = null;
    hiddenRaw = null;
    backHandlers.splice(0, backHandlers.length);
    mockAuth.user = { id: "uid-1", name: "Mustafa Yılmaz", email: "m@tamkobi.com", role: "admin" };
    mockAuth.companyId = "cid-1";
    (AsyncStorage.getItem as jest.Mock).mockImplementation(async (key: string) => {
      const name = String(key);
      if (name.includes("overview_order")) return orderRaw;
      if (name.includes("quick_order")) return quickOrderRaw;
      if (name.includes("quick_hidden")) return hiddenRaw;
      return null;
    });
    (AsyncStorage.getItem as jest.Mock).mockClear();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    (AsyncStorage.removeItem as jest.Mock).mockClear();
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

  async function openReorder() {
    await show();
    await act(async () => {
      reactProps(findByTestId(container, "home-overview-section-today"))?.onLongPress?.();
    });
  }

  it("opens reorder on long press and locks the pager", async () => {
    await openReorder();
    expect(findByTestId(container, "home-overview-reorder")).toBeTruthy();
    const pager = findByTestId(container, "home-pager");
    expect(pager.getAttribute("data-scroll-enabled")).toBe("false");
    expect(pager.__pager?.scrollEnabled).toBe(false);
    expect(collectAttr(findByTestId(container, "home-page-overview"), "data-refresh")).not.toContain("yes");
  });

  it("saves month at the top on Bitti and restores paging", async () => {
    await openReorder();
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-up-month"))?.onClick?.(); });
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-up-month"))?.onClick?.(); });
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-done"))?.onClick?.(); });
    await flush();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      "tamkobi.home.overview_order.v1:uid-1:cid-1",
      JSON.stringify(["month", "today", "panels", "stock", "production", "projects"]),
    );
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(sectionIds(container)[0]).toBe("home-overview-section-month");
    expect(findByTestId(container, "home-pager").getAttribute("data-scroll-enabled")).toBe("true");
  });

  it("drops a draft on Vazgeç without writing", async () => {
    await openReorder();
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-up-month"))?.onClick?.(); });
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-cancel"))?.onClick?.(); });
    await flush();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(sectionIds(container)[0]).toBe("home-overview-section-today");
  });

  it("resets a saved order and disables the reset button", async () => {
    orderRaw = JSON.stringify(["projects", "stock", "today", "panels", "month", "production"]);
    await openReorder();
    const reset = findByTestId(container, "home-overview-reorder-reset");
    expect(reactProps(reset)?.disabled).toBe(false);
    expect(reorderRowIds(container)).toEqual([
      "home-overview-reorder-row-projects",
      "home-overview-reorder-row-stock",
      "home-overview-reorder-row-today",
      "home-overview-reorder-row-panels",
      "home-overview-reorder-row-month",
      "home-overview-reorder-row-production",
    ]);
    await act(async () => { reactProps(reset)?.onClick?.(); });
    await flush();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("tamkobi.home.overview_order.v1:uid-1:cid-1");
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(findByTestId(container, "home-overview-reorder")).toBeTruthy();
    expect(reorderRowIds(container)).toEqual(DEFAULT_OVERVIEW_SECTION_ORDER.map((key) => `home-overview-reorder-row-${key}`));
    expect(reactProps(findByTestId(container, "home-overview-reorder-reset"))?.disabled).toBe(true);
  });

  it("cancels with the Android back handler and when the company changes", async () => {
    await openReorder();
    expect(backHandlers).toHaveLength(1);
    let handled = false;
    await act(async () => { handled = backHandlers[0]() === true; });
    expect(handled).toBe(true);
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(backHandlers).toHaveLength(0);

    await act(async () => {
      reactProps(findByTestId(container, "home-overview-section-month"))?.onLongPress?.();
    });
    await act(async () => { reactProps(findByTestId(container, "home-overview-reorder-up-month"))?.onClick?.(); });
    mockAuth.companyId = "cid-2";
    await act(async () => { root.render(React.createElement(HomeScreen)); });
    await flush();
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
    expect(sectionIds(container)[0]).toBe("home-overview-section-today");
  });

  it("has no reorder surface for personnel", async () => {
    mockAuth.user = { id: "uid-1", name: "Ali", email: "a@b.c", role: "personel" };
    await show();
    expect(findByTestId(container, "home-pager")).toBeNull();
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(findByTestId(container, "home-overview-section-today")).toBeNull();
    expect(findByTestId(container, "home-tiles-editor")).toBeNull();
    expect(backHandlers).toHaveLength(0);
  });

  it("keeps hide-only long press when the home is not paged", async () => {
    const { Alert } = require("react-native") as { Alert: { alert: jest.Mock } };
    mockAuth.user = { id: "uid-1", name: "Mustafa Yılmaz", email: "m@tamkobi.com", role: "admin", employee_id: "emp-1" };
    await show();
    expect(findByTestId(container, "home-pager")).toBeNull();
    Alert.alert.mockClear();
    const tile = findByTestId(container, "home-quick-invoices");
    expect(tile).toBeTruthy();
    await act(async () => { reactProps(tile)?.onLongPress?.(); });
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(findByTestId(container, "home-tiles-editor")).toBeNull();
  });

  it("saves page-2 tile ids from the long-press menu without touching page 1", async () => {
    const { Alert } = require("react-native") as { Alert: { alert: jest.Mock } };
    quickOrderRaw = JSON.stringify(["contacts", "invoices"]);
    await show();
    const page = findByTestId(container, "home-page-tiles");
    expect(quickIds(page)[0]).toBe("home-quick-contacts");
    expect(quickIds(page)[1]).toBe("home-quick-invoices");
    expect(findByTestId(container, "home-overview-section-today")).toBeTruthy();
    await act(async () => { reactProps(findByTestId(page, "home-quick-contacts"))?.onLongPress?.(); });
    const call = Alert.alert.mock.calls.at(-1);
    expect(call?.[0]).toBe("Karo gizlensin mi?");
    const buttons = call?.[2] as { text?: string; onPress?: () => void }[];
    expect(buttons.map((button) => button.text)).toEqual(["Gizle", "Yerini değiştir", "Vazgeç"]);
    await act(async () => { buttons[1].onPress?.(); });
    expect(findByTestId(container, "home-tiles-editor")).toBeTruthy();
    expect(findByTestId(container, "home-overview-reorder")).toBeNull();
    expect(findByTestId(container, "home-overview-section-today")).toBeTruthy();
    expect(findByTestId(container, "home-pager").getAttribute("data-scroll-enabled")).toBe("false");
    expect(findByTestId(container, "home-quick-refresh")).toBeNull();
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await act(async () => { reactProps(findByTestId(container, "home-tiles-editor-done"))?.onClick?.(); });
    await flush();
    const write = (AsyncStorage.setItem as jest.Mock).mock.calls.find((args) => String(args[0]).includes("quick_order"));
    expect(write?.[0]).toBe("tamkobi.home.quick_order.v1:uid-1:cid-1");
    const saved = JSON.parse(String(write?.[1])) as string[];
    expect(saved.slice(0, 2)).toEqual(["contacts", "invoices"]);
    expect(saved).not.toContain("notifications");
    expect(saved.every((id) => typeof id === "string" && !id.includes("@"))).toBe(true);
    expect(findByTestId(container, "home-tiles-editor")).toBeNull();
    expect(findByTestId(container, "home-pager").getAttribute("data-scroll-enabled")).toBe("true");
  });

  it("hides from the menu without rewriting tile order", async () => {
    const { Alert } = require("react-native") as { Alert: { alert: jest.Mock } };
    await show();
    const page = findByTestId(container, "home-page-tiles");
    await act(async () => { reactProps(findByTestId(page, "home-quick-invoices"))?.onLongPress?.(); });
    const buttons = Alert.alert.mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await act(async () => { buttons[0].onPress?.(); });
    await flush();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("tamkobi.home.quick_hidden.v1", JSON.stringify(["invoices"]));
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.some((args) => String(args[0]).includes("quick_order"))).toBe(false);
    expect(findByTestId(container, "home-page-tiles") && findByTestId(findByTestId(container, "home-page-tiles"), "home-quick-invoices")).toBeNull();
  });

  it("shows a hidden tile from edit mode and resets order without clearing hidden ids", async () => {
    const { Alert } = require("react-native") as { Alert: { alert: jest.Mock } };
    hiddenRaw = JSON.stringify(["vehicles"]);
    quickOrderRaw = JSON.stringify(["vehicles", "invoices", "contacts"]);
    await show();
    const page = findByTestId(container, "home-page-tiles");
    expect(findByTestId(page, "home-quick-vehicles")).toBeNull();
    expect(quickIds(page)[0]).toBe("home-quick-invoices");
    await act(async () => { reactProps(findByTestId(page, "home-quick-invoices"))?.onLongPress?.(); });
    const buttons = Alert.alert.mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
    await act(async () => { buttons[1].onPress?.(); });
    const slot = findByTestId(container, "home-tiles-editor-slot-vehicles");
    expect(reactProps(slot)?.style?.opacity).toBe(0.4);
    (AsyncStorage.setItem as jest.Mock).mockClear();
    await act(async () => { reactProps(findByTestId(container, "home-tiles-show-vehicles"))?.onClick?.(); });
    await flush();
    expect(AsyncStorage.setItem).toHaveBeenCalledWith("tamkobi.home.quick_hidden.v1", JSON.stringify([]));
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.some((args) => String(args[0]).includes("quick_order"))).toBe(false);
    expect(reactProps(findByTestId(container, "home-tiles-editor-slot-vehicles"))?.style?.opacity).toBe(1);

    (AsyncStorage.removeItem as jest.Mock).mockClear();
    await act(async () => { reactProps(findByTestId(container, "home-tiles-editor-reset"))?.onClick?.(); });
    await flush();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith("tamkobi.home.quick_order.v1:uid-1:cid-1");
    expect(AsyncStorage.removeItem).not.toHaveBeenCalledWith("tamkobi.home.quick_hidden.v1");
    expect(findByTestId(container, "home-tiles-editor")).toBeTruthy();
    const slots = collectIds(container).filter((id) => id.startsWith("home-tiles-editor-slot-"));
    expect(slots[0]).toBe("home-tiles-editor-slot-invoices");
    expect(reactProps(findByTestId(container, "home-tiles-editor-reset"))?.disabled).toBe(true);
  });

  it("drops an unsaved tile draft on the Android back handler", async () => {
    const { Alert } = require("react-native") as { Alert: { alert: jest.Mock } };
    await show();
    const page = findByTestId(container, "home-page-tiles");
    await act(async () => { reactProps(findByTestId(page, "home-quick-contacts"))?.onLongPress?.(); });
    const buttons = Alert.alert.mock.calls.at(-1)?.[2] as { onPress?: () => void }[];
    await act(async () => { buttons[1].onPress?.(); });
    expect(backHandlers).toHaveLength(1);
    let handled = false;
    await act(async () => { handled = backHandlers[0]() === true; });
    expect(handled).toBe(true);
    expect(findByTestId(container, "home-tiles-editor")).toBeNull();
    expect((AsyncStorage.setItem as jest.Mock).mock.calls.some((args) => String(args[0]).includes("quick_order"))).toBe(false);
  });
});

function quickIds(node: unknown): string[] {
  return collectIds(node).filter((id) => /^home-quick-(?!menu$|refresh$)/.test(id) && !id.endsWith("-badge"));
}

function sectionIds(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    const el = current as { getAttribute?: (name: string) => string | null; childNodes?: Iterable<unknown> };
    const id = el.getAttribute?.("data-testid");
    if (typeof id === "string" && id.startsWith("home-overview-section-")) out.push(id);
    for (const child of el.childNodes || []) walk(child);
  };
  walk(node);
  return out;
}

function reorderRowIds(node: unknown): string[] {
  return collectIds(node).filter((id) => id.startsWith("home-overview-reorder-row-"));
}

function collectIds(node: unknown): string[] {
  const out: string[] = [];
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    const el = current as { getAttribute?: (name: string) => string | null; childNodes?: Iterable<unknown> };
    const id = el.getAttribute?.("data-testid");
    if (typeof id === "string") out.push(id);
    for (const child of el.childNodes || []) walk(child);
  };
  walk(node);
  return out;
}

function collectAttr(node: unknown, name: string): string[] {
  const out: string[] = [];
  const walk = (current: unknown) => {
    if (!current || typeof current !== "object") return;
    const el = current as { getAttribute?: (name: string) => string | null; childNodes?: Iterable<unknown> };
    const value = el.getAttribute?.(name);
    if (value) out.push(value);
    for (const child of el.childNodes || []) walk(child);
  };
  walk(node);
  return out;
}
