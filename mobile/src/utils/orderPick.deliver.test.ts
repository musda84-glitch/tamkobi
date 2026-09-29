import { canMarkDeliveredFromPick, isPendingSevk } from "./orderPick";

describe("pick deliver (mobile)", () => {
  it("marks B2B/panel shipped orders as deliverable", () => {
    expect(canMarkDeliveredFromPick({ channel: "b2b", order_status: "shipped" })).toBe(true);
    expect(canMarkDeliveredFromPick({ channel: "manual", order_status: "shipped" })).toBe(true);
    expect(canMarkDeliveredFromPick({ can_mark_delivered: true })).toBe(true);
    expect(canMarkDeliveredFromPick({ channel: "trendyol", order_status: "shipped" })).toBe(false);
  });

  it("keeps deliverable shipped rows visible in sevk list", () => {
    expect(isPendingSevk({ channel: "b2b", order_status: "shipped", can_mark_delivered: true })).toBe(true);
    expect(isPendingSevk({ order_status: "delivered" })).toBe(false);
    expect(isPendingSevk({ order_status: "approved", pick_status: "open" })).toBe(true);
  });
});
