import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { del, get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { go } from "../../nav";
import { printInvoiceForm } from "../../utils/orderShare";
import { fmtMoney } from "../../utils/money";
import { InvoicesScreen } from "../InvoicesScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let allowEdit = true;
let allowDelete = true;
let dirParam: string | undefined;

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: null as null,
  can: (path?: string, level?: string) => {
    if (path !== "/invoices") return false;
    if (level === "edit") return allowEdit;
    if (level === "delete") return allowDelete;
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
    useLocalSearchParams: () => ({ dir: dirParam }),
    useRouter: () => ({
      setParams: (next: { dir?: string }) => { dirParam = next?.dir; },
      push: jest.fn(),
      back: jest.fn(),
    }),
    router: { push: jest.fn(), back: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("../../utils/orderShare", () => ({ printInvoiceForm: jest.fn(async () => true) }));

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
    (props: { testID?: string; value?: string; onChangeText?: (value: string) => void; placeholder?: string }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        placeholder: props.placeholder,
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }),
    { State: { currentlyFocusedInput: () => null } },
  );
  class AnimatedValue {
    constructor(public value: number) { this.value = value; }
    setValue(next: number) { this.value = next; }
  }
  const AnimatedView = host("div");
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
    Animated: {
      Value: AnimatedValue,
      spring: () => ({ start() { /* no-op */ } }),
      View: AnimatedView,
    },
    PanResponder: { create: () => ({ panHandlers: {} }) },
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

type Row = Record<string, unknown>;

function row(partial: Row): Row {
  return {
    invoice_type: "sales",
    e_type: "paper",
    status: "approved",
    payment_status: "unpaid",
    currency: "TRY",
    grand_total: 10,
    issue_date: "2026-10-01",
    due_date: "2026-10-15",
    contact_name: "Cari",
    ...partial,
  };
}

function pageOf(items: Row[], extra: Row = {}) {
  return {
    items,
    total: items.length,
    page: 1,
    page_size: 30,
    has_more: false,
    summary: { count: items.length, total_amount: 10, draft_count: 0, approved_count: items.length },
    ...extra,
  };
}

function pageCalls() {
  return (get as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/invoices/page");
}

function legacyCalls() {
  return (get as unknown as jest.Mock).mock.calls.filter((call) => call[1] === "/invoices");
}

function countTestId(node: unknown, id: string): number {
  const cur = node as { getAttribute?: (name: string) => string | null; childNodes?: unknown[] };
  let n = cur?.getAttribute?.("data-testid") === id ? 1 : 0;
  for (const child of cur?.childNodes || []) n += countTestId(child, id);
  return n;
}

function findStyle(node: unknown, match: (style: Record<string, unknown> | undefined) => boolean): boolean {
  const cur = node as { childNodes?: unknown[] };
  if (match(reactProps(cur)?.style as Record<string, unknown> | undefined)) return true;
  return (cur?.childNodes || []).some((child) => findStyle(child, match));
}

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function pressId(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 400)}`);
  const props = reactProps(node);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
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

describe("InvoicesScreen", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLElement;

  beforeEach(() => {
    allowEdit = true;
    allowDelete = true;
    dirParam = undefined;
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (del as unknown as jest.Mock).mockReset();
    (go as unknown as jest.Mock).mockReset();
    (printInvoiceForm as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({});
    (del as unknown as jest.Mock).mockResolvedValue({});
    (get as unknown as jest.Mock).mockResolvedValue(pageOf([]));
  });

  afterEach(() => {
    act(() => { root?.unmount(); });
    container?.parentNode?.removeChild(container);
  });

  async function show() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(InvoicesScreen)); });
    await settle();
  }

  it("shows a loading skeleton and hides the empty state until the list returns", async () => {
    let release: (value: unknown) => void = () => undefined;
    (get as unknown as jest.Mock).mockReturnValue(new Promise((resolve) => { release = resolve; }));
    await show();
    expect(findByTestId(container, "inv-loading")).toBeTruthy();
    expect(textOf(container)).toContain("Yükleniyor…");
    expect(textOf(container)).not.toContain("Fatura yok");
    await act(async () => { release(pageOf([])); });
    await settle();
    expect(findByTestId(container, "inv-loading")).toBeNull();
    expect(textOf(container)).toContain("Fatura yok");
  });

  it("shows the empty state for a successful empty page and reloads from the error banner", async () => {
    (get as unknown as jest.Mock).mockResolvedValueOnce(pageOf([], {
      summary: { count: 0, total_amount: 0, draft_count: 0, approved_count: 0 },
    }));
    await show();
    expect(textOf(container)).toContain("Fatura yok");
    expect(findByTestId(container, "inv-loading")).toBeNull();
    expect(textOf(findByTestId(container, "inv-sum-count"))).toBe("0");

    (get as unknown as jest.Mock).mockRejectedValueOnce(new Error("ağ koptu"));
    await pressId(container, "filter-tab-sales");
    expect(textOf(container)).toContain("ağ koptu");
    expect(textOf(container)).not.toContain("Fatura yok");
    expect(findByTestId(container, "inv-retry")).toBeTruthy();

    const loaded = row({ id: "s1", invoice_number: "SF-1", contact_name: "Satış A.Ş." });
    (get as unknown as jest.Mock).mockResolvedValueOnce(pageOf([loaded], {
      summary: { count: 1, total_amount: 10, draft_count: 0, approved_count: 1 },
    }));
    await pressId(container, "inv-retry");
    expect(textOf(container)).toContain("Satış A.Ş.");
    expect(textOf(container)).not.toContain("Fatura yok");
    const retry = pageCalls().at(-1);
    expect(retry?.[2]).toMatchObject({ tab: "sales", page: 1, page_size: 30 });
  });

  it("requests the sales tab from /invoices/page", async () => {
    await show();
    await pressId(container, "filter-tab-sales");
    expect(pageCalls().at(-1)?.[2]).toEqual({
      company_id: "co-1",
      tab: "sales",
      pay: "all",
      page: 1,
      page_size: 30,
    });
  });

  it("sends pay=unpaid for Ödenmedi and tab=outgoing_gib for Giden e", async () => {
    await show();
    await pressId(container, "inv-chip-unpaid");
    const unpaid = findByTestId(container, "inv-chip-unpaid");
    expect(reactProps(unpaid)?.style?.backgroundColor).toBe("#FFFBEB");
    expect(reactProps(unpaid)?.style?.borderColor).toBe("#F59E0B");
    expect(pageCalls().at(-1)?.[2]).toMatchObject({ tab: "all", pay: "unpaid", page: 1, page_size: 30 });

    await pressId(container, "filter-tab-outgoing_e");
    expect(pageCalls().at(-1)?.[2]).toMatchObject({ tab: "outgoing_gib", pay: "all", page: 1, page_size: 30 });
  });

  it("sends q 300ms after the search box changes", async () => {
    await show();
    const before = pageCalls().length;
    const input = findByTestId(container, "inv-search");
    expect(reactProps(input)?.placeholder).toBe("Fatura no / cari / GİB no");
    await act(async () => {
      reactProps(input)?.onChange?.({ target: { value: "ABC" } });
    });
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    expect(pageCalls().slice(before).some((call) => call[2]?.q)).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 200)); });
    await settle();
    expect(pageCalls().at(-1)?.[2]).toMatchObject({ q: "ABC", page: 1, page_size: 30, tab: "all" });
  });

  it("fills the summary boxes from summary and shows an em dash when a value is missing", async () => {
    (get as unknown as jest.Mock).mockResolvedValue(pageOf([row({ id: "a1" })], {
      summary: { count: 4, total_amount: 1250.5, draft_count: 2, approved_count: 2 },
    }));
    await show();
    expect(textOf(findByTestId(container, "inv-sum-count"))).toBe("4");
    expect(textOf(findByTestId(container, "inv-sum-total"))).toBe(fmtMoney(1250.5, "TRY"));
    expect(textOf(findByTestId(container, "inv-sum-draft"))).toBe("2");

    (get as unknown as jest.Mock).mockResolvedValue(pageOf([row({ id: "a1" })], { summary: {} }));
    await pressId(container, "filter-tab-purchase");
    expect(textOf(findByTestId(container, "inv-sum-count"))).toBe("—");
    expect(textOf(findByTestId(container, "inv-sum-total"))).toBe("—");
    expect(textOf(findByTestId(container, "inv-sum-draft"))).toBe("—");
  });

  it("appends the next page from Daha fazla and keeps a repeated id once", async () => {
    const first = row({ id: "a", invoice_number: "A-1", contact_name: "Bir" });
    const second = row({ id: "b", invoice_number: "B-1", contact_name: "İki" });
    const third = row({ id: "c", invoice_number: "C-1", contact_name: "Üç" });
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string, query: { page?: number }) => {
      if (path !== "/invoices/page") return [];
      if (query.page === 2) {
        return pageOf([second, third], { page: 2, has_more: false, summary: { count: 3, total_amount: 30, draft_count: 0 } });
      }
      return pageOf([first, second], { has_more: true, summary: { count: 3, total_amount: 30, draft_count: 0 } });
    });
    await show();
    expect(findByTestId(container, "inv-more")).toBeTruthy();
    expect(textOf(findByTestId(container, "inv-more"))).toContain("Daha fazla");
    await pressId(container, "inv-more");
    expect(pageCalls().at(-1)?.[2]).toMatchObject({ page: 2, page_size: 30 });
    expect(countTestId(container, "inv-row-a")).toBe(1);
    expect(countTestId(container, "inv-row-b")).toBe(1);
    expect(countTestId(container, "inv-row-c")).toBe(1);
    expect(textOf(container)).toContain("Üç");
  });

  it("keeps the loaded page when the next page fails and retries Daha fazla", async () => {
    let fail = true;
    const first = row({ id: "a", invoice_number: "A-1", contact_name: "Bir" });
    const third = row({ id: "c", invoice_number: "C-1", contact_name: "Üç" });
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string, query: { page?: number }) => {
      if (path === "/invoices/page" && query.page === 2) {
        if (fail) throw new Error("sayfa alınamadı");
        return pageOf([third], { page: 2, has_more: false });
      }
      return pageOf([first], { has_more: true, summary: { count: 2, total_amount: 10, draft_count: 0 } });
    });
    await show();
    await pressId(container, "inv-more");
    expect(textOf(container)).toContain("Bir");
    expect(textOf(container)).toContain("sayfa alınamadı");
    expect(findByTestId(container, "inv-more")).toBeTruthy();
    fail = false;
    await pressId(container, "inv-more");
    expect(textOf(container)).toContain("Üç");
    expect(countTestId(container, "inv-row-a")).toBe(1);
  });

  it("keeps dispatch, proforma and return on GET /invoices?type=", async () => {
    const outgoing = row({
      id: "d1", invoice_type: "dispatch", e_type: "e_dispatch", status: "draft",
      invoice_number: "IRS-1", contact_name: "Cikis Deposu", direction: "outgoing",
    });
    const incoming = row({
      id: "d2", invoice_type: "dispatch", e_type: "e_dispatch", status: "draft",
      invoice_number: "IRS-2", contact_name: "Giris Deposu", direction: "incoming",
    });
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string, query: { type?: string }) => {
      if (path === "/invoices" && query.type === "dispatch") return [outgoing, incoming];
      if (path === "/invoices") return [row({ id: "p1", invoice_type: query.type, invoice_number: String(query.type) })];
      return pageOf([]);
    });
    await show();
    await pressId(container, "filter-tab-dispatch");
    expect(legacyCalls().at(-1)?.[2]).toEqual({ company_id: "co-1", type: "dispatch" });
    expect(pageCalls().some((call) => call[2]?.tab === "dispatch")).toBe(false);
    expect(textOf(findByTestId(container, "dispatch-dir-count-out"))).toBe("1");
    expect(textOf(findByTestId(container, "dispatch-dir-count-in"))).toBe("1");
    expect(textOf(findByTestId(container, "inv-sum-count"))).toBe("1");
    await pressId(container, "dispatch-dir-in");
    expect(dirParam).toBe("in");
    await act(async () => { root.render(React.createElement(InvoicesScreen)); });
    await settle();
    expect(textOf(container)).toContain("Giris Deposu");
    expect(textOf(container)).not.toContain("Cikis Deposu");

    await pressId(container, "filter-tab-proforma");
    expect(legacyCalls().at(-1)?.[2]).toEqual({ company_id: "co-1", type: "proforma" });
    await pressId(container, "filter-tab-return");
    expect(legacyCalls().at(-1)?.[2]).toEqual({ company_id: "co-1", type: "return" });
  });

  it("swipes to delete a draft and cancel an issued e-invoice, and shows Faturalaştır on the draft card", async () => {
    const draft = row({
      id: "dr1", status: "draft", invoice_number: "TAS-1", contact_name: "Taslak Cari", grand_total: 50,
    });
    const issued = row({
      id: "c1", status: "approved", e_type: "e_invoice", einvoice_state: "sent", gib_status: "Gönderildi",
      invoice_number: "GIB-1", contact_name: "Kesilmiş", payment_status: "paid",
    });
    (get as unknown as jest.Mock).mockResolvedValue(pageOf([draft, issued], {
      summary: { count: 2, total_amount: 60, draft_count: 1, approved_count: 1 },
    }));
    await show();
    expect(findByTestId(container, "inv-faturalastir-dr1")).toBeTruthy();
    expect(textOf(container)).toContain("Faturalaştır");
    expect(textOf(findByTestId(container, "inv-row-dr1-del"))).toContain("Sil");
    expect(textOf(findByTestId(container, "inv-row-c1-del"))).toContain("İptal");
    expect(findStyle(findByTestId(container, "inv-row-dr1"), (style) => style?.borderLeftColor === "#F59E0B" && style?.borderLeftWidth === 4)).toBe(true);
    expect(findStyle(findByTestId(container, "inv-row-c1"), (style) => style?.borderLeftColor === "#F59E0B")).toBe(false);

    await pressId(container, "inv-row-dr1-del");
    const delButtons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text?: string; onPress?: () => Promise<void> }[];
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe("Faturayı sil");
    await act(async () => { await delButtons[1].onPress?.(); });
    await settle();
    expect(del).toHaveBeenCalledWith(mockAuth.client, "/invoices/dr1");

    await pressId(container, "inv-row-c1-del");
    const cancelButtons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { onPress?: () => Promise<void> }[];
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe("Faturayı iptal et");
    await act(async () => { await cancelButtons[1].onPress?.(); });
    await settle();
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/invoices/c1/cancel", {});
  });

  it("merges selected outgoing dispatches", async () => {
    const outgoingA = row({
      id: "d1", invoice_type: "dispatch", e_type: "e_dispatch", status: "draft", direction: "outgoing",
      invoice_number: "IRS-1", contact_name: "A",
    });
    const outgoingB = row({
      id: "d2", invoice_type: "dispatch", e_type: "e_dispatch", status: "draft", direction: "outgoing",
      invoice_number: "IRS-2", contact_name: "B",
    });
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/invoices") return [outgoingA, outgoingB];
      return pageOf([]);
    });
    await show();
    await pressId(container, "filter-tab-dispatch");
    const merge = findByTestId(container, "merge-dispatches-btn");
    expect(reactProps(merge)?.disabled).toBe(true);
    await pressId(container, "dispatch-select-d1");
    await pressId(container, "dispatch-select-d2");
    expect(reactProps(findByTestId(container, "merge-dispatches-btn"))?.disabled).toBe(false);
    await pressId(container, "merge-dispatches-btn");
    const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as { text?: string; onPress?: () => Promise<void> }[];
    expect(buttons[1].text).toBe("Birleştir");
    await act(async () => { await buttons[1].onPress?.(); });
    await settle();
    const call = (post as unknown as jest.Mock).mock.calls.find((item) => item[1] === "/dispatches/merge-to-invoice");
    expect(call?.[2].dispatch_ids).toEqual(["d1", "d2"]);
  });

  it("loads the full invoice before printing a draft PDF and hides header actions without edit permission", async () => {
    const draft = row({ id: "dr1", status: "draft", invoice_number: "TAS-1", contact_name: "Taslak Cari" });
    const full = { ...draft, items: [{ name: "Kalem", quantity: 1 }] };
    (get as unknown as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (path === "/invoices/dr1") return full;
      return pageOf([draft], { summary: { count: 1, total_amount: 10, draft_count: 1 } });
    });
    await show();
    expect(findByTestId(container, "create-new-invoice-btn")).toBeTruthy();
    expect(findByTestId(container, "inv-edoc-inbox-btn")).toBeTruthy();
    await pressId(container, "inv-pdf-dr1");
    expect(get).toHaveBeenCalledWith(mockAuth.client, "/invoices/dr1");
    expect(printInvoiceForm).toHaveBeenCalledWith(full, null, mockAuth.client);
    await pressId(container, "create-new-invoice-btn");
    expect(go).toHaveBeenCalledWith("InvoiceNew", { type: "all" });
    await pressId(container, "filter-tab-sales");
    await pressId(container, "create-new-invoice-btn");
    expect(go).toHaveBeenCalledWith("InvoiceNew", { type: "sales" });
    await pressId(container, "inv-edoc-inbox-btn");
    expect(go).toHaveBeenCalledWith("EdocInbox");

    allowEdit = false;
    await act(async () => { root.render(React.createElement(InvoicesScreen)); });
    await settle();
    expect(findByTestId(container, "create-new-invoice-btn")).toBeNull();
    expect(findByTestId(container, "inv-edoc-inbox-btn")).toBeNull();
  });

  it("opens the editor for a draft and the detail for approved paper and issued invoices", async () => {
    const draft = row({ id: "dr1", status: "draft", invoice_number: "TAS-1", contact_name: "Taslak Cari" });
    const paper = row({
      id: "p1",
      status: "approved",
      invoice_type: "sales",
      e_type: "paper",
      invoice_number: "KAG-1",
      contact_name: "Kağıt Cari",
    });
    const issued = row({
      id: "c1",
      status: "approved",
      invoice_type: "sales",
      e_type: "e_invoice",
      einvoice_state: "sent",
      gib_status: "Gönderildi",
      gib_tracking_id: "uuid-1",
      invoice_number: "GIB-1",
      contact_name: "Kesilmiş Cari",
    });
    (get as unknown as jest.Mock).mockResolvedValue(pageOf([draft, paper, issued], {
      summary: { count: 3, total_amount: 30, draft_count: 1, approved_count: 2 },
    }));
    await show();
    await pressId(container, "inv-open-dr1");
    expect(go).toHaveBeenCalledWith("InvoiceEdit", { id: "dr1" });
    await pressId(container, "inv-open-p1");
    expect(go).toHaveBeenCalledWith("InvoiceDetail", { id: "p1" });
    await pressId(container, "inv-open-c1");
    expect(go).toHaveBeenCalledWith("InvoiceDetail", { id: "c1" });
  });
});
