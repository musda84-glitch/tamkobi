import {
  orderIsShipped,
  orderFormPrinted,
  cargoActionButtonClass,
  printOrderButtonClass,
  cargoActionTitle,
  printOrderTitle,
} from "./orderActionBadges";

test("orderIsShipped: tracking or status", () => {
  expect(orderIsShipped({})).toBe(false);
  expect(orderIsShipped({ cargo_tracking_number: "TK123" })).toBe(true);
  expect(orderIsShipped({ order_status: "shipped" })).toBe(true);
  expect(orderIsShipped({ order_status: "pending" })).toBe(false);
});

test("print / cargo button classes flip when done", () => {
  expect(printOrderButtonClass({})).toContain("bg-violet-50");
  expect(printOrderButtonClass({ form_printed_at: "2026-01-01" })).toContain("bg-violet-600");
  expect(cargoActionButtonClass({})).toContain("bg-sky-50");
  expect(cargoActionButtonClass({ cargo_tracking_number: "X" })).toContain("bg-sky-600");
});

test("titles reflect done state", () => {
  expect(printOrderTitle({})).toBe("Sipariş Formu Yazdır");
  expect(printOrderTitle({ form_printed_at: "2026-09-23T10:00:00Z" })).toMatch(/yazdırıldı/i);
  expect(cargoActionTitle({})).toBe("Kargola");
  expect(cargoActionTitle({ cargo_tracking_number: "ABC" })).toMatch(/Sevk edildi/);
  expect(orderFormPrinted({ form_printed_at: "x" })).toBe(true);
});
