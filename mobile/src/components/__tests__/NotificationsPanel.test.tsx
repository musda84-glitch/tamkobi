import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { Notification } from "../../types";
import { NotificationsPanel } from "../NotificationsPanel";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    return style as Record<string, unknown>;
  };
  const resolveStyle = (style: unknown): Record<string, unknown> | undefined => {
    if (typeof style === "function") return resolveStyle((style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    return flatten(style);
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      numberOfLines?: number;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: resolveStyle(props.style),
        disabled: !!props.disabled,
        numberOfLines: props.numberOfLines,
        onClick: () => { if (!props.disabled) props.onPress?.(); },
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
    Animated: { Value: function Value() { /* no-op */ }, event: () => () => undefined },
    PanResponder: { create: () => ({ panHandlers: {} }) },
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

function findTextNode(node: any, text: string): any {
  if (!node) return null;
  if (node.nodeType === 1 && textOf(node) === text) return node;
  for (const child of node.childNodes || []) {
    const hit = findTextNode(child, text);
    if (hit) return hit;
  }
  return null;
}

afterAll(() => {
  removeTestNavigator();
});

async function renderPanel(props: Partial<React.ComponentProps<typeof NotificationsPanel>> = {}) {
  const onOpenAll = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(NotificationsPanel, {
      items: [] as Notification[],
      unread: 27,
      totalCount: 27,
      onOpenAll,
      onOpenItem: () => undefined,
      onMarkAllRead: () => undefined,
      onClearAll: () => undefined,
      ...props,
    }));
  });
  return {
    container,
    onOpenAll,
    async unmount() {
      await act(async () => { root.unmount(); });
      container.parentNode?.removeChild(container);
    },
  };
}

describe("NotificationsPanel", () => {
  it("keeps the title on one line and puts actions on the next row", async () => {
    const view = await renderPanel();
    const title = findTextNode(view.container, "Bildirimler");
    expect(reactProps(title)?.numberOfLines).toBe(1);
    expect(reactProps(title)?.style?.flexShrink).toBe(1);
    expect(reactProps(title)?.style?.flex).toBeUndefined();

    const titleRow = findByTestId(view.container, "notifications-title-row");
    const actionsRow = findByTestId(view.container, "notifications-actions-row");
    const readAll = findByTestId(view.container, "home-notifications-read-all");
    const clearAll = findByTestId(view.container, "home-notifications-clear-all");
    const openAll = findByTestId(view.container, "home-notifications-all");
    expect(titleRow.contains(title)).toBe(true);
    expect(titleRow.contains(openAll)).toBe(false);
    expect(actionsRow.contains(openAll)).toBe(true);
    expect(actionsRow.contains(readAll)).toBe(true);
    expect(actionsRow.contains(clearAll)).toBe(true);
    expect(reactProps(titleRow)?.style?.flexDirection).toBe("row");
    expect(reactProps(titleRow)?.style?.alignItems).toBe("center");
    expect(reactProps(titleRow)?.style?.minWidth).toBe(0);
    expect(reactProps(actionsRow)?.style?.flexWrap).toBe("wrap");
    expect(textOf(titleRow)).toContain("Bildirimler");
    expect(textOf(titleRow)).not.toContain("Tümü");
    expect(textOf(titleRow)).not.toContain("Okundu");
    expect(textOf(titleRow)).not.toContain("Tümünü sil");
    expect(textOf(actionsRow)).toContain("Tümü");
    expect(textOf(actionsRow)).toContain("Okundu");
    expect(textOf(actionsRow)).toContain("Tümünü sil");
    await view.unmount();
  });

  it("hides read-all and clear-all when the callbacks are absent", async () => {
    const view = await renderPanel({ onMarkAllRead: undefined, onClearAll: undefined });
    expect(findByTestId(view.container, "home-notifications-read-all")).toBeNull();
    expect(findByTestId(view.container, "home-notifications-clear-all")).toBeNull();
    await view.unmount();
  });

  it("shows the unread badge and opens all from the title row", async () => {
    const view = await renderPanel();
    expect(textOf(findByTestId(view.container, "home-notifications-unread"))).toBe("27 yeni");
    expect(textOf(findByTestId(view.container, "home-notifications-all"))).toContain("Tümü");
    await act(async () => { reactProps(findByTestId(view.container, "home-notifications-all"))?.onClick?.(); });
    expect(view.onOpenAll).toHaveBeenCalledTimes(1);
    await view.unmount();
  });
});
