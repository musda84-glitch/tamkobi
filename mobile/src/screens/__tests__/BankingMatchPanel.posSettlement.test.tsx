import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post } from "../../api/client";
import { clickable, findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { formatSummary } from "../../utils/posSettlement";
import { BankingMatchPanel } from "../BankingMatchPanel";

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
  apiErrorMessage: (err: unknown, fallback?: string) => {
    const { apiErrorMessage } = jest.requireActual("../../api/errors") as typeof import("../../api/errors");
    return apiErrorMessage(err, fallback);
  },
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: (_base: string, url?: string | null) => url || "",
}));

const accounts = [
  { id: "pos-1", type: "pos", account_name: "Sanal POS", current_balance: 5000 },
  { id: "bank-1", type: "bank", account_name: "Vadesiz", current_balance: 20 },
];

const inflow = {
  id: "tx-in",
  type: "inflow",
  amount: 100,
  description: "POS yatan",
  date: "2026-10-21",
  account_id: "bank-1",
  suggested_match_kind: "pos_settlement",
  suggested_target_account_id: "pos-1",
  suggested_target_account_name: "Sanal POS",
  suggested_pos_commission_rate: 0.1,
  suggested_pos_gross: 111.11,
  suggested_category: "POS Komisyonu",
};

const outflow = {
  id: "tx-out",
  type: "outflow",
  amount: 40,
  description: "Kira",
  date: "2026-10-20",
};

const matched = {
  id: "tx-done",
  type: "inflow",
  amount: 90,
  description: "Dün POS",
  date: "2026-10-20",
  match_status: "matched",
  match_kind: "pos_settlement",
  target_account_name: "Sanal POS",
  category: "POS Komisyonu",
  pos_gross: 100,
  pos_commission: 10,
  expense_number: "MSR-9",
};

function mockGets() {
  (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    if (path === "/banking/transactions/unmatched") return [inflow, outflow];
    if (path === "/banking/transactions/matched") return [matched];
    if (path === "/expenses/categories") return [{ name: "Yakıt" }];
    return [];
  });
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function pressId(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 800)}`);
  const target = clickable(node) || node;
  const props = reactProps(target);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
  await flush();
}

function inputValue(container: unknown, id: string): string {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing input ${id}; text=${textOf(container).slice(0, 500)}`);
  return String(reactProps(node)?.value ?? "");
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("BankingMatchPanel POS bloke çözümü", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: ReturnType<typeof document.createElement>;

  beforeEach(() => {
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    mockGets();
    (post as unknown as jest.Mock).mockResolvedValue({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function show() {
    await act(async () => {
      root.render(React.createElement(BankingMatchPanel, { accounts, onChanged: () => undefined }));
    });
    await flush();
  }

  it("shows the suggestion chip, the matched POS row, then success and unmatch", async () => {
    await show();
    expect(textOf(findByTestId(container, "unmatched-pos-chip-tx-in"))).toBe("POS bloke çözümü önerisi · Sanal POS");
    expect(findByTestId(container, "unmatched-pos-chip-tx-out")).toBeNull();

    await pressId(container, "toggle-matched-btn");
    expect(textOf(findByTestId(container, "matched-pos-chip-tx-done"))).toBe("POS bloke");
    expect(textOf(findByTestId(container, "matched-pos-expense-tx-done"))).toContain("↳ Masraf · POS komisyonu (MSR-9)");

    await pressId(container, "unmatched-tx-tx-in");
    expect(findByTestId(container, "match-mode-pos_settlement")).toBeTruthy();
    expect(inputValue(container, "match-pos-gross-tx-in")).toBe("100,00");
    expect(inputValue(container, "match-pos-net-tx-in")).toBe("100,00");
    expect(textOf(container)).not.toContain("111,11");

    await pressId(container, "match-btn-tx-in");
    const matchCall = (post as unknown as jest.Mock).mock.calls.find((call) => String(call[1]).endsWith("/match"));
    expect(matchCall?.[1]).toBe("/banking/transactions/tx-in/match");
    expect(matchCall?.[2]).toEqual({
      mode: "pos_settlement",
      target_account_id: "pos-1",
      pos_gross: 100,
      pos_commission: 0,
      category: "POS Komisyonu",
      learn: true,
    });
    expect(matchCall?.[2]).not.toHaveProperty("contact_id");
    expect(matchCall?.[2]).not.toHaveProperty("invoice_id");
    expect(matchCall?.[2]).not.toHaveProperty("as_expense");
    expect(textOf(findByTestId(container, "pos-settlement-summary"))).toBe(
      formatSummary({ posName: "Sanal POS", gross: 100, net: 100 }),
    );

    await pressId(container, "pos-settlement-unmatch");
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { style?: string; onPress?: () => void }[];
    const yes = buttons?.find((button) => button.style === "destructive");
    await act(async () => { yes?.onPress?.(); });
    await flush();
    const unmatchCall = (post as unknown as jest.Mock).mock.calls.find((call) => String(call[1]).endsWith("/unmatch"));
    expect(unmatchCall?.[1]).toBe("/banking/transactions/tx-in/unmatch");
    expect(unmatchCall?.[2]).toEqual({});
  });

  it("does not offer POS bloke çözümü for an outflow", async () => {
    await show();
    await pressId(container, "unmatched-tx-tx-out");
    expect(findByTestId(container, "match-mode-pos_settlement")).toBeNull();
    expect(findByTestId(container, "match-mode-contact")).toBeTruthy();
  });
});
