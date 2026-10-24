import "../../test/domSetup";
import React, { act } from "react";
import fs from "fs";
import path from "path";
import { findByTestId, reactProps, removeTestNavigator, textOf } from "../../test/domSetup";
import { scanCountPayload } from "../../utils/stockCount";
import { scanPickPayload } from "../../utils/orderPick";
import { parseScanQtyInput } from "../../utils/scanQty";
import { SHUTTER_DEDUPE_MS, SHUTTER_HOLD_MS, SHUTTER_SINGLE_MS } from "../ScanShutter";
import { BarcodeScannerModal } from "../BarcodeScannerModal";

const { createRoot } = require("react-dom/client") as {
  createRoot: (container: unknown) => { render: (node: unknown) => void; unmount: () => void };
};

type ScanFn = (event: { data: string }) => void;

jest.mock("expo-camera", () => {
  const ReactLib = require("react") as typeof import("react");
  return {
    CameraView: (props: { onBarcodeScanned?: ScanFn }) => {
      (globalThis as { __barcodeScan?: ScanFn }).__barcodeScan = props.onBarcodeScanned;
      return ReactLib.createElement("div", { "data-testid": "camera-view" });
    },
    useCameraPermissions: () => [
      {
        granted: (globalThis as { __camGranted?: boolean }).__camGranted !== false,
        canAskAgain: true,
      },
      (globalThis as { __requestCam?: () => void }).__requestCam || jest.fn(),
    ],
  };
});

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  removeItem: jest.fn(async () => undefined),
}));

jest.mock("react-native", () => {
  const ReactLib = require("react") as typeof import("react");
  const platform = {
    OS: "ios",
    select: (spec: { ios?: unknown; default?: unknown }) => spec.ios ?? spec.default,
  };
  (globalThis as { __rnPlatform?: typeof platform }).__rnPlatform = platform;
  const flatten = (style: unknown): Record<string, unknown> | undefined => {
    if (!style) return undefined;
    if (typeof style === "function") return flatten((style as (state: { pressed: boolean }) => unknown)({ pressed: false }));
    if (Array.isArray(style)) return Object.assign({}, ...style.map((part) => flatten(part) || {}));
    if (typeof style === "object") return style as Record<string, unknown>;
    return undefined;
  };
  const host = (tag: string) =>
    function Host(props: { testID?: string; style?: unknown; children?: React.ReactNode; onPress?: () => void; accessibilityLabel?: string }) {
      return ReactLib.createElement(tag, {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        "aria-label": props.accessibilityLabel,
      }, props.children);
    };
  return {
    Platform: platform,
    StyleSheet: {
      absoluteFillObject: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
      absoluteFill: {},
      hairlineWidth: 1,
      create: (styles: Record<string, unknown>) => styles,
      flatten,
    },
    Vibration: { vibrate: jest.fn() },
    View: host("div"),
    Text: host("span"),
    Pressable(props: {
      testID?: string;
      style?: unknown;
      children?: React.ReactNode;
      onPress?: () => void;
      onPressIn?: () => void;
      onPressOut?: () => void;
      onLongPress?: () => void;
      delayLongPress?: number;
      onContextMenu?: (event: { preventDefault?: () => void }) => void;
      accessibilityLabel?: string;
    }) {
      return ReactLib.createElement("button", {
        "data-testid": props.testID,
        style: flatten(props.style),
        onClick: props.onPress,
        onPressIn: props.onPressIn,
        onPressOut: props.onPressOut,
        onLongPress: props.onLongPress,
        delayLongPress: props.delayLongPress,
        onContextMenu: props.onContextMenu,
        "aria-label": props.accessibilityLabel,
      }, props.children);
    },
    Modal: (props: { visible?: boolean; children?: React.ReactNode; testID?: string }) => (
      props.visible ? host("div")(props) : null
    ),
    TextInput: (props: { testID?: string; value?: string; onChangeText?: (value: string) => void }) =>
      ReactLib.createElement("input", {
        "data-testid": props.testID,
        value: props.value ?? "",
        onChange: (event: { target?: { value?: string } }) => props.onChangeText?.(String(event.target?.value ?? "")),
        onChangeText: props.onChangeText,
      }),
    ActivityIndicator: () => null,
  };
});

const screensDir = path.join(__dirname, "../../screens");
const readScreen = (name: string) => fs.readFileSync(path.join(screensDir, name), "utf8");

afterAll(() => {
  const g = globalThis as { document?: unknown; window?: unknown; IS_REACT_ACT_ENVIRONMENT?: unknown; __miniDom?: unknown };
  delete g.document;
  delete g.window;
  delete g.IS_REACT_ACT_ENVIRONMENT;
  delete g.__miniDom;
  removeTestNavigator();
});

