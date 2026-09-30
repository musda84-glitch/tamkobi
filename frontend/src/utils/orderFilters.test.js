import {
  applyOrderFilters,
  ORDER_FILTER_DEFAULTS,
  isIncomingOrder,
  CLOSED_STATUSES,
} from "./orderFilters";

test("CLOSED_STATUSES covers iptal and iade", () => {
  expect(CLOSED_STATUSES.has("cancelled")).toBe(true);
  expect(CLOSED_STATUSES.has("returned")).toBe(true);
  expect(CLOSED_STATUSES.has("partially_returned")).toBe(true);
  expect(CLOSED_STATUSES.has("pending")).toBe(false);
});

test("cancelled orders are not incoming", () => {
  expect(isIncomingOrder({ order_status: "cancelled" })).toBe(false);
  expect(isIncomingOrder({ order_status: "pending" })).toBe(true);
});

test("default all filter hides cancelled like B2B-2026-0016", () => {
  const rows = [
    { order_number: "B2B-2026-0016", order_status: "cancelled", channel: "b2b" },
    { order_number: "B2B-2026-0015", order_status: "pending", channel: "b2b" },
  ];
  const out = applyOrderFilters(rows, { ...ORDER_FILTER_DEFAULTS });
  expect(out.map((o) => o.order_number)).toEqual(["B2B-2026-0015"]);
});
