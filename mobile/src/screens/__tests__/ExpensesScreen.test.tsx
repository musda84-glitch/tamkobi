import "../../test/domSetup";
import React, { act } from "react";
import * as ImagePicker from "expo-image-picker";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { go } from "../../nav";
import { expenseScanNavParams, extractExpenseFromAsset } from "../../utils/expenseScan";
import { fmtMoney } from "../../utils/money";
import { ExpensesScreen } from "../ExpensesScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let allowEdit = true;

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  can: (path?: string, level?: string) => {
    if (path !== "/expenses") return false;
    if (level === "edit") return allowEdit;
    return true;
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
    useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
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
  upload: jest.fn(async () => ({})),
}));

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file://cam.jpg" }] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: "file://lib.jpg" }] })),
}));

jest.mock("../../utils/expenseScan", () => {
  const actual = jest.requireActual("../../utils/expenseScan") as typeof import("../../utils/expenseScan");
  return { ...actual, extractExpenseFromAsset: jest.fn() };
});

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
    (props: { testID?: string; value?: string; onChangeText?: (value: string) => void; placeholder?: string }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        placeholder: props.placeholder,
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

const summary = { this_month_total: 1150, unpaid_total: 1100, unpaid_count: 2, count: 3 };

function sampleExpenses() {
  return [
    {
      id: "e1",
      expense_number: "MSR-1",
      date: "2026-10-02",
      category: "Yakıt",
      description: "Firma Adı: ABC Ltd",
      total: 100,
      payment_status: "unpaid",
      currency: "TRY",
    },
    {
      id: "e2",
      expense_number: "MSR-2",
      date: "2026-10-18",
      category: "Yemek",
      description: "öğle",
      contact_name: "Lokanta",
      total: 50,
      payment_status: "paid",
      currency: "TRY",
    },
    {
      id: "e3",
      expense_number: "MSR-3",
      date: "2026-09-05",
      category: "Kira",
      description: "ofis",
      total: 1000,
      payment_status: "unpaid",
      currency: "TRY",
    },
  ];
}

async function settle() {
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
  await act(async () => { handler(); });
  await settle();
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("ExpensesScreen", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLElement;

  beforeEach(() => {
    allowEdit = true;
    (get as unknown as jest.Mock).mockReset();
    (go as unknown as jest.Mock).mockReset();
    (extractExpenseFromAsset as unknown as jest.Mock).mockReset();
    (ImagePicker.launchCameraAsync as unknown as jest.Mock).mockClear();
    (ImagePicker.launchImageLibraryAsync as unknown as jest.Mock).mockClear();
    (get as unknown as jest.Mock).mockResolvedValue({ expenses: sampleExpenses(), summary });
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container?.parentNode?.removeChild(container);
  });

  async function show() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(ExpensesScreen)); });
    await settle();
  }

  it("renders vendor, badge, amount and month totals from loaded rows", async () => {
    await show();
    expect(textOf(findByTestId(container, "exp-row-e1-vendor"))).toBe("ABC Ltd");
    expect(textOf(findByTestId(container, "exp-row-e1-badge"))).toBe("Ödenmedi");
    expect(reactProps(findByTestId(container, "exp-row-e1-badge"))?.style?.color).toBe("#F59E0B");
    expect(textOf(findByTestId(container, "exp-row-e1-amount"))).toBe(fmtMoney(100, "TRY"));
    expect(textOf(findByTestId(container, "exp-row-e2-vendor"))).toBe("Lokanta");
    expect(textOf(findByTestId(container, "exp-row-e2-badge"))).toBe("Ödendi");
    expect(reactProps(findByTestId(container, "exp-row-e2-badge"))?.style?.color).toBe("#059669");
    expect(textOf(findByTestId(container, "exp-month-2026-10"))).toBe("Ekim 2026");
    expect(textOf(findByTestId(container, "exp-month-2026-10-total"))).toBe(fmtMoney(150, "TRY"));
    expect(textOf(findByTestId(container, "exp-month-2026-09"))).toBe("Eylül 2026");
    expect(textOf(findByTestId(container, "exp-month-2026-09-total"))).toBe(fmtMoney(1000, "TRY"));
    expect(textOf(findByTestId(container, "exp-summary"))).toContain("Bu ay toplam");
    expect(textOf(findByTestId(container, "exp-summary"))).toContain(fmtMoney(1150));
    expect(textOf(findByTestId(container, "exp-summary"))).toContain(`Ödenmemiş ${fmtMoney(1100)} / 2`);
    const monthText = textOf(container);
    expect(monthText.indexOf("Ekim 2026")).toBeLessThan(monthText.indexOf("Eylül 2026"));

    await pressId(container, "exp-row-e1");
    expect(go).toHaveBeenCalledWith("ExpenseDetail", { id: "e1" });
  });

  it("keeps status on the API and filters the loaded rows in the client", async () => {
    await show();
    expect((get as unknown as jest.Mock).mock.calls[0][1]).toBe("/expenses");
    expect((get as unknown as jest.Mock).mock.calls[0][2]).toEqual({ company_id: "co-1", status: undefined });

    await pressId(container, "exp-status-unpaid");
    expect((get as unknown as jest.Mock).mock.calls.at(-1)?.[2]).toEqual({ company_id: "co-1", status: "unpaid" });

    const input = findByTestId(container, "exp-search");
    expect(reactProps(input)?.placeholder).toBe("Açıklama / no / kategori");
    await act(async () => {
      reactProps(input)?.onChange?.({ target: { value: "lokanta" } });
    });
    await settle();
    expect(findByTestId(container, "exp-row-e2")).toBeTruthy();
    expect(findByTestId(container, "exp-row-e1")).toBeNull();
    expect(textOf(findByTestId(container, "exp-month-2026-10-total"))).toBe(fmtMoney(50, "TRY"));
  });

  it("opens a new expense from the red plus and from Elle gir", async () => {
    await show();
    expect(reactProps(findByTestId(container, "exp-new-btn"))?.style?.backgroundColor).toBe("#E11D48");
    await pressId(container, "exp-new-btn");
    expect(go).toHaveBeenCalledWith("ExpenseNew");

    (go as unknown as jest.Mock).mockClear();
    await pressId(container, "exp-scan-open");
    const sheet = findByTestId(container, "exp-scan-sheet");
    expect(sheet).toBeTruthy();
    expect(textOf(findByTestId(container, "exp-scan-camera"))).toContain("Kamera ile oku");
    expect(textOf(findByTestId(container, "exp-scan-gallery"))).toContain("Galeriden oku");
    expect(textOf(findByTestId(container, "exp-scan-manual"))).toContain("Elle gir");
    expect(textOf(findByTestId(container, "exp-scan-cancel"))).toContain("Vazgeç");
    const sheetText = textOf(sheet);
    expect(sheetText.indexOf("Kamera ile oku")).toBeLessThan(sheetText.indexOf("Galeriden oku"));
    expect(sheetText.indexOf("Galeriden oku")).toBeLessThan(sheetText.indexOf("Elle gir"));
    expect(sheetText.indexOf("Elle gir")).toBeLessThan(sheetText.indexOf("Vazgeç"));
    expect(reactProps(findByTestId(container, "exp-scan-open"))?.style?.backgroundColor).toBe("#4F46E5");
    await pressId(container, "exp-scan-manual");
    expect(go).toHaveBeenCalledWith("ExpenseNew");
    expect(findByTestId(container, "exp-scan-sheet")).toBeNull();
  });

  it("closes the scan sheet from Vazgeç", async () => {
    await show();
    await pressId(container, "exp-scan-open");
    expect(findByTestId(container, "exp-scan-sheet")).toBeTruthy();
    await pressId(container, "exp-scan-cancel");
    expect(findByTestId(container, "exp-scan-sheet")).toBeNull();
    expect(go).not.toHaveBeenCalled();
  });

  it("runs the existing camera and gallery scan flow", async () => {
    const draft = { amount: 80, category: "Yemek", description: "Öğle yemeği", vat_rate: 10 };
    let release: (value: unknown) => void = () => undefined;
    (extractExpenseFromAsset as unknown as jest.Mock).mockImplementation(
      () => new Promise((resolve) => { release = resolve; }),
    );
    await show();
    await pressId(container, "exp-scan-open");
    await pressId(container, "exp-scan-camera");
    expect(textOf(container)).toContain("Okunuyor…");
    expect(ImagePicker.launchCameraAsync).toHaveBeenCalled();
    await act(async () => { release({ draft, matched_contact: { id: "c1" } }); });
    await settle();
    expect(extractExpenseFromAsset).toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith("ExpenseNew", expenseScanNavParams(draft, { id: "c1" }));

    (go as unknown as jest.Mock).mockClear();
    (extractExpenseFromAsset as unknown as jest.Mock).mockResolvedValue({
      draft: { amount: 20, description: "Galeri fişi", category: "Kira" },
      matched_contact: null,
    });
    await pressId(container, "exp-scan-open");
    await pressId(container, "exp-scan-gallery");
    expect(ImagePicker.launchImageLibraryAsync).toHaveBeenCalled();
    expect(go).toHaveBeenCalledWith("ExpenseNew", expect.objectContaining({ amount: "20", category: "Kira" }));
  });

  it("keeps the newest 80 rows when a hundred arrive out of order", async () => {
    const day = (index: number) => new Date(Date.UTC(2026, 0, 1) + index * 86400000).toISOString().slice(0, 10);
    const rows = Array.from({ length: 100 }, (_, index) => ({
      id: `n${index}`,
      expense_number: `MSR-${index}`,
      date: day(index),
      category: "Diğer",
      description: `Kalem ${index}`,
      total: index + 1,
      payment_status: "unpaid",
      currency: "TRY",
    }));
    const unordered: typeof rows = [];
    for (let lo = 0, hi = rows.length - 1; lo <= hi; lo += 1, hi -= 1) {
      unordered.push(rows[lo]);
      if (lo !== hi) unordered.push(rows[hi]);
    }
    (get as unknown as jest.Mock).mockResolvedValue({ expenses: unordered, summary });
    await show();

    let shown = 0;
    for (let index = 0; index < rows.length; index += 1) {
      const node = findByTestId(container, `exp-row-n${index}`);
      if (index >= 20) {
        expect(node).toBeTruthy();
        shown += 1;
      } else {
        expect(node).toBeNull();
      }
    }
    expect(shown).toBe(80);

    const totals = new Map<string, number>();
    rows.slice(20).forEach((row) => {
      const key = row.date.slice(0, 7);
      totals.set(key, (totals.get(key) || 0) + row.total);
    });
    totals.forEach((amount, key) => {
      expect(textOf(findByTestId(container, `exp-month-${key}-total`))).toBe(fmtMoney(amount, "TRY"));
    });
    expect(textOf(findByTestId(container, "exp-month-2026-01-total"))).toBe(fmtMoney(286, "TRY"));
  });

  it("hides create and scan when the user cannot edit", async () => {
    allowEdit = false;
    await show();
    expect(findByTestId(container, "exp-new-btn")).toBeNull();
    expect(findByTestId(container, "exp-scan-open")).toBeNull();
    expect(findByTestId(container, "exp-row-e2")).toBeTruthy();
    expect(textOf(container)).not.toContain("Masraf yok");
  });
});
