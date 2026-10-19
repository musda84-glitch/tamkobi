import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post } from "../../api/client";
import { ApiHttpError } from "../../api/errors";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { InvoiceFormScreen } from "../InvoiceFormScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useLocalSearchParams: () => ({}),
  router: { replace: jest.fn(), back: jest.fn(), push: jest.fn() },
}));

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../components/BarcodeScannerModal", () => ({ BarcodeScannerModal: () => null }));

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
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: host("input"),
    Image: host("img"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
  };
});

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

function renderForm(invoiceId?: string) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => { root.render(React.createElement(InvoiceFormScreen, invoiceId ? { invoiceId } : {})); });
  return { container, root };
}

describe("InvoiceFormScreen", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    (get as unknown as jest.Mock).mockReset();
    (post as unknown as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("locks the editor while an existing invoice is loading", async () => {
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) return new Promise(() => undefined);
      return Promise.resolve([]);
    });
    const { container, root } = renderForm("inv-9");
    await settle();
    expect(findByTestId(container, "inv-form-loading")).toBeTruthy();
    expect(textOf(container)).toContain("Yükleniyor…");
    expect(reactProps(findByTestId(container, "save-invoice-btn"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(container, "issue-invoice-btn"))?.disabled).toBe(true);
    root.unmount();
  });

  it("shows a retry when the invoice fails to load", async () => {
    let fail = true;
    (get as unknown as jest.Mock).mockImplementation((_client: unknown, path: string) => {
      if (String(path).startsWith("/invoices/")) {
        if (fail) return Promise.reject(new ApiHttpError(500, "kapalı", "Fatura yüklenemedi."));
        return Promise.resolve({
          id: "inv-9",
          status: "draft",
          invoice_type: "sales",
          e_type: "paper",
          contact_id: "c1",
          contact_name: "Acme",
          items: [{ name: "Kalem", quantity: 1, unit_price: 10, vat_rate: 20 }],
        });
      }
      return Promise.resolve([]);
    });
    const { container, root } = renderForm("inv-9");
    await settle();
    expect(textOf(container)).toContain("Fatura yüklenemedi.");
    expect(findByTestId(container, "inv-form-loading")).toBeNull();
    fail = false;
    await press(container, "inv-form-retry");
    expect(textOf(container)).toContain("Taslak Düzenle");
    expect(findByTestId(container, "inv-form-retry")).toBeNull();
    expect(reactProps(findByTestId(container, "save-invoice-btn"))?.disabled).toBe(false);
    root.unmount();
  });

  it("titles a new invoice Yeni Fatura and runs save and issue from the fixed bar", async () => {
    (get as unknown as jest.Mock).mockResolvedValue([]);
    const { container, root } = renderForm();
    await settle();
    expect(textOf(container)).toContain("Yeni Fatura");
    expect(textOf(container)).not.toContain("Yeni Fatura Düzenle");
    expect(findByTestId(container, "save-invoice-btn")).toBeTruthy();
    expect(textOf(findByTestId(container, "issue-invoice-btn"))).toContain("Faturalaştır");
    await press(container, "save-invoice-btn");
    expect(textOf(container)).toContain("Lütfen bir cari seçiniz.");
    expect(post).not.toHaveBeenCalled();
    await press(container, "issue-invoice-btn");
    expect((Alert.alert as jest.Mock).mock.calls.at(-1)?.[0]).toBe("Fatura kes");
    root.unmount();
  });
});
