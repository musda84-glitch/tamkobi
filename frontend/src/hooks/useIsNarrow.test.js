/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { useIsNarrow } from "./useIsNarrow";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function Probe() {
  const narrow = useIsNarrow(768);
  return <div data-testid="narrow">{narrow ? "yes" : "no"}</div>;
}

test("useIsNarrow follows matchMedia and its change listener", () => {
  const mql = {
    matches: false,
    media: "(max-width: 768px)",
    addEventListener: jest.fn((event, fn) => {
      if (event === "change") mql.onChange = fn;
    }),
    removeEventListener: jest.fn(),
  };
  window.matchMedia = jest.fn(() => mql);
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => { root.render(<Probe />); });
  expect(host.querySelector("[data-testid='narrow']").textContent).toBe("no");
  expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 768px)");
  act(() => {
    mql.matches = true;
    mql.onChange();
  });
  expect(host.querySelector("[data-testid='narrow']").textContent).toBe("yes");
  act(() => { root.unmount(); });
  host.remove();
});
