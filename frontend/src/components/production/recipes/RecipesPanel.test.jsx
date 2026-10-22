/**
 * @jest-environment jsdom
 */
import React from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import RecipesPanel from "./RecipesPanel";
import { canAccessPath } from "../../../utils/authAccess";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const products = [
  { id: "fp-wd", name: "WD Serisi", sale_price: 550 },
  { id: "fp-mdf", name: "MDF Dolap", sale_price: 0 },
  { id: "fp-dry", name: "Duvar Rafı", sale_price: 297 },
  { id: "mat-cam", name: "ATLANTIK CAM", stock_quantity: 120 },
  { id: "mat-beyaz", name: "BEYAZ MDF", stock_quantity: 3, min_stock_alert: 5 },
  { id: "mat-eksik", name: "Eksik levha", stock_quantity: -24 },
];

const recipes = [
  {
    id: "r-dry",
    code: "BOM-314009",
    name: "DRY2C_RAF",
    finished_product_id: "fp-dry",
    finished_product_name: "Duvar Rafı İkiz",
    target_quantity: 54,
    unit: "Adet",
    is_active: true,
    one_time: false,
    unit_cost: 64.81,
    steps: [{ name: "Kesim", station: "CNC", duration_min: 20 }, { name: "Bant", station: "Bantlama", duration_min: 10 }, { name: "Montaj", station: "Montaj" }],
    materials: [
      { product_id: "mat-eksik", product_name: "ATLANTIK CAM MDF", quantity: 1, unit: "Adet", stock_quantity: -24, missing_qty: 24, wastage_percent: 5, cost_per_unit: 100 },
    ],
  },
  {
    id: "r-14",
    code: "BOM-239726",
    name: "WD-14",
    finished_product_id: "fp-wd",
    finished_product_name: "WD_Serisi",
    target_quantity: 1,
    unit: "Adet",
    is_active: true,
    one_time: false,
    version: 2,
    unit_cost: 131.25,
    steps: [{ name: "Kesim", station: "CNC", duration_min: 15 }],
    materials: [
      { product_id: "mat-beyaz", product_name: "BEYAZ MDF", quantity: 0.5, unit: "Adet", stock_quantity: 3 },
    ],
  },
  {
    id: "r-12",
    code: "BOM-253544",
    name: "WD-12",
    finished_product_id: "fp-wd",
    finished_product_name: "WD_Serisi",
    target_quantity: 1,
    unit: "Adet",
    is_active: true,
    one_time: false,
    version: 1,
    unit_cost: 131.25,
    steps: [{ name: "Kesim", station: "CNC" }],
    materials: [
      { product_id: "mat-cam", product_name: "ATLANTIK CAM", quantity: 1, unit: "Adet", stock_quantity: 120 },
    ],
  },
  {
    id: "r-one",
    code: "BOM-232179",
    name: "MDF Dolap Reçetesi",
    finished_product_id: "fp-mdf",
    finished_product_name: "MDF Dolap",
    target_quantity: 1,
    unit: "Adet",
    is_active: true,
    one_time: true,
    contact_name: "Ferhat 10.bölge",
    job_file_name: "21_10_2026/ferhat_10bolge",
    unit_cost: 4500,
    total_estimated_cost: 4500,
    material_cost: 3200,
    labor_cost: 900,
    overhead_cost: 400,
    steps: [{ name: "Montaj", station: "Montaj", duration_min: 60 }],
    materials: [
      { product_name: "BEYAZ MDF", quantity: 1, unit: "Adet", wastage_percent: 5, cost_per_unit: 2950, stock_quantity: 0, missing_qty: 24 },
    ],
  },
  {
    id: "r-arch",
    code: "BOM-ARCH",
    name: "Eski reçete",
    finished_product_id: "fp-old",
    finished_product_name: "Eski",
    target_quantity: 1,
    unit: "Adet",
    is_active: false,
    unit_cost: 10,
    materials: [],
    steps: [],
  },
];

const orders = [
  { id: "po1", order_code: "URT-2026-26659", recipe_id: "r-one", status: "in_production", planned_quantity: 1, completed_quantity: 0, planned_date: "2026-10-21" },
];

function renderPanel(props = {}) {
  const host = document.createElement("div");
  host.style.width = "390px";
  host.style.maxWidth = "390px";
  document.body.appendChild(host);
  const root = createRoot(host);
  const api = {
    onProduce: jest.fn(),
    onCopy: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onArchive: jest.fn(),
  };
  act(() => {
    root.render(
      <RecipesPanel
        recipes={recipes}
        products={products}
        orders={orders}
        can={() => true}
        {...api}
        {...props}
      />,
    );
  });
  return {
    host,
    ...api,
    cleanup() {
      act(() => root.unmount());
      host.remove();
    },
  };
}

