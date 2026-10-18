import "../../test/domSetup";
import React, { act } from "react";
import { get, post } from "../../api/client";
import { clickable, findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtDate, fmtMoney } from "../../utils/money";
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
    (props: { testID?: string; value?: string; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
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

const COMPANY_ID = "co-1";
const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: COMPANY_ID,
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

const TX_ID = "tx1";
const EMP_ID = "emp1";
const EMP_NAME = "Ayşe Yılmaz";
const OPEN_ID = "msr-open";
const CLOSED_ID = "msr-closed";
const DETAIL = "Bu personelde açık masraf borcu yok — Avans, Maaş veya 'Şirket masrafı' seçin.";

const openExpense = {
  id: OPEN_ID,
  expense_number: "MSR-2026-0007",
  date: "2026-09-02",
  amount: 120.5,
  personnel_debt_status: "open",
};
const closedExpense = {
  id: CLOSED_ID,
  expense_number: "MSR-2026-0008",
  date: "2026-08-01",
  amount: 80,
  personnel_debt_status: "closed",
};

let cardBody: { expenses?: unknown; open_personnel_debts?: unknown } = {
  expenses: [openExpense, closedExpense],
};

function mockGets() {
  (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    const p = String(path || "");
    if (p === `/personnel/employees/${EMP_ID}/card`) return cardBody;
    if (p === "/banking/transactions/unmatched") {
      return [{
        id: TX_ID,
        type: "outflow",
        amount: 150,
        description: "Market",
        date: "2026-10-01",
        account_id: "acc1",
      }];
    }
    if (p === "/personnel/employees") return [{ id: EMP_ID, full_name: EMP_NAME, is_active: true }];
    if (p === "/expenses/categories") return [{ name: "Yakıt" }, { name: "Personel Masrafı" }];
    return [];
  });
}

function matchCalls() {
  return (post as unknown as jest.Mock).mock.calls.filter((call) => String(call[1] || "").includes("/match"));
}

async function flush() {
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

async function pressId(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const target = clickable(node) || node;
  const props = reactProps(target);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
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

describe("BankingMatchPanel reimburse", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: ReturnType<typeof document.createElement>;

  beforeEach(() => {
    cardBody = { expenses: [openExpense, closedExpense] };
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
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
      root.render(React.createElement(BankingMatchPanel, { accounts: [], onChanged: () => undefined }));
    });
    await flush();
    await pressId(container, `unmatched-tx-${TX_ID}`);
  }

  async function choosePersonnelExpense() {
    await pressId(container, "match-mode-expense");
    await pressId(container, `match-expense-cat-${TX_ID}`);
    await pressId(container, `match-expense-cat-${TX_ID}-opt-Personel Masrafı`);
    await pressId(container, `match-employee-${TX_ID}`);
    await pressId(container, `match-employee-${TX_ID}-opt-${EMP_ID}`);
    await flush();
  }

  it("defaults to Masraf iadesi and posts reimburse with the employee", async () => {
    await show();
    await pressId(container, "match-mode-expense");
    await pressId(container, `match-expense-cat-${TX_ID}`);
    await pressId(container, `match-expense-cat-${TX_ID}-opt-Personel Masrafı`);
    expect(textOf(findByTestId(container, `match-pay-kind-${TX_ID}`))).toContain("Masraf iadesi");
    await pressId(container, `match-employee-${TX_ID}`);
    await pressId(container, `match-employee-${TX_ID}-opt-${EMP_ID}`);
    await flush();
    await pressId(container, `match-btn-${TX_ID}`);
    await flush();
    expect(matchCalls()).toHaveLength(1);
    expect(matchCalls()[0][1]).toBe(`/banking/transactions/${TX_ID}/match`);
    expect(matchCalls()[0][2]).toMatchObject({
      as_expense: true,
      employee_id: EMP_ID,
      personnel_pay_kind: "reimburse",
      expense_id: null,
    });
    expect(textOf(container)).toContain(EMP_NAME);
    expect(textOf(container)).toContain("Masraf iadesi");
    expect(textOf(container)).toContain("eşleştirildi");
  });

  it("lists only open debts, sends expense_id, and drops it for Avans", async () => {
    await show();
    await choosePersonnelExpense();
    expect(get).toHaveBeenCalledWith(
      mockAuth.client,
      `/personnel/employees/${EMP_ID}/card`,
      { company_id: COMPANY_ID },
    );
    expect(textOf(findByTestId(container, `match-msr-${TX_ID}`))).toContain("Otomatik (en eski açık borçlar)");
    await pressId(container, `match-msr-${TX_ID}`);
    const openOpt = findByTestId(container, `match-msr-${TX_ID}-opt-${OPEN_ID}`);
    expect(openOpt).toBeTruthy();
    expect(findByTestId(container, `match-msr-${TX_ID}-opt-${CLOSED_ID}`)).toBeNull();
    expect(textOf(openOpt)).toBe(`MSR-2026-0007 · ${fmtDate(openExpense.date)} · ${fmtMoney(openExpense.amount)}`);
    expect(textOf(container)).not.toContain("MSR-2026-0008");
    await pressId(container, `match-msr-${TX_ID}-opt-${OPEN_ID}`);
    await pressId(container, `match-btn-${TX_ID}`);
    await flush();
    expect(matchCalls()[0][2]).toMatchObject({
      personnel_pay_kind: "reimburse",
      expense_id: OPEN_ID,
      employee_id: EMP_ID,
      as_expense: true,
    });

    await pressId(container, `unmatched-tx-${TX_ID}`);
    await choosePersonnelExpense();
    await pressId(container, `match-pay-kind-${TX_ID}`);
    await pressId(container, `match-pay-kind-${TX_ID}-opt-advance`);
    expect(textOf(container)).not.toContain("Personel bakiyesini değiştirmez.");
    await pressId(container, `match-btn-${TX_ID}`);
    await flush();
    expect(matchCalls()[1][2]).toMatchObject({
      personnel_pay_kind: "advance",
      expense_id: null,
      employee_id: EMP_ID,
    });

    await pressId(container, `unmatched-tx-${TX_ID}`);
    await choosePersonnelExpense();
    await pressId(container, `match-pay-kind-${TX_ID}`);
    await pressId(container, `match-pay-kind-${TX_ID}-opt-expense`);
    expect(textOf(findByTestId(container, `match-expense-note-${TX_ID}`))).toContain("Personel bakiyesini değiştirmez.");
  });

  it("uses open_personnel_debts when expenses is missing and warns when none are open", async () => {
    cardBody = { open_personnel_debts: [openExpense, closedExpense] };
    await show();
    await choosePersonnelExpense();
    await pressId(container, `match-msr-${TX_ID}`);
    expect(findByTestId(container, `match-msr-${TX_ID}-opt-${OPEN_ID}`)).toBeTruthy();
    expect(findByTestId(container, `match-msr-${TX_ID}-opt-${CLOSED_ID}`)).toBeNull();

    await pressId(container, `match-pay-kind-${TX_ID}`);
    await pressId(container, `match-pay-kind-${TX_ID}-opt-advance`);
    cardBody = { expenses: [closedExpense] };
    await pressId(container, `match-pay-kind-${TX_ID}`);
    await pressId(container, `match-pay-kind-${TX_ID}-opt-reimburse`);
    await flush();
    expect(textOf(findByTestId(container, `match-msr-empty-${TX_ID}`))).toContain(
      "Açık masraf borcu görünmüyor; kaydederseniz sunucu uyarı verebilir.",
    );
    expect(textOf(findByTestId(container, `match-msr-${TX_ID}`))).toContain("Otomatik (en eski açık borçlar)");
    expect(findByTestId(container, `match-msr-${TX_ID}-opt-${CLOSED_ID}`)).toBeNull();
  });

  it("blocks category-only personnel pay and switches into expense mode", async () => {
    await show();
    await pressId(container, "match-mode-category");
    await typeId(container, `match-category-${TX_ID}`, "Personel Masrafı");
    expect(textOf(container)).toContain("Personel ödemesi için 'Masraf' modunda personel seçin.");
    expect(textOf(container)).toContain("Masraf moduna geç");
    const btn = findByTestId(container, `match-btn-${TX_ID}`);
    expect(reactProps(btn)?.disabled).toBe(true);
    await pressId(container, `match-btn-${TX_ID}`);
    expect(matchCalls()).toHaveLength(0);
    await pressId(container, `match-goto-expense-${TX_ID}`);
    expect(findByTestId(container, `match-category-${TX_ID}`)).toBeNull();
    expect(findByTestId(container, `match-expense-cat-${TX_ID}`)).toBeTruthy();
    expect(textOf(findByTestId(container, `match-pay-kind-${TX_ID}`))).toContain("Masraf iadesi");
    expect(textOf(container)).not.toContain("Personel ödemesi için 'Masraf' modunda personel seçin.");
  });

  it("shows the backend 400 detail for a reimburse with no open debt", async () => {
    (post as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("/match")) {
        throw { status: 400, response: { status: 400, data: { detail: DETAIL } } };
      }
      return {};
    });
    await show();
    await choosePersonnelExpense();
    await pressId(container, `match-btn-${TX_ID}`);
    await flush();
    expect(textOf(container)).toContain(DETAIL);
  });
});
