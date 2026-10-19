import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { ActionTile } from "../ActionTiles";
import { filterHomeQuickTiles } from "../../utils/homeQuickHidden";
import { splitNotificationsTile, visibleQuickTiles } from "../../utils/quickMenu";
import { HomeTilesPage } from "./HomeTilesPage";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));
jest.mock("../ManagerApprovalsPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { ManagerApprovalsPanel: () => ReactLib.createElement("div", { "data-testid": "manager-approvals-panel" }) };
});
jest.mock("../StaffMessagesPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { StaffMessagesPanel: () => ReactLib.createElement("div", { "data-testid": "staff-messages-panel" }) };
});
jest.mock("../NotificationsPanel", () => {
  const ReactLib = require("react") as typeof import("react");
  return { NotificationsPanel: () => ReactLib.createElement("div", { "data-testid": "home-notifications-panel" }) };
});

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
    Pressable: host("button"),
    Image: host("img"),
    ScrollView: host("div"),
    ActivityIndicator: () => null,
  };
});

const admin = { id: "uid-1", role: "admin" };
const { tiles } = splitNotificationsTile(visibleQuickTiles(admin, { modules: {} }));
const homeTiles = filterHomeQuickTiles(tiles, [], []);
const quickItems: ActionTile[] = homeTiles.map((tile) => ({
  key: tile.id,
  label: tile.label,
  icon: tile.icon as ActionTile["icon"],
  tone: tile.tone,
  testID: `home-quick-${tile.id}`,
  onPress: () => {},
}));

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

function findTestIdPrefix(node: any, prefix: string): any {
  if (!node) return null;
  const id = node.getAttribute?.("data-testid");
  if (typeof id === "string" && id.startsWith(prefix)) return node;
  for (const child of node.childNodes || []) {
    const hit = findTestIdPrefix(child, prefix);
    if (hit) return hit;
  }
  return null;
}

describe("HomeTilesPage", () => {
  it("renders the quick menu, every home tile and the refresh tile", async () => {
    expect(homeTiles.length).toBeGreaterThan(0);
    const onRefresh = jest.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(React.createElement(HomeTilesPage, {
        error: null,
        quickItems,
        showRefresh: true,
        refreshing: false,
        onRefresh,
      }));
    });

    const menu = findByTestId(container, "home-quick-menu");
    expect(menu).toBeTruthy();
    for (const tile of homeTiles) {
      const node = findByTestId(menu, `home-quick-${tile.id}`);
      expect(node).toBeTruthy();
      expect(textOf(node)).toContain(tile.label);
    }
    const refresh = findByTestId(menu, "home-quick-refresh");
    expect(refresh).toBeTruthy();
    expect(textOf(refresh)).toContain("Yenile");
    await act(async () => { reactProps(refresh)?.onClick?.(); });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    expect(findByTestId(container, "home-summary")).toBeNull();
    expect(findTestIdPrefix(container, "home-task-")).toBeNull();
    expect(findTestIdPrefix(container, "home-notifications-")).toBeNull();
    expect(findByTestId(container, "manager-approvals-panel")).toBeNull();
    expect(findByTestId(container, "staff-messages-panel")).toBeNull();
    expect(textOf(container)).not.toContain("Bugünkü işler");

    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });
});