test("filtre çipleri sayıları gösterir ve arama kartı düşürür", () => {
  const view = renderPanel();
  expect(view.host.querySelector("[data-testid=recipe-filter-count-all]").textContent).toBe("4");
  expect(view.host.querySelector("[data-testid=recipe-filter-count-standard]").textContent).toBe("3");
  expect(view.host.querySelector("[data-testid=recipe-filter-count-one_time]").textContent).toBe("1");
  expect(view.host.querySelector("[data-testid=recipe-filter-count-missing]").textContent).toBe("2");
  expect(view.host.querySelector("[data-testid=recipe-filter-count-archive]").textContent).toBe("1");

  const search = view.host.querySelector("[data-testid=recipe-search]");
  const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value");
  act(() => {
    proto.set.call(search, "BOM-232179");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(view.host.querySelector("[data-testid=recipe-card-BOM-232179]")).not.toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-card-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-card-BOM-239726]")).toBeNull();
  view.cleanup();
});

test("stok ikonu ve N eksik metni eksi stoğu stok -24 diye yazmaz", () => {
  const view = renderPanel();
  const icon = view.host.querySelector("[data-testid=recipe-stock-icon-BOM-314009-0]");
  expect(icon.getAttribute("data-status")).toBe("none");
  expect(icon.querySelector("span").className).toMatch(/bg-rose-500/);
  const label = view.host.querySelector("[data-testid=recipe-stock-label-BOM-314009-0]");
  expect(label.textContent).toBe("24 eksik");
  expect(view.host.textContent).not.toMatch(/stok\s*-\d/);

  const low = view.host.querySelector("[data-testid=recipe-stock-icon-BOM-239726-0]");
  expect(low.getAttribute("data-status")).toBe("low");
  expect(low.querySelector("span").className).toMatch(/bg-amber-500/);
  expect(view.host.querySelector("[data-testid=recipe-stock-label-BOM-239726-0]").textContent).toBe("az · 3 kaldı");

  const ok = view.host.querySelector("[data-testid=recipe-stock-icon-BOM-253544-0]");
  expect(ok.getAttribute("data-status")).toBe("ok");
  expect(ok.querySelector("span").className).toMatch(/bg-emerald-500/);
  expect(view.host.querySelector("[data-testid=recipe-stock-label-BOM-253544-0]").textContent).toBe("yeterli · 120");
  view.cleanup();
});

test("üretilebilir adet ve marj; satış yoksa fiyat yok", () => {
  const view = renderPanel();
  expect(view.host.querySelector("[data-testid=recipe-producible-BOM-239726]").textContent).toBe("6 adet");
  expect(view.host.querySelector("[data-testid=recipe-producible-BOM-314009]").textContent).toBe("0 adet");
  expect(view.host.querySelector("[data-testid=recipe-margin-BOM-314009]").textContent).toBe("%78");
  expect(view.host.querySelector("[data-testid=recipe-margin-BOM-232179]").textContent).toBe("fiyat yok");
  expect(view.host.querySelector("[data-testid=recipe-sale-BOM-232179]").textContent).toBe("—");
  view.cleanup();
});

test("aynı bitmiş ürün tek grupta varyant çipleriyle durur", () => {
  const view = renderPanel();
  const group = view.host.querySelector("[data-testid=recipe-group-fp-wd]");
  expect(group).not.toBeNull();
  expect(group.querySelector("[data-testid=recipe-variant-BOM-239726]").textContent).toContain("WD-14");
  expect(group.querySelector("[data-testid=recipe-variant-BOM-239726]").textContent).toContain("v2");
  expect(group.querySelector("[data-testid=recipe-variant-BOM-253544]").textContent).toContain("BOM-253544");
  expect(group.querySelector("[data-testid=recipe-card-BOM-239726]")).not.toBeNull();
  expect(group.querySelector("[data-testid=recipe-card-BOM-253544]")).not.toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-group-fp-dry]")).toBeNull();
  view.cleanup();
});

test("siparişe özel bölüm müşteri ve iş dosyası rozetleriyle katlanır", () => {
  const view = renderPanel();
  const section = view.host.querySelector("[data-testid=recipe-one-time-section]");
  expect(section.textContent).toContain("Siparişe özel reçeteler");
  expect(view.host.querySelector("[data-testid=recipe-one-time-count]").textContent).toBe("1");
  expect(view.host.querySelector("[data-testid=recipe-customer-BOM-232179]").textContent).toContain("Ferhat 10.bölge");
  expect(view.host.querySelector("[data-testid=recipe-job-BOM-232179]").textContent).toContain("21_10_2026/ferhat_10bolge");
  expect(view.host.querySelector("[data-testid=recipe-type-BOM-232179]").textContent).toBe("Tek seferlik");
  act(() => view.host.querySelector("[data-testid=recipe-one-time-toggle]").click());
  expect(view.host.querySelector("[data-testid=recipe-card-BOM-232179]")).toBeNull();
  view.cleanup();
});

