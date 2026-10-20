import "../../test/domSetup";
import React, { act } from "react";
import * as ImagePicker from "expo-image-picker";
import { get, post, put } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { fmtDate, todayIso } from "../../utils/money";
import { extractChequeFromAsset } from "../../utils/chequeScan";
import { ChequeFormScreen } from "../ChequeFormScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

jest.mock("../../utils/chequeShare", () => ({
  printChequeReceipt: jest.fn(async () => undefined),
}));

jest.mock("../../utils/chequeScan", () => {
  const actual = jest.requireActual("../../utils/chequeScan") as typeof import("../../utils/chequeScan");
  return { ...actual, extractChequeFromAsset: jest.fn() };
});

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  activeCompany: { name: "TamKobi" },
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
  upload: jest.fn(async () => ({})),
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
      disabled?: boolean;
      accessibilityState?: { selected?: boolean; disabled?: boolean };
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        value: props.value,
        placeholder: props.placeholder,
        disabled: props.editable === false || props.disabled === true,
        accessibilityState: props.accessibilityState,
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

const openCheque = {
  id: "ch-open",
  number: "CEK-2026-0009",
  instrument: "cheque",
  direction: "received",
  status: "open",
  contact_id: "c1",
  contact_name: "Acme A.Ş.",
  amount: 1000,
  issue_date: "2026-09-01",
  due_date: "2026-10-01",
  serial_no: "998877",
  bank_name: "Garanti",
  notes: "portföy",
};

const lockedCheque = {
  ...openCheque,
  id: "ch-locked",
  status: "collected",
  status_label: "Tahsil edildi",
};

