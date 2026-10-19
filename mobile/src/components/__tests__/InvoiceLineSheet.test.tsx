import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { emptyLine } from "../../utils/documentLines";
import type { InvoiceLine } from "../../utils/documentLines";
import { InvoiceLineSheet } from "../InvoiceLineSheet";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ client: { baseUrl: "https://api.test", token: "tok" } }),
}));

jest.mock("../../api/client", () => ({
  displayFileUrl: () => "",
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    if (typeof style === "object") return style as Record<string, unknown>;
    return undefined;
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      disabled?: boolean;
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      onFocus?: () => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
        onChangeText: props.onChangeText,
        onFocus: props.onFocus,
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: unknown) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (props.visible === false ? null : host("div")(props)),
    TextInput: host("input"),
    Image: host("img"),
    ActivityIndicator: () => null,
  };
});

function line(partial: Partial<InvoiceLine> = {}): InvoiceLine {
  return {
    ...emptyLine(),
    name: "Kalem",
    product_name: "Kalem",
    quantity: 1,
    unit_price: 100,
    vat_rate: 20,
    ...partial,
  };
}

function renderSheet(props: Partial<React.ComponentProps<typeof InvoiceLineSheet>> = {}) {
  const onSave = jest.fn();
  const onDelete = jest.fn();
  const onClose = jest.fn();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(InvoiceLineSheet, {
      visible: true,
      index: 0,
      count: 2,
      line: line(),
      allowDelete: true,
      loadHits: async () => [],
      onSave,
      onDelete,
      onClose,
      ...props,
    }));
  });
  return { container, root, onSave, onDelete, onClose };
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const props = reactProps(node);
  await act(async () => { await (props?.onClick || props?.onPress)?.(); });
}

async function typeField(container: unknown, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  const props = reactProps(node);
  await act(async () => { props?.onFocus?.(); });
  await act(async () => { props?.onChangeText?.(value); });
}

describe("InvoiceLineSheet", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    (Alert.alert as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("writes the ex-VAT or inc-VAT field and changes the VAT chip", async () => {
    const excl = renderSheet();
    await typeField(excl.container, "inv-item-price", "50");
    await press(excl.container, "inv-line-save");
    const savedExcl = excl.onSave.mock.calls[0][0] as InvoiceLine;
    expect(savedExcl.unit_price).toBeCloseTo(50);
    expect(savedExcl.unit_price_incl).toBeCloseTo(60);
    excl.root.unmount();

    const incl = renderSheet();
    await press(incl.container, "inv-line-price-incl");
    await typeField(incl.container, "inv-item-price", "240");
    await press(incl.container, "inv-line-save");
    const savedIncl = incl.onSave.mock.calls[0][0] as InvoiceLine;
    expect(savedIncl.unit_price_incl).toBeCloseTo(240);
    expect(savedIncl.unit_price).toBeCloseTo(200);

    await press(incl.container, "inv-item-vat-10");
    await press(incl.container, "inv-line-save");
    const savedVat = incl.onSave.mock.calls.at(-1)?.[0] as InvoiceLine;
    expect(savedVat.vat_rate).toBe(10);
    incl.root.unmount();
  });

  it("breaks down a percent discount as 10 × 950 at 5% and 20% VAT", () => {
    const view = renderSheet({
      line: line({ quantity: 10, unit_price: 950, discount_rate: 5, vat_rate: 20 }),
    });
    const text = textOf(view.container);
    expect(text).toContain("9.025,00");
    expect(text).toContain("1.805,00");
    expect(text).toContain("10.830,00");
    expect(text).toContain("İskonto");
    view.root.unmount();
  });

  it("shows GTIP and origin only for export or import", () => {
    const domestic = renderSheet({ tradeKind: "" });
    expect(findByTestId(domestic.container, "inv-item-gtip")).toBeNull();
    expect(textOf(domestic.container)).not.toContain("Menşe");
    domestic.root.unmount();

    const exported = renderSheet({ tradeKind: "export" });
    expect(findByTestId(exported.container, "inv-item-gtip")).toBeTruthy();
    expect(findByTestId(exported.container, "inv-item-origin")).toBeTruthy();
    exported.root.unmount();
  });

  it("asks before deleting, refuses the last filled line, and discards on close", async () => {
    const view = renderSheet();
    await press(view.container, "inv-line-delete");
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text?: string; onPress?: () => void }[];
    expect(buttons[0].text).toBe("Vazgeç");
    expect(view.onDelete).not.toHaveBeenCalled();
    await act(async () => { buttons[1].onPress?.(); });
    expect(view.onDelete).toHaveBeenCalled();

    const last = renderSheet({ allowDelete: false, count: 1 });
    await press(last.container, "inv-line-delete");
    expect(textOf(last.container)).toContain("En az bir kalem gerekli.");
    expect(last.onDelete).not.toHaveBeenCalled();

    await press(last.container, "inv-item-vat-1");
    await press(last.container, "inv-line-sheet-close");
    expect(last.onClose).toHaveBeenCalled();
    expect(last.onSave).not.toHaveBeenCalled();
    view.root.unmount();
    last.root.unmount();
  });

  it("asks before turning a linked product into a service", async () => {
    const view = renderSheet({
      line: line({ product_id: "p1", name: "Profil", product_name: "Profil", sku: "DL" }),
    });
    await press(view.container, "inv-item-kind");
    const call = (Alert.alert as jest.Mock).mock.calls.at(-1);
    expect(String(call?.[1])).toContain("Ürün bağı kaldırılacak");
    const buttons = call?.[2] as { onPress?: () => void }[];
    await act(async () => { buttons[1].onPress?.(); });
    await press(view.container, "inv-line-save");
    const saved = view.onSave.mock.calls[0][0] as InvoiceLine;
    expect(saved.is_service).toBe(true);
    expect(saved.product_id).toBe("");
    view.root.unmount();
  });
});
