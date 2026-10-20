import "../../test/domSetup";
import React, { act, useState } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import {
  CHEQUE_BATCH_LIMIT,
  addBatchItem,
  appendScannedCheque,
  removeBatchItem,
  type ChequeBatchItem,
} from "../../utils/chequeBatch";
import { emptyChequeDraft } from "../../utils/cheques";
import { fmtMoney } from "../../utils/money";
import { ChequeBatchList } from "../ChequeBatchList";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("../ChequeScanButtons", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    ChequeScanButtons: ({
      onDraft,
      testID,
      disabled,
    }: {
      onDraft: (draft: {
        instrument: string;
        direction: string;
        amount: number;
        due_date: string;
        serial_no: string;
        bank_name: string;
      }) => void;
      testID?: string;
      disabled?: boolean;
    }) => ReactLib.createElement("button", {
      "data-testid": testID,
      disabled: !!disabled,
      onClick: () => onDraft({
        instrument: "cheque",
        direction: "issued",
        amount: 80,
        due_date: "2026-12-15",
        serial_no: "SCAN1",
        bank_name: "Garanti",
      }),
    }, "📷 Kamerayla ekle"),
  };
});

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; disabled?: boolean; onPress?: () => void; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        disabled: props.disabled === true,
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

function row(amount: string, serial: string): ChequeBatchItem {
  return addBatchItem([], {
    ...emptyChequeDraft("2026-10-20"),
    contact_id: "c1",
    contact_name: "Acme A.Ş.",
    amount,
    due_date: "2026-11-01",
    serial_no: serial,
    bank_name: "Ziraat",
  })[0];
}

function Host({ initial }: { initial: ChequeBatchItem[] }) {
  const [items, setItems] = useState(initial);
  return (
    <ChequeBatchList
      items={items}
      direction="received"
      contactName="Acme A.Ş."
      recordDate="2026-10-20"
      onRemove={(index) => setItems((prev) => removeBatchItem(prev, index))}
      onAddManual={() => undefined}
      onScan={(scan) => {
        setItems((prev) => {
          const result = appendScannedCheque(prev, scan, {
            contact_id: "c1",
            contact_name: "Acme A.Ş.",
            direction: "received",
          });
          return result.error ? prev : result.items;
        });
      }}
    />
  );
}

function renderList(initial: ChequeBatchItem[]) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(Host, { initial })); });
  return { container, root };
}

describe("ChequeBatchList", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("adds a camera cheque to the list and keeps the manual badge", async () => {
    const view = renderList([row("100", "EL1")]);
    expect(textOf(findByTestId(view.container, "cheque-batch-total"))).toContain("ALINAN ÇEK · Acme A.Ş.");
    expect(textOf(findByTestId(view.container, "cheque-batch-total"))).toContain(fmtMoney(100));
    expect(textOf(findByTestId(view.container, "cheque-batch-total"))).toContain("1 çek · tek makbuz · kayıt 20.10.2026");
    expect(textOf(findByTestId(view.container, "cheque-batch-item-0"))).toContain("Ziraat · EL1");
    expect(textOf(findByTestId(view.container, "cheque-batch-item-0"))).toContain("elle");
    expect(textOf(findByTestId(view.container, "cheque-batch-item-0"))).toContain("Vade 01.11.2026 · keşide —");
    const scan = findByTestId(view.container, "cheque-batch-add-scan");
    await act(async () => { reactProps(scan)?.onClick?.(); });
    expect(textOf(findByTestId(view.container, "cheque-batch-item-1"))).toContain("Garanti · SCAN1");
    expect(textOf(findByTestId(view.container, "cheque-batch-item-1"))).toContain("📷 okundu");
    expect(textOf(findByTestId(view.container, "cheque-batch-item-1"))).toContain("Vade 15.12.2026");
    expect(textOf(findByTestId(view.container, "cheque-batch-total"))).toContain("2 çek · tek makbuz");
    expect(textOf(findByTestId(view.container, "cheque-batch-total"))).toContain("ALINAN ÇEK");
    await act(async () => { reactProps(findByTestId(view.container, "cheque-batch-item-0-remove"))?.onClick?.(); });
    expect(findByTestId(view.container, "cheque-batch-item-1")).toBeNull();
    expect(textOf(findByTestId(view.container, "cheque-batch-item-0"))).toContain("SCAN1");
    act(() => { view.root.unmount(); });
  });

  it("disables adding another cheque at 50", () => {
    let items: ChequeBatchItem[] = [];
    const seed = {
      ...emptyChequeDraft("2026-10-20"),
      contact_id: "c1",
      contact_name: "Acme A.Ş.",
      amount: "1",
      due_date: "2026-11-01",
    };
    for (let i = 0; i < CHEQUE_BATCH_LIMIT; i += 1) items = addBatchItem(items, seed);
    const view = renderList(items);
    expect(reactProps(findByTestId(view.container, "cheque-batch-add-manual"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(view.container, "cheque-batch-add-scan"))?.disabled).toBe(true);
    act(() => { view.root.unmount(); });
  });
});
