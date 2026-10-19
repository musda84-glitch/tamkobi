import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { OrdersToolbar } from "./OrdersToolbar";
import { ORDER_FILTER_DEFAULTS } from "../utils/orderFilters";
import { StockToolbar, STOCK_FILTER_DEFAULTS } from "./StockToolbar";
import { InvoiceToolbar, DEFAULT_FILTERS } from "./InvoiceToolbar";

let host;
let root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => { root.unmount(); });
  host.remove();
});

const desktop = () => host.querySelector('[data-layout="desktop"]');
const mobile = () => host.querySelector('[data-layout="mobile"]');

function expectUniqueTestIds(scope) {
  const counts = new Map();
  scope.querySelectorAll("[data-testid]").forEach((node) => {
    const id = node.getAttribute("data-testid");
    counts.set(id, (counts.get(id) || 0) + 1);
  });
  const dupes = [...counts.entries()].filter(([, n]) => n > 1).map(([id, n]) => `${id} ×${n}`);
  expect(dupes).toEqual([]);
}

test("sipariş masaüstü satırında inline filtreler ve mevcut testid'ler durur", async () => {
  await act(async () => {
    root.render(
      <OrdersToolbar
        f={{ ...ORDER_FILTER_DEFAULTS }}
        setF={() => {}}
        orders={[]}
        count={3}
        total={10}
        pageSize={50}
        onPageSizeChange={() => {}}
        onRefresh={() => {}}
        onBulkAction={() => {}}
      />,
    );
  });
  expectUniqueTestIds(host);
  const row = desktop();
  expect(row.className).toContain("hidden");
  expect(row.className).toContain("sm:flex");
  expect(row.className).toContain("flex-wrap");
  ["ord-search", "ord-status", "ord-channel", "ord-doc-status", "ord-invoiced", "ord-cargo", "ord-cancel-request-chip", "ord-sort", "ord-from", "ord-to", "ord-page-size", "ord-result-summary"].forEach((id) => {
    expect(host.querySelector(`[data-layout="desktop"] [data-testid="${id}"]`)).not.toBeNull();
  });
  expect(host.querySelector('[data-testid="ord-search"]').parentElement.className).toContain("min-w-[220px]");
  expect(mobile().querySelector('[data-testid="ord-search-m"]').parentElement.className).toContain("min-w-0");
  expect(mobile().querySelector('[data-testid="ord-status"]')).toBeNull();
  expect(mobile().querySelector('[data-testid="mobile-filter-button"]').textContent).toBe("Filtreler");
  const chips = mobile().querySelector('[data-testid="ord-cancel-request-chip-m"]').parentElement;
  expect(chips.className).toContain("overflow-x-auto");
  expect(chips.className).toContain("-mx-4");
  expect(chips.className).toContain("px-4");
  expect(mobile().querySelector('[data-testid="ord-cancel-request-chip-m"]').className).toContain("rounded-full");
  expect(host.querySelectorAll('[data-testid="ord-page-size"]').length).toBe(1);
});

test("sipariş rozeti yalnızca varsayılandan farklı filtreleri sayar", async () => {
  function Harness() {
    const [f, setF] = useState({ ...ORDER_FILTER_DEFAULTS, status: "pending", channel: "b2b" });
    return <OrdersToolbar f={f} setF={setF} orders={[]} count={0} total={0} pageSize={100} onPageSizeChange={() => {}} />;
  }
  await act(async () => { root.render(<Harness />); });
  expect(mobile().querySelector('[data-testid="mobile-filter-button"]').textContent).toBe("Filtreler (2)");

  function SortOnly() {
    const [f, setF] = useState({ ...ORDER_FILTER_DEFAULTS, sort: "amount_desc" });
    return <OrdersToolbar f={f} setF={setF} orders={[]} count={0} total={0} pageSize={200} />;
  }
  await act(async () => { root.render(<SortOnly />); });
  expect(mobile().querySelector('[data-testid="mobile-filter-badge"]')).toBeNull();
});

