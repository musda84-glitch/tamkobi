import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { colors } from "../../theme";
import { fmtMoney } from "../../utils/money";
import { employeeSettleButtonLabel } from "../../utils/personnel";
import { PersonnelScreen } from "../PersonnelScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

let allowEdit = true;

const employees = [
  {
    id: "e-pos",
    full_name: "Ayşe Demir",
    status: "active",
    position: "Usta",
    department: "Saha",
    location_last_inside: true,
    annual_leave_days: 14,
    used_leave_days: 4,
    balance: { remaining: 12345.67, advances: 250 },
  },
  {
    id: "e-neg",
    full_name: "Mehmet Kaya",
    status: "active",
    location_last_inside: true,
    annual_leave_days: 14,
    balance: { remaining: -500 },
  },
  {
    id: "e-zero",
    full_name: "Zeynep Ak",
    status: "active",
    balance: { remaining: 0 },
  },
];

const attendance = {
  summary: [
    { employee_id: "e-pos", days_present: 3, today: { check_in: "09:00" } },
    {
      employee_id: "e-neg",
      days_present: 1,
      today: { check_in: "09:00", check_out: "17:00", assigned_overtime_hours: 2 },
    },
    { employee_id: "e-zero", days_present: 0, today: null },
  ],
};

const pending = [{ id: "req-1", kind: "leave", employee_id: "e-pos", title: "Yıllık izin" }];

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
    router: { push: jest.fn(), navigate: jest.fn(), replace: jest.fn() },
  };
});

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-location", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
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
    function Host(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        "aria-label": props.accessibilityLabel,
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
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    Linking: { openURL: jest.fn(async () => undefined) },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Image: () => null,
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput,
  };
});

