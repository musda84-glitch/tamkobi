import { canMarkDeliveredFromPick } from "./pickDeliver";

describe("pickDeliver", () => {
  test("allows B2B and panel after ship", () => {
    expect(canMarkDeliveredFromPick({ channel: "b2b", order_status: "shipped" })).toBe(true);
    expect(canMarkDeliveredFromPick({ channel: "manual", order_status: "shipped" })).toBe(true);
    expect(canMarkDeliveredFromPick({ order_status: "shipped" })).toBe(true);
    expect(canMarkDeliveredFromPick({ can_mark_delivered: true })).toBe(true);
  });

  test("blocks marketplace and pre-ship", () => {
    expect(canMarkDeliveredFromPick({ channel: "trendyol", order_status: "shipped" })).toBe(false);
    expect(canMarkDeliveredFromPick({ channel: "b2b", order_status: "preparing" })).toBe(false);
    expect(canMarkDeliveredFromPick({ can_mark_delivered: false, channel: "b2b", order_status: "shipped" })).toBe(false);
  });
});
