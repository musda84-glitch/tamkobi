import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { AtolyeScreen } from "../AtolyeScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("../../components/ProductionAiAdvisor", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    ProductionAiAdvisor: () => ReactLib.createElement("div", { "data-testid": "production-ai-advisor" }, "ai"),
  };
});

jest.mock("expo-router", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    useFocusEffect: (effect: () => void | (() => void)) => {
      ReactLib.useEffect(() => {
        const cleanup = effect();
        return typeof cleanup === "function" ? cleanup : undefined;
      }, [effect]);
    },
  };
});

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-location", () => ({}));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    return style as Record<string, unknown>;
  };
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      disabled?: boolean;
      numberOfLines?: number;
      accessibilityState?: { selected?: boolean };
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        numberOfLines: props.numberOfLines,
        accessibilityState: props.accessibilityState,
        onClick: () => { if (!props.disabled) props.onPress?.(); },
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
    AppState: { addEventListener: () => ({ remove() { /* no-op */ } }) },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    Image: () => null,
    Switch: host("input"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    TextInput,
  };
});

jest.mock("../../auth/AuthContext", () => {
  const auth = {
    client: { baseUrl: "https://api.test", token: "tok" },
    companyId: "co-1",
    user: null as null,
    baseUrl: "https://api.test",
    can: () => true,
    addonOn: () => false,
    feature: () => false,
  };
  return {
    useAuth: () => auth,
    apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
  };
});

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(),
  upload: jest.fn(),
  fileUrl: (_base: string, url?: string) => url || "",
}));

const minutesAgo = (mins: number) => new Date(Date.now() - mins * 60000).toISOString();

function workOrders() {
  return [
    {
      id: "mine-ready",
      status: "ready",
      station: "HOLZHER",
      assigned_name: "Ali Usta",
      step_no: 2,
      step_count: 3,
      product_name: "Tabla",
      order_code: "M1",
      step_name: "Kesim",
    },
    {
      id: "mine-paused",
      status: "paused",
      station: "HOLZHER",
      operator_name: "Ali Usta",
      paused_at: minutesAgo(12),
      auto_paused: false,
      elapsed_min: 9,
      step_no: 1,
      step_count: 3,
      order_code: "M2",
      step_name: "Bant",
    },
    {
      id: "other-ready",
      status: "ready",
      station: "OMAKSAN",
      step_no: 1,
      step_count: 1,
      product_name: "Kapak",
      order_code: "O1",
      step_name: "Ebat",
    },
    {
      id: "other-paused",
      status: "paused",
      station: "OMAKSAN",
      operator_name: "Veli",
      paused_at: minutesAgo(72),
      auto_paused: true,
      elapsed_min: 20,
      step_no: 1,
      step_count: 2,
      notes: "Kenar notu",
      images: ["https://cdn.test/a.jpg"],
      materials: [{ product_id: "m1", product_name: "MDF", needed: 2, unit: "Adet" }],
      order_code: "O2",
      step_name: "Delme",
    },
    {
      id: "other-run",
      status: "in_progress",
      station: "PVC",
      elapsed_min: 5,
      step_no: 1,
      step_count: 2,
      order_code: "R1",
      step_name: "Delik",
    },
    {
      id: "wait-1",
      status: "waiting",
      station: "PVC",
      step_no: 2,
      step_count: 2,
      order_code: "W1",
      step_name: "Montaj",
    },
    {
      id: "done-today",
      status: "done",
      finished_at: new Date().toISOString(),
      produced_qty: 4,
      order_code: "D1",
      step_name: "Kontrol",
    },
    {
      id: "done-old",
      status: "done",
      finished_at: "2020-01-01T00:00:00Z",
      order_code: "D0",
      step_name: "Eski",
    },
  ];
}

let groupSame = false;

