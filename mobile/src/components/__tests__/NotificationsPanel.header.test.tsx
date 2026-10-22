import React from "react";
import { render, within } from "@testing-library/react-native";
import type { Notification } from "../../types";
import { NotificationsPanel } from "../NotificationsPanel";

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (typeof style === "function") return flatten((style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    return style as Record<string, unknown>;
  };
  const host = (type: string) =>
    function Host(props: { style?: unknown; children?: React.ReactNode } & Record<string, unknown>) {
      const { style, children, ...rest } = props;
      return ReactLib.createElement(type, { ...rest, style: flatten(style) }, children);
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
    Animated: { Value: function Value() { /* no-op */ }, spring: () => ({ start() { /* no-op */ } }), event: () => () => undefined },
    PanResponder: { create: () => ({ panHandlers: {} }) },
    View: host("View"),
    Text: host("Text"),
    Pressable: host("Pressable"),
    Image: host("Image"),
    ScrollView: host("ScrollView"),
    KeyboardAvoidingView: host("KeyboardAvoidingView"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    TextInput: host("TextInput"),
  };
});

describe("NotificationsPanel header", () => {
  it("keeps Bildirimler on one line and wraps the actions below it", async () => {
    const view = await render(React.createElement(NotificationsPanel, {
      items: [] as Notification[],
      unread: 19,
      totalCount: 19,
      onOpenAll: () => undefined,
      onOpenItem: () => undefined,
      onMarkAllRead: () => undefined,
      onClearAll: () => undefined,
    }));

    const title = view.getByText("Bildirimler");
    expect(title.props.numberOfLines).toBe(1);
    expect(title.props.style?.flexShrink).not.toBe(0);
    expect(title.props.style?.flexShrink).toBe(1);

    const titleRow = view.getByTestId("notifications-title-row");
    const actionsRow = view.getByTestId("notifications-actions-row");
    expect(titleRow.props.style?.flexDirection).toBe("row");
    expect(titleRow.props.style?.alignItems).toBe("center");
    expect(titleRow.props.style?.minWidth).toBe(0);
    expect(within(titleRow).getByText("19 yeni")).toBeTruthy();
    expect(within(titleRow).getByTestId("home-notifications-unread").parent?.props.style?.flexShrink).toBe(0);

    for (const label of ["Tümü", "Okundu", "Tümünü sil"]) {
      expect(within(titleRow).queryByText(label)).toBeNull();
      expect(within(actionsRow).getByText(label)).toBeTruthy();
    }
    expect(actionsRow.props.style?.flexDirection).toBe("row");
    expect(actionsRow.props.style?.flexWrap).toBe("wrap");
    expect(view.getByTestId("home-notifications-all").props.style?.minHeight).toBe(44);
    expect(view.getByTestId("home-notifications-read-all").props.style?.minHeight).toBe(44);
    expect(view.getByTestId("home-notifications-clear-all").props.style?.minHeight).toBe(44);
  });
});
