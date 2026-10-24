import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps } from "../../test/domSetup";
import { ShopfloorPairScreen } from "../ShopfloorPairScreen";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

const auth = {
  baseUrl: "https://tamkobi.com",
  pairShopfloorDevice: jest.fn(async () => undefined),
};

jest.mock("../../auth/AuthContext", () => ({
  useAuth: () => auth,
  apiErrorMessage: (_err: unknown, fallback?: string) => fallback || "Eşleştirme yapılamadı.",
}));

jest.mock("../../components/kit", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    Field: (props: { testID?: string; onChangeText?: (value: string) => void; value?: string }) => ReactLib.createElement("input", {
      "data-testid": props.testID,
      value: props.value || "",
      onChangeText: props.onChangeText,
    }),
    PrimaryButton: (props: { testID?: string; onPress?: () => void; disabled?: boolean; title?: string }) => ReactLib.createElement("button", {
      type: "button",
      "data-testid": props.testID,
      disabled: props.disabled,
      onClick: props.disabled ? undefined : props.onPress,
    }, props.title),
  };
});

jest.mock("../../components/BarcodeScannerModal", () => ({
  BarcodeScannerModal: (props: { visible?: boolean; onScan?: (code: string) => void }) => {
    const ReactLib = require("react") as typeof import("react");
    if (!props.visible) return null;
    return ReactLib.createElement("button", {
      type: "button",
      "data-testid": "pair-scan-fire",
      onClick: () => props.onScan?.("k4m7np"),
    });
  },
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const host = (tag: string) => (props: { children?: React.ReactNode; testID?: string; onPress?: () => void }) => ReactLib.createElement(tag, {
    "data-testid": props.testID,
    onClick: props.onPress,
  }, props.children);
  return { Pressable: host("button"), Text: host("span"), View: host("div") };
});

describe("ShopfloorPairScreen", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLDivElement;

  beforeEach(() => {
    auth.pairShopfloorDevice.mockClear();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
  });

  async function show() {
    await act(async () => { root.render(React.createElement(ShopfloorPairScreen)); });
  }

  it("sends a typed code and does not keep it in the address", async () => {
    await show();
    const input = findByTestId(container, "shopfloor-pair-code");
    await act(async () => {
      reactProps(input)?.onChangeText?.("k4m7np");
    });
    await act(async () => {
      await reactProps(findByTestId(container, "shopfloor-pair-submit"))?.onClick?.();
    });
    expect(auth.pairShopfloorDevice).toHaveBeenCalledWith("K4M7NP", undefined);
    expect(window.location.href).not.toContain("K4M7NP");
  });

  it("reads a QR payload as a plain code", async () => {
    await show();
    await act(async () => {
      reactProps(findByTestId(container, "shopfloor-pair-scan"))?.onClick?.();
    });
    await act(async () => {
      await reactProps(findByTestId(container, "pair-scan-fire"))?.onClick?.();
    });
    expect(auth.pairShopfloorDevice).toHaveBeenCalledWith("K4M7NP", undefined);
  });
});
