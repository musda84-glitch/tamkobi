/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import {
  CameraScanner,
  SHUTTER_DEDUPE_MS,
  SHUTTER_HOLD_MS,
  SHUTTER_SEARCH_MS,
} from "./CameraScanner";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("html5-qrcode", () => {
  const scanners = [];
  globalThis.__qrScanners = scanners;
  class Html5Qrcode {
    constructor() {
      this.isScanning = false;
      scanners.push(this);
    }
    async start(_camera, _config, onOk) {
      this.isScanning = true;
      this.onOk = onOk;
    }
    async stop() { this.isScanning = false; }
    clear() {}
    static getCameras() {
      return Promise.resolve([{ id: "back-cam", label: "Back Camera" }]);
    }
  }
  return {
    Html5Qrcode,
    Html5QrcodeSupportedFormats: {
      EAN_13: 0, EAN_8: 1, UPC_A: 2, UPC_E: 3, CODE_128: 4, CODE_39: 5,
      CODE_93: 6, CODABAR: 7, ITF: 8, RSS_14: 9, QR_CODE: 10,
      DATA_MATRIX: 11, PDF_417: 12, AZTEC: 13,
    },
  };
});

if (typeof window.PointerEvent !== "function") {
  window.PointerEvent = class PointerEvent extends MouseEvent {
    constructor(type, props = {}) {
      super(type, props);
      this.pointerId = props.pointerId ?? 1;
      this.pointerType = props.pointerType ?? "mouse";
    }
  };
}
if (!("onpointerdown" in window)) window.onpointerdown = null;
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = function setPointerCapture() {};
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = function releasePointerCapture() {};
}
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = function hasPointerCapture() { return false; };
}

let host;
let root;

beforeEach(() => {
  jest.useFakeTimers();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  globalThis.__qrScanners.length = 0;
  delete window.BarcodeDetector;
  navigator.vibrate = jest.fn();
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
});

async function advance(ms) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderScanner(props = {}) {
  const onScan = props.onScan || jest.fn();
  const onClose = props.onClose || jest.fn();
  await act(async () => {
    root.render(<CameraScanner onScan={onScan} onClose={onClose} {...props} />);
  });
  for (let i = 0; i < 6; i += 1) {
    // Kamera açılışı 40 ms gecikir; arka kamera seçilince etki bir kez daha kurulur.
    // eslint-disable-next-line no-await-in-loop
    await advance(50);
    if (globalThis.__qrScanners.some((s) => s.onOk)) break;
  }
  return { onScan, onClose };
}

function shutter() {
  return host.querySelector('[data-testid="camera-scanner-shutter"]');
}

function reactProps(el) {
  const key = Object.keys(el).find((k) => k.startsWith("__reactProps"));
  return key ? el[key] : null;
}

async function point(phase, extra = {}) {
  const el = shutter();
  const props = reactProps(el);
  const map = { down: "onPointerDown", up: "onPointerUp", leave: "onPointerLeave", cancel: "onPointerCancel" };
  if (!props?.[map[phase]]) throw new Error(`${map[phase]} yok`);
  const event = {
    pointerId: 1,
    pointerType: extra.pointerType || "touch",
    button: extra.button ?? 0,
    preventDefault() { this.defaultPrevented = true; },
    currentTarget: el,
    target: el,
  };
  await act(async () => { props[map[phase]](event); });
  return event;
}

function decode(text) {
  const scanner = [...globalThis.__qrScanners].reverse().find((s) => s.onOk);
  if (!scanner) throw new Error("okuyucu başlamadı");
  act(() => { scanner.onOk(text); });
}

test("kısa dokunuş tek okuma yapar, kamerayı açık bırakır ve yeşil toast gösterir", async () => {
  const { onScan, onClose } = await renderScanner({ continuous: true, statusText: "Kalem sepete eklendi (2)", qty: 2, qtyEnabled: true });
  expect(host.querySelector('[data-testid="camera-scanner-engine"]').textContent).toMatch(/Gelişmiş yazılım okuyucu/);
  await point("down");
  await point("up");
  decode("8690123456789");
  decode("8690999999999");
  expect(onScan).toHaveBeenCalledTimes(1);
  expect(onScan).toHaveBeenCalledWith("8690123456789");
  expect(onClose).not.toHaveBeenCalled();
  expect(host.querySelector('[data-testid="camera-scanner"]')).not.toBeNull();
  const toast = host.querySelector('[data-testid="camera-scanner-toast"]');
  expect(toast).not.toBeNull();
  expect(toast.className).toMatch(/emerald/);
  expect(toast.textContent).toContain("Kalem sepete eklendi (2)");
  expect(toast.textContent).toContain("8690123456789");
  expect(toast.textContent).toContain("Sepete eklendi (×2)");
  expect(toast.textContent).toContain("sıradaki için tekrar dokunun");
  expect(host.querySelector('[data-testid="camera-scanner-shutter"]').getAttribute("data-mode")).toBe("idle");
});

