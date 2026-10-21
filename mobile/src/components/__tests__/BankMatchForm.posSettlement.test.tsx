import "../../test/domSetup";
import React, { act, useState } from "react";
import { clickable, findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { BankMatchForm } from "../BankMatchForm";
import { emptyMatchDraft, type BankMatchTx, type MatchDraft } from "../../utils/bankMatch";
import type { BankAccount, ExpenseCategory } from "../../utils/finance";
import { fmtDate } from "../../utils/money";
import { grossFromRate } from "../../utils/posSettlement";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const view = (props: { testID?: string; children?: React.ReactNode }) =>
    ReactLib.createElement("div", { "data-testid": props.testID }, props.children);
  const text = (props: { testID?: string; children?: React.ReactNode }) =>
    ReactLib.createElement("span", { "data-testid": props.testID }, props.children);
  const pressable = (props: { testID?: string; disabled?: boolean; onPress?: () => unknown; children?: React.ReactNode }) =>
    ReactLib.createElement("button", {
      "data-testid": props.testID,
      disabled: !!props.disabled,
      onClick: () => (props.disabled ? undefined : props.onPress?.()),
    }, props.children);
  const TextInput = Object.assign(
    (props: { testID?: string; value?: string; editable?: boolean; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        "data-editable": String(props.editable !== false),
        value: props.value ?? "",
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }),
    { State: { currentlyFocusedInput: () => null } },
  );
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      absoluteFillObject: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => style,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    View: view,
    Text: text,
    Pressable: pressable,
    ScrollView: view,
    KeyboardAvoidingView: view,
    Image: () => null,
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? view({ children: props.children }) : null),
    TextInput,
    Dimensions: { get: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }) },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: () => true,
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(async () => ({})),
  post: jest.fn(async () => ({})),
}));

const TX_ID = "tx-pos";
const accounts: BankAccount[] = [
  { id: "bank-1", type: "bank", account_name: "Vadesiz", current_balance: 9000 },
  { id: "cash-1", type: "cash_box", account_name: "Merkez kasa", current_balance: 40 },
  { id: "pos-1", type: "pos", account_name: "Sanal POS", current_balance: 5000 },
  { id: "okc-1", type: "okc_pos", account_name: "ÖKC POS", current_balance: 250.5 },
];
const cats: ExpenseCategory[] = [{ name: "Yakıt" }];

const inflow: BankMatchTx = {
  id: TX_ID,
  type: "inflow",
  amount: 100,
  date: "2026-10-21",
  description: "POS bloke",
  suggested_match_kind: "pos_settlement",
  suggested_target_account_id: "pos-1",
  suggested_target_account_name: "Sanal POS",
  suggested_category: "",
  suggested_pos_commission_rate: 0.1,
  suggested_pos_gross: 111.11,
};

function Harness({ tx, initial }: { tx: BankMatchTx; initial?: MatchDraft }) {
  const [draft, setDraft] = useState<MatchDraft>(() => initial || emptyMatchDraft(tx));
  const [contactLabel, setContactLabel] = useState("");
  return (
    <BankMatchForm
      tx={tx}
      draft={draft}
      setDraft={setDraft}
      contactLabel={contactLabel}
      setContactLabel={setContactLabel}
      accounts={accounts}
      partners={[]}
      expenseCats={cats}
      employees={[]}
      onSubmit={() => undefined}
      onCancel={() => undefined}
    />
  );
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
}

async function pressId(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 800)}`);
  const target = clickable(node) || node;
  const props = reactProps(target);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

function inputValue(container: unknown, id: string): string {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing input ${id}`);
  return String(reactProps(node)?.value ?? "");
}

