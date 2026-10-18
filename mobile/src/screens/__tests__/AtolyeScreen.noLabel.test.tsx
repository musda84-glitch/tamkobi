import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, removeTestNavigator, textOf } from "../../test/domSetup";
import { AtolyeScreen } from "../AtolyeScreen";

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
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
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
  get: jest.fn(async (_client: unknown, path: string) => {
    const p = String(path);
    if (p.includes("/production/work-orders") && !p.includes("pause-policy") && !p.includes("stations") && !p.includes("shopfloor-settings")) {
      return [
        { id: "wo-ready", order_code: "IE-1", step_name: "Kesim", product_name: "Tabla", status: "ready" },
        { id: "wo-run", order_code: "IE-2", step_name: "Bant", product_name: "Kapak", status: "in_progress" },
        { id: "wo-wait", order_code: "IE-3", step_name: "Montaj", product_name: "Çekmece", status: "waiting" },
      ];
    }
    if (p.includes("pause-policy")) return { allowed: true, phase: "mesai" };
    if (p.includes("/personnel/me")) return { tasks: [] };
    if (p.includes("shopfloor-settings")) return { group_same_station: false };
    if (p.includes("work-parks")) return { parks: [] };
    return [];
  }),
  post: jest.fn(async () => ({})),
}));

function testIds(node: any, acc: string[] = []): string[] {
  if (!node) return acc;
  const id = node.getAttribute?.("data-testid");
  if (typeof id === "string" && id) acc.push(id);
  for (const child of node.childNodes || []) testIds(child, acc);
  return acc;
}

afterAll(() => {
  const g = globalThis as any;
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("AtolyeScreen without label printing", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  it("does not render Etiket bas or a label sheet on work order cards", async () => {
    await act(async () => { root.render(React.createElement(AtolyeScreen)); });
    for (let i = 0; i < 8; i += 1) {
      await act(async () => { await Promise.resolve(); });
    }
    expect(get).toHaveBeenCalled();
    expect(findByTestId(container, "wo-card-wo-ready")).toBeTruthy();
    expect(findByTestId(container, "wo-card-wo-run")).toBeTruthy();
    expect(findByTestId(container, "wo-card-wo-wait")).toBeTruthy();
    expect(textOf(container)).not.toContain("Etiket bas");
    expect(testIds(container).some((id) => id.startsWith("wo-label"))).toBe(false);
    expect(findByTestId(container, "wo-label-sheet")).toBeNull();
    expect(findByTestId(container, "wo-start-wo-ready")).toBeTruthy();
    expect(findByTestId(container, "wo-pause-wo-run")).toBeTruthy();
    expect(findByTestId(container, "wo-finish-wo-run")).toBeTruthy();
  });
});
