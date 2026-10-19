import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, removeTestNavigator, textOf } from "../../test/domSetup";
import { EXPENSE_SCAN_IDLE_HINT } from "../../utils/expenseScan";
import { ExpenseScanButtons } from "../ExpenseScanButtons";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ client: { baseUrl: "https://api.test", token: "tok" }, companyId: "co-1" }),
  apiErrorMessage: (err: unknown, fallback?: string) => String((err as Error)?.message || fallback || ""),
}));

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ status: "granted" })),
  launchCameraAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
  launchImageLibraryAsync: jest.fn(async () => ({ canceled: true, assets: [] })),
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) =>
    function Host(props: { testID?: string; children?: React.ReactNode; onPress?: () => void }) {
      return ReactLib.createElement(tag, { "data-testid": props.testID, onClick: props.onPress }, props.children);
    };
  return {
    Platform: { OS: "ios", select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default },
    StyleSheet: { absoluteFill: {}, hairlineWidth: 1, create: (styles: unknown) => styles, flatten: (style: unknown) => style },
    View: host("div"),
    Text: host("span"),
    Pressable: host("button"),
    Modal: (props: { visible?: boolean; children?: React.ReactNode }) => (props.visible ? host("div")(props) : null),
    ActivityIndicator: () => null,
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("ExpenseScanButtons", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => { root.unmount(); });
    container.parentNode?.removeChild(container);
  });

  it("keeps the two-button camera and gallery controls", async () => {
    await act(async () => {
      root.render(React.createElement(ExpenseScanButtons, { onDraft: () => undefined }));
    });
    expect(textOf(findByTestId(container, "exp-scan-hint"))).toBe(EXPENSE_SCAN_IDLE_HINT);
    expect(textOf(findByTestId(container, "exp-scan-camera"))).toContain("Kamera ile oku");
    expect(textOf(findByTestId(container, "exp-scan-gallery"))).toContain("Galeriden oku");
    expect(findByTestId(container, "exp-scan-open")).toBeNull();
    expect(findByTestId(container, "exp-scan-sheet")).toBeNull();
  });
});
