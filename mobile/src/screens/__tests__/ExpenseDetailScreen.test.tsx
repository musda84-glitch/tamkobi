import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { del, get, post } from "../../api/client";
import { ApiHttpError } from "../../api/errors";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtDate, fmtMoney } from "../../utils/money";
import { ExpenseDetailScreen } from "../ExpenseDetailScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
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
    useLocalSearchParams: () => ({ id: "e1" }),
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));

let allowEdit = true;

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: (path?: string, level?: string) => (path === "/expenses" && level === "edit" ? allowEdit : false),
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
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    if (typeof style === "object") return style as Record<string, unknown>;
    return undefined;
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      disabled?: boolean;
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
        onPress: props.onPress,
        onChangeText: props.onChangeText,
      }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: {},
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
    TextInput: host("input"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

const expense = {
  id: "e1",
  expense_number: "MSR-2026-0001",
  date: "2026-10-18",
  category: "Kira",
  description: "Firma Adı: ABC Ltd",
  contact_name: "ERSAY HOME",
  document_no: "FİŞ-9",
  vat_rate: 20,
  vat_included: true,
  total: 1200,
  currency: "TRY",
  payment_status: "unpaid",
  account_name: "",
  project_id: "prj-1",
  notes: "Kasım kirası",
};

const account = { id: "acc-1", account_name: "Kasa", type: "cash_box", currency: "TRY", current_balance: 500 };
const project = { id: "prj-1", project_number: "PRJ-1", name: "Merkez" };

function countTag(node: { tagName?: string; nodeName?: string; childNodes?: unknown[] } | null, tag: string): number {
  if (!node) return 0;
  const name = String(node.tagName || node.nodeName || "").toUpperCase();
  const self = name === tag ? 1 : 0;
  const kids = (node.childNodes || []) as { tagName?: string; nodeName?: string; childNodes?: unknown[] }[];
  return self + kids.reduce((sum, child) => sum + countTag(child, tag), 0);
}

async function settle() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 500)}`);
  const props = reactProps(node);
  await act(async () => { await (props?.onClick || props?.onPress)?.(); });
  await settle();
}

async function confirmAlert() {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { style?: string; onPress?: () => void }[];
  const yes = buttons?.find((button) => button.style === "destructive");
  await act(async () => { await yes?.onPress?.(); });
  await settle();
}

function renderDetail() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(ExpenseDetailScreen)); });
  return { container, root };
}

function mockGets(doc: Record<string, unknown> | null, fail?: "missing" | "error") {
  (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
    if (path === "/expenses") {
      if (fail === "missing") return Promise.reject(new ApiHttpError(404, "yok", "bulunamadı"));
      if (fail === "error") return Promise.reject(new ApiHttpError(500, "kapalı", "Masraf yüklenemedi."));
      if (!doc) return Promise.resolve({ expenses: [] });
      return Promise.resolve({ expenses: [doc] });
    }
    if (path === "/banking/accounts") return Promise.resolve([account]);
    if (path === "/banking/partners") return Promise.resolve([{ id: "p1", name: "Ali", is_active: true }]);
    if (path === "/projects") return Promise.resolve([project]);
    return Promise.resolve([]);
  });
}

describe("ExpenseDetailScreen", () => {
  beforeEach(() => {
    allowEdit = true;
    (post as unknown as jest.Mock).mockReset();
    (del as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({});
    (del as unknown as jest.Mock).mockResolvedValue({});
    (Alert.alert as jest.Mock).mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (get as unknown as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("separates loading, a missing expense, and a failed load", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/expenses") return new Promise(() => undefined);
      return Promise.resolve([]);
    });
    const loading = renderDetail();
    await settle();
    expect(findByTestId(loading.container, "exp-detail-loading")).toBeTruthy();
    expect(textOf(loading.container)).toContain("Yükleniyor…");
    expect(textOf(loading.container)).not.toContain("Masraf bulunamadı.");
    loading.root.unmount();

    mockGets(null);
    const missing = renderDetail();
    await settle();
    expect(findByTestId(missing.container, "exp-detail-notfound")).toBeTruthy();
    expect(textOf(missing.container)).toContain("Masraf bulunamadı.");
    expect(findByTestId(missing.container, "exp-detail-retry")).toBeNull();
    expect(findByTestId(missing.container, "exp-detail-loading")).toBeNull();
    missing.root.unmount();

    mockGets(null, "missing");
    const httpMissing = renderDetail();
    await settle();
    expect(findByTestId(httpMissing.container, "exp-detail-notfound")).toBeTruthy();
    httpMissing.root.unmount();

    let fail = true;
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (path === "/expenses") {
        if (fail) return Promise.reject(new ApiHttpError(500, "kapalı", "Masraf yüklenemedi."));
        return Promise.resolve({ expenses: [expense] });
      }
      if (path === "/projects") return Promise.resolve([project]);
      return Promise.resolve([]);
    });
    const broken = renderDetail();
    await settle();
    expect(findByTestId(broken.container, "exp-detail-retry")).toBeTruthy();
    expect(textOf(broken.container)).not.toContain("Masraf bulunamadı.");
    fail = false;
    await press(broken.container, "exp-detail-retry");
    expect(textOf(broken.container)).toContain("MSR-2026-0001");
    expect(findByTestId(broken.container, "exp-header-total")).toBeTruthy();
    broken.root.unmount();
  });

  it("renders the expense read-only and opens the editor", async () => {
    mockGets(expense);
    const view = renderDetail();
    await settle();
    const body = textOf(view.container);
    expect(countTag(view.container as never, "INPUT")).toBe(0);
    expect(findByTestId(view.container, "exp-amount")).toBeNull();
    expect(findByTestId(view.container, "exp-description")).toBeNull();
    expect(textOf(findByTestId(view.container, "exp-header-total"))).toBe(fmtMoney(expense.total, expense.currency));
    expect(textOf(findByTestId(view.container, "exp-detail-badge"))).toBe("Ödenmedi");
    expect(textOf(findByTestId(view.container, "exp-detail-vendor"))).toBe("ERSAY HOME");
    expect(textOf(findByTestId(view.container, "exp-detail-number"))).toContain("MSR-2026-0001");
    expect(textOf(findByTestId(view.container, "exp-detail-category"))).toBe("Kira");
    expect(textOf(findByTestId(view.container, "exp-detail-date"))).toBe(fmtDate(expense.date));
    expect(textOf(findByTestId(view.container, "exp-detail-description"))).toContain("Firma Adı: ABC Ltd");
    expect(textOf(findByTestId(view.container, "exp-detail-document"))).toContain("FİŞ-9");
    expect(textOf(findByTestId(view.container, "exp-detail-vat"))).toContain("%20 · KDV dahil");
    expect(textOf(findByTestId(view.container, "exp-detail-contact"))).toContain("ERSAY HOME");
    expect(textOf(findByTestId(view.container, "exp-detail-project"))).toContain("PRJ-1 · Merkez");
    expect(textOf(findByTestId(view.container, "exp-detail-account"))).toContain("—");
    expect(textOf(findByTestId(view.container, "exp-detail-notes"))).toContain("Kasım kirası");
    expect(body).toContain("✏️");
    const { go } = require("../../nav") as { go: jest.Mock };
    await press(view.container, "exp-edit");
    expect(go).toHaveBeenCalledWith("ExpenseEdit", { id: "e1" });
    view.root.unmount();

    const next = { ...expense, total: 1500 };
    mockGets(next);
    const again = renderDetail();
    await settle();
    expect(textOf(findByTestId(again.container, "exp-header-total"))).toBe(fmtMoney(1500, "TRY"));
    again.root.unmount();
  });

  it("hides the editor and payment actions without edit permission", async () => {
    allowEdit = false;
    mockGets(expense);
    const view = renderDetail();
    await settle();
    expect(findByTestId(view.container, "exp-edit")).toBeNull();
    expect(findByTestId(view.container, "exp-pay")).toBeNull();
    expect(findByTestId(view.container, "exp-unpay")).toBeNull();
    expect(findByTestId(view.container, "exp-delete")).toBeNull();
    expect(findByTestId(view.container, "exp-pay-select-edit")).toBeNull();
    expect(textOf(findByTestId(view.container, "exp-detail-vendor"))).toBe("ERSAY HOME");
    view.root.unmount();
  });

  it("pays an unpaid expense from the selected account", async () => {
    mockGets(expense);
    const view = renderDetail();
    await settle();
    expect(findByTestId(view.container, "exp-unpay")).toBeNull();
    await press(view.container, "exp-pay-select-edit");
    await press(view.container, "exp-pay-select-edit-opt-acc-1");
    await press(view.container, "exp-pay");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/expenses/e1/pay", { account_id: "acc-1", partner_id: null });
    expect(textOf(view.container)).toContain("Masraf ödendi.");
    view.root.unmount();
  });

  it("undoes a payment and deletes the expense after confirmation", async () => {
    mockGets({ ...expense, payment_status: "paid", account_name: "Kasa" });
    const view = renderDetail();
    await settle();
    expect(textOf(findByTestId(view.container, "exp-detail-badge"))).toBe("Ödendi");
    expect(textOf(findByTestId(view.container, "exp-detail-account"))).toContain("Kasa");
    expect(findByTestId(view.container, "exp-pay")).toBeNull();
    await press(view.container, "exp-unpay");
    expect(Alert.alert).toHaveBeenCalledWith("Ödemeyi geri al", "Kasa/banka bakiyesi düzeltilir.", expect.any(Array));
    await confirmAlert();
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/expenses/e1/unpay");
    expect(textOf(view.container)).toContain("Ödeme geri alındı.");

    await press(view.container, "exp-delete");
    expect(Alert.alert).toHaveBeenCalledWith("Masrafı sil", "MSR-2026-0001 silinsin mi?", expect.any(Array));
    const { router } = require("expo-router") as typeof import("expo-router");
    await confirmAlert();
    expect(del).toHaveBeenCalledWith(mockAuth.client, "/expenses/e1");
    expect(router.back).toHaveBeenCalled();
    view.root.unmount();
  });
});
