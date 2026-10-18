import "../../test/domSetup";
import React, { act } from "react";
import { Alert } from "react-native";
import { del, put } from "../../api/client";
import { clickable, findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { ProjectCardsHost } from "../ProjectCard";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const go = jest.fn();

jest.mock("../../nav", () => ({
  go: (...args: unknown[]) => go(...args),
}));

jest.mock("expo-image", () => ({ Image: () => null }));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));
jest.mock("expo-linking", () => ({ openURL: jest.fn() }));
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({
    client: { baseUrl: "https://x.test", token: "t" },
    companyId: "co-1",
    can: () => true,
  }),
  apiErrorMessage: (_err: unknown, fallback: string) => fallback,
}));

jest.mock("../../api/client", () => ({
  get: jest.fn(async () => []),
  put: jest.fn(async () => ({})),
  del: jest.fn(async () => ({})),
  post: jest.fn(async () => ({})),
  upload: jest.fn(async () => ({})),
  fileUrl: (_base: string, url: string) => url,
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; disabled?: boolean; onPress?: () => void; children?: React.ReactNode; accessibilityLabel?: string }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        disabled: !!props.disabled,
        "aria-label": props.accessibilityLabel,
        onClick: () => (props.disabled ? undefined : props.onPress?.()),
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
      create: (styles: unknown) => styles,
      flatten: (style: unknown) => style,
    },
    Keyboard: { addListener: () => ({ remove() { /* no-op */ } }) },
    Linking: { openURL: jest.fn(async () => undefined) },
    Share: { share: jest.fn(async () => ({ action: "sharedAction" })) },
    Alert: { alert: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    ScrollView: host("div"),
    KeyboardAvoidingView: host("div"),
    ActivityIndicator: () => null,
    RefreshControl: () => null,
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (
      props.visible === false ? null : host("div")(props)
    ),
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
  { key: "on_hold", label: "Beklemede" },
  { key: "completed", label: "Tamamlandı", is_final: true },
];

const PROJECT = {
  id: "p1",
  name: "Villa",
  status: "planning",
  contact_id: "c1",
  contact_name: "Ali",
  project_number: "PRJ-1",
  budget: 0,
  quoted_total: 0,
  invoiced_total: 0,
  expense_total: 0,
  production_order_code: "UE-9",
  show_production_steps: true,
  production_steps: [
    { no: 1, name: "Kesim" },
    { no: 2, name: "Bant" },
    { no: 3, name: "Delik" },
    { no: 4, name: "Toplama" },
  ],
};

function renderHost(overrides: Record<string, unknown> = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const props = {
    projects: [PROJECT],
    stages: STAGES,
    canEdit: true,
    canExp: true,
    canQuote: true,
    client: { baseUrl: "https://x.test", token: "t" },
    companyId: "co-1",
    baseUrl: "https://x.test",
    onPatch: () => undefined,
    onError: () => undefined,
    onCollect: () => undefined,
    ...overrides,
  };
  return { container, root, props };
}

async function show(overrides: Record<string, unknown> = {}) {
  const view = renderHost(overrides);
  await act(async () => { view.root.render(React.createElement(ProjectCardsHost, view.props as never)); });
  return view;
}

async function press(container: unknown, id: string) {
  const node = findByTestId(container, id);
  if (!node) throw new Error(`missing ${id}; text=${textOf(container).slice(0, 400)}`);
  const target = clickable(node) || node;
  const props = reactProps(target);
  const handler = props?.onClick || props?.onPress;
  if (!handler) throw new Error(`no handler ${id}`);
  await act(async () => { await handler(); });
}

describe("ProjectCard redesign", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: any;

  afterEach(async () => {
    if (root) await act(async () => { root.unmount(); });
    container?.parentNode?.removeChild(container);
    go.mockClear();
    (put as jest.Mock).mockClear();
    (del as jest.Mock).mockClear();
    (Alert.alert as jest.Mock).mockClear();
  });

  it("puts the selected stage and hides the stage dropdown", async () => {
    ({ container, root } = await show());
    expect(textOf(container)).not.toContain("Aşama seçin");
    expect(textOf(container)).not.toContain(">Aşama<");
    expect(findByTestId(container, "project-status-p1")).toBeTruthy();
    await press(container, "project-status-p1-active");
    expect(put).toHaveBeenCalledWith(expect.anything(), "/projects/p1", { status: "active" });
  });

  it("does not change status when the card is read-only", async () => {
    ({ container, root } = await show({ canEdit: false }));
    const step = findByTestId(container, "project-status-p1-active");
    expect(step).toBeTruthy();
    expect(step.tagName).toBe("DIV");
    await act(async () => { reactProps(step)?.onClick?.(); });
    expect(put).not.toHaveBeenCalled();
  });

  it("opens a new quote and completes the project from the two buttons", async () => {
    ({ container, root } = await show());
    expect(textOf(findByTestId(container, "project-new-quote-p1"))).toContain("+ Teklif");
    await press(container, "project-new-quote-p1");
    expect(go).toHaveBeenCalledWith("QuoteNew", {
      project_id: "p1",
      contact_id: "c1",
      contact_name: "Ali",
      title: "Villa",
    });
    expect(textOf(findByTestId(container, "project-quote-p1"))).toContain("✓ Tamamla");
    await press(container, "project-quote-p1");
    expect(put).toHaveBeenCalledWith(expect.anything(), "/projects/p1", { status: "completed" });
  });

  it("lists the existing actions in the more sheet", async () => {
    ({ container, root } = await show());
    await press(container, "project-more-p1");
    const sheet = findByTestId(container, "project-more-sheet");
    expect(sheet).toBeTruthy();
    for (const id of [
      "project-edit-p1",
      "project-expense-p1",
      "project-team-p1",
      "project-collect-p1",
      "project-track-p1",
      "project-maps-p1",
      "project-delete-p1",
    ]) {
      expect(findByTestId(sheet, id)).toBeTruthy();
    }
  });

  it("deletes on confirm and skips the request when dismissed", async () => {
    ({ container, root } = await show());
    await press(container, "project-more-p1");
    await press(container, "project-delete-p1");
    expect(Alert.alert).toHaveBeenCalledWith("Sil", "Kayıt çöp kutusuna taşınsın mı?", expect.any(Array));
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { text: string; onPress?: () => void }[];
    const cancel = buttons.find((b) => b.text === "Vazgeç");
    cancel?.onPress?.();
    expect(del).not.toHaveBeenCalled();
    await act(async () => {
      buttons.find((b) => b.text === "Tamam")?.onPress?.();
      await Promise.resolve();
    });
    expect(del).toHaveBeenCalledWith(expect.anything(), "/projects/p1");
  });

  it("shows one production line and an empty photo strip", async () => {
    ({ container, root } = await show());
    expect(textOf(findByTestId(container, "project-recipe-steps-p1"))).toContain("4 adım");
    expect(textOf(findByTestId(container, "project-recipe-steps-p1"))).toContain("UE-9");
    expect(textOf(findByTestId(container, "project-recipe-steps-p1"))).toContain("Müşteri görür");
    expect(textOf(findByTestId(container, "project-stage-photos-p1"))).toContain("Fotoğraf yok");
  });
});
