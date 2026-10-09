import { SCOPE_COLLECTIONS, scopesOverlap } from "./dataRefresh";

test("scopesOverlap matches shared scopes", () => {
  expect(scopesOverlap(["cash"], ["cash"])).toBe(true);
  expect(scopesOverlap(["cash", "contacts"], ["invoices"])).toBe(false);
  expect(scopesOverlap(["cash"], ["all"])).toBe(true);
  expect(scopesOverlap(["all"], ["invoices"])).toBe(true);
  expect(scopesOverlap(["contacts"], ["cash", "contacts"])).toBe(true);
});

test("orders scope maps to IndexedDB orders collection", () => {
  expect(SCOPE_COLLECTIONS.orders).toEqual(["orders"]);
  expect(SCOPE_COLLECTIONS.invoices).toContain("orders");
  expect(SCOPE_COLLECTIONS.all).toContain("orders");
});
