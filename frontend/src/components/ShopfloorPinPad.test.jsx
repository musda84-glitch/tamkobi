import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import ShopfloorPinPad from "./ShopfloorPinPad";

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
    root.render(<ShopfloorPinPad operatorName="Ali Usta" station="CNC" onSubmit={() => {}} onCancel={() => {}} {...props} />);
  });
}

function clickKey(digit) {
  const button = host.querySelector(`[data-testid="shopfloor-pin-key-${digit}"]`);
  expect(button).not.toBeNull();
  act(() => { button.click(); });
}

test("four keys submit the pin once and the digits stay off the display", async () => {
  const onSubmit = jest.fn();
  await renderPad({ onSubmit });
  clickKey("5");
  clickKey("8");
  clickKey("2");
  expect(onSubmit).not.toHaveBeenCalled();
  const dots = host.querySelector('[data-testid="shopfloor-pin-dots"]');
  expect(dots.textContent.replace(/\s/g, "")).not.toMatch(/[0-9]/);
  expect(dots.querySelectorAll('[data-filled="1"]')).toHaveLength(3);
  clickKey("9");
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith("5829");
  expect(host.textContent).not.toContain("5829");
  expect(dots.querySelectorAll('[data-filled="1"]')).toHaveLength(0);
});

test("backspace removes a digit and cancel clears without submit", async () => {
  const onSubmit = jest.fn();
  const onCancel = jest.fn();
  await renderPad({ onSubmit, onCancel });
  clickKey("5");
  clickKey("8");
  act(() => { host.querySelector('[data-testid="shopfloor-pin-backspace"]').click(); });
  expect(host.querySelectorAll('[data-testid="shopfloor-pin-dot"][data-filled="1"]')).toHaveLength(1);
  act(() => { host.querySelector('[data-testid="shopfloor-pin-cancel"]').click(); });
  expect(onCancel).toHaveBeenCalledTimes(1);
  expect(onSubmit).not.toHaveBeenCalled();
  expect(host.querySelectorAll('[data-testid="shopfloor-pin-dot"][data-filled="1"]')).toHaveLength(0);
});

test("shows the error strip and keyboard digits submit once", async () => {
  const onSubmit = jest.fn();
  await renderPad({ onSubmit, error: "PIN hatalı: 2 deneme hakkınız kaldı — 5 hatalı denemede 15 dk kilitlenir" });
  const alert = host.querySelector('[data-testid="shopfloor-pin-error"]');
  expect(alert).not.toBeNull();
  expect(alert.textContent).toContain("2 deneme hakkınız kaldı");
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "5", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "8", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "8", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "9", bubbles: true }));
  });
  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith("5829");
});
