import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { BankingAccountScreen } from "../BankingAccountScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let allowBank = true;
let allowExp = true;

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: (path?: string) => {
    if (path === "/banking") return allowBank;
    if (path === "/expenses") return allowExp;
    return false;
  },
};

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
    useLocalSearchParams: () => ({ id: "acc-1" }),
    router: { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => mockAuth,
  apiErrorMessage: (err: unknown, fallback?: string) => {
    const { apiErrorMessage } = jest.requireActual("../../api/errors") as typeof import("../../api/errors");
    return apiErrorMessage(err, fallback);
  },
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(async () => ({})),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
}));

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
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput,
  };
});

const LONG = "Bu açıklama kartta iki satıra sığmaz ve hareket detayında eksiksiz durmalıdır. İkinci cümle de burada.";

let account: Record<string, unknown>;
let txs: Record<string, unknown>[];

function integratedAccount(extra: Record<string, unknown> = {}) {
  return {
    id: "acc-1",
    account_name: "Vadesiz TL",
    bank_name: "Kuveyt Türk",
    type: "bank",
    iban: "TR330006200519786457841326",
    current_balance: 1500,
    currency: "TRY",
    is_integrated: true,
    integration_provider: "Kuveyt Türk",
    integration_status: "connected",
    connection_id: "conn-1",
    last_synced_at: "2026-10-18T07:00:00+00:00",
    month_in: 140,
    month_out: 20,
    unmatched_count: 2,
    ...extra,
  };
}

function movementRows() {
  return [
    { id: "tx-open", source: "bank_sync", match_status: "unmatched", type: "inflow", amount: 50, description: "Gelen havale", date: "2026-10-17", category: "Havale" },
    { id: "tx-done", source: "bank_sync", match_status: "matched", type: "outflow", amount: 80, description: "Kira ödemesi", date: "2026-10-16", category: "Kira", matched_by_name: "Ayşe", created_by_name: "Mehmet" },
    { id: "tx-lock", source: "bank_sync", match_status: "rematching", type: "inflow", amount: 10, description: "Kilitli hareket", date: "2026-10-15" },
    { id: "tx-manual", source: "manual", match_status: "unmatched", type: "inflow", amount: 5, description: "Elden tahsilat", date: "2026-10-14" },
    { id: "tx-partner", source: "partner", match_status: "matched", type: "outflow", amount: 3, description: "Ortak çıkışı", date: "2026-10-13" },
    { id: "tx-virman", source: "bank_match", match_status: "matched", type: "transfer", amount: 7, description: "Virman satırı", date: "2026-10-12" },
    { id: "tx-long", source: "manual", type: "inflow", amount: 1, description: LONG, date: "2026-10-11" },
  ];
}

function styleOf(node: unknown): Record<string, unknown> {
  const style = reactProps(node as never)?.style;
  if (!style) return {};
  if (Array.isArray(style)) return Object.assign({}, ...style.filter(Boolean));
  return style as Record<string, unknown>;
}

