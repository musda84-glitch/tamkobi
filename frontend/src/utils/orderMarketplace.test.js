import { canChangeMarketplaceCargo, canShowMarketplaceApprove, isMarketplaceChannel } from "./orderMarketplace";

describe("orderMarketplace", () => {
  it("detects marketplace channels", () => {
    expect(isMarketplaceChannel("trendyol")).toBe(true);
    expect(isMarketplaceChannel("saha")).toBe(false);
  });

  it("hides approve after the order is already approved", () => {
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "pending", marketplace_status: "Created" })).toBe(true);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "approved" })).toBe(false);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "delivered", marketplace_status: "Delivered" })).toBe(false);
    expect(canChangeMarketplaceCargo({ channel: "trendyol", order_status: "delivered" })).toBe(true);
    expect(canChangeMarketplaceCargo({ channel: "trendyol", order_status: "cancelled" })).toBe(false);
  });
});
