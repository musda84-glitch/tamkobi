import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
import type { Product } from "../../types";
import { ProductPickRow } from "../ProductPickRow";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ client: { baseUrl: "https://x.test", token: "t" } }),
}));

jest.mock("../../api/client", () => ({
  displayFileUrl: () => "",
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, { "data-testid": props.testID, onClick: props.onPress }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten: (style: unknown) => style,
    },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    Image: host("img"),
  };
});

const product: Product = {
  id: "p1",
  name: "Profil",
  sku: "DL120",
  barcode: "8680001",
  sale_price: 1250,
  purchase_price: 80,
  last_purchase_price: 55,
  unit: "Adet",
  stock_quantity: 3,
};

function renderRow(props: Partial<React.ComponentProps<typeof ProductPickRow>> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(ProductPickRow, { product, onPress: () => undefined, ...props }));
  });
  return { container, root };
}

describe("ProductPickRow", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("shows the sale price unless priceType is purchase", () => {
    const sales = renderRow();
    const salesRow = findByTestId(sales.container, "prod-pick-p1");
    expect(salesRow).toBeTruthy();
    expect(findByTestId(sales.container, "prod-pick-thumb-p1")).toBeTruthy();
    expect(textOf(salesRow)).toContain(fmtMoney(1250));
    expect(textOf(salesRow)).not.toContain(fmtMoney(55));
    sales.root.unmount();

    const purchase = renderRow({ priceType: "purchase" });
    const purchaseRow = findByTestId(purchase.container, "prod-pick-p1");
    expect(textOf(purchaseRow)).toContain(fmtMoney(55));
    expect(textOf(purchaseRow)).not.toContain(fmtMoney(1250));
    purchase.root.unmount();
  });

  it("falls back to the card purchase price when there is no last purchase", () => {
    const view = renderRow({
      priceType: "purchase",
      product: { ...product, last_purchase_price: null },
    });
    expect(textOf(findByTestId(view.container, "prod-pick-p1"))).toContain(fmtMoney(80));
    view.root.unmount();
  });
});