function installApi() {
  (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    const p = String(path);
    if (p.includes("pause-policy")) return { allowed: true, phase: "mesai" };
    if (p.includes("/personnel/me")) {
      return {
        employee: { id: "emp-ali", full_name: "Ali Usta", has_user: true },
        tasks: [{ id: "duty-1", title: "Tezgah temizliği", done: false, kind: "office" }],
      };
    }
    if (p.includes("shopfloor-settings")) return { group_same_station: groupSame };
    if (p.includes("work-parks")) return { parks: [] };
    if (p.includes("/personnel/employees")) {
      return [{ id: "emp-ali", full_name: "Ali Usta", has_user: true, position: "Operatör" }];
    }
    if (p.includes("/production/work-orders") && !p.includes("stations")) return workOrders();
    return [];
  });
  (post as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    if (String(path).includes("shopfloor-unlock")) return { operator_name: "Ali Usta" };
    return { message: "ok" };
  });
}

function allTestIds(node: any, acc: string[] = []): string[] {
  if (!node) return acc;
  const id = node.getAttribute?.("data-testid");
  if (typeof id === "string" && id) acc.push(id);
  for (const child of node.childNodes || []) allTestIds(child, acc);
  return acc;
}

function cardIds(node: any): string[] {
  return allTestIds(node).filter((id) => id.startsWith("wo-card-"));
}

function elements(node: any): any[] {
  return (node?.childNodes || []).filter((child: any) => child.nodeType === 1);
}

function findDeepestText(node: any, text: string): any {
  for (const child of node?.childNodes || []) {
    const hit = findDeepestText(child, text);
    if (hit) return hit;
  }
  if (node?.nodeType === 1 && textOf(node) === text) return node;
  return null;
}

