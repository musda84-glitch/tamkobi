import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { DEFAULT_OVERVIEW_SECTION_ORDER, overviewMonthTitle, type OverviewSectionKey } from "./overviewSections";
import { HomeOverviewReorder } from "./HomeOverviewReorder";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));
jest.mock("../../nav", () => ({ goHref: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock("../ManagerApprovalsPanel", () => ({ ManagerApprovalsPanel: () => null }));
jest.mock("../StaffMessagesPanel", () => ({ StaffMessagesPanel: () => null }));
jest.mock("../NotificationsPanel", () => ({ NotificationsPanel: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    return style as Record<string, unknown>;
  };
  const host = (tag: string) =>
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
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
    View: host("div"),
    Text: host("span"),
    Pressable(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
    }) {
      return ReactLib.createElement("button", {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        disabled: props.disabled,
      }, props.children);
    },
  };
});

const ORDER = [...DEFAULT_OVERVIEW_SECTION_ORDER] as OverviewSectionKey[];

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

async function renderReorder(props: Partial<React.ComponentProps<typeof HomeOverviewReorder>> = {}) {
  const onChange = jest.fn();
  const onDone = jest.fn();
  const onCancel = jest.fn();
  const onReset = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(HomeOverviewReorder, {
      order: ORDER,
      onChange,
      onDone,
      onCancel,
      onReset,
      resetDisabled: false,
      ...props,
    }));
  });
  return {
    container,
    onChange,
    onDone,
    onCancel,
    onReset,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

describe("HomeOverviewReorder", () => {
  it("renders six rows in order and moves them with the up and down buttons", async () => {
    const view = await renderReorder();
    const rows = collectTestIds(view.container).filter((id) => id.startsWith("home-overview-reorder-row-"));
    expect(rows).toEqual(ORDER.map((key) => `home-overview-reorder-row-${key}`));
    const text = textOf(view.container);
    expect(text).toContain("Bölümleri sırala");
    expect(text).toContain("Bugün");
    expect(text).toContain("Bildirimler/Mesajlar");
    expect(text).toContain(overviewMonthTitle());
    expect(text).toContain("Kritik stok");
    expect(text).toContain("Üretim");
    expect(text).toContain("Projeler");
    expect(text).toContain("Kartı basılı tutup sürükleyin · sıra bu şirket ve kullanıcıya saklanır");
    expect(reactProps(findByTestId(view.container, "home-overview-reorder-up-today"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(view.container, "home-overview-reorder-down-projects"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(view.container, "home-overview-reorder-down-today"))?.disabled).toBe(false);
    expect(reactProps(findByTestId(view.container, "home-overview-reorder-up-month"))?.disabled).toBe(false);

    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-up-today"))?.onClick?.(); });
    expect(view.onChange).not.toHaveBeenCalled();
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-down-projects"))?.onClick?.(); });
    expect(view.onChange).not.toHaveBeenCalled();

    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-up-month"))?.onClick?.(); });
    expect(view.onChange).toHaveBeenCalledWith(["today", "month", "panels", "stock", "production", "projects"]);
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-down-today"))?.onClick?.(); });
    expect(view.onChange).toHaveBeenCalledWith(["panels", "today", "month", "stock", "production", "projects"]);
    await view.unmount();
  });

  it("disables reset until a custom order can be restored", async () => {
    const locked = await renderReorder({ resetDisabled: true });
    const reset = findByTestId(locked.container, "home-overview-reorder-reset");
    expect(reactProps(reset)?.disabled).toBe(true);
    await act(async () => { reactProps(reset)?.onClick?.(); });
    expect(locked.onReset).not.toHaveBeenCalled();
    await locked.unmount();

    const open = await renderReorder({ resetDisabled: false });
    await act(async () => { reactProps(findByTestId(open.container, "home-overview-reorder-reset"))?.onClick?.(); });
    expect(open.onReset).toHaveBeenCalledTimes(1);
    await open.unmount();
  });

  it("finishes and cancels from the top bar", async () => {
    const view = await renderReorder();
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-done"))?.onClick?.(); });
    expect(view.onDone).toHaveBeenCalledTimes(1);
    await act(async () => { reactProps(findByTestId(view.container, "home-overview-reorder-cancel"))?.onClick?.(); });
    expect(view.onCancel).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});

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
