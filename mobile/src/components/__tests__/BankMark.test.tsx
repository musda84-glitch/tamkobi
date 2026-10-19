import "../../test/domSetup";
import React, { act } from "react";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import type { BankBrand } from "../../utils/bankBrand";
import { BankMark } from "../BankMark";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    View: (props: { testID?: string; style?: unknown; children?: React.ReactNode }) =>
      ReactLib.createElement("div", { "data-testid": props.testID, style: props.style }, props.children),
    Text: (props: { children?: React.ReactNode }) => ReactLib.createElement("span", null, props.children),
    Image: (props: { testID?: string; source?: { uri?: string }; onError?: () => void; style?: unknown }) =>
      ReactLib.createElement("img", {
        "data-testid": props.testID,
        src: props.source?.uri,
        style: props.style,
        onError: props.onError,
      }),
  };
});

const brand: BankBrand = {
  key: "isbank",
  label: "İş Bankası",
  initials: "İŞ",
  solid: "#0033A0",
  bg: "#EEF2FF",
  border: "#A5B4FC",
  text: "#1E3A8A",
};

function renderMark(next: BankBrand, size?: number) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(React.createElement(BankMark, { brand: next, size }));
  });
  return { container, root };
}

describe("BankMark", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  afterAll(() => {
    removeTestNavigator();
  });

  it("renders the uploaded logo in the same rounded frame", () => {
    const { container } = renderMark({ ...brand, logoUri: "https://api.test/api/files/is.png" }, 48);
    const frame = findByTestId(container, "bank-mark-isbank");
    const image = findByTestId(container, "bank-mark-image-isbank");
    expect(image).toBeTruthy();
    expect(image.getAttribute("src")).toBe("https://api.test/api/files/is.png");
    expect(reactProps(image)?.style?.width).toBe(48);
    expect(reactProps(image)?.style?.height).toBe(48);
    expect(reactProps(frame)?.style?.width).toBe(48);
    expect(reactProps(frame)?.style?.height).toBe(48);
    expect(reactProps(frame)?.style?.borderRadius).toBe(10);
    expect(textOf(frame)).not.toContain("İŞ");
  });

  it("falls back to the monogram when the image errors", () => {
    const { container } = renderMark({ ...brand, logoUri: "https://api.test/api/files/missing.png" });
    const image = findByTestId(container, "bank-mark-image-isbank");
    expect(image).toBeTruthy();
    act(() => {
      reactProps(image)?.onError?.();
    });
    expect(findByTestId(container, "bank-mark-image-isbank")).toBeNull();
    const frame = findByTestId(container, "bank-mark-isbank");
    expect(textOf(frame)).toContain("İŞ");
    expect(reactProps(frame)?.style?.backgroundColor).toBe("#0033A0");
    expect(reactProps(frame)?.style?.borderRadius).toBe(10);
  });

  it("shows the monogram when there is no logo", () => {
    const { container } = renderMark(brand);
    expect(findByTestId(container, "bank-mark-image-isbank")).toBeNull();
    expect(textOf(findByTestId(container, "bank-mark-isbank"))).toContain("İŞ");
  });
});
