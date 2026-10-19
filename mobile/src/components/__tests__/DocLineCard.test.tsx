import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
import { DocLineCard } from "../DocLineCard";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; onPress?: () => void; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        onClick: () => props.onPress?.(),
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: unknown) => styles, flatten: (style: unknown) => style },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
  };
});

const line = {
  name: "Kapı",
  product_name: "Kapı",
  quantity: 2,
  unit_price: 100,
  vat_rate: 20,
  discount_rate: 10,
  unit: "Adet",
  total_incl: 216,
};

function renderCard(props: Partial<React.ComponentProps<typeof DocLineCard>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const onPress = jest.fn();
  const onDelete = jest.fn();
  act(() => {
    root.render(React.createElement(DocLineCard, {
      line,
      currency: "TRY",
      testIDPrefix: "inv-item",
      index: 0,
      onPress,
      onDelete,
      editable: true,
      ...props,
    }));
  });
  return { container, root, onPress, onDelete };
}

describe("DocLineCard", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("shows adet, fiyat, kdv, iskonto, unit and the inclusive total", () => {
    const { container, root } = renderCard();
    const card = findByTestId(container, "inv-item-0");
    expect(card).toBeTruthy();
    const text = textOf(card);
    expect(text).toContain("Kapı");
    expect(text).toContain("ADET");
    expect(text).toContain("2");
    expect(text).toContain("FİYAT");
    expect(text).toContain(fmtMoney(100));
    expect(text).toContain("KDV");
    expect(text).toContain("%20");
    expect(text).toContain("İSK");
    expect(text).toContain("%10");
    expect(text).toContain("Adet");
    expect(text).toContain(fmtMoney(216));
    root.unmount();
  });

  it("fires onPress and onDelete with the prefix test ids", () => {
    const onPress = jest.fn();
    const onDelete = jest.fn();
    const { container, root } = renderCard({ testIDPrefix: "q-item", index: 1, onPress, onDelete, currency: "USD" });
    const card = findByTestId(container, "q-item-1");
    const del = findByTestId(container, "q-item-del-1");
    expect(card).toBeTruthy();
    expect(del).toBeTruthy();
    expect(textOf(card)).toContain(fmtMoney(100, "USD"));
    expect(textOf(card)).toContain(fmtMoney(216, "USD"));
    act(() => { reactProps(card)?.onClick?.(); });
    act(() => { reactProps(del)?.onClick?.(); });
    expect(onPress).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledTimes(1);
    root.unmount();
  });

  it("hides delete when the line is not editable", () => {
    const { container, root } = renderCard({ editable: false, testIDPrefix: "inv-item", index: 3 });
    expect(findByTestId(container, "inv-item-3")).toBeTruthy();
    expect(findByTestId(container, "inv-item-del-3")).toBeNull();
    root.unmount();
  });
});
