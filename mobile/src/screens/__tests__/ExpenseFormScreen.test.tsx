import "../../test/domSetup";
import React, { act } from "react";
import { get, post, put } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { ExpenseFormScreen } from "../ExpenseFormScreen";

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
    useLocalSearchParams: () => ({}),
    router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

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
      value?: string;
      placeholder?: string;
      editable?: boolean;
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        value: props.value,
        placeholder: props.placeholder,
        disabled: props.editable === false,
        onClick: () => props.onPress?.(),
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }, props.children);
    };
  const TextInput = Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } });
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
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput,
    Image: host("img"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

const account = { id: "acc-1", account_name: "Kasa", type: "cash_box", currency: "TRY", current_balance: 500 };
const expense = {
  id: "e1",
  expense_number: "MSR-1",
  date: "2026-10-02",
  category: "Yakıt",
  description: "Depo yakıtı",
  amount: 80,
  vat_rate: 20,
  vat_included: false,
  total: 96,
  currency: "TRY",
  payment_status: "paid",
  account_id: "acc-1",
  account_name: "Kasa",
};

function mockLists() {
  (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string, query?: { q?: string }) => {
    if (path === "/expenses") {
      const row = query?.q && query.q !== expense.id ? null : expense;
      return Promise.resolve({ expenses: row ? [expense] : [] });
    }
    if (path === "/banking/accounts") return Promise.resolve([account]);
    if (path === "/expenses/categories") return Promise.resolve([{ name: "Yakıt", is_default: true }]);
    if (path === "/banking/partners") return Promise.resolve([]);
    if (path === "/projects") return Promise.resolve([]);
    return Promise.resolve([]);
  });
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

async function typeInto(container: unknown, id: string, value: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}`);
  const props = reactProps(node);
  await act(async () => { await props?.onChange?.({ target: { value } }); });
  await settle();
}

function renderForm(expenseId?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(ExpenseFormScreen, expenseId ? { expenseId } : {})); });
  return { container, root };
}

describe("ExpenseFormScreen", () => {
  beforeEach(() => {
    mockLists();
    (post as unknown as jest.Mock).mockReset();
    (put as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({});
    (put as unknown as jest.Mock).mockResolvedValue({});
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (get as unknown as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("keeps save-and-pay on a new expense and hides pay or delete", async () => {
    const view = renderForm();
    await settle();
    expect(textOf(findByTestId(view.container, "exp-save"))).toContain("Kaydet");
    expect(textOf(findByTestId(view.container, "exp-save"))).not.toContain("Kaydet & öde");
    expect(findByTestId(view.container, "exp-pay-select")).toBeTruthy();
    expect(findByTestId(view.container, "exp-pay")).toBeNull();
    expect(findByTestId(view.container, "exp-pay-select-edit")).toBeNull();
    expect(findByTestId(view.container, "exp-unpay")).toBeNull();
    expect(findByTestId(view.container, "exp-delete")).toBeNull();

    await press(view.container, "exp-save");
    expect(textOf(view.container)).toContain("Açıklama zorunlu.");
    expect(post).not.toHaveBeenCalled();

    await press(view.container, "exp-pay-select");
    await press(view.container, "exp-pay-select-opt-acc-1");
    expect(textOf(findByTestId(view.container, "exp-save"))).toContain("Kaydet & öde");

    await typeInto(view.container, "exp-description", "Kira");
    await typeInto(view.container, "exp-amount", "150");
    await press(view.container, "exp-save");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/expenses", expect.objectContaining({
      description: "Kira",
      account_id: "acc-1",
      company_id: "co-1",
    }));
    expect((post as unknown as jest.Mock).mock.calls.some((call) => String(call[1]).includes("/pay"))).toBe(false);
    view.root.unmount();
  });

  it("updates an existing expense without pay or delete actions", async () => {
    const view = renderForm("e1");
    await settle();
    expect(textOf(findByTestId(view.container, "exp-save"))).toContain("Güncelle");
    expect(findByTestId(view.container, "exp-pay")).toBeNull();
    expect(findByTestId(view.container, "exp-delete")).toBeNull();
    expect(findByTestId(view.container, "exp-unpay")).toBeNull();
    expect(findByTestId(view.container, "exp-pay-select")).toBeNull();
    expect(findByTestId(view.container, "exp-pay-select-edit")).toBeNull();
    expect(textOf(view.container)).toContain("MSR-1");
    await press(view.container, "exp-save");
    expect(put).toHaveBeenCalledWith(mockAuth.client, "/expenses/e1", expect.objectContaining({
      description: "Depo yakıtı",
      company_id: "co-1",
    }));
    expect(post).not.toHaveBeenCalled();
    expect(textOf(view.container)).toContain("Masraf güncellendi.");
    view.root.unmount();
  });
});
