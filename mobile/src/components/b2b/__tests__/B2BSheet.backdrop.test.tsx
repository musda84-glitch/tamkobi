import "../../../test/domSetup";
import React, { act } from "react";
import { findByTestId } from "../../../test/domSetup";
import { B2BSheet } from "../B2BSheet";

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
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput: Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } }),
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
});

describe("B2BSheet backdrop", () => {
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

  it("fills the screen with an absolute backdrop", async () => {
    await act(async () => {
      root.render(React.createElement(B2BSheet, { visible: true, title: "Sepet", onClose: () => undefined, children: "iç" }));
    });
    const backdrop = findByTestId(container, "sheet-backdrop");
    expect(backdrop).toBeTruthy();
    expect(backdrop.style.position).toBe("absolute");
    expect(Number(backdrop.style.top)).toBe(0);
    expect(Number(backdrop.style.left)).toBe(0);
    expect(Number(backdrop.style.right)).toBe(0);
    expect(Number(backdrop.style.bottom)).toBe(0);
  });
});
