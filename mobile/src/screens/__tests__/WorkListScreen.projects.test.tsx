import "../../test/domSetup";
import React, { act } from "react";
import { get } from "../../api/client";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { WorkListScreen } from "../WorkListScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("expo-router", () => ({
  useFocusEffect: (effect: () => void | (() => void)) => {
    const ReactLib = require("react") as typeof import("react");
    ReactLib.useEffect(() => effect(), [effect]);
  },
}));
jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({}));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../../nav", () => ({ go: jest.fn() }));
jest.mock("../../auth/AuthContext", () => {
  const auth = {
    client: { baseUrl: "https://x.test", token: "t" },
    companyId: "co-1",
    baseUrl: "https://x.test",
    can: () => true,
  };
  return {
    useAuth: () => auth,
    apiErrorMessage: (_err: unknown, fallback: string) => fallback,
  };
});
jest.mock("../../api/client", () => ({
  get: jest.fn(),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  post: jest.fn(async () => ({})),
  upload: jest.fn(),
  fileUrl: (_base: string, url: string) => url,
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: {
      testID?: string;
      placeholder?: string;
      value?: string;
      onPress?: () => void;
      onChangeText?: (value: string) => void;
      children?: React.ReactNode;
    }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        placeholder: props.placeholder,
        value: props.value ?? "",
        onClick: props.onPress,
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event?.target?.value ?? "")),
      }, props.children);
    };
  const TextInput = Object.assign(host("input"), { State: { currentlyFocusedInput: () => null } });
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: {
      absoluteFill: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
      hairlineWidth: 1,
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => style,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Linking: { openURL: jest.fn() },
    Share: { share: jest.fn() },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible === false ? null : host("div")(props)),
    TextInput,
  };
});

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

const STAGES = [
  { key: "planning", label: "Planlama" },
  { key: "active", label: "Devam Ediyor" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

const PROJECTS = [
  { id: "a", name: "Aktif İş", status: "active", contact_name: "Ali", project_number: "PRJ-1" },
  { id: "b", name: "Biten İş", status: "completed", contact_name: "Veli", project_number: "PRJ-2" },
  { id: "c", name: "Plan İş", status: "planning", contact_name: "Ayşe", project_number: "PRJ-3" },
];

async function flush() {
  for (let i = 0; i < 8; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

function inputByPlaceholder(node: any, placeholder: string): any {
  if (!node) return null;
  if (node.getAttribute?.("placeholder") === placeholder) return node;
  for (const child of node.childNodes || []) {
    const hit = inputByPlaceholder(child, placeholder);
    if (hit) return hit;
  }
  return null;
}

describe("WorkListScreen project chips", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  beforeEach(() => {
    (get as jest.Mock).mockImplementation(async (_client: unknown, path: string) => {
      if (String(path).includes("project-stages")) return { stages: STAGES };
      if (String(path).includes("/quotes")) return [{ id: "q1", quote_number: "TKF-1", title: "Teklif", contact_name: "Ali", grand_total: 10 }];
      return PROJECTS;
    });
  });

  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.parentNode?.removeChild(container);
  });

  async function renderKind(kind: "project" | "quote") {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => { root.render(React.createElement(WorkListScreen, { kind })); });
    await flush();
  }

  it("defaults to active, narrows by chip, and searches inside the chip", async () => {
    await renderKind("project");
    expect(findByTestId(container, "toggle-completed-projects")).toBeNull();
    expect(findByTestId(container, "completed-projects-hint")).toBeNull();
    expect(findByTestId(container, "new-project-btn")).toBeTruthy();
    expect(textOf(findByTestId(container, "project-filter-active"))).toBe("Aktif (2)");
    expect(textOf(findByTestId(container, "project-filter-completed"))).toBe("Tamamlanan (1)");
    expect(textOf(findByTestId(container, "project-filter-all"))).toBe("Tümü (3)");
    expect(findByTestId(container, "project-row-a")).toBeTruthy();
    expect(findByTestId(container, "project-row-c")).toBeTruthy();
    expect(findByTestId(container, "project-row-b")).toBeNull();

    await act(async () => { reactProps(findByTestId(container, "project-filter-completed"))?.onClick?.(); });
    expect(findByTestId(container, "project-row-b")).toBeTruthy();
    expect(findByTestId(container, "project-row-a")).toBeNull();

    await act(async () => { reactProps(findByTestId(container, "project-filter-all"))?.onClick?.(); });
    expect(findByTestId(container, "project-row-a")).toBeTruthy();
    expect(findByTestId(container, "project-row-b")).toBeTruthy();

    await act(async () => { reactProps(findByTestId(container, "project-filter-active"))?.onClick?.(); });
    const search = inputByPlaceholder(container, "No / cari / ad");
    await act(async () => { reactProps(search)?.onChange?.({ target: { value: "Ayşe" } }); });
    expect(findByTestId(container, "project-row-c")).toBeTruthy();
    expect(findByTestId(container, "project-row-a")).toBeNull();
    expect(findByTestId(container, "project-row-b")).toBeNull();

    await act(async () => { reactProps(search)?.onChange?.({ target: { value: "Veli" } }); });
    expect(findByTestId(container, "project-row-b")).toBeNull();
    expect(findByTestId(container, "project-row-a")).toBeNull();
  });

  it("leaves the quote list without project chips", async () => {
    await renderKind("quote");
    expect(findByTestId(container, "project-filter-active")).toBeNull();
    expect(findByTestId(container, "new-quote-btn")).toBeTruthy();
    expect(findByTestId(container, "quote-row-q1")).toBeTruthy();
  });
});
