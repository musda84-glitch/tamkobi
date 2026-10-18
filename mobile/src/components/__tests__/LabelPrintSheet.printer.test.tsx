import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { labelPrinterConfigError } from "../../utils/labelPrinter";
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
    Switch: host("input"),
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

async function typeId(container: any, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing input ${id}`);
  const props = reactProps(node);
  await act(async () => { await props?.onChange?.({ target: { value } }); });
}

describe("LabelPrintSheet printer fields", () => {
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

  it("shows IP and port fields when the host is empty", async () => {
    await show({ printerHost: "", printerPort: 9100, onSavePrinter: async () => undefined, onOpenPrinters: () => undefined });
    const host = findByTestId(container, "label-print-sheet-host");
    const port = findByTestId(container, "label-print-sheet-port");
    expect(host).toBeTruthy();
    expect(port).toBeTruthy();
    expect(reactProps(host)?.placeholder).toBe("Yazıcı IP adresi");
    expect(reactProps(host)?.keyboardType).toBe("decimal-pad");
    expect(reactProps(port)?.keyboardType).toBe("number-pad");
    expect(String(reactProps(port)?.value ?? port.value)).toBe("9100");
    expect(textOf(container)).toContain("Kaydet ve bas");
    expect(textOf(container)).toContain("YAZICI IP");
    expect(textOf(container)).toContain("PORT");
  });

  it("blocks printing when the IP is empty", async () => {
    const onPrint = jest.fn();
    const onSavePrinter = jest.fn(async () => undefined);
    await show({ printerHost: "", onPrint, onSavePrinter, onOpenPrinters: () => undefined });
    await pressId(container, "label-print-sheet-go");
    expect(textOf(container)).toContain("Yazıcı IP adresi girin");
    expect(onPrint).not.toHaveBeenCalled();
    expect(onSavePrinter).not.toHaveBeenCalled();
    expect(textOf(container)).toContain("Yazıcı ayarları");
  });

  it("saves the printer on this phone before printing a valid entry", async () => {
    const order: string[] = [];
    const onSavePrinter = jest.fn(async (host: string, port: number) => {
      order.push(`save:${host}:${port}`);
    });
    const onPrint = jest.fn(() => { order.push("print"); });
    await show({ printerHost: "", printerPort: 9100, onSavePrinter, onPrint });
    await typeId(container, "label-print-sheet-host", "192.168.1.20");
    await pressId(container, "label-print-sheet-go");
    expect(order).toEqual(["save:192.168.1.20:9100", "print"]);
    expect(onSavePrinter).toHaveBeenCalledWith("192.168.1.20", 9100);
    expect(onPrint).toHaveBeenCalledWith(1, { includePrice: true });
  });

  it("shows the resolved printer when a host is already set", async () => {
    await show({ printerHost: "10.4.4.4", printerPort: 9100, onSavePrinter: async () => undefined });
    expect(textOf(container)).toContain("Yazıcı: 10.4.4.4:9100");
    expect(textOf(container)).toContain("Değiştir");
    expect(findByTestId(container, "label-print-sheet-host")).toBeNull();
    expect(textOf(container)).not.toContain("Kaydet ve bas");
  });

  it("opens printer settings when the error comes from label printer config", async () => {
    const onOpenPrinters = jest.fn();
    await show({
      printerHost: "192.168.1.1",
      printerPort: 9600,
      error: labelPrinterConfigError({ host: "192.168.1.1", port: 9600 }),
      onOpenPrinters,
    });
    expect(textOf(container)).toContain("Yazıcı ayarları");
    expect(textOf(container)).toContain("seri baud");
    await pressId(container, "label-print-sheet-open-printers");
    expect(onOpenPrinters).toHaveBeenCalledTimes(1);
  });

  it("keeps the previous sheet when printer props are omitted", async () => {
    const onPrint = jest.fn();
    await show({
      onPrint,
      error: labelPrinterConfigError({ host: "", port: 9100 }),
    });
    expect(findByTestId(container, "label-print-sheet-host")).toBeNull();
    expect(findByTestId(container, "label-print-sheet-port")).toBeNull();
    expect(findByTestId(container, "label-print-sheet-open-printers")).toBeNull();
    expect(textOf(container)).not.toContain("Kaydet ve bas");
    expect(textOf(container)).not.toContain("Yazıcı:");
    expect(textOf(container)).not.toContain("Yazıcı ayarları");
    const go = findByTestId(container, "label-print-sheet-go");
    expect(go.getAttribute("aria-label")).toBe("Etiket bas");
    expect(findByTestId(container, "label-print-sheet-qty")).toBeTruthy();
    await pressId(container, "label-print-sheet-go");
    expect(onPrint).toHaveBeenCalledWith(1, { includePrice: true });
  });
});
