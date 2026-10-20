import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { SavedChequeBatch } from "../../utils/chequeBatch";
import { printChequeGroupReceipt, printChequeReceipt, shareChequeGroupReceipt, shareChequeReceipt } from "../../utils/chequeShare";
import { fmtMoney } from "../../utils/money";
import { ChequeSavedConfirm } from "../ChequeSavedConfirm";
import { router } from "expo-router";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({ contact_id: "c1", contact_name: "Acme A.Ş." }),
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: { baseUrl: "https://api.test", token: "tok" },
    companyId: "co-1",
    activeCompany: { name: "TamKobi" },
  }),
  apiErrorMessage: (err: unknown, fallback?: string) => String((err as Error)?.message || fallback || ""),
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
}));

jest.mock("../../utils/chequeShare", () => ({
  printChequeReceipt: jest.fn(async () => true),
  printChequeGroupReceipt: jest.fn(async () => true),
  shareChequeReceipt: jest.fn(async () => true),
  shareChequeGroupReceipt: jest.fn(async () => true),
}));

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

const client = { baseUrl: "https://api.test", token: "tok" };

const groupSaved: SavedChequeBatch = {
  mode: "group",
  contactId: "c1",
  contactName: "Acme A.Ş.",
  direction: "received",
  recordDate: "2026-10-20",
  receiptGroupId: "grp-1",
  total: 140,
  items: [
    { id: "a", amount: 100, due_date: "2026-11-01", contact_name: "Acme A.Ş.", direction: "received", instrument: "cheque", serial_no: "A1", status: "open" },
    { id: "b", amount: 40, due_date: "2026-12-01", contact_name: "Acme A.Ş.", direction: "received", instrument: "cheque", serial_no: "A2", status: "open" },
  ],
};

const singleSaved: SavedChequeBatch = {
  ...groupSaved,
  mode: "single",
  receiptGroupId: undefined,
  total: 100,
  items: [groupSaved.items[0]],
};

function renderConfirm(saved: SavedChequeBatch, onNew = jest.fn()) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(ChequeSavedConfirm, { saved, onNew })); });
  return { container, root, onNew };
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  await act(async () => { await reactProps(node)?.onClick?.(); });
}

describe("ChequeSavedConfirm", () => {
  beforeEach(() => {
    (get as unknown as jest.Mock).mockReset();
    (printChequeReceipt as unknown as jest.Mock).mockClear();
    (printChequeGroupReceipt as unknown as jest.Mock).mockClear();
    (shareChequeReceipt as unknown as jest.Mock).mockClear();
    (shareChequeGroupReceipt as unknown as jest.Mock).mockClear();
    (router.replace as jest.Mock).mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("shows the saved summary and total", () => {
    const view = renderConfirm(groupSaved);
    const text = textOf(findByTestId(view.container, "cheque-saved"));
    expect(text).toContain("2 çek kaydedildi");
    expect(text).toContain("Acme A.Ş. cari bakiyesine işlendi · portföyde “açık”");
    expect(text).toContain("Cari");
    expect(text).toContain("Adet");
    expect(text).toContain("2");
    expect(text).toContain("Vade");
    expect(text).toContain("01.11.2026 – 01.12.2026");
    expect(text).toContain("Kayıt tarihi");
    expect(text).toContain("20.10.2026");
    expect(text).toContain("Toplam");
    expect(text).toContain(fmtMoney(140));
    expect(text).toContain("🖨 Makbuz yazdır (2 çek, tek makbuz)");
    act(() => { view.root.unmount(); });
  });

  it("prints a group receipt from GET /cheques/receipt and a single cheque with the existing printer", async () => {
    const group = { receipt_group_id: "grp-1", cheques: groupSaved.items, total: 140 };
    (get as unknown as jest.Mock).mockResolvedValue(group);
    const grouped = renderConfirm(groupSaved);
    await press(grouped.container, "cheque-saved-print");
    expect(get).toHaveBeenCalledWith(client, "/cheques/receipt", { group_id: "grp-1", company_id: "co-1" });
    expect(printChequeGroupReceipt).toHaveBeenCalledWith(group, { name: "TamKobi" }, client);
    expect(printChequeReceipt).not.toHaveBeenCalled();
    act(() => { grouped.root.unmount(); });

    (get as unknown as jest.Mock).mockClear();
    (printChequeGroupReceipt as unknown as jest.Mock).mockClear();
    const single = renderConfirm(singleSaved);
    await press(single.container, "cheque-saved-print");
    expect(get).not.toHaveBeenCalled();
    expect(printChequeReceipt).toHaveBeenCalledWith(singleSaved.items[0], { name: "TamKobi" }, client);
    expect(printChequeGroupReceipt).not.toHaveBeenCalled();
    act(() => { single.root.unmount(); });
  });

  it("shares, opens the contact and starts a new collection", async () => {
    const onNew = jest.fn();
    const view = renderConfirm(groupSaved, onNew);
    await press(view.container, "cheque-saved-share");
    expect(shareChequeGroupReceipt).toHaveBeenCalledWith(expect.objectContaining({
      receipt_group_id: "grp-1",
      total: 140,
      cheques: groupSaved.items,
    }), { name: "TamKobi" }, client);
    await press(view.container, "cheque-saved-contact");
    expect(router.replace).toHaveBeenCalledWith({
      pathname: "/contacts/[id]",
      params: { id: "c1", name: "Acme A.Ş." },
    });
    await press(view.container, "cheque-saved-new");
    expect(onNew).toHaveBeenCalled();
    act(() => { view.root.unmount(); });

    const single = renderConfirm(singleSaved);
    await press(single.container, "cheque-saved-share");
    expect(shareChequeReceipt).toHaveBeenCalledWith(singleSaved.items[0], { name: "TamKobi" }, client);
    act(() => { single.root.unmount(); });
  });
});
