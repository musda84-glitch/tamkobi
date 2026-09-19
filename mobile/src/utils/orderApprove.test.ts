import { approveOrderBody, approveOrderConfirm, canApproveOrder, isMarketplaceChannel } from "./orderApprove";

describe("orderApprove", () => {
  it("allows only pending and new orders", () => {
    expect(canApproveOrder({ order_status: "pending" })).toBe(true);
    expect(canApproveOrder({ order_status: "new" })).toBe(true);
    expect(canApproveOrder({ order_status: "delivered" })).toBe(false);
    expect(canApproveOrder({ order_status: "approved" })).toBe(false);
  });

  it("sends the marketplace cargo carrier on approve", () => {
    expect(approveOrderBody({ cargo_carrier: "trendyolexpress" })).toEqual({ cargo_carrier: "trendyolexpress" });
    expect(approveOrderBody({})).toEqual({ cargo_carrier: "geliver" });
  });

  it("mentions marketplace integration in the confirm copy", () => {
    const text = approveOrderConfirm({
      order_number: "11573451170",
      channel: "trendyol",
      marketplace_status: "Created",
      cargo_carrier: "trendyolexpress",
      cargo_carrier_name: "Trendyol Express",
    });
    expect(text).toContain("11573451170");
    expect(text).toContain("Trendyol");
    expect(text).toContain("Created");
    expect(text).toContain("Trendyol Express");
    expect(text).toMatch(/pazaryeri entegrasyonuna iletilir/);
    expect(isMarketplaceChannel("trendyol")).toBe(true);
    expect(isMarketplaceChannel("saha")).toBe(false);
  });
});
