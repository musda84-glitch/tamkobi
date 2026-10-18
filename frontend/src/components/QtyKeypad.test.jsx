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
