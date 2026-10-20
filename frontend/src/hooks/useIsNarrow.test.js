import React from "react";
import { act, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { useIsNarrow } from "./useIsNarrow";

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
  render(<Probe />);
  expect(screen.getByTestId("narrow")).toHaveTextContent("no");
  expect(window.matchMedia).toHaveBeenCalledWith("(max-width: 768px)");
  act(() => {
    mql.matches = true;
    mql.onChange();
  });
  expect(screen.getByTestId("narrow")).toHaveTextContent("yes");
});
