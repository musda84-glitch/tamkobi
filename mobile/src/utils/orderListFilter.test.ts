import {
  ORDER_LIST_FILTER_DEFAULT,
  filterOrders,
  matchesOrderListFilter,
  orderListBucket,
  orderListEmptyTitle,
  orderListFilterCounts,
} from "./orderListFilter";

describe("orderListBucket", () => {
  it("puts pending / approved without cargo into Yeni", () => {
    expect(orderListBucket({ order_status: "pending" })).toBe("new");
    expect(orderListBucket({ order_status: "new" })).toBe("new");
    expect(orderListBucket({ order_status: "approved" })).toBe("new");
    expect(orderListBucket({ order_status: "preparing" })).toBe("new");
  });

  it("puts cancelled marketplace and ERP statuses into İptal", () => {
    expect(orderListBucket({ order_status: "cancelled" })).toBe("cancelled");
    expect(orderListBucket({ order_status: "approved", marketplace_status: "Cancelled" })).toBe("cancelled");
    expect(orderListBucket({ order_status: "shipped", marketplace_status: "Cancelled" })).toBe("cancelled");
  });

  it("puts returns into İade", () => {
    expect(orderListBucket({ order_status: "returned" })).toBe("returned");
    expect(orderListBucket({ order_status: "partially_returned" })).toBe("returned");
    expect(orderListBucket({ order_status: "approved", marketplace_status: "Returned" })).toBe("returned");
  });

  it("puts shipped / cargo tracking into Kargolandı", () => {
    expect(orderListBucket({ order_status: "shipped" })).toBe("shipped");
    expect(orderListBucket({ order_status: "delivered" })).toBe("shipped");
    expect(orderListBucket({ order_status: "approved", cargo_tracking_number: "123" })).toBe("shipped");
    expect(orderListBucket({ order_status: "approved", tracking: { tracking_number: "XYZ" } })).toBe("shipped");
    expect(orderListBucket({ order_status: "approved", marketplace_status: "ReadyToShip" })).toBe("new");
  });
});

describe("filterOrders", () => {
  const rows = [
    { order_number: "B2B-1", customer_name: "ERSAY", order_status: "approved" },
    { order_number: "TY-2", customer_name: "Mustafa", order_status: "cancelled", marketplace_status: "Cancelled" },
    { order_number: "SAHA-3", customer_name: "Deneme", order_status: "shipped" },
    { order_number: "TY-4", customer_name: "Hatice", order_status: "returned" },
  ];

  it("defaults to Yeni and hides closed / shipped", () => {
    expect(ORDER_LIST_FILTER_DEFAULT).toBe("new");
    expect(filterOrders(rows).map((o) => o.order_number)).toEqual(["B2B-1"]);
  });

  it("filters each tab and search", () => {
    expect(filterOrders(rows, "all").map((o) => o.order_number)).toEqual(["B2B-1", "TY-2", "SAHA-3", "TY-4"]);
    expect(filterOrders(rows, "cancelled").map((o) => o.order_number)).toEqual(["TY-2"]);
    expect(filterOrders(rows, "returned").map((o) => o.order_number)).toEqual(["TY-4"]);
    expect(filterOrders(rows, "shipped").map((o) => o.order_number)).toEqual(["SAHA-3"]);
    expect(filterOrders(rows, "all", "ersay").map((o) => o.order_number)).toEqual(["B2B-1"]);
    expect(matchesOrderListFilter(rows[0], "new")).toBe(true);
    expect(matchesOrderListFilter(rows[1], "new")).toBe(false);
  });

  it("counts buckets and empty titles", () => {
    expect(orderListFilterCounts(rows)).toEqual({ new: 1, all: 4, cancelled: 1, returned: 1, shipped: 1 });
    expect(orderListEmptyTitle("new")).toBe("Yeni sipariş yok");
    expect(orderListEmptyTitle("all")).toBe("Sipariş yok");
  });
});
