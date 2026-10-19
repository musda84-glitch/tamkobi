import React from "react";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
import { createRoot } from "react-dom/client";
import { act } from "react";
import QtyKeypad from "./QtyKeypad";

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  if (root) {
    act(() => { root.unmount(); });
    root = null;
  }
  host.remove();
});

async function renderPad(props) {
  root = createRoot(host);
  await act(async () => {
    root.render(<QtyKeypad {...props} />);
  });
}

async function clickId(id) {
  await act(async () => {
    host.querySelector(`[data-testid="${id}"]`).click();
  });
}

function display() {
  return host.querySelector('[data-testid="pick-keypad-display"]').textContent;
}

async function pressKey(key) {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

test("tuşla 3 girip onaylayınca onConfirm(3)", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 9, onConfirm, onCancel });
  await clickId("pick-keypad-key-3");
  await clickId("pick-keypad-ok");
  expect(onConfirm).toHaveBeenCalledWith(3);
  expect(onCancel).not.toHaveBeenCalled();
});

test("⌫ son rakamı siler", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 9, onConfirm, onCancel });
  await clickId("pick-keypad-key-1");
  await clickId("pick-keypad-key-2");
  expect(display()).toContain("12 / 9 en çok");
  await clickId("pick-keypad-back");
  expect(display()).toContain("1 / 9 en çok");
  expect(display()).not.toContain("12");
});

test("max aşımı onayda max'e iner", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 5, onConfirm, onCancel });
  await clickId("pick-keypad-key-8");
  await clickId("pick-keypad-ok");
  expect(onConfirm).toHaveBeenCalledWith(5);
});

test("klavyeden rakam ve Enter onaylar", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 9, onConfirm, onCancel });
  await pressKey("4");
  await pressKey("Enter");
  expect(onConfirm).toHaveBeenCalledWith(4);
  expect(onCancel).not.toHaveBeenCalled();
});

test("Esc vazgeçirir ve onaylamaz", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 9, onConfirm, onCancel });
  await pressKey("7");
  await pressKey("Escape");
  expect(onCancel).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});

test("ekranda en çok sınırı görünür", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: 1, max: 5, onConfirm, onCancel });
  expect(display()).toContain("/ 5 en çok");
  expect(host.textContent).toContain("fazlası 5'e indirilir");
});

test("hızlı okuyucu onaylamaz, vazgeçer ve karakterleri iletir", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const onScanText = jest.fn();
  const scanHost = document.createElement("input");
  document.body.appendChild(scanHost);
  const scanInputRef = { current: scanHost };
  let now = 0;
  const clock = jest.spyOn(performance, "now").mockImplementation(() => now);
  await renderPad({ value: "", max: 9, onConfirm, onCancel, scanInputRef, onScanText });
  await act(async () => {
    for (const key of "8690002") {
      now += 10;
      scanHost.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
    }
    now += 10;
    scanHost.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(onConfirm).not.toHaveBeenCalled();
  expect(onCancel).toHaveBeenCalled();
  expect(onScanText.mock.calls.map((call) => call[0])).toContain("8690002");
  clock.mockRestore();
  scanHost.remove();
});

test("yavaş rakam ve Enter sınırlı onaylar", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  const onScanText = jest.fn();
  const scanHost = document.createElement("input");
  document.body.appendChild(scanHost);
  const scanInputRef = { current: scanHost };
  let now = 0;
  const clock = jest.spyOn(performance, "now").mockImplementation(() => now);
  await renderPad({ value: "", max: 5, onConfirm, onCancel, scanInputRef, onScanText });
  await act(async () => {
    now = 0;
    scanHost.dispatchEvent(new KeyboardEvent("keydown", { key: "8", bubbles: true, cancelable: true }));
  });
  await act(async () => {
    now = 80;
    scanHost.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  expect(onConfirm).toHaveBeenCalledWith(5);
  expect(onCancel).not.toHaveBeenCalled();
  expect(onScanText).not.toHaveBeenCalled();
  clock.mockRestore();
  scanHost.remove();
});

test("dışarı tıklayınca onCancel", async () => {
  const onConfirm = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ value: "", max: 5, onConfirm, onCancel });
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(onCancel).toHaveBeenCalled();
  expect(onConfirm).not.toHaveBeenCalled();
});
