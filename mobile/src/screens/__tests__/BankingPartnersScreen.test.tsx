import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { go } from "../../nav";
import { BankingPartnersPanel } from "../BankingPartnersScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: () => true,
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

jest.mock("../../nav", () => ({ go: jest.fn() }));
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

const partners = [{
  id: "p1",
  name: "Ali BAL",
  share_percent: 40,
  balance: 800,
  monthly_salary: 0,
}];

const summary = {
  partner_count: 1,
  total_card_pocket: 800,
  total_balance: 50,
  total_cash_in: 1000,
  total_cash_out: 200,
  total_capital_in: 1000,
  total_withdrawn: 200,
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

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("BankingPartnersPanel", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  beforeEach(() => {
    (get as unknown as jest.Mock).mockReset();
    (go as unknown as jest.Mock).mockReset();
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/banking/partners") return partners;
      if (path === "/banking/partners/summary") return summary;
      if (path === "/banking/partners/transactions") return [];
      if (path === "/banking/partners/ledgers") {
        return { p1: { drift: false, stored: 800, ledger: 800, count: 0, netMatchesCard: true } };
      }
      if (path === "/expenses/categories") return [];
      return [];
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  it("labels NET from partner balance meta and opens the detail", async () => {
    await act(async () => {
      root.render(React.createElement(BankingPartnersPanel, { accounts: [], onChanged: jest.fn() }));
    });
    await flush();
    const summaryNode = findByTestId(container, "partners-summary");
    expect(textOf(summaryNode)).toContain("Toplam aldığı");
    expect(textOf(summaryNode)).toContain("Toplam ödediği");
    expect(textOf(findByTestId(container, "partners-summary-net"))).toContain("NET · Ortak borçlu");
    expect(textOf(findByTestId(container, "partner-badge-p1"))).toBe("Ortak borçlu");
    expect(textOf(findByTestId(container, "partner-flow-p1"))).toContain("Aldığı");
    expect(textOf(container)).toContain("ORTAKLAR · 1");
    await press(container, "partner-row-p1");
    await flush();
    expect(findByTestId(container, "partner-detail")).toBeTruthy();
    expect(findByTestId(container, "partners-selected-dock")).toBeTruthy();
    expect(textOf(findByTestId(container, "partner-detail"))).toContain("pay %40 · aylık maaş —");
  });

  it("keeps virman and the expense sheet", async () => {
    await act(async () => {
      root.render(React.createElement(BankingPartnersPanel, { accounts: [], onChanged: jest.fn() }));
    });
    await flush();
    await press(container, "partner-virman-btn");
    expect(go).toHaveBeenCalledWith("BankingVirman");
    await press(container, "partner-row-p1");
    await flush();
    await press(container, "partner-more-p1");
    await press(container, "partner-expense-btn-p1");
    expect(findByTestId(container, "partner-expense-modal")).toBeTruthy();
    expect(findByTestId(container, "partner-exp-amount")).toBeTruthy();
    expect(findByTestId(container, "partner-exp-description")).toBeTruthy();
    expect(findByTestId(container, "partner-exp-save")).toBeTruthy();
  });
});
