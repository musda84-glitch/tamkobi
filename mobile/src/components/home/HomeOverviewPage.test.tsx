import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { DashboardStats, ManagerSummary, Overview, User } from "../../types";
import { salesChangeText } from "../../utils/dashboard";
import { fmtMoney } from "../../utils/money";
import { goHref } from "../../nav";
import type { QuickTile } from "../../utils/quickMenu";
import { HomeOverviewPage } from "./HomeOverviewPage";
import { DEFAULT_OVERVIEW_SECTION_ORDER, type OverviewSectionKey } from "./overviewSections";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("../../nav", () => ({ goHref: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock("../ManagerApprovalsPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { ManagerApprovalsPanel: () => ReactLib.createElement("div", { "data-testid": "home-approvals" }) };
});
jest.mock("../StaffMessagesPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { StaffMessagesPanel: () => ReactLib.createElement("div", { "data-testid": "home-messages-panel" }) };
});
jest.mock("../NotificationsPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { NotificationsPanel: () => ReactLib.createElement("div", { "data-testid": "home-notifications-panel" }) };
});

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
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
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    View: host("div"),
    Text: host("span"),
    Pressable(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      onLongPress?: () => void;
      delayLongPress?: number;
      disabled?: boolean;
    }) {
      return ReactLib.createElement("button", {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        ...(typeof props.onLongPress === "function" ? { onLongPress: props.onLongPress } : {}),
        ...(typeof props.delayLongPress === "number" ? { delayLongPress: props.delayLongPress } : {}),
        disabled: props.disabled,
      }, props.children);
    },
    Image: host("img"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

const admin = { id: "uid-1", name: "Mustafa Yılmaz", email: "m@tamkobi.com", role: "admin" } as User;

const products = [1, 2, 3, 4, 5, 6].map((n) => ({
  id: `p${n}`,
  name: `Ürün ${n}`,
  stock_quantity: n,
  min_stock_alert: 10,
}));

const stats: DashboardStats = {
  monthly_sales: 10000,
  sales_change_pct: 12.5,
  today_sales: 1250,
  total_bank_balance: 4000,
  total_receivables: 2500,
  total_payables: 800,
  net_profit: 6000,
  monthly_expenses: 4000,
  low_stock_count: 6,
  low_stock_products: products,
};

const overview = {
  date: "2026-10-18",
  tasks: [
    { key: "pending_orders", label: "Onay bekleyen sipariş", count: 2, path: "/orders" },
    { key: "overdue", label: "Vadesi geçmiş tahsilat", count: 1, path: "/invoices" },
    { key: "drafts", label: "Taslak fatura", count: 3, path: "/invoices" },
    { key: "critical_stock", label: "Kritik stok", count: 4, path: "/stock" },
  ],
  collections: { total: 500, overdue: 120, not_due: 380 },
  payments: { total: 200, overdue: 40, not_due: 160 },
  drafts: { count: 3, total: 0 },
  invoices: { outgoing: { month: 6, week: 1, today: 1 }, incoming: { month: 0, week: 0, today: 0 } },
  vat: { month: "2026-10", calculated: 0, deductible: 0, payable: 0, days_left: 8 },
} as Overview;

const manager: ManagerSummary = {
  production: { open: 2, late: 1, completed_this_month: 3 },
  projects: { active: 7, overdue: 2, budget_total: 300, cost_total: 150 },
};

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

async function renderPage(props: Partial<React.ComponentProps<typeof HomeOverviewPage>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(HomeOverviewPage, {
      userName: admin.name,
      companyName: "Nexus",
      user: admin,
      stats,
      overview,
      manager,
      showApprovals: false,
      client: { baseUrl: "https://api.test", token: "tok" },
      companyId: "cid-1",
      onBadgesChanged: () => {},
      showMessages: false,
      notifications: null,
      notes: [],
      clearingNotes: false,
      onOpenAllNotes: () => {},
      onOpenNote: () => {},
      onDeleteNote: () => {},
      onClearNotes: () => {},
      onMarkAllRead: () => {},
      ...props,
    }));
  });
  return {
    container,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

describe("HomeOverviewPage", () => {
  it("shows ciro, today, tasks, kpis, bars, the first five stock rows, production and projects", async () => {
    const view = await renderPage();
    const text = textOf(view.container);
    expect(text).toContain("Merhaba, Mustafa");
    expect(text).toContain("Nexus");
    expect(text).toContain(fmtMoney(10000));
    expect(text).toContain("6 fatura");
    expect(text).toContain(salesChangeText(12.5));
    expect(textOf(findByTestId(view.container, "home-overview-today"))).toBe(`Bugün ${fmtMoney(1250)}`);
    expect(text).toContain("Onay bekleyen sipariş");
    expect(text).toContain("Vadesi geçmiş tahsilat");
    expect(text).toContain("Taslak fatura");
    expect(text).toContain("Kritik stok");
    expect(text).toContain(`Tahsil edilecek · ${fmtMoney(2500)}`);
    expect(textOf(findByTestId(view.container, "home-overview-kpi-bank"))).toContain(fmtMoney(4000));
    expect(textOf(findByTestId(view.container, "home-overview-kpi-recv"))).toContain(fmtMoney(2500));
    expect(textOf(findByTestId(view.container, "home-overview-kpi-pay"))).toContain(fmtMoney(800));
    const profit = textOf(findByTestId(view.container, "home-overview-kpi-profit"));
    expect(profit).toContain(fmtMoney(6000));
    expect(profit).toContain(`Gider ${fmtMoney(4000)}`);
    const collections = textOf(findByTestId(view.container, "home-overview-collections"));
    expect(collections).toContain(`Gecikmiş ${fmtMoney(120)}`);
    expect(collections).toContain(`Vadesi gelmemiş ${fmtMoney(380)}`);
    const payments = textOf(findByTestId(view.container, "home-overview-payments"));
    expect(payments).toContain(`Gecikmiş ${fmtMoney(40)}`);
    expect(payments).toContain(`Vadesi gelmemiş ${fmtMoney(160)}`);
    const stock = textOf(findByTestId(view.container, "home-overview-stock"));
    expect(stock).toContain("Kritik stok · 6");
    expect(stock).toContain("Tümü ›");
    for (let n = 1; n <= 5; n += 1) expect(stock).toContain(`Ürün ${n}`);
    expect(stock).not.toContain("Ürün 6");
    const manager = findByTestId(view.container, "home-overview-manager");
    expect(reactProps(manager)?.style?.flexDirection).toBe("column");
    expect(reactProps(manager)?.style?.flexDirection).not.toBe("row");
    const productionEl = findByTestId(view.container, "home-overview-production");
    const projectsEl = findByTestId(view.container, "home-overview-projects");
    const productionSection = findByTestId(manager, "home-overview-section-production");
    const projectsSection = findByTestId(manager, "home-overview-section-projects");
    expect(productionSection.parentNode).toBe(manager);
    expect(projectsSection.parentNode).toBe(manager);
    expect(productionEl.parentNode).toBe(productionSection);
    expect(projectsEl.parentNode).toBe(projectsSection);
    expect(reactProps(productionEl)?.style?.width).toBe("100%");
    expect(reactProps(projectsEl)?.style?.width).toBe("100%");
    expect(reactProps(productionEl)?.style?.flex).not.toBe(1);
    expect(reactProps(projectsEl)?.style?.flex).not.toBe(1);
    const production = textOf(productionEl);
    expect(production).toContain("AÇIK");
    expect(production).toContain("GECİKEN");
    expect(production).toContain("BU AY BİTEN");
    expect(production).toContain("2");
    expect(production).toContain("1");
    expect(production).toContain("3");
    const projects = textOf(projectsEl);
    expect(projects).toContain("AKTİF");
    expect(projects).toContain("GECİKEN");
    expect(projects).toContain("BÜTÇE");
    expect(projects).toContain("7");
    expect(projects).toContain("2");
    expect(textOf(findByTestId(view.container, "home-overview-budget"))).toBe("BÜTÇE%50");

    await act(async () => { reactProps(findByTestId(view.container, "home-overview-task-pending_orders"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/orders");
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-task-critical_stock"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/stok");
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-stock-all"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/stok");
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-production"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/production");
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-projects"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/projects");
    await view.unmount();
  });

  it("hides production and projects when the summary is empty", async () => {
    const view = await renderPage({ manager: {} });
    expect(findByTestId(view.container, "home-overview-production")).toBeNull();
    expect(findByTestId(view.container, "home-overview-projects")).toBeNull();
    await view.unmount();
  });

  it("shows an em dash when a field is missing", async () => {
    const view = await renderPage({
      stats: { monthly_sales: 1000 },
      overview: {
        ...overview,
        tasks: [],
        collections: {} as Overview["collections"],
        payments: {} as Overview["payments"],
        invoices: { outgoing: {}, incoming: {} } as Overview["invoices"],
      },
      manager: { production: {}, projects: { budget_total: 0, cost_total: 10 } },
    });
    expect(textOf(findByTestId(view.container, "home-overview-today"))).toBe("Bugün —");
    expect(textOf(findByTestId(view.container, "home-overview-sales-meta"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-kpi-bank"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-kpi-recv"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-kpi-pay"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-kpi-profit"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-kpi-profit"))).toContain("Gider —");
    expect(textOf(findByTestId(view.container, "home-overview-collections"))).toContain("Gecikmiş —");
    expect(textOf(findByTestId(view.container, "home-overview-collections"))).toContain("Vadesi gelmemiş —");
    expect(textOf(findByTestId(view.container, "home-overview-stock"))).toContain("Kritik stok · —");
    expect(textOf(findByTestId(view.container, "home-overview-production"))).toContain("—");
    expect(textOf(findByTestId(view.container, "home-overview-budget"))).toBe("BÜTÇE—");
    expect(textOf(view.container)).not.toContain("Tahsil edilecek");
    await view.unmount();
  });

  it("shows KDV ödenecek with the fixture days-left hint", async () => {
    const view = await renderPage();
    const vat = textOf(findByTestId(view.container, "home-overview-kpi-vat"));
    expect(vat).toContain(fmtMoney(overview.vat.payable));
    expect(vat).toContain("8 gün");
    const vatCard = findByTestId(view.container, "home-overview-kpi-vat");
    const siblings = (vatCard.parentNode?.childNodes || []).filter((node: any) =>
      String(node.getAttribute?.("data-testid") || "").startsWith("home-overview-kpi-"));
    expect(siblings.length).toBeLessThanOrEqual(2);
    const profitRow = findByTestId(view.container, "home-overview-kpi-profit").parentNode;
    const payRow = findByTestId(view.container, "home-overview-kpi-pay").parentNode;
    expect(profitRow).toBe(payRow);
    expect(vatCard.parentNode).not.toBe(profitRow);
    await view.unmount();
  });

  it("puts notifications, approvals and messages in home-overview-panels", async () => {
    const notifications = {
      id: "notifications",
      label: "Bildirimler",
      path: "/",
      href: "/notifications",
      icon: "notifications",
      tone: "rose",
      always: true,
    } as QuickTile;
    const shown = await renderPage({ showApprovals: true, showMessages: true, notifications });
    const panels = findByTestId(shown.container, "home-overview-panels");
    expect(findByTestId(panels, "home-notifications-panel")).toBeTruthy();
    expect(findByTestId(panels, "home-approvals")).toBeTruthy();
    expect(findByTestId(panels, "home-messages-panel")).toBeTruthy();
    const ids = collectTestIds(findByTestId(shown.container, "home-overview"));
    const at = (id: string) => ids.indexOf(id);
    expect(at("home-overview-tasks")).toBeGreaterThanOrEqual(0);
    expect(at("home-overview-tasks")).toBeLessThan(at("home-overview-panels"));
    expect(at("home-overview-panels")).toBeLessThan(at("home-overview-sales"));
    expect(at("home-overview-sales")).toBeLessThan(at("home-overview-kpis"));
    expect(at("home-overview-kpis")).toBeLessThan(at("home-overview-collections"));
    expect(at("home-overview-payments")).toBeLessThan(at("home-overview-stock"));
    expect(at("home-overview-stock")).toBeLessThan(at("home-overview-manager"));
    await shown.unmount();

    const hidden = await renderPage({ showApprovals: false, showMessages: false, notifications: null });
    const hiddenPanels = findByTestId(hidden.container, "home-overview-panels");
    expect(findByTestId(hiddenPanels, "home-notifications-panel")).toBeNull();
    expect(findByTestId(hiddenPanels, "home-approvals")).toBeNull();
    expect(findByTestId(hiddenPanels, "home-messages-panel")).toBeNull();
    await hidden.unmount();
  });

  it("renders section wrappers in the default order and nests the month card", async () => {
    const view = await renderPage();
    const ids = collectTestIds(view.container);
    const sections = ids.filter((id) => id.startsWith("home-overview-section-"));
    expect(sections).toEqual(DEFAULT_OVERVIEW_SECTION_ORDER.map((key) => `home-overview-section-${key}`));
    const month = findByTestId(view.container, "home-overview-month");
    expect(textOf(month)).toContain("Ekim 2026");
    expect(findByTestId(month, "home-overview-sales")).toBeTruthy();
    expect(findByTestId(month, "home-overview-kpis")).toBeTruthy();
    for (const key of ["bank", "recv", "pay", "profit", "vat"]) {
      expect(findByTestId(month, `home-overview-kpi-${key}`)).toBeTruthy();
    }
    expect(findByTestId(month, "home-overview-collections")).toBeTruthy();
    expect(findByTestId(month, "home-overview-payments")).toBeTruthy();
    expect(findByTestId(month, "home-overview-collections-bar")).toBeTruthy();
    expect(findByTestId(month, "home-overview-payments-bar")).toBeTruthy();
    await view.unmount();
  });

  it("hides stock when the count is zero and there are no products, and drops empty manager sections", async () => {
    const view = await renderPage({
      stats: { ...stats, low_stock_count: 0, low_stock_products: [] },
      manager: {},
    });
    expect(findByTestId(view.container, "home-overview-stock")).toBeNull();
    expect(findByTestId(view.container, "home-overview-section-stock")).toBeNull();
    expect(findByTestId(view.container, "home-overview-production")).toBeNull();
    expect(findByTestId(view.container, "home-overview-projects")).toBeNull();
    expect(findByTestId(view.container, "home-overview-section-production")).toBeNull();
    expect(findByTestId(view.container, "home-overview-section-projects")).toBeNull();
    expect(findByTestId(view.container, "home-overview-section-today")).toBeTruthy();
    expect(findByTestId(view.container, "home-overview-section-month")).toBeTruthy();
    await view.unmount();
  });

  it("renders section wrappers in the saved order", async () => {
    const order = ["month", "today", "stock", "panels", "production", "projects"] as const;
    const view = await renderPage({ sectionOrder: order });
    const sections = collectTestIds(view.container).filter((id) => id.startsWith("home-overview-section-"));
    expect(sections).toEqual(order.map((key) => `home-overview-section-${key}`));
    await view.unmount();
  });

  it("splits non-adjacent production and projects without a duplicate key warning", async () => {
    const errors: unknown[][] = [];
    const spy = jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      errors.push(args);
    });
    const view = await renderPage({
      sectionOrder: ["projects", "today", "production", "panels", "month", "stock"],
    });
    expect(findByTestId(view.container, "home-overview-section-production")).toBeTruthy();
    expect(findByTestId(view.container, "home-overview-section-projects")).toBeTruthy();
    const manager = findByTestId(view.container, "home-overview-manager");
    expect(findByTestId(manager, "home-overview-section-projects")).toBeTruthy();
    expect(findByTestId(manager, "home-overview-section-production")).toBeNull();
    expect(collectTestIds(view.container).filter((id) => id === "home-overview-manager")).toEqual(["home-overview-manager"]);
    const keyWarnings = errors.filter((args) => args.some((arg) => /same key|unique "key"/i.test(String(arg))));
    expect(keyWarnings).toEqual([]);
    spy.mockRestore();
    await view.unmount();
  });

  it("still shows every non-empty section when the saved order has unknown or missing keys", async () => {
    const view = await renderPage({
      sectionOrder: ["foo", "month", "month"] as unknown as OverviewSectionKey[],
    });
    const sections = collectTestIds(view.container).filter((id) => id.startsWith("home-overview-section-"));
    expect(sections).toEqual([
      "home-overview-section-month",
      "home-overview-section-today",
      "home-overview-section-panels",
      "home-overview-section-stock",
      "home-overview-section-production",
      "home-overview-section-projects",
    ]);
    await view.unmount();
  });

  it("starts reorder on a section long press and keeps inner presses working", async () => {
    const onRequestReorder = jest.fn();
    const view = await renderPage({ onRequestReorder });
    const today = findByTestId(view.container, "home-overview-section-today");
    expect(reactProps(today)?.delayLongPress).toBe(350);
    expect(reactProps(today)?.onClick).toBeUndefined();
    fireEvent(today, "longPress");
    expect(onRequestReorder).toHaveBeenCalledTimes(1);
    (goHref as jest.Mock).mockClear();
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-stock-all"))?.onClick?.(); });
    expect(goHref).toHaveBeenCalledWith("/stok");
    await view.unmount();
  });

  it("does not attach a long press when reorder is not requested", async () => {
    const view = await renderPage();
    const today = findByTestId(view.container, "home-overview-section-today");
    expect(reactProps(today)?.onLongPress).toBeUndefined();
    expect(collectTestIds(view.container).filter((id) => id.startsWith("home-overview-section-"))).toEqual(
      DEFAULT_OVERVIEW_SECTION_ORDER.map((key) => `home-overview-section-${key}`),
    );
    await view.unmount();
  });
});

function fireEvent(node: any, type: "longPress" | "press") {
  const props = reactProps(node);
  if (type === "longPress") props?.onLongPress?.();
  else (props?.onClick || props?.onPress)?.();
}

function collectTestIds(node: any): string[] {
  const out: string[] = [];
  const walk = (current: any) => {
    if (!current) return;
    const id = current.getAttribute?.("data-testid");
    if (id) out.push(id);
    for (const child of current.childNodes || []) walk(child);
  };
  walk(node);
  return out;
}
