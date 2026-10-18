import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { DashboardProductionCard } from "./DashboardProductionCard";

function isoShift(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function render(data) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  act(() => {
    root.render(<MemoryRouter><DashboardProductionCard data={data} /></MemoryRouter>);
  });
  return {
    host,
    cleanup() {
      act(() => { root.unmount(); });
      host.remove();
    },
  };
}

const sample = {
  open: 2,
  in_production: 1,
  late: 1,
  completed_this_month: 4,
  today_completed_steps: 3,
  today_produced_qty: 11,
  top_orders: [
    {
      order_code: "URT-12",
      product_name: "Kapı",
      planned_quantity: 8,
      status: "in_production",
      done: 2,
      total: 5,
      late: true,
      planned_date: isoShift(-4),
    },
    {
      order_code: "URT-13",
      product_name: "Pencere",
      planned_quantity: 2,
      status: "planned",
      late: false,
    },
  ],
};

test("renders payload counts and late order badges", () => {
  const view = render(sample);
  expect(view.host.textContent).toContain("URT-12 Kapı");
  expect(view.host.textContent).toContain("8 adet");
  expect(view.host.textContent).toContain("Üretimde · 2/5 adım");
  expect(view.host.textContent).toContain("4 gün gecikti");
  expect(view.host.querySelector("[data-testid='production-badge-URT-12']").className).toMatch(/rose/);
  expect(view.host.textContent).toContain("Planlı");
  expect(view.host.querySelector("[data-testid='production-badge-URT-13']").className).toMatch(/slate/);
  expect(view.host.textContent).toContain("Bugün tamamlanan iş adımı 3 · üretilen 11 adet");
  expect(view.host.textContent).toContain("4");
  view.cleanup();

  const other = render({
    ...sample,
    open: 9,
    in_production: 6,
    late: 0,
    completed_this_month: 15,
    today_completed_steps: 8,
    today_produced_qty: 21,
    top_orders: [],
  });
  expect(other.host.textContent).toContain("9");
  expect(other.host.textContent).toContain("6");
  expect(other.host.textContent).toContain("15");
  expect(other.host.textContent).toContain("üretilen 21 adet");
  expect(other.host.textContent).not.toContain("üretilen 11 adet");
  other.cleanup();
});

test("open zero collapses to a slim row", () => {
  const view = render({ ...sample, open: 0 });
  expect(view.host.textContent).toContain("🏭 Üretim · Açık üretim emri yok · Üretim ›");
  expect(view.host.querySelector("a").getAttribute("href")).toBe("/production");
  expect(view.host.textContent).not.toContain("Bu ay biten");
  expect(view.host.textContent).not.toContain("URT-12");
  view.cleanup();
});