describe("BarcodeScannerModal shutter", () => {
  let root: { render: (node: unknown) => void; unmount: () => void };
  let container: HTMLElement;

  beforeEach(() => {
    const originalError = console.error;
    jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      const msg = args.map((part) => String(part ?? "")).join(" ");
      if (/onPressIn|onPressOut|onLongPress|delayLongPress|onChangeText/.test(msg)) return;
      originalError(...args);
    });
    jest.useFakeTimers({ now: 1_700_000_000_000 });
    (globalThis as { __camGranted?: boolean }).__camGranted = true;
    (globalThis as { __rnPlatform?: { OS: string } }).__rnPlatform!.OS = "ios";
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    jest.clearAllTimers();
    act(() => { root.unmount(); });
    container.parentNode?.removeChild(container);
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function renderModal(extra: Record<string, unknown> = {}) {
    const onScan = jest.fn();
    const onClose = jest.fn();
    act(() => {
      root.render(React.createElement(BarcodeScannerModal, {
        visible: true,
        onScan,
        onClose,
        ...extra,
      }));
    });
    return { onScan, onClose };
  }

  function shutter() {
    return findByTestId(container, "barcode-shutter");
  }

  function tapShort() {
    act(() => { reactProps(shutter())?.onPressIn?.(); });
    act(() => { jest.advanceTimersByTime(SHUTTER_HOLD_MS - 1); });
    act(() => { reactProps(shutter())?.onPressOut?.(); });
  }

  function holdSerial() {
    act(() => { reactProps(shutter())?.onPressIn?.(); });
    act(() => { jest.advanceTimersByTime(SHUTTER_HOLD_MS); });
  }

  function release() {
    act(() => { reactProps(shutter())?.onPressOut?.(); });
  }

  function scan(data: string) {
    act(() => {
      (globalThis as { __barcodeScan?: ScanFn }).__barcodeScan?.({ data });
    });
  }

  it("exports the shutter timings", () => {
    expect(SHUTTER_HOLD_MS).toBe(400);
    expect(SHUTTER_SINGLE_MS).toBe(1500);
    expect(SHUTTER_DEDUPE_MS).toBe(1500);
  });

  it("counts one code on a short tap and leaves the scanner open", () => {
    const { onScan, onClose } = renderModal();
    expect(reactProps(shutter())?.delayLongPress).toBe(SHUTTER_HOLD_MS);
    tapShort();
    scan("]C18690123456789");
    scan("8690000000002");
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith("8690123456789");
    expect(onClose).not.toHaveBeenCalled();
    expect(textOf(findByTestId(container, "barcode-toast"))).toContain("8690123456789");
    expect(findByTestId(container, "barcode-serial-badge")).toBeNull();
  });

  it("reads every distinct code while held, then ignores reads after release", () => {
    const { onScan, onClose } = renderModal({ continuous: true });
    expect(textOf(container)).not.toContain("Seri barkod okut");
    expect(textOf(container)).not.toContain("Okuttukça açık kalır");
    holdSerial();
    expect(textOf(findByTestId(container, "barcode-serial-badge"))).toContain("SERİ");
    expect(textOf(findByTestId(container, "barcode-count"))).toBe("0");
    expect(textOf(findByTestId(container, "barcode-hint"))).toContain("bırakınca durur");
    scan("8690000000001");
    scan("8690000000002");
    expect(onScan.mock.calls.map((call) => call[0])).toEqual(["8690000000001", "8690000000002"]);
    expect(textOf(findByTestId(container, "barcode-count"))).toBe("2");
    release();
    expect(findByTestId(container, "barcode-serial-badge")).toBeNull();
    scan("8690000000003");
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("dedupes the same code for 1.5s during serial, then counts it again", () => {
    const { onScan } = renderModal();
    holdSerial();
    scan("ABC");
    scan("ABC");
    expect(onScan).toHaveBeenCalledTimes(1);
    act(() => { jest.advanceTimersByTime(SHUTTER_DEDUPE_MS); });
    scan("ABC");
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(onScan.mock.calls.map((call) => call[0])).toEqual(["ABC", "ABC"]);
  });

  it("shows bulunamadı when a tap sees no code within 1.5s", () => {
    const { onScan, onClose } = renderModal();
    tapShort();
    act(() => { jest.advanceTimersByTime(SHUTTER_SINGLE_MS - 1); });
    expect(findByTestId(container, "barcode-notfound")).toBeNull();
    act(() => { jest.advanceTimersByTime(1); });
    expect(textOf(findByTestId(container, "barcode-notfound"))).toBe("bulunamadı");
    scan("8690000000001");
    expect(onScan).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes from the X control", () => {
    const { onClose } = renderModal();
    act(() => { reactProps(findByTestId(container, "barcode-close"))?.onClick?.(); });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("shows the qty multiplier only when the screen asks for it", () => {
    renderModal();
    expect(findByTestId(container, "barcode-qty")).toBeNull();
    expect(textOf(container)).not.toContain("Adet çarpan");
    const { onScan } = renderModal({ qtyEnabled: true, qty: "2", onQtyChange: jest.fn() });
    expect(findByTestId(container, "barcode-qty")).toBeTruthy();
    expect(textOf(container)).toContain("Adet çarpan");
    tapShort();
    scan("869");
    expect(onScan).toHaveBeenCalledWith("869");
    expect(parseScanQtyInput("2")).toBe(2);
    expect(scanCountPayload("869", "2")).toEqual({ barcode: "869", quantity: 2 });
    expect(scanPickPayload("869", "2")).toEqual({ barcode: "869", quantity: 2 });
  });

  it("keeps manual entry and the camera permission button", () => {
    const { onScan } = renderModal();
    act(() => { reactProps(findByTestId(container, "barcode-manual"))?.onChangeText?.("SKU-1"); });
    act(() => { reactProps(findByTestId(container, "barcode-submit"))?.onClick?.(); });
    expect(onScan).toHaveBeenCalledWith("SKU-1");

    (globalThis as { __camGranted?: boolean }).__camGranted = false;
    const request = jest.fn();
    (globalThis as { __requestCam?: () => void }).__requestCam = request;
    act(() => {
      root.render(React.createElement(BarcodeScannerModal, {
        visible: true,
        onScan: jest.fn(),
        onClose: jest.fn(),
      }));
    });
    expect(textOf(container)).toContain("Kamera izni ver");
    act(() => { reactProps(findByTestId(container, "barcode-submit"))?.onClick?.(); });
  });

  it("disables text selection and the long-press menu on web", () => {
    (globalThis as { __rnPlatform?: { OS: string } }).__rnPlatform!.OS = "web";
    renderModal();
    const node = shutter();
    expect(reactProps(node)?.style?.userSelect).toBe("none");
    expect(reactProps(node)?.style?.WebkitTouchCallout).toBe("none");
    const event = { preventDefault: jest.fn() };
    reactProps(node)?.onContextMenu?.(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(findByTestId(container, "barcode-torch")).toBeTruthy();
  });
});

describe("screen scan wiring", () => {
  const qtyScreens = ["FieldSalesScreen.tsx", "B2BPortalScreen.tsx", "StockCountSessionScreen.tsx", "SevkPickScreen.tsx"];
  const plainScreens = ["InvoiceFormScreen.tsx", "OrderFormScreen.tsx", "WorkFormScreen.tsx", "StockScreen.tsx", "ProductFormScreen.tsx"];

  it("keeps the qty multiplier on the screens that already had it", () => {
    for (const file of qtyScreens) expect(readScreen(file)).toMatch(/qtyEnabled/);
    for (const file of plainScreens) expect(readScreen(file)).not.toMatch(/qtyEnabled/);
  });

  it("uses one scan button on stock count and shipment picking", () => {
    const sayim = readScreen("StockCountSessionScreen.tsx");
    const sevk = readScreen("SevkPickScreen.tsx");
    expect(sayim).toContain('testID="sayim-scan-btn"');
    expect(sayim).not.toContain("sayim-scan-serial-btn");
    expect(sayim).not.toContain("Seri okut");
    expect(sayim).toContain("onScan={submitScan}");
    expect(sayim).toContain("scanCountPayload(value, scanQty)");
    expect(sevk).toContain('testID="sevk-scan-btn"');
    expect(sevk).not.toContain("sevk-scan-serial-btn");
    expect(sevk).not.toContain("Seri okut");
    expect(sevk).toContain("onScan={submitScan}");
    expect(sevk).toContain("scanPickPayload(value, scanQty)");
    expect(readScreen("StockCountScreen.tsx")).toContain("basılı tutunca seri");
    expect(readScreen("StockCountScreen.tsx")).not.toContain("seri okuma ile sayın");
  });

  it("keeps each screen's scan handler and the manual close flows", () => {
    expect(readScreen("FieldSalesScreen.tsx")).toContain("onScan={lookupBarcode}");
    expect(readScreen("FieldSalesScreen.tsx")).toContain("parseScanQty(scanQty)");
    expect(readScreen("B2BPortalScreen.tsx")).toContain("onScan={addFromScan}");
    expect(readScreen("OrderFormScreen.tsx")).toContain("onScan={lookupBarcode}");
    expect(readScreen("WorkFormScreen.tsx")).toContain("onScan={applyBarcodeToLine}");
    expect(readScreen("StockScreen.tsx")).toContain("onScan={lookup}");
    expect(readScreen("ProductFormScreen.tsx")).toContain('set("barcode", code)');
    const invoice = readScreen("InvoiceFormScreen.tsx");
    expect(invoice).toContain("if (scanLine != null) void applyBarcodeToLine(code)");
    expect(invoice).toContain("else void lookupBarcode(code)");
    expect(invoice).toContain("setScan(false)");
    const modal = fs.readFileSync(path.join(__dirname, "../BarcodeScannerModal.tsx"), "utf8");
    expect(modal).not.toContain("Seri barkod okut");
    expect(modal).not.toContain("Okuttukça açık kalır");
    expect(modal).toContain("continuous");
  });

  it("bumps the mobile version above origin/main", () => {
    const app = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../app.json"), "utf8")) as {
      expo: { version: string; android: { versionCode: number } };
    };
    expect(app.expo.version).toBe("1.0.137");
    expect(app.expo.android.versionCode).toBe(139);
  });
});
