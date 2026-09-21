import { orderEditBlockedReason, orderLinesLocked } from "./orderEdit";

test("approved order with a draft invoice id stays editable", () => {
  expect(orderEditBlockedReason({
    order_status: "approved",
    is_invoiced: false,
    invoice_id: "inv_draft",
  })).toBe("");
});

test("issued e-document blocks edit, paper does not", () => {
  expect(orderEditBlockedReason({ order_status: "approved", is_invoiced: true, e_type: "e_archive" }))
    .toMatch(/E-belge/);
  expect(orderEditBlockedReason({ order_status: "approved", is_invoiced: true, e_type: "paper" })).toBe("");
});

test("cancelled stays locked and marketplace lines stay locked", () => {
  expect(orderEditBlockedReason({ order_status: "cancelled" })).toMatch(/düzenlenemez/);
  expect(orderLinesLocked({ channel: "trendyol" })).toBe(true);
  expect(orderLinesLocked({ channel: "b2b" })).toBe(false);
});
