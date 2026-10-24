import { notifyDataChanged, SCOPE_COLLECTIONS, scopesOverlap } from "./dataRefresh";

jest.mock("./dataSync", () => ({
  dropCached: jest.fn(() => {
    throw new Error("cursor dropped");
  }),
}));

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

test("notifyDataChanged keeps the sync cursor and still notifies screens", async () => {
  const seen = [];
  const handler = (event) => seen.push(event.detail);
  window.addEventListener("tamkobi:data-changed", handler);
  try {
    await notifyDataChanged({ companyId: "c1", scopes: ["cash", "contacts"] });
  } finally {
    window.removeEventListener("tamkobi:data-changed", handler);
  }
  expect(seen).toHaveLength(1);
  expect(seen[0].companyId).toBe("c1");
  expect(seen[0].collections).toEqual(expect.arrayContaining(["bank_transactions", "contacts"]));
});
