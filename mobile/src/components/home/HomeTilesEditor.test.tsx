import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { ActionTile } from "../ActionTiles";
import { TILE_SIZES } from "../../utils/tileSizes";
import { HomeTilesEditor } from "./HomeTilesEditor";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

type PanConfig = {
  onPanResponderGrant?: () => void;
  onPanResponderRelease?: (event: unknown, gesture: { dx: number; dy: number }) => void;
};

const pans: PanConfig[] = [];

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-router", () => ({ router: { push: jest.fn(), navigate: jest.fn() } }));

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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onLayout?: (event: unknown) => void }) {
      ReactLib.useEffect(() => {
        if (props.testID === "home-tiles-editor-grid") {
          props.onLayout?.({ nativeEvent: { layout: { width: 360, height: 400, x: 0, y: 0 } } });
        }
      });
      return ReactLib.createElement(tag, { "data-testid": props.testID, style: flatten(props.style) }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: Record<string, unknown>) => styles, flatten },
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
    PanResponder: {
      create: (config: PanConfig) => {
        pans.push(config);
        return { panHandlers: {} };
      },
    },
  };
});

const items: ActionTile[] = [
  { key: "invoices", label: "Faturalar", icon: "document-text", onPress: () => {}, testID: "home-quick-invoices" },
  { key: "vehicles", label: "Araçlarım", icon: "car", onPress: jest.fn(), testID: "home-quick-vehicles", dimmed: true },
];

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("HomeTilesEditor", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;
  const onMove = jest.fn();
  const onDone = jest.fn();
  const onReset = jest.fn();

  beforeEach(() => {
    pans.splice(0, pans.length);
    onMove.mockClear();
    onDone.mockClear();
    onReset.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show(resetDisabled = false) {
    await act(async () => {
      root.render(React.createElement(HomeTilesEditor, {
        items,
        onMove,
        onDone,
        onReset,
        resetDisabled,
      }));
    });
    await act(async () => { await Promise.resolve(); });
  }

  it("shows Bitti and Düzeni sıfırla and fades hidden tiles", async () => {
    await show();
    expect(textOf(findByTestId(container, "home-tiles-editor-done"))).toContain("Bitti");
    expect(textOf(findByTestId(container, "home-tiles-editor-reset"))).toContain("Düzeni sıfırla");
    expect(reactProps(findByTestId(container, "home-tiles-editor-slot-vehicles"))?.style?.opacity).toBe(0.4);
    expect(reactProps(findByTestId(container, "home-tiles-editor-slot-invoices"))?.style?.opacity).toBe(1);
    expect(findByTestId(container, "home-tiles-show-vehicles")).toBeTruthy();
    expect(findByTestId(container, "home-tiles-show-invoices")).toBeNull();
    await act(async () => { reactProps(findByTestId(container, "home-tiles-show-vehicles"))?.onClick?.(); });
    expect(items[1].onPress).toHaveBeenCalledTimes(1);
  });

  it("drags a tile by one cell and ignores a short nudge", async () => {
    await show();
    expect(pans.length).toBeGreaterThan(1);
    const cell = 360 / 4;
    await act(async () => { pans[0].onPanResponderGrant?.(); });
    await act(async () => { pans[0].onPanResponderRelease?.({}, { dx: 10, dy: 4 }); });
    expect(onMove).not.toHaveBeenCalled();
    await act(async () => { pans[0].onPanResponderGrant?.(); });
    await act(async () => { pans[0].onPanResponderRelease?.({}, { dx: cell, dy: 0 }); });
    expect(onMove).toHaveBeenCalledWith(0, 1);
    expect(TILE_SIZES.md.height).toBeGreaterThan(0);
  });

  it("commits with Bitti and resets only when the order is custom", async () => {
    await show(true);
    expect(reactProps(findByTestId(container, "home-tiles-editor-reset"))?.disabled).toBe(true);
    await act(async () => { reactProps(findByTestId(container, "home-tiles-editor-reset"))?.onClick?.(); });
    expect(onReset).not.toHaveBeenCalled();
    await act(async () => { reactProps(findByTestId(container, "home-tiles-editor-done"))?.onClick?.(); });
    expect(onDone).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(React.createElement(HomeTilesEditor, {
        items,
        onMove,
        onDone,
        onReset,
        resetDisabled: false,
      }));
    });
    await act(async () => { reactProps(findByTestId(container, "home-tiles-editor-reset"))?.onClick?.(); });
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
