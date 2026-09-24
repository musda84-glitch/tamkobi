import { cartFromOrderItems, canStaffDeleteOrder, canStaffEditOrder, orderStatusOf, orderUpdatePayload, removeOrderLine, setCartLineQty } from "./orderEdit";

describe("staff order gates", () => {
  it("lets pending B2B/saha orders be edited and deleted", () => {
    const o = { channel: "b2b", order_status: "pending" };
    expect(canStaffEditOrder(o)).toBe(true);
    expect(canStaffDeleteOrder(o)).toBe(true);
    expect(canStaffEditOrder({ ...o, order_status: "approved" })).toBe(true);
    expect(canStaffEditOrder({ channel: "saha", status: "new" })).toBe(true);
  });

  it("blocks invoiced, cancelled and marketplace edits", () => {
    expect(canStaffEditOrder({ channel: "b2b", order_status: "pending", is_invoiced: true })).toBe(false);
    expect(canStaffDeleteOrder({ invoice_id: "inv-1" })).toBe(false);
    expect(canStaffEditOrder({ channel: "b2b", order_status: "cancelled" })).toBe(false);
    expect(canStaffEditOrder({ channel: "trendyol", order_status: "pending" })).toBe(false);
    expect(canStaffDeleteOrder({ is_invoiced: false })).toBe(true);
  });

  it("allows edit when only draft invoice_id exists", () => {
    const draft = { channel: "b2b", order_status: "approved", invoice_id: "inv_draft", is_invoiced: false };
    expect(canStaffEditOrder(draft)).toBe(true);
    expect(canStaffDeleteOrder(draft)).toBe(false);
  });

  it("reads order_status or status", () => {
    expect(orderStatusOf({ status: "approved" })).toBe("approved");
    expect(orderStatusOf({ order_status: "pending", status: "x" })).toBe("pending");
  });
});

describe("order edit cart", () => {
  it("rebuilds lines and drops zero qty", () => {
    const cart = cartFromOrderItems([
      { product_id: "a", product_name: "A", quantity: 2, unit_price: 10, vat_rate: 0 },
    ]);
    expect(cart[0].total_incl).toBe(20);
    expect(setCartLineQty(cart, 0, 0)).toEqual([]);
    expect(setCartLineQty(cart, 0, 3)[0].quantity).toBe(3);
    const payload = orderUpdatePayload(cart, "not", "PO-1");
    expect(payload.notes).toBe("not");
    expect(payload.customer_order_number).toBe("PO-1");
    expect(payload.items[0].product_id).toBe("a");
  });

  it("refuses deleting the last order line", () => {
    const rows = [{ name: "A" }, { name: "B" }];
    expect(removeOrderLine(rows, 0)).toEqual([{ name: "B" }]);
    expect(removeOrderLine(rows, 1)).toEqual([{ name: "A" }]);
    expect(removeOrderLine([{ name: "A" }], 0)).toBeNull();
    expect(removeOrderLine(rows, -1)).toEqual(rows);
  });
});