test("stok masaüstü satırında inline filtreler ve mevcut testid'ler durur", async () => {
  await act(async () => {
    root.render(
      <StockToolbar
        categories={[{ name: "Kablo", count: 2 }]}
        filterCategory="all"
        setFilterCategory={() => {}}
        f={{ ...STOCK_FILTER_DEFAULTS }}
        setF={() => {}}
        search=""
        setSearch={() => {}}
        count={1}
        stockValue={0}
        paging
        brand="all"
        setBrand={() => {}}
        brands={["Acme"]}
        warehouseId="all"
        setWarehouseId={() => {}}
        warehouses={[{ id: "w1", name: "Merkez" }]}
        cardStatus="all"
        setCardStatus={() => {}}
        criticalCount={1}
        onReorderCritical={() => {}}
      />,
    );
  });
  expectUniqueTestIds(host);
  expect(desktop().className).toContain("hidden");
  expect(desktop().className).toContain("sm:flex");
  ["stock-search-input", "stock-category-select", "stock-status-select", "stock-b2b-select", "stock-sort-select", "stock-brand-select", "stock-warehouse-select", "stock-active-select", "stock-result-summary"].forEach((id) => {
    expect(host.querySelector(`[data-layout="desktop"] [data-testid="${id}"]`)).not.toBeNull();
  });
  const input = host.querySelector('[data-testid="stock-search-input"]');
  expect(input.className).toContain("min-w-[240px]");
  expect(input.parentElement.className).toContain("min-w-[240px]");
  expect(input.parentElement.parentElement.className).toContain("flex-wrap");
  expect(mobile().querySelector('[data-testid="stock-search-input-m"]').className).toContain("min-w-0");
  expect(mobile().querySelector('[data-testid="stock-category-select"]')).toBeNull();
  expect(mobile().querySelector('[data-testid="mobile-filter-button"]')).not.toBeNull();
});

test("fatura masaüstü satırında inline filtreler durur, ödeme çipleri sheet dışında kalır", async () => {
  await act(async () => {
    root.render(<InvoiceToolbar f={{ ...DEFAULT_FILTERS, q: "ada" }} setF={() => {}} count={2} total={20} draftCount={1} approvedCount={2} onBulkAction={() => {}} />);
  });
  expectUniqueTestIds(host);
  expect(desktop().className).toContain("hidden");
  expect(desktop().className).toContain("sm:flex");
  ["inv-search", "inv-pay-filter", "inv-pay-all", "inv-pay-unpaid", "inv-etype-filter", "inv-sort", "inv-date-preset", "inv-date-from", "inv-date-to", "inv-min", "inv-max", "inv-result-summary"].forEach((id) => {
    expect(host.querySelector(`[data-layout="desktop"] [data-testid="${id}"]`)).not.toBeNull();
  });
  const pay = host.querySelector('[data-layout="desktop"] [data-testid="inv-pay-filter"]');
  expect(pay.className).toContain("bg-slate-100");
  expect(pay.className).toContain("rounded-xl");
  expect(host.querySelector('[data-testid="inv-search"]').parentElement.className).toContain("min-w-[220px]");
  expect(mobile().querySelector('[data-testid="inv-etype-filter"]')).toBeNull();
  expect(mobile().querySelector('[data-testid="inv-min"]')).toBeNull();
  const chips = mobile().querySelector('[data-testid="inv-pay-filter-m"]');
  expect(chips.className).toContain("overflow-x-auto");
  expect(chips.className).toContain("-mx-4");
  expect(chips.className).toContain("gap-2");
  const selected = chips.querySelector('[data-testid="inv-pay-all-m"]');
  expect(selected.className).toContain("shrink-0");
  expect(selected.className).toContain("h-9");
  expect(selected.className).toContain("rounded-full");
  expect(selected.className).toContain("bg-slate-900");
  expect(selected.className).toContain("text-white");

  await act(async () => { mobile().querySelector('[data-testid="mobile-filter-button"]').click(); });
  const sheetSelect = document.querySelector('[data-testid="mobile-filter-sheet"] [data-testid="inv-etype-filter"]');
  expect(sheetSelect).not.toBeNull();
  expect(sheetSelect.className).toContain("w-full");
  expect(sheetSelect.className).toContain("h-11");
  expect(sheetSelect.className).toContain("rounded-xl");
  expect(document.querySelector('[data-testid="mobile-filter-sheet"] [data-testid="inv-pay-all"]')).toBeNull();
});