async function typeId(container: unknown, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing input ${id}`);
  const props = reactProps(node);
  await act(async () => { await props?.onChange?.({ target: { value } }); });
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("BankMatchForm POS bloke çözümü", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: ReturnType<typeof document.createElement>;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show(tx: BankMatchTx, initial?: MatchDraft) {
    await act(async () => {
      root.render(React.createElement(Harness, { tx, initial }));
    });
    await flush();
  }

  it("lists only pos and okc_pos accounts, keeps net read-only, and defaults the category", async () => {
    await show(inflow);
    expect(findByTestId(container, "match-mode-pos_settlement")).toBeTruthy();
    expect(textOf(container)).toContain("POS Komisyonu");
    expect(textOf(container)).toContain("Oran önerisi otomatik uygulanmaz");
    expect(textOf(container)).toContain("Bu açıklama tekrar gelirse POS bloke çözümü olarak öner (öğren)");
    expect(inputValue(container, `match-pos-net-${TX_ID}`)).toBe("100,00");
    expect(findByTestId(container, `match-pos-net-${TX_ID}`)?.getAttribute("data-editable")).toBe("false");
    expect(inputValue(container, `match-pos-date-${TX_ID}`)).toBe(fmtDate("2026-10-21"));
    expect(findByTestId(container, `match-pos-date-${TX_ID}`)?.getAttribute("data-editable")).toBe("false");

    await pressId(container, `match-pos-account-${TX_ID}`);
    expect(findByTestId(container, `match-pos-account-${TX_ID}-opt-pos-1`)).toBeTruthy();
    expect(findByTestId(container, `match-pos-account-${TX_ID}-opt-okc-1`)).toBeTruthy();
    expect(findByTestId(container, `match-pos-account-${TX_ID}-opt-bank-1`)).toBeNull();
    expect(findByTestId(container, `match-pos-account-${TX_ID}-opt-cash-1`)).toBeNull();
    const options = textOf(findByTestId(container, `match-pos-account-${TX_ID}-wrap`));
    expect(options).toContain("Sanal POS");
    expect(options).toContain("ÖKC POS");
    expect(options).toContain("bloke bakiye");
    expect(options).not.toContain("Vadesiz");
    expect(options).not.toContain("Merkez kasa");

    await pressId(container, `match-pos-cat-${TX_ID}`);
    expect(findByTestId(container, `match-pos-cat-${TX_ID}-opt-POS Komisyonu`)).toBeTruthy();
    expect(findByTestId(container, `match-pos-cat-${TX_ID}-opt-Yakıt`)).toBeTruthy();
  });

  it("does not apply the suggested rate until the chip is pressed, and commission stays editable", async () => {
    await show(inflow);
    expect(inputValue(container, `match-pos-gross-${TX_ID}`)).toBe("100,00");
    expect(inputValue(container, `match-pos-commission-${TX_ID}`)).toBe("0,00");
    expect(textOf(container)).toContain("geçen sefer %10");
    expect(textOf(container)).not.toContain("111,11");

    await pressId(container, `match-pos-rate-edit-${TX_ID}`);
    expect(inputValue(container, `match-pos-gross-${TX_ID}`)).toBe("100,00");

    await pressId(container, `match-pos-rate-${TX_ID}`);
    expect(inputValue(container, `match-pos-gross-${TX_ID}`)).toBe("111,11");
    expect(inputValue(container, `match-pos-commission-${TX_ID}`)).toBe("11,11");
    expect(grossFromRate(100, 0.1)).toBe(111.11);

    await typeId(container, `match-pos-gross-${TX_ID}`, "150");
    expect(inputValue(container, `match-pos-gross-${TX_ID}`)).toBe("150,00");
    expect(inputValue(container, `match-pos-commission-${TX_ID}`)).toBe("50,00");

    await typeId(container, `match-pos-commission-${TX_ID}`, "15");
    expect(inputValue(container, `match-pos-commission-${TX_ID}`)).toBe("15,00");
    expect(inputValue(container, `match-pos-gross-${TX_ID}`)).toBe("115,00");
    expect(inputValue(container, `match-pos-net-${TX_ID}`)).toBe("100,00");
  });

  it("hides POS bloke çözümü on an outflow", async () => {
    await show({ id: "tx-out", type: "outflow", amount: 40, date: "2026-10-20", description: "Kira" });
    expect(findByTestId(container, "match-mode-pos_settlement")).toBeNull();
    expect(findByTestId(container, "match-mode-expense")).toBeTruthy();
    expect(findByTestId(container, "match-pos-tx-out")).toBeNull();
  });
});
