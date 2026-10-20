import { orderShowsProduction, productionBadge } from "./B2BPortalParts";

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

describe("productionBadge", () => {
  it("keeps a planned order planned when total is 0", () => {
    expect(productionBadge({
      order_status: "pending",
      production: { status: "planned", status_label: "Üretim tamamlandı", done: 0, total: 0, steps: [] },
    })).toEqual({ label: "Üretim planlandı", tone: "amber" });
  });

  it("falls back to status_label when total is 0 and progress has no rule", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "completed", status_label: "Üretim tamamlandı", done: 0, total: 0, steps: [] },
    })).toEqual({ label: "Üretim tamamlandı", tone: "slate" });
  });

  it("treats done above total as finished", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "in_production", status_label: "Üretimde", done: 4, total: 3, steps: [] },
    })).toEqual({ label: "Üretim tamamlandı", tone: "emerald" });
  });

  it("follows done/total when the step list is empty", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "completed", status_label: "Üretim tamamlandı", done: 2, total: 3, steps: [] },
    })).toEqual({ label: "Üretimde", tone: "blue" });
  });

  it("uses the order status when there is no production", () => {
    expect(productionBadge({ order_status: "pending" })).toEqual({ label: "Beklemede", tone: "slate" });
  });

  it("stays in production when a completed order has not finished its steps", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "completed", status_label: "Üretim tamamlandı", done: 0, total: 3 },
    })).toEqual({ label: "Üretimde", tone: "blue" });
  });

  it("finishes only when every counted step is done", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "completed", status_label: "Üretim tamamlandı", done: 3, total: 3 },
    })).toEqual({ label: "Üretim tamamlandı", tone: "emerald" });
  });

  it("keeps a partial completed order in production", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "completed", status_label: "Üretim tamamlandı", done: 2, total: 3 },
    })).toEqual({ label: "Üretimde", tone: "blue" });
  });

  it("plans a zero-progress planned order", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "planned", status_label: "Üretim planlandı", done: 0, total: 14 },
    })).toEqual({ label: "Üretim planlandı", tone: "amber" });
  });

  it("keeps an unrecognized cancel label", () => {
    expect(productionBadge({
      order_status: "approved",
      production: { status: "cancelled", status_label: "Üretim iptal", done: 0, total: 3 },
    })).toEqual({ label: "Üretim iptal", tone: "slate" });
  });
});