const OPEN_ORDER = [
  "wo-card-mine-paused",
  "wo-card-mine-ready",
  "wo-card-other-run",
  "wo-card-other-paused",
  "wo-card-other-ready",
  "wo-card-wait-1",
];

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("AtolyeScreen mobile_atolye_v1", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    groupSame = false;
    (get as jest.Mock).mockReset();
    (post as jest.Mock).mockReset();
    (Alert.alert as jest.Mock).mockReset();
    installApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function settle() {
    for (let i = 0; i < 12; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
  }

  async function renderScreen() {
    await act(async () => { root.render(React.createElement(AtolyeScreen)); });
    await settle();
  }

  async function clickId(id: string) {
    await act(async () => {
      const props = reactProps(findByTestId(container, id));
      if (!props || props.disabled) return;
      await props.onClick?.();
    });
  }

  async function unlockAli() {
    await clickId("shopfloor-operator");
    await clickId("shopfloor-operator-opt-emp-ali");
    expect(findByTestId(container, "shopfloor-pin-modal")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-pin-modal"))).toContain("Mesaim girişi yapılmamış personel operatör olamaz.");
    await act(async () => {
      reactProps(findByTestId(container, "shopfloor-pin-input"))?.onChange?.({ target: { value: "1234" } });
    });
    await clickId("shopfloor-pin-submit");
    await settle();
  }

  it("does not render ProductionAiAdvisor", async () => {
    await renderScreen();
    expect(findByTestId(container, "production-ai-advisor")).toBeNull();
  });

  it("keeps actions closed until the operator enters a PIN", async () => {
    await renderScreen();
    const gate = findByTestId(container, "shopfloor-no-operator");
    expect(gate).toBeTruthy();
    expect(findByTestId(gate, "shopfloor-operator")).toBeTruthy();
    expect(textOf(gate)).toContain("Operatör seç ve PIN gir");
    expect(textOf(gate)).toContain("Başla / Devam / Bitir operatör girişinden sonra açılır");
    expect(reactProps(findByTestId(container, "wo-start-mine-ready"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(container, "wo-finish-other-run"))?.disabled).toBe(true);
    expect(reactProps(findByTestId(container, "wo-trash-mine-ready"))?.disabled).toBe(true);
    expect(Number(reactProps(findByTestId(container, "wo-trash-mine-ready"))?.style?.opacity)).toBeLessThan(1);
    expect(allTestIds(container).filter((id) => id.startsWith("wo-need-operator-")).sort()).toEqual([
      "wo-need-operator-mine-paused",
      "wo-need-operator-mine-ready",
      "wo-need-operator-other-paused",
      "wo-need-operator-other-ready",
      "wo-need-operator-other-run",
      "wo-need-operator-wait-1",
    ]);

    await clickId("wo-trash-mine-ready");
    await clickId("wo-start-mine-ready");
    expect((post as jest.Mock).mock.calls.some((call) => String(call[1]).includes("trash-request"))).toBe(false);
    expect((post as jest.Mock).mock.calls.some((call) => String(call[1]).includes("/start"))).toBe(false);

    await unlockAli();
    expect(findByTestId(container, "shopfloor-no-operator")).toBeNull();
    expect(textOf(findByTestId(container, "shopfloor-operator-name"))).toContain("Ali Usta");
    expect(textOf(container)).toContain("değiştir");
    expect(reactProps(findByTestId(container, "wo-start-mine-ready"))?.disabled).toBe(false);
    expect(reactProps(findByTestId(container, "wo-finish-other-run"))?.disabled).toBe(false);
    expect(reactProps(findByTestId(container, "wo-trash-mine-ready"))?.disabled).toBe(false);
    expect(allTestIds(container).some((id) => id.startsWith("wo-need-operator-"))).toBe(false);

    await clickId("wo-start-mine-ready");
    expect(post).toHaveBeenCalledWith(
      expect.anything(),
      "/production/work-orders/mine-ready/start",
      expect.objectContaining({ operator_name: "Ali Usta" }),
    );
  });

  it("filters in-progress and paused cards from the active counter, then clears", async () => {
    await renderScreen();
    await unlockAli();
    expect(reactProps(findByTestId(container, "shopfloor-kpi-active"))?.accessibilityState).toEqual({ selected: false });
    await clickId("shopfloor-kpi-active");
    expect(reactProps(findByTestId(container, "shopfloor-kpi-active"))?.accessibilityState).toEqual({ selected: true });
    expect(reactProps(findByTestId(container, "shopfloor-kpi-ready"))?.accessibilityState).toEqual({ selected: false });
    expect(reactProps(findByTestId(container, "shopfloor-kpi-active"))?.style?.borderColor).toBe("#F59E0B");
    expect(reactProps(findByTestId(container, "shopfloor-kpi-active"))?.style?.backgroundColor).toBe("#FFFBEB");
    expect(cardIds(container)).toEqual([
      "wo-card-mine-paused",
      "wo-card-other-run",
      "wo-card-other-paused",
    ]);
    await clickId("shopfloor-kpi-active");
    expect(reactProps(findByTestId(container, "shopfloor-kpi-active"))?.accessibilityState).toEqual({ selected: false });
    expect(cardIds(container)).toEqual(OPEN_ORDER);
  });

  it("keeps Benim İşlerim on top and sorts inside station groups only when grouping is on", async () => {
    await renderScreen();
    await unlockAli();
    const ids = allTestIds(container);
    expect(ids.indexOf("shopfloor-mine")).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf("shopfloor-mine")).toBeLessThan(ids.indexOf("wo-card-other-run"));
    expect(ids.some((id) => id.startsWith("shopfloor-station-group-"))).toBe(false);
    expect(cardIds(container)).toEqual(OPEN_ORDER);

    groupSame = true;
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderScreen();
    await unlockAli();

    expect(cardIds(container)).toEqual([
      "wo-card-mine-paused",
      "wo-card-mine-ready",
      "wo-card-other-paused",
      "wo-card-other-ready",
      "wo-card-other-run",
      "wo-card-wait-1",
    ]);
    expect(cardIds(findByTestId(container, "shopfloor-station-group-omaksan"))).toEqual([
      "wo-card-other-paused",
      "wo-card-other-ready",
    ]);
    expect(cardIds(findByTestId(container, "shopfloor-station-group-holzher"))).toEqual([
      "wo-card-mine-paused",
      "wo-card-mine-ready",
    ]);
    expect(cardIds(findByTestId(container, "shopfloor-mine"))[0]).toBe("wo-card-mine-paused");
    const groupedIds = allTestIds(container);
    expect(groupedIds.indexOf("shopfloor-mine")).toBeLessThan(groupedIds.indexOf("shopfloor-station-group-omaksan"));
  });

  it("shows how long a card has been paused and the worked minutes", async () => {
    await renderScreen();
    expect(textOf(findByTestId(container, "wo-paused-for-mine-paused"))).toContain("dk duraklatıldı · Elle");
    expect(textOf(findByTestId(container, "wo-paused-for-mine-paused"))).toMatch(/12 dk duraklatıldı/);
    expect(textOf(findByTestId(container, "wo-card-mine-paused"))).toContain("çalışılan 9 dk");
    expect(textOf(findByTestId(container, "wo-paused-for-other-paused"))).toContain("Otomatik (mesai dışı)");
    expect(textOf(findByTestId(container, "wo-paused-for-other-paused"))).toContain("1 sa 12 dk duraklatıldı");
    expect(textOf(findByTestId(container, "wo-card-other-paused"))).toContain("çalışılan 20 dk");
    expect(textOf(findByTestId(container, "wo-card-other-run"))).toContain("5 dk geçti");
    expect(textOf(findByTestId(container, "wo-card-other-run"))).not.toContain("çalışılan");
  });

  it("hides materials until Detay is opened and keeps images outside", async () => {
    await renderScreen();
    expect(findByTestId(container, "wo-materials-other-paused")).toBeNull();
    expect(findByTestId(container, "wo-detail-toggle-mine-ready")).toBeNull();
    expect(findByTestId(container, "wo-meta-other-paused")).toBeTruthy();
    expect(findByTestId(container, "wo-images-other-paused")).toBeTruthy();
    expect(textOf(findByTestId(container, "wo-card-other-paused"))).not.toContain("Kenar notu");
    await clickId("wo-detail-toggle-other-paused");
    expect(findByTestId(container, "wo-materials-other-paused")).toBeTruthy();
    expect(textOf(findByTestId(container, "wo-card-other-paused"))).toContain("Kenar notu");
    expect(findByTestId(container, "wo-images-other-paused")).toBeTruthy();
  });

  it("draws one step-bar segment per step and highlights only the current step", async () => {
    await renderScreen();
    const segs = elements(findByTestId(container, "wo-stepbar-mine-ready"));
    expect(segs).toHaveLength(3);
    expect(reactProps(segs[0])?.style?.backgroundColor).toBe("#E2E8F0");
    expect(reactProps(segs[1])?.style?.backgroundColor).toBe("#F59E0B");
    expect(reactProps(segs[2])?.style?.backgroundColor).toBe("#E2E8F0");
    expect(elements(findByTestId(container, "wo-stepbar-other-ready"))).toHaveLength(1);
    expect(reactProps(findDeepestText(findByTestId(container, "wo-card-mine-ready"), "Tabla"))?.numberOfLines).toBe(2);
  });

  it("still lists assigned duties, trash-completed and the PIN modal", async () => {
    await renderScreen();
    expect(findByTestId(container, "shopfloor-duties")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-duties"))).toContain("Atanan Görevler");
    expect(findByTestId(container, "shopfloor-duty-duty-1")).toBeTruthy();
    expect(findByTestId(container, "shopfloor-trash-done")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-trash-done"))).toContain("Tamamlananları çöpe taşı (2)");

    await clickId("shopfloor-trash-done");
    expect(Alert.alert).toHaveBeenCalled();
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { style?: string; onPress?: () => Promise<void> }[];
    const confirm = buttons.find((button) => button.style === "destructive");
    await act(async () => { await confirm?.onPress?.(); });
    expect(post).toHaveBeenCalledWith(
      expect.anything(),
      "/production/work-orders/trash-completed",
      expect.objectContaining({ company_id: "co-1" }),
    );

    await clickId("shopfloor-operator");
    await clickId("shopfloor-operator-opt-emp-ali");
    expect(findByTestId(container, "shopfloor-pin-modal")).toBeTruthy();
    expect(findByTestId(container, "shopfloor-pin-submit")).toBeTruthy();
  });

  it("shows only today's finished cards when the done counter is selected", async () => {
    await renderScreen();
    await clickId("shopfloor-kpi-done");
    expect(cardIds(container)).toEqual(["wo-card-done-today"]);
    expect(findByTestId(container, "shopfloor-waiting")).toBeNull();
  });
});
