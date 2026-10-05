import { orderShowsProduction } from "./B2BPortalParts";

describe("orderShowsProduction", () => {
  it("shows production when active and order still open", () => {
    expect(orderShowsProduction({
      order_status: "pending",
      production: { status: "in_production", active: true, status_label: "Üretimde" },
    })).toBe(true);
  });

  it("hides production after ship/deliver", () => {
    expect(orderShowsProduction({
      order_status: "shipped",
      production: { status: "completed", active: false },
    })).toBe(false);
  });

  it("prefers tracking once production finished", () => {
    expect(orderShowsProduction({
      order_status: "approved",
      tracking: { status: "in_transit" },
      production: { status: "completed", active: false },
    })).toBe(false);
  });
});