const mockAuth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  user: null as null,
  activeCompany: null as null,
  baseUrl: "https://api.test",
  can: (_path?: string, level?: string) => (level === "edit" ? allowEdit : true),
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
  upload: jest.fn(async () => ({})),
  displayFileUrl: () => "",
  fileUrl: () => "",
}));

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function pressId(container: any, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 400)}`);
  const props = reactProps(node);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("PersonnelScreen payroll cards", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    allowEdit = true;
    (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      const p = String(path);
      if (p.includes("/personnel/employees")) return employees;
      if (p.includes("/personnel/payrolls")) return [];
      if (p.includes("/banking/accounts")) return [];
      if (p.includes("/banking/partners")) return [];
      if (p.includes("/personnel/leaves")) return [];
      if (p.includes("/personnel/attendance")) return attendance;
      if (p.includes("/projects")) return [];
      if (p.includes("/personnel/pending-requests")) return { items: pending };
      if (p.includes("/personnel/bonuses")) return [];
      if (p.includes("office-task-types")) return { types: [] };
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

  async function renderScreen() {
    await act(async () => { root.render(React.createElement(PersonnelScreen)); });
    await flush();
  }

  it("shows signed balances, on-shift mark, requests, and assigned overtime", async () => {
    await renderScreen();
    const summary = findByTestId(container, "personnel-shift-summary");
    expect(textOf(summary)).toContain("Mesaide 1 / 3");
    expect(textOf(summary)).toContain(`Toplam bakiye ${fmtMoney(12345.67 - 500)}`);
    const totalLine = (summary.childNodes || []).find((node: { tagName?: string }) => node.tagName === "SPAN" && textOf(node).includes("Toplam bakiye"));
    expect(reactProps(totalLine)?.style?.color).toBe(colors.danger);

    const negative = findByTestId(container, "emp-receivable-e-neg");
    expect(textOf(negative)).toContain("-");
    expect(textOf(negative)).toBe(fmtMoney(-500));
    expect(reactProps(negative)?.style?.color).toBe(colors.warning);
    expect(reactProps(findByTestId(container, "emp-card-balance-e-neg"))?.style?.backgroundColor).toBe(colors.amber50);

    const positive = findByTestId(container, "emp-receivable-e-pos");
    expect(textOf(positive)).toBe(fmtMoney(12345.67));
    expect(reactProps(positive)?.style?.color).toBe(colors.danger);
    expect(reactProps(findByTestId(container, "emp-card-balance-e-pos"))?.style?.backgroundColor).toBe(colors.rose50);
    expect(textOf(findByTestId(container, "emp-card-balance-e-pos"))).toContain(`Avans ${fmtMoney(250)}`);
    expect(textOf(findByTestId(container, "emp-leave-e-pos"))).toMatch(/İzin \d+\/\d+ gün/);

    const dot = findByTestId(container, "emp-onshift-dot-e-pos");
    expect(reactProps(dot)?.style?.width).toBe(8);
    expect(reactProps(dot)?.style?.height).toBe(8);
    expect(reactProps(dot)?.style?.backgroundColor).toBe(colors.primary);
    expect(textOf(findByTestId(container, "emp-onshift-label-e-pos"))).toBe("Mesaide");
    expect(textOf(findByTestId(container, "emp-presence-e-pos"))).toBe("İş Yerinde");
    expect(findByTestId(container, "emp-onshift-dot-e-neg")).toBeNull();
    expect(textOf(findByTestId(container, "emp-presence-e-neg"))).toBe("Mesai Bitti");

    expect(findByTestId(container, "emp-card-requests-strip-e-pos")).toBeTruthy();
    expect(findByTestId(container, "emp-card-requests-strip-e-neg")).toBeNull();
    expect(findByTestId(container, "emp-card-requests-strip-e-zero")).toBeNull();

    expect(findByTestId(container, "emp-card-assigned-ot-e-pos")).toBeNull();
    expect(findByTestId(container, "emp-card-loc-e-pos")).toBeTruthy();
    expect(textOf(findByTestId(container, "emp-card-assigned-ot-e-neg"))).toContain("+2 sa");

    const actions = reactProps(findByTestId(container, "emp-card-actions-e-pos"))?.style;
    expect(actions?.flexDirection).toBe("row");
    expect(actions?.flexWrap).toBe("wrap");
    expect(reactProps(findByTestId(container, "emp-card-moves-btn-e-pos"))?.style?.flexShrink).toBe(0);
  });

  it("opens settle with the full amount and moves work actions into the more sheet", async () => {
    await renderScreen();
    expect(findByTestId(container, "emp-card-task-btn-e-pos")).toBeNull();
    expect(findByTestId(container, "emp-card-overtime-btn-e-pos")).toBeNull();

    const pay = findByTestId(container, "employee-pay-btn-e-pos");
    const label = employeeSettleButtonLabel({ balance: { remaining: 12345.67 } });
    expect(textOf(pay)).toBe(label);
    expect(textOf(pay)).toContain(fmtMoney(12345.67));
    expect(reactProps(pay)?.style?.backgroundColor).toBe(colors.primary);
    const payText = pay.childNodes?.find((node: { tagName?: string }) => node.tagName === "SPAN");
    expect(reactProps(payText)?.numberOfLines).toBeUndefined();

    await pressId(container, "employee-pay-btn-e-pos");
    await flush();
    expect(findByTestId(container, "employee-settle-sheet")).toBeTruthy();
    expect(textOf(findByTestId(container, "employee-settle-sheet"))).toContain("Ayşe Demir");

    await pressId(container, "emp-card-more-btn-e-pos");
    await flush();
    expect(findByTestId(container, "emp-card-more-sheet")).toBeTruthy();
    expect(textOf(findByTestId(container, "emp-card-task-btn-e-pos"))).toContain("Görev ata");
    expect(textOf(findByTestId(container, "emp-card-overtime-btn-e-pos"))).toContain("+ Mesai");

    await pressId(container, "emp-card-task-btn-e-pos");
    await flush();
    expect(findByTestId(container, "task-assign-sheet")).toBeTruthy();

    await pressId(container, "emp-card-more-btn-e-pos");
    await flush();
    await pressId(container, "emp-card-overtime-btn-e-pos");
    await flush();
    expect(findByTestId(container, "overtime-assign-sheet")).toBeTruthy();
  });

  it("narrows the list with the filter chips", async () => {
    await renderScreen();
    expect(findByTestId(container, "employee-card-e-pos")).toBeTruthy();
    expect(findByTestId(container, "employee-card-e-neg")).toBeTruthy();
    expect(findByTestId(container, "employee-card-e-zero")).toBeTruthy();

    await pressId(container, "personnel-filter-onshift");
    await flush();
    expect(textOf(findByTestId(container, "personnel-shift-summary"))).toContain("Mesaide 1 / 3");
    expect(findByTestId(container, "employee-card-e-pos")).toBeTruthy();
    expect(findByTestId(container, "employee-card-e-neg")).toBeNull();
    expect(findByTestId(container, "employee-card-e-zero")).toBeNull();

    await pressId(container, "personnel-filter-balance");
    await flush();
    expect(findByTestId(container, "employee-card-e-pos")).toBeTruthy();
    expect(findByTestId(container, "employee-card-e-neg")).toBeTruthy();
    expect(findByTestId(container, "employee-card-e-zero")).toBeNull();

    await pressId(container, "personnel-filter-all");
    await flush();
    expect(findByTestId(container, "employee-card-e-zero")).toBeTruthy();
  });

  it("hides pay and the more menu without edit permission", async () => {
    allowEdit = false;
    await renderScreen();
    expect(findByTestId(container, "employee-card-e-pos")).toBeTruthy();
    expect(findByTestId(container, "employee-pay-btn-e-pos")).toBeNull();
    expect(findByTestId(container, "emp-card-more-btn-e-pos")).toBeNull();
    expect(findByTestId(container, "emp-card-moves-btn-e-pos")).toBeTruthy();
    expect(findByTestId(container, "emp-card-task-btn-e-pos")).toBeNull();
    expect(findByTestId(container, "emp-card-overtime-btn-e-pos")).toBeNull();
  });
});
