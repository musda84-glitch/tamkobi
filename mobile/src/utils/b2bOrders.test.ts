import {
  addEditProduct,
  canCancelOrder,
  canEditOrder,
  cancelBadge,
  editLinesFromOrder,
  installmentRemaining,
  installmentTitle,
  invoiceRemaining,
  payStatus,
  previewLineCode,
  setEditQty,
  trackingLabel,
} from "./b2bOrders";

describe("order gates", () => {
  it("lets pending/new orders be edited and approved ones cancelled", () => {
    expect(canEditOrder({ order_status: "pending" })).toBe(true);
    expect(canEditOrder({ order_status: "new" })).toBe(true);
    expect(canEditOrder({ order_status: "approved" })).toBe(false);
    expect(canCancelOrder({ order_status: "approved" })).toBe(true);
    expect(canCancelOrder({ order_status: "preparing", cancel_request: { status: "pending" } })).toBe(false);
    expect(cancelBadge({ cancel_request: { status: "pending" } })).toBe("İptal talebi iletildi");
  });
});

describe("money leftovers", () => {
  it("never goes negative", () => {
    expect(invoiceRemaining({ grand_total: 100, paid_amount: 40 })).toBe(60);
    expect(installmentRemaining({ amount: 50, paid_amount: 80 })).toBe(0);
    expect(installmentTitle({ invoice_number: "F-1", label: "2. taksit" })).toBe("F-1 • 2. taksit");
    expect(payStatus("paid")).toBe("paid");
    expect(payStatus("x")).toBe("unpaid");
  });
});

describe("edit lines", () => {
  it("adds, increments and drops zero qty", () => {
    let lines = editLinesFromOrder([{ product_id: "a", product_name: "A", quantity: 2, unit_price: 10 }]);
    lines = addEditProduct(lines, { id: "b", name: "B", price: 5 });
    lines = addEditProduct(lines, { id: "a", name: "A" });
    expect(lines.find((l) => l.product_id === "a")?.quantity).toBe(3);
    expect(setEditQty(lines, "b", 0).map((l) => l.product_id)).toEqual(["a"]);
  });
});

describe("preview helpers", () => {
  it("falls back to catalog barcode", () => {
    expect(previewLineCode({ product_id: "1" }, [{ id: "1", barcode: "869" }])).toBe("869");
    expect(trackingLabel("in_transit")).toBe("Yolda");
    expect(trackingLabel(null)).toBe("Kargo bekleniyor");
  });
});
