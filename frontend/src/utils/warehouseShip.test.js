import {
  canWarehouseShip,
  isWarehouseShipClosed,
  isWarehouseShipped,
  orderStatusLabel,
  orderStatusSelectOptions,
  warehouseShipConfirm,
  warehouseShippedOptionLabel,
  warehouseShipPath,
  WAREHOUSE_SHIP_NAME,
  WAREHOUSE_SHIP_STATUS_LABEL,
} from "./warehouseShip";

test("isWarehouseShipped: flags, carrier, DEPO tracking", () => {
  expect(isWarehouseShipped({})).toBe(false);
  expect(isWarehouseShipped({ order_status: "shipped" })).toBe(false);
  expect(isWarehouseShipped({ warehouse_shipped: true })).toBe(true);
  expect(isWarehouseShipped({ ship_method: "warehouse" })).toBe(true);
  expect(isWarehouseShipped({ cargo_carrier: "warehouse" })).toBe(true);
  expect(isWarehouseShipped({ cargo_tracking_number: "DEPO-B2B-1" })).toBe(true);
  expect(isWarehouseShipped({ cargo_tracking_number: "YK-1" })).toBe(false);
});

test("canWarehouseShip blocks delivered/completed and cancel/return", () => {
  expect(canWarehouseShip({ order_status: "approved" })).toBe(true);
  expect(isWarehouseShipClosed({ order_status: "delivered" })).toBe(true);
  expect(canWarehouseShip({ order_status: "delivered" })).toBe(false);
  expect(canWarehouseShip({ order_status: "completed" })).toBe(false);
  expect(canWarehouseShip({ order_status: "cancelled" })).toBe(false);
  expect(canWarehouseShip({ warehouse_shipped: true })).toBe(false);
});

test("confirm copy and path", () => {
  expect(WAREHOUSE_SHIP_NAME).toMatch(/Depodan sevk/);
  const text = warehouseShipConfirm({ order_number: "B2B-2026-0014", customer_name: "Ersay", city: "İstanbul" });
  expect(text).toContain("B2B-2026-0014");
  expect(text).toContain("Ersay • İstanbul");
  expect(text).toMatch(/sevk edildi/);
  expect(warehouseShipPath("ord_1")).toBe("/orders/ord_1/warehouse-ship");
});

test("warehouse-shipped status select and badge say Depo sevk edildi", () => {
  expect(WAREHOUSE_SHIP_STATUS_LABEL).toBe("Depo sevk edildi");
  expect(warehouseShippedOptionLabel({})).toBe("Kargolandı");
  expect(warehouseShippedOptionLabel({ warehouse_shipped: true })).toBe("Depo sevk edildi");
  expect(warehouseShippedOptionLabel({ cargo_carrier: "warehouse" })).toBe("Depo sevk edildi");
  expect(warehouseShippedOptionLabel({ cargo_tracking_number: "DEPO-B2B-2026-0063" })).toBe("Depo sevk edildi");
  expect(orderStatusLabel({ order_status: "shipped" }, "Kargolandı")).toBe("Kargolandı");
  expect(orderStatusLabel({ order_status: "shipped", warehouse_shipped: true }, "Kargolandı")).toBe("Depo sevk edildi");
  expect(orderStatusLabel({ order_status: "completed", warehouse_shipped: true }, "Teslim edildi")).toBe("Teslim edildi");
  const opts = orderStatusSelectOptions({ warehouse_shipped: true, order_status: "shipped" });
  expect(opts.find(([k]) => k === "shipped")[1]).toBe("Depo sevk edildi");
  expect(orderStatusSelectOptions({}).find(([k]) => k === "shipped")[1]).toBe("Kargolandı");
});
