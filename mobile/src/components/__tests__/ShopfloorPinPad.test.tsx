import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { ShopfloorPinPad } from "../ShopfloorPinPad";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

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
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        accessibilityState: props.accessibilityState,
        "aria-label": props.accessibilityLabel,
        onClick: () => { if (!props.disabled) props.onPress?.(); },
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: { create: (styles: Record<string, unknown>) => styles, flatten, hairlineWidth: 1 },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    TextInput: () => { throw new Error("PIN pad must not render TextInput"); },
  };
});

function filledCount(node: any): number {
  return [0, 1, 2, 3].filter((index) => (
    reactProps(findByTestId(node, `shopfloor-pin-dot-${index}`))?.accessibilityState?.selected
  )).length;
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("ShopfloorPinPad", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function renderPad(props: Partial<React.ComponentProps<typeof ShopfloorPinPad>> = {}) {
    await act(async () => {
      root.render(React.createElement(ShopfloorPinPad, {
        operatorName: "Ali Usta",
        station: "Kesim",
        onSubmit: () => {},
        onCancel: () => {},
        ...props,
      }));
    });
  }

  async function press(id: string) {
    await act(async () => {
      const props = reactProps(findByTestId(container, id));
      if (!props || props.disabled) return;
      props.onClick?.();
    });
  }

  it("submits four digits once and never paints them", async () => {
    const onSubmit = jest.fn();
    await renderPad({ onSubmit });
    expect(reactProps(findByTestId(container, "shopfloor-pin-key-5"))?.style?.minHeight).toBe(56);
    expect(reactProps(findByTestId(container, "shopfloor-pin-key-0"))?.style?.minHeight).toBe(56);
    expect(reactProps(findByTestId(container, "shopfloor-pin-back"))?.style?.minHeight).toBe(56);
    expect(reactProps(findByTestId(container, "shopfloor-pin-cancel"))?.style?.minHeight).toBe(56);
    await press("shopfloor-pin-key-5");
    await press("shopfloor-pin-key-8");
    await press("shopfloor-pin-key-2");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(filledCount(container)).toBe(3);
    expect(textOf(container)).not.toContain("582");
    expect(textOf(findByTestId(container, "shopfloor-pin-dot-0"))).not.toMatch(/[0-9]/);
    await press("shopfloor-pin-key-9");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith("5829");
    expect(filledCount(container)).toBe(0);
    expect(textOf(container)).not.toContain("5829");
    expect(textOf(container)).toContain("Vazgeç");
    expect(textOf(container)).toContain("⌫");
  });

  it("backspace deletes a digit and cancel clears without submit", async () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    await renderPad({ onSubmit, onCancel });
    await press("shopfloor-pin-key-5");
    await press("shopfloor-pin-key-8");
    await press("shopfloor-pin-back");
    expect(filledCount(container)).toBe(1);
    await press("shopfloor-pin-cancel");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(filledCount(container)).toBe(0);
  });

  it("shows the error strip and clears entered dots", async () => {
    const onSubmit = jest.fn();
    await renderPad({ onSubmit });
    await press("shopfloor-pin-key-5");
    expect(filledCount(container)).toBe(1);
    await renderPad({ onSubmit, error: "PIN hatalı: 2 deneme hakkınız kaldı — 5 hatalı denemede 15 dk kilitlenir" });
    expect(textOf(findByTestId(container, "shopfloor-pin-error"))).toContain("2 deneme hakkınız kaldı");
    expect(filledCount(container)).toBe(0);
    expect(textOf(container)).not.toContain("5829");
  });

  it("ignores key presses while busy", async () => {
    const onSubmit = jest.fn();
    const onCancel = jest.fn();
    await renderPad({ onSubmit, onCancel, busy: true });
    await press("shopfloor-pin-key-5");
    await press("shopfloor-pin-key-8");
    await press("shopfloor-pin-key-2");
    await press("shopfloor-pin-key-9");
    await press("shopfloor-pin-back");
    await press("shopfloor-pin-cancel");
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
    expect(filledCount(container)).toBe(0);
  });
});
