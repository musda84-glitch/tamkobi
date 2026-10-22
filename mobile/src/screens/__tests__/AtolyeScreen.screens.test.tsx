import "../../test/domSetup";
import React, { act } from "react";
import { get, post } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { AtolyeScreen, shopfloorOperatorMemory } from "../AtolyeScreen";

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
      source?: { uri?: string };
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        disabled: !!props.disabled,
        src: props.source?.uri,
        alt: props.accessibilityLabel,
        onClick: () => { if (!props.disabled) props.onPress?.(); },
      }, props.children);
    };
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
    Image: host("img"),
    Switch: host("input"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput: (props: { testID?: string; value?: string; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }),
  };
});

const auth = {
  client: { baseUrl: "https://api.test", token: "tok" },
  companyId: "co-1",
  user: null as null | {
    id: string;
    name: string;
    role: string;
    account_type?: string;
    permissions?: Record<string, string>;
    shopfloor_stations?: string[];
  },
  baseUrl: "https://api.test",
  can: () => true,
  addonOn: () => false,
  feature: () => false,
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => auth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "İşlem başarısız.",
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(),
  post: jest.fn(),
}));

const FILTERS = {
  projects: [{ project_id: "p14", project_number: "PRJ-014", project_name: "Villa Mutfak", job_count: 3 }],
  recipes: [{ recipe_id: "r1", recipe_name: "Mutfak Dolabı", job_count: 2 }],
};

const OPERATORS = [
  { operator_type: "employee", id: "e3", name: "Muhammed ASLAN", station: "CNC", has_shopfloor_pin: true, personnel_no: "P-0001" },
];

function wo(partial: Record<string, unknown>) {
  return {
    step_no: 1,
    step_count: 2,
    step_name: "Kesim",
    product_name: "Gövde",
    recipe_name: "Mutfak Dolabı",
    status: "ready",
    station: "CNC",
    unit: "Adet",
    planned_quantity: 10,
    materials: [],
    order_code: "URT-1",
    unit_price: 987654,
    sale_price: 987654,
    cost: 987654,
    ...partial,
    id: partial.id || partial.order_code || "URT-1",
  };
}

let jobs: Record<string, unknown>[] = [wo({})];
let settings: Record<string, unknown> = {};
let operators: unknown[] = [];

