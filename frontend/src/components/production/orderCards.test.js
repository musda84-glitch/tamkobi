import {
  costBreakdown,
  countProductionFilters,
  filterProductionOrders,
  lateDays,
  orderLateDays,
  orderProgress,
  sortProductionOrders,
  sourceBadge,
  stepTone,
} from "./orderCards";

const today = "2026-10-22";

test("gecikme takvim günü ve kapalı emirde rozet yok", () => {
  expect(lateDays("2026-10-21", today)).toBe(1);
  expect(lateDays("2026-10-19", today)).toBe(3);
  expect(lateDays("2026-10-22", today)).toBe(0);
  expect(lateDays("", today)).toBe(0);
  expect(orderLateDays({ status: "completed", planned_date: "2026-10-01" }, today)).toBe(0);
  expect(orderLateDays({ status: "planned", planned_date: "2026-10-21" }, today)).toBe(1);
});

test("filtre sayıları, arama ve sıralama", () => {
  const orders = [
    { id: "1", status: "planned", planned_date: "2026-10-19", order_code: "URT-A", finished_product_name: "Raf", sales_order_no: "B2B-1", customer_name: "ERSAY", total_cost: 10 },
    { id: "2", status: "in_production", planned_date: "2026-10-21", order_code: "URT-B", finished_product_name: "Dolap", source: "stock_card", total_cost: 50 },
    { id: "3", status: "planned", planned_date: "2026-10-28", order_code: "URT-C", finished_product_name: "Masa", total_cost: 5 },
    { id: "4", status: "completed", planned_date: "2026-10-01", order_code: "URT-D", finished_product_name: "Kapak", total_cost: 1 },
    { id: "5", status: "cancelled", order_code: "URT-E", finished_product_name: "Raf", total_cost: 0 },
  ];
  expect(countProductionFilters(orders, today)).toEqual({ open: 3, late: 2, completed: 1, cancelled: 1, all: 5 });
  expect(filterProductionOrders(orders, { filter: "late", today }).map((o) => o.order_code)).toEqual(["URT-A", "URT-B"]);
  expect(filterProductionOrders(orders, { filter: "open", query: "ersay", today }).map((o) => o.order_code)).toEqual(["URT-A"]);
  expect(filterProductionOrders(orders, { filter: "all", query: "B2B-1", today }).map((o) => o.order_code)).toEqual(["URT-A"]);
  expect(sortProductionOrders(orders, "cost").map((o) => o.order_code)).toEqual(["URT-B", "URT-A", "URT-C", "URT-D", "URT-E"]);
});

test("planlandı adım gri, üretimde aktif turuncu sayılır", () => {
  const steps = [
    { no: 1, name: "Kesim", done: true, status: "done" },
    { no: 2, name: "Bant", done: false, status: "in_progress", current: true },
    { no: 3, name: "Montaj", done: false, status: "waiting" },
  ];
  const running = { status: "in_production", steps_summary: { done: 1, total: 3, steps } };
  const planned = { status: "planned", steps_summary: { done: 0, total: 1, steps: [{ no: 1, name: "Üretim", done: false, status: "ready", current: true }] } };
  expect(orderProgress(running)).toMatchObject({ currentNo: 2, pct: 33, total: 3 });
  expect(stepTone(steps[0], running)).toBe("done");
  expect(stepTone(steps[1], running)).toBe("active");
  expect(stepTone(steps[2], running)).toBe("pending");
  expect(orderProgress(planned)).toMatchObject({ currentNo: 0, pct: 0 });
  expect(stepTone(planned.steps_summary.steps[0], planned)).toBe("pending");
});

test("kaynak rozeti ve maliyet kırılımı olmayan satırı yazmaz", () => {
  expect(sourceBadge({ source: "stock_card" }).label).toBe("Stok kartından");
  expect(sourceBadge({ source: "sales_order", sales_order_no: "B2B-9", customer_name: "ERSAY" }).label).toBe("Siparişten · B2B-9 · ERSAY");
  expect(sourceBadge({ source: "manual" })).toBeNull();
  const lines = costBreakdown(
    { planned_quantity: 2 },
    { target_quantity: 1, material_cost: 100, labor_cost: 0, overhead_cost: null },
  );
  expect(lines).toEqual([{ label: "Hammadde", amount: 200 }]);
  expect(costBreakdown({ planned_quantity: 1 }, null)).toEqual([]);
});