test("1,5 sn içinde kod yoksa bulunamadı görünür ve onScan çağrılmaz", async () => {
  const { onScan, onClose } = await renderScanner();
  await point("down");
  await point("up");
  await advance(SHUTTER_SEARCH_MS);
  expect(onScan).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  const miss = host.querySelector('[data-testid="camera-scanner-notfound"]');
  expect(miss).not.toBeNull();
  expect(miss.textContent.toLowerCase()).toContain("bulunamadı");
  expect(host.querySelector('[data-testid="camera-scanner"]')).not.toBeNull();
});

test("basılı tutma seri moda geçer, her yeni kodu sayar", async () => {
  const { onScan } = await renderScanner();
  await point("down", { pointerType: "touch" });
  await advance(SHUTTER_HOLD_MS);
  expect(host.querySelector('[data-testid="camera-scanner-serial-badge"]').textContent).toContain("SERİ");
  expect(shutter().className).toMatch(/rose/);
  expect(host.textContent).toContain("Seri okuma");
  expect(host.querySelector('[data-testid="camera-scanner-hint"]').textContent).toContain("bırakınca durur");
  decode("111");
  decode("222");
  decode("333");
  expect(onScan.mock.calls.map((c) => c[0])).toEqual(["111", "222", "333"]);
  expect(host.querySelector('[data-testid="camera-scanner-count"]').textContent).toBe("3 okuma");
  expect(navigator.vibrate).toHaveBeenCalled();
  expect(host.querySelector('[data-testid="camera-scanner-flash"]')).not.toBeNull();
});

test("bırakınca seri durur ve sonraki kodlar onScan çağırmaz", async () => {
  const { onScan } = await renderScanner();
  await point("down");
  await advance(SHUTTER_HOLD_MS);
  decode("111");
  await point("up");
  decode("222");
  expect(onScan.mock.calls.map((c) => c[0])).toEqual(["111"]);
  expect(host.querySelector('[data-testid="camera-scanner-serial-badge"]')).toBeNull();
  expect(host.querySelector('[data-testid="camera-scanner"]')).not.toBeNull();
});

test("fare pointerleave ve pointercancel seriyi durdurur; dokunuşta kayma durdurmaz", async () => {
  const leave = await renderScanner();
  await point("down", { pointerType: "mouse" });
  await advance(SHUTTER_HOLD_MS);
  decode("AAA");
  await point("leave", { pointerType: "mouse" });
  decode("BBB");
  expect(leave.onScan.mock.calls.map((c) => c[0])).toEqual(["AAA"]);

  act(() => { root.unmount(); });
  root = createRoot(host);
  const slid = await renderScanner();
  await point("down", { pointerType: "touch" });
  await advance(SHUTTER_HOLD_MS / 2);
  await point("leave", { pointerType: "touch" });
  await advance(SHUTTER_HOLD_MS);
  expect(shutter().getAttribute("data-mode")).toBe("serial");
  decode("EEE");
  expect(slid.onScan.mock.calls.map((c) => c[0])).toEqual(["EEE"]);

  act(() => { root.unmount(); });
  root = createRoot(host);
  const cancel = await renderScanner();
  await point("down", { pointerType: "touch" });
  await advance(SHUTTER_HOLD_MS);
  decode("CCC");
  await point("cancel", { pointerType: "touch" });
  decode("DDD");
  expect(cancel.onScan.mock.calls.map((c) => c[0])).toEqual(["CCC"]);
  expect(shutter().getAttribute("data-mode")).toBe("idle");
});

test("seri modda aynı kod 1,5 sn içinde bir kez, süre dolunca yeniden sayılır", async () => {
  const { onScan } = await renderScanner();
  await point("down");
  await advance(SHUTTER_HOLD_MS);
  decode("8690");
  decode("8690");
  expect(onScan).toHaveBeenCalledTimes(1);
  await advance(SHUTTER_DEDUPE_MS - 1);
  decode("8690");
  expect(onScan).toHaveBeenCalledTimes(1);
  await advance(1);
  decode("8690");
  expect(onScan).toHaveBeenCalledTimes(2);
});

