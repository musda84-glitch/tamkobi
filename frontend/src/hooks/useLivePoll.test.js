/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { useLivePoll } from "./useLivePoll";

function Probe({ onTick, intervalMs }) {
  useLivePoll(onTick, { intervalMs });
  return null;
}

describe("useLivePoll", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
  });

  afterEach(() => {
    act(() => {
      root.unmount();
    });
    container.remove();
    jest.useRealTimers();
  });

  test("ticks immediately and on interval while visible", () => {
    const fn = jest.fn();
    act(() => {
      root.render(<Probe onTick={fn} intervalMs={5000} />);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    act(() => {
      jest.advanceTimersByTime(5000);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("refreshes when tab becomes visible again", () => {
    const fn = jest.fn();
    let vis = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => vis,
    });
    act(() => {
      root.render(<Probe onTick={fn} intervalMs={5000} />);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    vis = "hidden";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    act(() => {
      jest.advanceTimersByTime(15000);
    });
    expect(fn).toHaveBeenCalledTimes(1);
    vis = "visible";
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
