import {
  applyOrderFilters,
  ORDER_FILTER_DEFAULTS,
  isIncomingOrder,
  CLOSED_STATUSES,
  isActiveCartOrder,
  orderPanelFilter,
  decorateB2bHeldOrder,
  prepareOrdersForPanel,
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

test("orderPanelFilter excludes active B2B carts", () => {
  expect(isActiveCartOrder({ order_status: "active_cart" })).toBe(true);
  expect(isActiveCartOrder({ is_active_cart: true })).toBe(true);
  expect(isActiveCartOrder({ source: "b2b_active_cart" })).toBe(true);
  expect(orderPanelFilter({ order_status: "approved" })).toBe(true);
  expect(orderPanelFilter({ order_status: "active_cart" })).toBe(false);
  expect(orderPanelFilter({ order_status: "held_cart", is_held_cart: true })).toBe(true);
});

test("prepareOrdersForPanel decorates held carts and sorts", () => {
  const rows = [
    { id: "1", order_status: "approved", order_number: "A" },
    { id: "2", source: "b2b_held_cart", held_seq: 2, order_number: "H" },
    { id: "3", order_status: "active_cart", order_number: "X" },
  ];
  const out = prepareOrdersForPanel(rows);
  expect(out.map((o) => o.id)).toEqual(["2", "1"]);
  expect(out[0].held_label).toBe("Bekleyen sepet #2");
  expect(out[0].view_only).toBe(true);
  expect(decorateB2bHeldOrder({ order_status: "held_cart" }).is_held_cart).toBe(true);
});