function installApi() {
  (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
    const p = String(path);
    if (p.includes("shopfloor-filters")) return FILTERS;
    if (p.includes("pause-policy")) return { allowed: true, phase: "mesai" };
    if (p.includes("shopfloor-settings")) return { group_same_station: false, idle_lock_minutes: 30, undo_finish_minutes: 5, scrap_reasons: [], ...settings };
    if (p.includes("/drawing")) return { url: "/api/files/cizim.png?t=1", content_type: "image/png", filename: "kapak.png", expires_in: 900 };
    if (p.includes("shopfloor-operators")) return operators;
    if (p.includes("/personnel/me")) return { employee: { full_name: "Ali Usta" }, tasks: [] };
    if (p.includes("work-parks")) return { parks: [] };
    if (p.includes("/production/work-orders") && !p.includes("stations")) return jobs;
    return [];
  });
  (post as jest.Mock).mockResolvedValue({ message: "ok" });
}

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("AtolyeScreen iş ekranı jestleri", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLElement;

  beforeEach(() => {
    shopfloorOperatorMemory.clear();
    auth.user = { id: "u9", name: "Ali Usta", role: "admin", account_type: "standard" };
    jobs = [wo({})];
    settings = {};
    operators = [];
    installApi();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  async function settle(times = 12) {
    for (let i = 0; i < times; i += 1) {
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
    await settle();
  }

  it("iş listesi fiyat basmaz ve Kendi oturumunuz yazmaz", async () => {
    await renderScreen();
    expect(findByTestId(container, "wo-card-URT-1")).toBeTruthy();
    expect(textOf(findByTestId(container, "wo-title-URT-1"))).toBe("Mutfak Dolabı");
    expect(textOf(findByTestId(container, "wo-station-tag-URT-1"))).toContain("■ CNC");
    expect(textOf(findByTestId(container, "wo-drawing-URT-1"))).toContain("Teknik çizim");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
    expect(textOf(container)).not.toContain("987654");
    expect(textOf(findByTestId(container, "shopfloor-color-note"))).toContain("istasyon = dolu etiket");
    expect(textOf(findByTestId(container, "shopfloor-operator-chip"))).toContain("Operatör: Ali Usta");
  });

  it("proje filtresi menüsü seçince listeyi proje kimliğiyle yeniler", async () => {
    await renderScreen();
    await clickId("shopfloor-filter-project");
    expect(textOf(findByTestId(container, "shopfloor-filter-menu"))).toContain("Villa Mutfak");
    (get as jest.Mock).mockClear();
    await clickId("shopfloor-filter-option-p14");
    expect(textOf(findByTestId(container, "shopfloor-project"))).toBe("p14");
    expect(findByTestId(container, "shopfloor-filter-menu")).toBeNull();
    expect((get as jest.Mock).mock.calls.some((call) => {
      const query = call[2] as { project_id?: string } | undefined;
      return String(call[1]).includes("/production/work-orders") && query?.project_id === "p14";
    })).toBe(true);
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
  });

  it("sıradaki iş ve çalışan iş odak ekranları açılır", async () => {
    await renderScreen();
    await clickId("shopfloor-focus-open");
    expect(findByTestId(container, "shopfloor-next-job")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-focus-start"))).toContain("BAŞLAT");
    await clickId("shopfloor-focus-back");
    expect(findByTestId(container, "shopfloor-next-job")).toBeNull();

    jobs = [wo({ status: "in_progress", operator_name: "Ali Usta", partial_qty_total: 4 })];
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await renderScreen();
    await clickId("shopfloor-focus-open");
    expect(findByTestId(container, "shopfloor-running")).toBeTruthy();
    expect(textOf(findByTestId(container, "shopfloor-focus-finish"))).toContain("BİTİR");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
  });

  it("devralma uyarısı onayı confirm_takeover ile yeniden dener", async () => {
    let starts = 0;
    (post as jest.Mock).mockImplementation(async (_client: unknown, path: string, body?: { confirm_takeover?: boolean }) => {
      if (!String(path).includes("/start")) return { message: "ok" };
      starts += 1;
      if (!body?.confirm_takeover) {
        throw {
          response: {
            status: 409,
            data: { detail: { code: "takeover_confirm_required", previous_operator: "Ayşe Usta", last_action_at: "2026-10-22T09:40:00.000Z" } },
          },
        };
      }
      return { message: "devralındı", work_order: wo({ status: "in_progress", operator_name: "Ali Usta" }) };
    });
    await renderScreen();
    await clickId("wo-start-URT-1");
    const dialog = findByTestId(container, "shopfloor-takeover-dialog");
    expect(textOf(dialog)).toContain("Ayşe Usta");
    expect(textOf(dialog)).toContain("devralınsın mı");
    await clickId("shopfloor-takeover-confirm");
    expect(starts).toBe(2);
    const retry = (post as jest.Mock).mock.calls.map((call) => call[2]).find((body) => body?.confirm_takeover);
    expect(retry.confirm_takeover).toBe(true);
    expect(retry.operator_name).toBe("Ali Usta");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
  });

  it("ara sayım penceresi planı aşmayan adedi partial-count ile yollar", async () => {
    jobs = [wo({ status: "in_progress", operator_name: "Ali Usta", partial_qty_total: 3, planned_quantity: 10 })];
    (post as jest.Mock).mockResolvedValue({ partial_qty_total: 5, message: "ok" });
    await renderScreen();
    expect(findByTestId(container, "wo-partial-bar-URT-1")).toBeTruthy();
    await clickId("wo-partial-URT-1");
    expect(textOf(findByTestId(container, "shopfloor-partial-dialog"))).toContain("Ara sayım");
    await clickId("shopfloor-numpad-2");
    expect(textOf(findByTestId(container, "shopfloor-partial-forecast"))).toContain("kalan");
    await clickId("shopfloor-partial-add");
    const call = (post as jest.Mock).mock.calls.find((item) => String(item[1]).includes("/partial-count"));
    expect(call[2]).toEqual({ qty: 2, operator_name: "Ali Usta" });
    expect(call[4]["Idempotency-Key"]).toBeTruthy();
    expect(findByTestId(container, "shopfloor-partial-dialog")).toBeNull();
  });

  it("bitir sonrası geri al bildirimi undo-finish çağırır", async () => {
    const running = wo({ status: "in_progress", operator_name: "Ali Usta", planned_quantity: 4 });
    jobs = [running];
    (post as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("/finish")) {
        return { message: "bitti", work_order: { ...running, status: "done", finished_at: new Date().toISOString(), produced_qty: 4, scrap_qty: 0 } };
      }
      if (String(path).includes("/undo-finish")) return { message: "geri alındı" };
      return { message: "ok" };
    });
    await renderScreen();
    await clickId("wo-finish-URT-1");
    expect(findByTestId(container, "wo-finish-modal")).toBeTruthy();
    expect(findByTestId(container, "wo-finish-scrap-reasons")).toBeNull();
    await clickId("wo-finish-confirm");
    const toast = findByTestId(container, "shopfloor-undo-toast");
    expect(textOf(toast)).toContain("Geri al");
    expect(textOf(toast)).toMatch(/\d:\d\d/);
    await clickId("shopfloor-undo-toast-action");
    expect((post as jest.Mock).mock.calls.some((call) => String(call[1]).includes("/undo-finish"))).toBe(true);
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
  });

  it("teknik çizim görüntüleyicisi çizim adresini açar", async () => {
    await renderScreen();
    await clickId("wo-drawing-URT-1");
    const view = findByTestId(container, "shopfloor-drawing");
    expect(textOf(view)).toContain("Teknik çizim");
    expect(textOf(view)).toContain("kapak.png");
    expect(findByTestId(container, "shopfloor-drawing-image").getAttribute("src")).toContain("cizim.png");
    await clickId("shopfloor-drawing-close");
    expect(findByTestId(container, "shopfloor-drawing")).toBeNull();
  });

  it("görüntüleme yetkisinde başla, duraklat, bitir ve ara sayım pasif kalır", async () => {
    auth.user = { id: "u8", name: "İzleyici", role: "user", account_type: "standard", permissions: { "/atolye": "view" } };
    jobs = [
      wo({ order_code: "URT-R", status: "ready" }),
      wo({ order_code: "URT-I", status: "in_progress", step_no: 2, operator_name: "Ali" }),
    ];
    await renderScreen();
    for (const id of ["wo-start-URT-R", "wo-pause-URT-I", "wo-finish-URT-I", "wo-partial-URT-I"]) {
      expect(reactProps(findByTestId(container, id))?.disabled).toBe(true);
    }
    expect(reactProps(findByTestId(container, "wo-drawing-URT-R"))?.disabled).toBe(false);
    (post as jest.Mock).mockClear();
    await clickId("wo-start-URT-R");
    expect(post).not.toHaveBeenCalled();
    expect(textOf(container)).not.toContain("987654");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
  });

  it("kilit ekranı operatör seçtirir ve Kendi oturumunuz yazmaz", async () => {
    auth.user = { id: "u1", name: "Atölye Tablet", role: "production", account_type: "atolye", shopfloor_stations: ["CNC"] };
    operators = OPERATORS;
    jobs = [];
    await renderScreen();
    const gate = findByTestId(container, "shopfloor-no-operator");
    expect(textOf(gate)).toContain("Kim çalışıyor?");
    expect(textOf(gate)).toContain("Operatör seçin");
    expect(textOf(gate)).toContain("PIN tanımlı");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
    expect(findByTestId(container, "shopfloor-operator")).toBeNull();
  });

  it("boşta kalınca kilit ekranı aynı operatörün PIN'ini ister", async () => {
    auth.user = { id: "u1", name: "Atölye Tablet", role: "production", account_type: "atolye", shopfloor_stations: ["CNC"] };
    operators = OPERATORS;
    jobs = [wo({ status: "ready" })];
    settings = { idle_lock_minutes: 0.001 };
    (post as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("shopfloor-unlock")) {
        return {
          operator_token: "tok-e3",
          operator_name: "Muhammed ASLAN",
          operator_type: "employee",
          operator_id: "e3",
          expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        };
      }
      return { message: "ok" };
    });
    await renderScreen();
    await clickId("shopfloor-operator-card-e3");
    for (const digit of "5829") {
      await clickId(`shopfloor-pin-key-${digit}`);
    }
    expect(findByTestId(container, "shopfloor-idle-lock")).toBeNull();
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 250); }); });
    const lock = findByTestId(container, "shopfloor-idle-lock");
    expect(lock).toBeTruthy();
    expect(textOf(lock)).toContain("Ekran kilitlendi");
    expect(textOf(lock)).toContain("Muhammed ASLAN");
    expect(textOf(container)).not.toContain("Kendi oturumunuz");
    await clickId("shopfloor-idle-switch");
    expect(findByTestId(container, "shopfloor-no-operator")).toBeTruthy();
  });
});
