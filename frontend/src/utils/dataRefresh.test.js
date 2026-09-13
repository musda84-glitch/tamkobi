import { scopesOverlap } from "./dataRefresh";

test("scopesOverlap matches shared scopes", () => {
  expect(scopesOverlap(["cash"], ["cash"])).toBe(true);
  expect(scopesOverlap(["cash", "contacts"], ["invoices"])).toBe(false);
  expect(scopesOverlap(["cash"], ["all"])).toBe(true);
  expect(scopesOverlap(["all"], ["invoices"])).toBe(true);
  expect(scopesOverlap(["contacts"], ["cash", "contacts"])).toBe(true);
});
