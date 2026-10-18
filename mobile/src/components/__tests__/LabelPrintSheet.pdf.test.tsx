import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { LabelPrintSheet } from "../LabelPrintSheet";

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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        "aria-label": props.accessibilityLabel,
      }, props.children);
    };
  const TextInput = Object.assign(
    (props: {
      testID?: string;
      value?: string;
      placeholder?: string;
      keyboardType?: string;
      onChangeText?: (value: string) => void;
    }) => ReactLib.createElement("input", {
      "data-testid": props.testID,
      value: props.value ?? "",
      placeholder: props.placeholder,
      keyboardType: props.keyboardType,
      onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
    }),
    { State: { currentlyFocusedInput: () => null } },
  );
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
    Switch: (props: { testID?: string; value?: boolean; onValueChange?: (value: boolean) => void }) => ReactLib.createElement("input", {
      "data-testid": props.testID,
      type: "checkbox",
      checked: !!props.value,
      onClick: () => props.onValueChange?.(!props.value),
    }),
    ActivityIndicator: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (
      props.visible === false ? null : host("div")(props)
    ),
    TextInput,
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

async function pressId(container: any, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const props = reactProps(node);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

describe("LabelPrintSheet PDF actions", () => {
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

  async function show(props: Record<string, unknown>) {
    await act(async () => {
      root.render(React.createElement(LabelPrintSheet, {
        visible: true,
        title: "Etiket bas",
        onClose: () => undefined,
        onPrint: () => undefined,
        ...props,
      }));
    });
  }

  it("shows phone print and PDF share under the IP button and calls onPdf with the mode", async () => {
    const onPdf = jest.fn(async () => undefined);
    const onPrint = jest.fn();
    await show({
      onPdf,
      onPrint,
      initialQty: 4,
      allowPrice: true,
      printerHost: "",
      printerPort: 9100,
      error: "Yazıcı IP adresi girin (örn. 192.168.1.117).",
      onSavePrinter: async () => undefined,
    });
    expect(textOf(container)).toContain("Telefondan yazdır");
    expect(textOf(container)).toContain("PDF paylaş");
    expect(findByTestId(container, "label-print-sheet-host")).toBeTruthy();
    expect(textOf(container)).toContain("Yazıcı IP adresi girin");

    await pressId(container, "label-print-sheet-phone");
    expect(onPdf).toHaveBeenCalledWith("print", 4, { includePrice: true });
    expect(onPrint).not.toHaveBeenCalled();

    await pressId(container, "label-print-sheet-price");
    await pressId(container, "label-print-sheet-pdf");
    expect(onPdf).toHaveBeenCalledWith("pdf", 4, { includePrice: false });
  });

  it("hides the secondary buttons when onPdf is omitted", async () => {
    await show({ printerHost: "10.0.0.8", printerPort: 9100 });
    expect(textOf(container)).not.toContain("Telefondan yazdır");
    expect(textOf(container)).not.toContain("PDF paylaş");
    expect(findByTestId(container, "label-print-sheet-phone")).toBeNull();
    expect(findByTestId(container, "label-print-sheet-pdf")).toBeNull();
    expect(textOf(container)).toContain("Etiket bas");
  });
});