function textColor(node: unknown): unknown {
  const kids = (node as { childNodes?: { tagName?: string }[] })?.childNodes || [];
  const span = kids.find((child) => child.tagName === "SPAN");
  return styleOf(span).color;
}

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function pressId(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const props = reactProps(node);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

function postsTo(part: string) {
  return (post as unknown as jest.Mock).mock.calls.filter((call) => String(call[1] || "").includes(part));
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("BankingAccountScreen match actions", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: ReturnType<typeof document.createElement>;

  beforeEach(() => {
    allowBank = true;
    allowExp = true;
    account = integratedAccount();
    txs = movementRows();
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/banking/accounts") return [account];
      if (path === "/banking/transactions") return txs;
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

  async function show() {
    await act(async () => { root.render(React.createElement(BankingAccountScreen)); });
    await flush();
  }

  it("shows an amber match button only for an unmatched bank sync movement", async () => {
    await show();
    const match = findByTestId(container, "bank-tx-match-tx-open");
    expect(textOf(match)).toBe("Eşleştir");
    expect(styleOf(match).backgroundColor).toBe("#F59E0B");
    expect(textColor(match)).toBe("#FFFFFF");
    const change = findByTestId(container, "bank-tx-rematch-tx-done");
    const remove = findByTestId(container, "bank-tx-unmatch-tx-done");
    expect(textOf(change)).toBe("Değiştir");
    expect(styleOf(change).backgroundColor).toBe("#F0FDF4");
    expect(styleOf(change).borderColor).toBe("#6EE7B7");
    expect(textColor(change)).toBe("#047857");
    expect(textOf(remove)).toBe("Kaldır");
    expect(styleOf(remove).backgroundColor).toBe("#FFFFFF");
    expect(styleOf(remove).borderColor).toBe("#FDA4AF");
    expect(textColor(remove)).toBe("#E11D48");
    for (const id of ["tx-manual", "tx-partner", "tx-virman"]) {
      expect(findByTestId(container, `bank-tx-match-${id}`)).toBeNull();
      expect(findByTestId(container, `bank-tx-rematch-${id}`)).toBeNull();
      expect(findByTestId(container, `bank-tx-unmatch-${id}`)).toBeNull();
    }
    expect(textOf(findByTestId(container, "bank-tx-row-tx-lock"))).toContain("Eşleştiriliyor…");
    expect(findByTestId(container, "bank-tx-match-tx-lock")).toBeNull();
    expect(findByTestId(container, "bank-tx-rematch-tx-lock")).toBeNull();
    expect(findByTestId(container, "bank-tx-unmatch-tx-lock")).toBeNull();
  });

  it("hides match buttons when the user cannot edit banking", async () => {
    allowBank = false;
    await show();
    expect(findByTestId(container, "bank-tx-match-tx-open")).toBeNull();
    expect(findByTestId(container, "bank-tx-rematch-tx-done")).toBeNull();
    expect(findByTestId(container, "bank-tx-unmatch-tx-done")).toBeNull();
    expect(textOf(container)).toContain("Eşleştiriliyor…");
    expect(findByTestId(container, "bank-account-sync")).toBeNull();
  });

  it("opens replace without unmatch and posts replace true", async () => {
    await show();
    await pressId(container, "bank-tx-rematch-tx-done");
    expect(textOf(findByTestId(container, "bank-match-sheet"))).toContain("Eşleştirmeyi değiştir");
    expect(postsTo("/unmatch")).toHaveLength(0);
    await pressId(container, "match-btn-tx-done");
    await flush();
    expect(postsTo("/unmatch")).toHaveLength(0);
    expect(postsTo("/match")).toHaveLength(1);
    expect(postsTo("/match")[0][1]).toBe("/banking/transactions/tx-done/match");
    expect(postsTo("/match")[0][2].replace).toBe(true);
  });

  it("cancels replace without a request", async () => {
    await show();
    await pressId(container, "bank-tx-rematch-tx-done");
    await pressId(container, "match-cancel-tx-done");
    expect(postsTo("/match")).toHaveLength(0);
    expect(postsTo("/unmatch")).toHaveLength(0);
  });

  it("skips unmatch when the confirm is dismissed and posts when it is accepted", async () => {
    await show();
    await pressId(container, "bank-tx-unmatch-tx-done");
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text?: string; onPress?: () => void }[];
    expect(buttons[0].text).toBe("Vazgeç");
    expect(postsTo("/unmatch")).toHaveLength(0);
    await act(async () => { await buttons[1].onPress?.(); });
    await flush();
    expect(postsTo("/unmatch")).toHaveLength(1);
    expect(postsTo("/unmatch")[0][1]).toBe("/banking/transactions/tx-done/unmatch");
    expect(textOf(container)).toContain("Eşleşme geri alındı.");
  });

  it("shows the full description in the movement sheet", async () => {
    await show();
    await pressId(container, "bank-tx-row-tx-long");
    const sheet = findByTestId(container, "bank-tx-sheet");
    expect(textOf(sheet)).toContain(LONG);
    expect(textOf(sheet)).toContain("Oluşturan");
    expect(textOf(sheet)).toContain("Eşleştiren");
  });

  it("offers sync only for an integrated account the user can edit, and never an Ekstre button", async () => {
    await show();
    expect(findByTestId(container, "bank-account-sync")).toBeTruthy();
    expect(textOf(container)).not.toContain("Ekstre");
    await pressId(container, "bank-account-sync");
    await flush();
    expect(postsTo("/sync")).toHaveLength(1);
    expect(postsTo("/sync")[0][1]).toBe("/banking/connections/conn-1/sync");
    expect(textOf(container)).not.toContain("Ekstre");
  });

  it("hides sync on a manual account", async () => {
    account = { id: "acc-1", account_name: "Merkez kasa", type: "cash_box", current_balance: 10, is_integrated: false };
    await show();
    expect(findByTestId(container, "bank-account-sync")).toBeNull();
    expect(textOf(container)).not.toContain("Senkronize");
    expect(textOf(container)).not.toContain("Ekstre");
  });

  it("shows a dash when this month totals are missing", async () => {
    account = { id: "acc-1", account_name: "Vadesiz", type: "bank", current_balance: 12, is_integrated: false };
    txs = [];
    await show();
    expect(textOf(findByTestId(container, "bank-month-in"))).toBe("—");
    expect(textOf(findByTestId(container, "bank-month-out"))).toBe("—");
    expect(textOf(findByTestId(container, "bank-last-sync"))).toContain("—");
  });
});