function mockGets() {
  (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
    if (path === "/contacts/search") {
      return Promise.resolve({ items: [{ id: "c1", name: "Acme A.Ş.", phone: "555" }] });
    }
    if (path === "/cheques/ch-open") return Promise.resolve(openCheque);
    if (path === "/cheques/ch-locked") return Promise.resolve(lockedCheque);
    if (path === "/contacts") return Promise.resolve([]);
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
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 400)}`);
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

function findPressableText(node: any, label: string): any {
  if (!node) return null;
  const props = reactProps(node);
  if (props && typeof props.onClick === "function" && textOf(node).trim() === label) return node;
  for (const child of node.childNodes || []) {
    const hit = findPressableText(child, label);
    if (hit) return hit;
  }
  return null;
}

async function pickDueDay(container: unknown) {
  await press(container, "cheque-due-date");
  const cal = findByTestId(container, "cheque-due-date-cal");
  const day = findPressableText(cal, "15");
  if (!day) throw new Error("vade günü yok");
  const props = reactProps(day);
  await act(async () => { await props?.onClick?.(); });
  await settle();
}

function renderForm(chequeId?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(ChequeFormScreen, chequeId ? { chequeId } : {})); });
  return { container, root };
}

describe("ChequeFormScreen", () => {
  beforeEach(() => {
    mockGets();
    (post as unknown as jest.Mock).mockReset();
    (put as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockResolvedValue({ id: "new-1" });
    (put as unknown as jest.Mock).mockImplementation(async () => openCheque);
    (extractChequeFromAsset as unknown as jest.Mock).mockReset();
    (ImagePicker.launchCameraAsync as unknown as jest.Mock).mockReset();
    (ImagePicker.launchCameraAsync as unknown as jest.Mock).mockResolvedValue({ canceled: true, assets: [] });
  });

  afterEach(() => {
    document.body.innerHTML = "";
    (get as unknown as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("renders four kinds and posts the selected direction and instrument", async () => {
    const view = renderForm();
    await settle();
    expect(textOf(findByTestId(view.container, "cheque-form-title"))).toBe("‹ Yeni çek");
    expect(findByTestId(view.container, "cheque-direction-received")).toBeNull();
    expect(findByTestId(view.container, "cheque-instrument-cheque")).toBeNull();
    for (const key of ["received_cheque", "received_promissory", "issued_cheque", "issued_promissory"]) {
      expect(findByTestId(view.container, `cheque-kind-${key}`)).toBeTruthy();
    }
    expect(reactProps(findByTestId(view.container, "cheque-kind-received_cheque"))?.accessibilityState?.selected).toBe(true);
    expect(findByTestId(view.container, "cheque-bank")).toBeTruthy();

    await press(view.container, "cheque-kind-issued_promissory");
    expect(textOf(findByTestId(view.container, "cheque-form-title"))).toBe("‹ Yeni senet");
    expect(reactProps(findByTestId(view.container, "cheque-kind-issued_promissory"))?.accessibilityState?.selected).toBe(true);
    expect(findByTestId(view.container, "cheque-bank")).toBeNull();
    expect(findByTestId(view.container, "cheque-branch")).toBeNull();
    expect(findByTestId(view.container, "cheque-account-no")).toBeNull();
    expect(findByTestId(view.container, "cheque-serial")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-drawer")).toBeTruthy();

    await press(view.container, "cheque-contact");
    await press(view.container, "cheque-contact-option-c1");
    expect(textOf(findByTestId(view.container, "cheque-contact-selected"))).toContain("Acme A.Ş.");
    expect(textOf(findByTestId(view.container, "cheque-contact-selected"))).toContain("Değiştir ›");
    expect(findByTestId(view.container, "cheque-contact-empty")).toBeNull();
    await press(view.container, "cheque-contact-change");
    expect(textOf(findByTestId(view.container, "cheque-contact-selected"))).toContain("Acme A.Ş.");
    expect(findByTestId(view.container, "cheque-contact")).toBeTruthy();

    await typeInto(view.container, "cheque-amount", "1500");
    await pickDueDay(view.container);
    expect(textOf(findByTestId(view.container, "cheque-issue-date"))).toBe("Tarih seçin");
    expect(textOf(findByTestId(view.container, "cheque-record-date"))).toContain("Kayıt tarihi · bugün ·");
    expect(textOf(findByTestId(view.container, "cheque-record-date"))).toContain(fmtDate(todayIso()));
    expect(textOf(findByTestId(view.container, "cheque-save"))).toContain("Kaydet");

    await press(view.container, "cheque-save");
    expect(post).toHaveBeenCalledWith(mockAuth.client, "/cheques", expect.any(Object));
    const body = (post as unknown as jest.Mock).mock.calls[0][2];
    expect(body.direction).toBe("issued");
    expect(body.instrument).toBe("promissory");
    expect(body.contact_id).toBe("c1");
    expect(body.company_id).toBe("co-1");
    expect(body.amount).toBe(1500);
    expect(body.due_date).toMatch(/^\d{4}-\d{2}-15$/);
    expect(body).not.toHaveProperty("issue_date");
    act(() => { view.root.unmount(); });
  });

  it("highlights scanned fields and drops the highlight after a manual edit", async () => {
    (ImagePicker.launchCameraAsync as unknown as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://cheque.jpg" }],
    });
    (extractChequeFromAsset as unknown as jest.Mock).mockResolvedValue({
      draft: {
        instrument: "cheque",
        direction: "received",
        amount: 50000,
        serial_no: "1234567",
        bank_name: "Garanti BBVA",
        due_date: "2026-11-01",
        issue_date: "2026-10-01",
      },
      matched_contact: { id: "c1", name: "Acme A.Ş." },
    });
    const view = renderForm();
    await settle();
    expect(textOf(findByTestId(view.container, "cheque-scan-open"))).toContain("Kamerayla çek oku");
    await press(view.container, "cheque-scan-open");
    await press(view.container, "cheque-scan-camera");
    const body = textOf(view.container);
    const bannerAt = body.indexOf("Kameradan okundu — kontrol et");
    const hintAt = body.indexOf("alınan çek okundu · 50000 ₺");
    expect(findByTestId(view.container, "cheque-scan-banner")).toBeTruthy();
    expect(bannerAt).toBeGreaterThan(-1);
    expect(hintAt).toBeGreaterThan(bannerAt);
    expect(findByTestId(view.container, "cheque-serial-scanned")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-bank-scanned")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-amount-scanned")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-issue-date-scanned")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-due-date-scanned")).toBeTruthy();
    expect(findByTestId(view.container, "cheque-contact-scanned")).toBeTruthy();

    await typeInto(view.container, "cheque-serial", "ELLEYAZ");
    expect(findByTestId(view.container, "cheque-serial-scanned")).toBeNull();
    expect(findByTestId(view.container, "cheque-bank-scanned")).toBeTruthy();
    act(() => { view.root.unmount(); });
  });

  it("puts an open cheque and keeps the receipt button", async () => {
    const view = renderForm("ch-open");
    await settle();
    expect(textOf(findByTestId(view.container, "cheque-form-header"))).toContain("998877");
    expect(textOf(findByTestId(view.container, "cheque-form-header"))).toContain("Portföy / Açık");
    expect(textOf(findByTestId(view.container, "cheque-print-receipt"))).toContain("Tahsilat makbuzu");
    expect(textOf(findByTestId(view.container, "cheque-save"))).toContain("Güncelle");
    await press(view.container, "cheque-save");
    expect(put).toHaveBeenCalledWith(mockAuth.client, "/cheques/ch-open", expect.objectContaining({
      contact_id: "c1",
      amount: 1000,
      issue_date: "2026-09-01",
      due_date: "2026-10-01",
      serial_no: "998877",
      company_id: "co-1",
    }));
    expect(post).not.toHaveBeenCalled();
    expect(textOf(view.container)).toContain("Çek / senet güncellendi.");
    act(() => { view.root.unmount(); });
  });

  it("locks kind, amount and contact after settlement", async () => {
    const view = renderForm("ch-locked");
    await settle();
    expect(textOf(view.container)).toContain("Tahsil / ödeme sonrası yön, tür, cari ve tutar kilitlenir.");
    expect(reactProps(findByTestId(view.container, "cheque-kind-received_cheque"))?.accessibilityState?.disabled).toBe(true);
    await press(view.container, "cheque-kind-issued_cheque");
    expect(reactProps(findByTestId(view.container, "cheque-kind-received_cheque"))?.accessibilityState?.selected).toBe(true);
    expect(reactProps(findByTestId(view.container, "cheque-kind-issued_cheque"))?.accessibilityState?.selected).toBe(false);
    expect(reactProps(findByTestId(view.container, "cheque-amount"))?.disabled).toBe(true);
    expect(findByTestId(view.container, "cheque-contact-change")).toBeNull();
    expect(findByTestId(view.container, "cheque-contact")).toBeNull();
    expect(textOf(findByTestId(view.container, "cheque-contact-selected"))).toContain("Acme A.Ş.");
    expect(findByTestId(view.container, "cheque-scan-open")).toBeNull();
    act(() => { view.root.unmount(); });
  });
});
