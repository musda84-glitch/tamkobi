import {
  applyOrderFilters,
  ORDER_FILTER_DEFAULTS,
  isIncomingOrder,
  CLOSED_STATUSES,
  isActiveCartOrder,
  orderPanelFilter,
  decorateB2bHeldOrder,
  prepareOrdersForPanel,
  foldTr,
  orderFiltersFromSearch,
  writeOrderFiltersToParams,
  buildOrderListParams,
  toggleColumnSort,
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

test("date range uses Istanbul calendar day so 23:30 stays on that day", () => {
  const evening = {
    order_number: "TY-2330",
    order_status: "pending",
    channel: "trendyol",
    order_date: "2026-10-13T20:30:00+00:00",
  };
  const afterMidnight = {
    order_number: "TY-0030",
    order_status: "pending",
    channel: "shopphp",
    order_date: "2026-10-13T21:30:00+00:00",
  };
  const onDay = applyOrderFilters([evening, afterMidnight], { ...ORDER_FILTER_DEFAULTS, from: "2026-10-13", to: "2026-10-13" });
  expect(onDay.map((o) => o.order_number)).toEqual(["TY-2330"]);
  const nextDay = applyOrderFilters([evening, afterMidnight], { ...ORDER_FILTER_DEFAULTS, from: "2026-10-14", to: "2026-10-14" });
  expect(nextDay.map((o) => o.order_number)).toEqual(["TY-0030"]);
});

test("search matches order no, customer, phone, product, sku and tracking without turkish case", () => {
  expect(foldTr("Şişe")).toBe("sise");
  const rows = [
    { order_number: "SP-9", order_status: "pending", customer_name: "Ali", customer_phone: "0532", items: [{ product_name: "Kupa", sku: "KP-1" }] },
    { order_number: "SP-1", order_status: "pending", customer_name: "Şişeci", customer_phone: "0212", items: [{ product_name: "Çelik", sku: "CEL-2" }], cargo_tracking_number: "YK999" },
  ];
  const base = { ...ORDER_FILTER_DEFAULTS };
  expect(applyOrderFilters(rows, { ...base, q: "sp-9" }).map((o) => o.order_number)).toEqual(["SP-9"]);
  expect(applyOrderFilters(rows, { ...base, q: "sise" }).map((o) => o.order_number)).toEqual(["SP-1"]);
  expect(applyOrderFilters(rows, { ...base, q: "0532" }).map((o) => o.order_number)).toEqual(["SP-9"]);
  expect(applyOrderFilters(rows, { ...base, q: "celik" }).map((o) => o.order_number)).toEqual(["SP-1"]);
  expect(applyOrderFilters(rows, { ...base, q: "cel-2" }).map((o) => o.order_number)).toEqual(["SP-1"]);
  expect(applyOrderFilters(rows, { ...base, q: "yk999" }).map((o) => o.order_number)).toEqual(["SP-1"]);
});

test("date range follows the Istanbul calendar day", () => {
  const rows = [
    { order_number: "PREV", order_status: "pending", order_date: "2026-10-12T20:59:59Z" },
    { order_number: "START", order_status: "pending", order_date: "2026-10-12T21:00:00Z" },
    { order_number: "END", order_status: "pending", order_date: "2026-10-13T20:59:59Z" },
    { order_number: "NEXT", order_status: "pending", order_date: "2026-10-13T21:00:00Z" },
  ];
  const out = applyOrderFilters(rows, { ...ORDER_FILTER_DEFAULTS, from: "2026-10-13", to: "2026-10-13", sort: "number" });
  expect(out.map((o) => o.order_number).sort()).toEqual(["END", "START"]);
});

test("channel invoice cargo and doc filters", () => {
  const rows = [
    { order_number: "B", order_status: "pending", channel: "", invoice_id: "", cargo_tracking_number: "" },
    { order_number: "T", order_status: "pending", channel: "trendyol", invoice_id: "i1", is_invoiced: true, cargo_tracking_number: "C1" },
    { order_number: "G", order_status: "approved", channel: "trendyol", invoice_id: "i2", is_invoiced: true, einvoice_state: "sent", cargo_tracking_number: "" },
    { order_number: "D", order_status: "approved", channel: "b2b", dispatch_number: "IRS-1" },
  ];
  const base = { ...ORDER_FILTER_DEFAULTS };
  expect(applyOrderFilters(rows, { ...base, channel: "b2b" }).map((o) => o.order_number).sort()).toEqual(["B", "D"]);
  expect(applyOrderFilters(rows, { ...base, invoiced: "yes" }).map((o) => o.order_number).sort()).toEqual(["G", "T"]);
  expect(applyOrderFilters(rows, { ...base, invoiced: "no" }).map((o) => o.order_number).sort()).toEqual(["B", "D"]);
  expect(applyOrderFilters(rows, { ...base, invoiced: "einvoice" }).map((o) => o.order_number)).toEqual(["G"]);
  expect(applyOrderFilters(rows, { ...base, cargo: "yes" }).map((o) => o.order_number)).toEqual(["T"]);
  expect(applyOrderFilters(rows, { ...base, cargo: "no" }).map((o) => o.order_number).sort()).toEqual(["B", "D", "G"]);
  expect(applyOrderFilters(rows, { ...base, docStatus: ["dispatched"] }).map((o) => o.order_number)).toEqual(["D"]);
  expect(applyOrderFilters(rows, { ...base, docStatus: ["invoiced"] }).map((o) => o.order_number).sort()).toEqual(["G", "T"]);
});

test("filters round-trip through the url and clear back to defaults", () => {
  const current = new URLSearchParams("tab=questions&customer=Ada&page=3");
  const filters = {
    ...ORDER_FILTER_DEFAULTS,
    q: "şişe",
    status: "pending",
    channel: "trendyol",
    invoiced: "einvoice",
    cargo: "no",
    docStatus: ["draft"],
    from: "2026-10-01",
    to: "2026-10-13",
    sort: "amount_desc",
  };
  const written = writeOrderFiltersToParams(current, filters);
  expect(written.get("tab")).toBe("questions");
  expect(written.get("customer")).toBe("Ada");
  expect(written.get("page")).toBeNull();
  const back = orderFiltersFromSearch(written);
  expect(back.q).toBe("şişe");
  expect(back.status).toBe("pending");
  expect(back.channel).toBe("trendyol");
  expect(back.invoiced).toBe("einvoice");
  expect(back.cargo).toBe("no");
  expect(back.docStatus).toEqual(["draft"]);
  expect(back.from).toBe("2026-10-01");
  expect(back.to).toBe("2026-10-13");
  expect(back.sort).toBe("amount_desc");
  const cleared = writeOrderFiltersToParams(written, { ...ORDER_FILTER_DEFAULTS, docStatus: ["draft", "dispatched", "invoiced", "cancelled"] });
  expect(orderFiltersFromSearch(cleared)).toMatchObject({
    q: "", status: "all", channel: "all", invoiced: "all", cargo: "all", from: "", to: "", sort: "date_desc",
  });
  expect(cleared.get("tab")).toBe("questions");
});

test("list query sends each filter and export asks for the full filtered set", () => {
  const params = buildOrderListParams(
    { ...ORDER_FILTER_DEFAULTS, q: "ada", status: "shipped", channel: "n11", invoiced: "yes", cargo: "yes", docStatus: ["invoiced"], from: "2026-01-01", to: "2026-01-31" },
    { companyId: "c1", page: 2, pageSize: 100, customer: "Ada" },
  );
  expect(params).toMatchObject({
    company_id: "c1", paged: 1, page: 2, page_size: 100, q: "ada", status: "shipped",
    channel: "n11", invoiced: "yes", cargo: "yes", doc_status: "invoiced",
    date_from: "2026-01-01", date_to: "2026-01-31", customer: "Ada",
  });
  const exp = buildOrderListParams(ORDER_FILTER_DEFAULTS, { companyId: "c1", exportAll: true, page: 4 });
  expect(exp.page).toBe(1);
  expect(exp.export).toBe(1);
  expect(exp.page_size).toBe(5000);
  expect(toggleColumnSort("date_desc", "order_date")).toBe("date_asc");
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