test("fare ile basılı tutma seri moda geçer ve contextmenu engellenir", async () => {
  await renderScanner();
  const capture = jest.spyOn(Element.prototype, "setPointerCapture");
  await point("down", { pointerType: "mouse", button: 0 });
  expect(capture).toHaveBeenCalled();
  await advance(SHUTTER_HOLD_MS);
  expect(host.querySelector('[data-testid="camera-scanner-serial-badge"]')).not.toBeNull();
  const menu = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
  const props = reactProps(shutter());
  await act(async () => { props.onContextMenu(menu); });
  expect(menu.defaultPrevented).toBe(true);
  const style = reactProps(shutter()).style;
  expect(style.touchAction).toBe("none");
  expect(style.userSelect).toBe("none");
  expect(style.WebkitTouchCallout).toBe("none");
  capture.mockRestore();
});

test("X kapatır", async () => {
  const { onClose } = await renderScanner();
  await act(async () => {
    host.querySelector('[data-testid="camera-scanner-close"]').click();
  });
  expect(onClose).toHaveBeenCalledTimes(1);
});

function pxOf(styleText, prop) {
  const match = String(styleText).match(new RegExp(`${prop}\\s*:\\s*([0-9.]+)px`));
  return match ? parseFloat(match[1]) : NaN;
}

test("mobil deklanşör en az 72px, kaydırma ve seçim engelli, titreşim güvenli", async () => {
  const { onScan } = await renderScanner();
  const el = shutter();
  const styleText = el.getAttribute("style") || "";
  expect(pxOf(styleText, "width")).toBeGreaterThanOrEqual(72);
  expect(pxOf(styleText, "height")).toBeGreaterThanOrEqual(72);
  expect(pxOf(styleText, "min-width")).toBeGreaterThanOrEqual(72);
  expect(pxOf(styleText, "min-height")).toBeGreaterThanOrEqual(72);
  expect(styleText).toContain("touch-action: none");
  expect(styleText).toContain("user-select: none");
  expect(styleText).toContain("-webkit-user-select: none");
  expect(styleText).toContain("-webkit-touch-callout: none");
  expect(el.className).toMatch(/touch-none/);
  expect(el.className).toMatch(/select-none/);

  ["touchstart", "touchmove", "pointermove", "selectstart", "contextmenu"].forEach((type) => {
    const ev = new Event(type, { bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
  });

  const down = new PointerEvent("pointerdown", {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch", button: 0,
  });
  await act(async () => { el.dispatchEvent(down); });
  expect(down.defaultPrevented).toBe(true);
  await advance(SHUTTER_HOLD_MS);
  expect(el.getAttribute("data-mode")).toBe("serial");
  decode("V1");
  expect(navigator.vibrate).toHaveBeenCalledWith(60);
  expect(onScan).toHaveBeenCalledWith("V1");

  const cancel = new PointerEvent("pointercancel", {
    bubbles: true, cancelable: true, pointerId: 7, pointerType: "touch",
  });
  await act(async () => { el.dispatchEvent(cancel); });
  decode("V2");
  expect(onScan).toHaveBeenCalledTimes(1);
  expect(el.getAttribute("data-mode")).toBe("idle");

  navigator.vibrate = jest.fn(() => { throw new Error("titreşim yok"); });
  const up = new PointerEvent("pointerup", {
    bubbles: true, cancelable: true, pointerId: 8, pointerType: "touch", button: 0,
  });
  const again = new PointerEvent("pointerdown", {
    bubbles: true, cancelable: true, pointerId: 8, pointerType: "touch", button: 0,
  });
  await act(async () => { el.dispatchEvent(again); });
  await act(async () => { el.dispatchEvent(up); });
  decode("V3");
  expect(onScan).toHaveBeenCalledWith("V3");

  delete navigator.vibrate;
  await act(async () => { el.dispatchEvent(new PointerEvent("pointerdown", {
    bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0,
  })); });
  await act(async () => { el.dispatchEvent(new PointerEvent("pointerup", {
    bubbles: true, cancelable: true, pointerId: 9, pointerType: "touch", button: 0,
  })); });
  decode("V4");
  expect(onScan).toHaveBeenCalledWith("V4");
  expect(host.querySelector('[data-testid="camera-scanner"]')).not.toBeNull();
});

test("adet çarpan yalnızca qtyEnabled iken görünür; continuous metni kalkar", async () => {
  await renderScanner({ continuous: true });
  expect(host.querySelector('[data-testid="camera-scanner-qty"]')).toBeNull();
  expect(host.textContent).not.toContain("Sürekli okuma açık");
  expect(host.querySelector('[data-testid="camera-scanner-hint"]').textContent).toContain("Dokun: tek okut");
  await act(async () => {
    root.render(<CameraScanner onScan={jest.fn()} onClose={jest.fn()} qtyEnabled qty={3} onQtyChange={jest.fn()} />);
  });
  await advance(50);
  const qty = host.querySelector('[data-testid="camera-scanner-qty"]');
  expect(qty).not.toBeNull();
  expect(qty.value).toBe("3");
  expect(host.textContent).toContain("Adet çarpan");
});
