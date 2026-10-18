import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { del, get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtMoney } from "../../utils/money";
import { PartnerDetail } from "../PartnerDetail";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let allowEdit = true;

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: (path: string, level?: string) => allowEdit && (path === "/banking" || path === "/expenses") && (level == null || level === "edit" || level === "view"),
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(async () => ({})),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  displayFileUrl: () => "",
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (typeof style === "function") return flatten((style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    if (typeof style === "object") return style as Record<string, unknown>;
    return undefined;
  };
  const host = (tag: string) =>
    function Host(props: { testID?: string; style?: unknown; disabled?: boolean; onPress?: () => void; children?: React.ReactNode }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
      }, props.children);
    };
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
    ActivityIndicator: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    Image: host("img"),
    TextInput,
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 2, fontScale: 1 }),
  };
});

const partner = {
  id: "p1",
  name: "Ali BAL",
  share_percent: 50,
  balance: 1200,
  monthly_salary: 10000,
  phone: "555",
  email: "ali@firma.test",
};

const accounts = [
  { id: "int", type: "bank", is_integrated: true, account_name: "Entegre Banka", current_balance: 1 },
  { id: "pos", type: "pos", account_name: "Mağaza POS", current_balance: 2 },
  { id: "cash", type: "cash_box", account_name: "Ana Kasa", current_balance: 300 },
  { id: "bank", type: "bank", is_integrated: false, account_name: "Vadesiz", current_balance: 400 },
];

const txs = [
  { id: "tx1", partner_id: "p1", type: "capital_in", amount: 1200, date: "2026-10-01", description: "sermaye" },
];

let ledger: Record<string, unknown> = {
  p1: { drift: false, stored: 1200, ledger: 1200, count: 1, netMatchesCard: true },
};

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: ParentNode, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  await act(async () => {
    reactProps(node)?.onClick?.();
    await Promise.resolve();
  });
}

async function typeInto(container: ParentNode, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  await act(async () => {
    reactProps(node)?.onChange?.({ target: { value } });
    await Promise.resolve();
  });
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("PartnerDetail", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  async function show() {
    await act(async () => {
      root.render(React.createElement(PartnerDetail, {
        partner,
        accounts,
        txs,
        onBack: jest.fn(),
        onExpense: jest.fn(),
        onChanged: jest.fn(async () => undefined),
      }));
    });
    await flush();
  }

  beforeEach(() => {
    allowEdit = true;
    ledger = { p1: { drift: false, stored: 1200, ledger: 1200, count: 1, netMatchesCard: true } };
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (del as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/banking/partners/ledgers") return ledger;
      return [];
    });
    (post as unknown as jest.Mock).mockResolvedValue({});
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  it("shows a green match line when the ledger agrees", async () => {
    await show();
    expect(textOf(findByTestId(container, "partner-ledger-check"))).toBe("✓ Bakiye hareketlerle uyumlu");
    expect(textOf(findByTestId(container, "partner-badge-p1"))).toBe("Ortak borçlu");
  });

  it("shows the drift line when the stored balance disagrees", async () => {
    ledger = { p1: { drift: true, stored: 1200, ledger: 1000, count: 2, netMatchesCard: false } };
    await show();
    const line = textOf(findByTestId(container, "partner-ledger-check"));
    expect(line).toBe(`Sapma: kayıtlı ${fmtMoney(1200)} ≠ hareket ${fmtMoney(1000)}`);
  });

  it("hides the ledger row when the check request fails", async () => {
    (get as unknown as jest.Mock).mockRejectedValue(new Error("down"));
    await show();
    expect(findByTestId(container, "partner-ledger-check")).toBeNull();
  });

  it("posts capital_in with the first cash or bank account", async () => {
    await show();
    await press(container, "partner-tx-btn-capital_in");
    expect(findByTestId(container, "partner-tx-sheet")).toBeTruthy();
    expect(textOf(findByTestId(container, "partner-tx-type"))).toBe("capital_in");
    expect(textOf(findByTestId(container, "partner-tx-account"))).toContain("Ana Kasa");
    expect(findByTestId(container, "partner-tx-account-opt-pos")).toBeNull();
    await typeInto(container, "partner-tx-amount", "1500");
    await typeInto(container, "partner-tx-description", "sermaye");
    await press(container, "partner-tx-save");
    await flush();
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/banking/partners/transactions", {
      partner_id: "p1",
      type: "capital_in",
      amount: 1500,
      account_id: "cash",
      description: "sermaye",
      company_id: "co-1",
    });
    expect(textOf(container)).toContain("Para Koy kaydedildi.");
  });

  it("posts debit with a null account", async () => {
    await show();
    await press(container, "partner-tx-btn-debit");
    expect(textOf(findByTestId(container, "partner-tx-type"))).toBe("debit");
    expect(findByTestId(container, "partner-tx-account")).toBeNull();
    await typeInto(container, "partner-tx-amount", "250");
    await typeInto(container, "partner-tx-description", "düzeltme");
    await press(container, "partner-tx-save");
    await flush();
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/banking/partners/transactions", {
      partner_id: "p1",
      type: "debit",
      amount: 250,
      account_id: null,
      description: "düzeltme",
      company_id: "co-1",
    });
  });

  it("shows the pending approval message", async () => {
    (post as unknown as jest.Mock).mockResolvedValue({
      status: "pending_approval",
      message: "Diğer yönetici onayı bekleniyor.",
    });
    await show();
    await press(container, "partner-tx-btn-withdrawal");
    await typeInto(container, "partner-tx-amount", "80");
    await press(container, "partner-tx-save");
    await flush();
    expect(textOf(container)).toContain("Diğer yönetici onayı bekleniyor.");
    expect(textOf(container)).not.toContain("Para Çek kaydedildi.");
  });

  it("hides movement buttons and the more menu without edit permission", async () => {
    allowEdit = false;
    await show();
    expect(findByTestId(container, "partner-tx-btn-capital_in")).toBeNull();
    expect(findByTestId(container, "partner-tx-btn-withdrawal")).toBeNull();
    expect(findByTestId(container, "partner-tx-btn-credit")).toBeNull();
    expect(findByTestId(container, "partner-tx-btn-debit")).toBeNull();
    expect(findByTestId(container, "partner-more-p1")).toBeNull();
    expect(textOf(findByTestId(container, "partner-ledger-check"))).toContain("Bakiye hareketlerle uyumlu");
  });

  it("does not delete when the confirm is cancelled", async () => {
    await show();
    await press(container, "partner-more-p1");
    await press(container, "partner-delete-p1");
    expect(Alert.alert).toHaveBeenCalledWith("Ortağı sil", "Ali BAL silinsin mi?", expect.any(Array));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    buttons.find((button) => button.text === "Vazgeç")?.onPress?.();
    expect(del).not.toHaveBeenCalled();
  });
});