test("⋯ menüsü kopyala, düzenle, arşivle ve sil çağırır", () => {
  const view = renderPanel();
  act(() => view.host.querySelector("[data-testid=recipe-menu-BOM-314009]").click());
  act(() => view.host.querySelector("[data-testid=recipe-copy-BOM-314009]").click());
  expect(view.onCopy).toHaveBeenCalledWith(expect.objectContaining({ code: "BOM-314009" }));

  act(() => view.host.querySelector("[data-testid=recipe-menu-BOM-314009]").click());
  act(() => view.host.querySelector("[data-testid=recipe-edit-BOM-314009]").click());
  expect(view.onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "r-dry" }));

  act(() => view.host.querySelector("[data-testid=recipe-menu-BOM-314009]").click());
  act(() => view.host.querySelector("[data-testid=recipe-archive-BOM-314009]").click());
  expect(view.onArchive).toHaveBeenCalledWith(expect.objectContaining({ id: "r-dry" }), false);

  act(() => view.host.querySelector("[data-testid=recipe-menu-BOM-314009]").click());
  act(() => view.host.querySelector("[data-testid=recipe-delete-BOM-314009]").click());
  expect(view.onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "r-dry" }));

  act(() => view.host.querySelector("[data-testid=recipe-produce-BOM-314009]").click());
  expect(view.onProduce).toHaveBeenCalledWith(expect.objectContaining({ code: "BOM-314009" }));
  view.cleanup();
});

test("Görür yetkisinde Üret, Düzenle, Sil ve Arşivle gizlenir", () => {
  const user = { role: "sales", permissions: { "/production": "view" } };
  const view = renderPanel({
    can: (path, level) => canAccessPath(user, path, level),
  });
  expect(view.host.querySelector("[data-testid=recipe-produce-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-menu-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-edit-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-delete-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-archive-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-copy-BOM-314009]")).toBeNull();
  expect(view.host.querySelector("[data-testid=recipe-card-BOM-314009]")).not.toBeNull();
  expect(view.host.textContent).toContain("Üretilebilir");
  view.cleanup();
});

test("390px panelde yatay taşma sınıfları ve tek sütun", () => {
  const view = renderPanel();
  const panel = view.host.querySelector("[data-testid=recipes-panel]");
  expect(panel.className).toMatch(/overflow-x-hidden/);
  expect(panel.className).toMatch(/max-w-full/);
  expect(panel.className).toMatch(/min-w-0/);
  const bar = view.host.querySelector("[data-testid=recipe-filter-bar]");
  expect(bar.className).toMatch(/overflow-x-auto/);
  expect(bar.className).toMatch(/max-w-full/);
  view.host.querySelectorAll("[data-testid=recipe-grid]").forEach((grid) => {
    expect(grid.className).toMatch(/grid-cols-1/);
  });
  const offenders = [];
  panel.querySelectorAll("*").forEach((el) => {
    if (el.closest("[data-allow-x-scroll]")) return;
    const cls = el.className;
    if (typeof cls === "string" && /min-w-\[\d{3,}/.test(cls)) offenders.push(cls);
  });
  expect(offenders).toEqual([]);
  if (panel.clientWidth > 0) {
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
  }
  view.cleanup();
});

test("detay paneli malzeme, adım, maliyet ve son üretimi mevcut veriden açar", () => {
  const view = renderPanel();
  act(() => view.host.querySelector("[data-testid=recipe-card-BOM-232179]").click());
  const drawer = view.host.querySelector("[data-testid=recipe-drawer]");
  expect(drawer).not.toBeNull();
  expect(drawer.textContent).toContain("%5");
  expect(drawer.querySelector("[data-testid=recipe-drawer-stock-BOM-232179-0]").textContent).toContain("24 eksik");
  expect(drawer.querySelector("[data-testid=recipe-drawer-step-BOM-232179-0]").textContent).toContain("Montaj");
  expect(drawer.textContent).toContain("Hammadde (fire dahil)");
  expect(drawer.textContent).toContain("tanımsız — marj hesaplanamıyor");
  expect(drawer.querySelector("[data-testid=recipe-drawer-po-URT-2026-26659]").textContent).toContain("Üretimde");
  view.cleanup();
});
