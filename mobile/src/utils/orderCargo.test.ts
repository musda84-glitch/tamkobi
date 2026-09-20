import {
  approveActionLabel,
  canApproveMarketplaceOrder,
  canChangeMarketplaceCargo,
  canShowMarketplaceApprove,
  cargoChangeBody,
  cargoChangeConfirm,
  cargoNameOf,
  cargoSelectGroups,
  FALLBACK_CARGO_CATALOG,
} from "./orderCargo";

describe("orderCargo", () => {
  it("shows cargo change on marketplace orders that are not cancelled", () => {
    expect(canChangeMarketplaceCargo({ channel: "trendyol", order_status: "delivered" })).toBe(true);
    expect(canChangeMarketplaceCargo({ channel: "trendyol", order_status: "pending" })).toBe(true);
    expect(canChangeMarketplaceCargo({ channel: "trendyol", order_status: "cancelled" })).toBe(false);
    expect(canChangeMarketplaceCargo({ channel: "saha", order_status: "pending" })).toBe(false);
  });

  it("hides pazaryeri approve once the order is approved or delivered", () => {
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "pending", marketplace_status: "Created" })).toBe(true);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "approved" })).toBe(false);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "delivered", marketplace_status: "Delivered" })).toBe(false);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "pending", marketplace_status: "Picking" })).toBe(false);
    expect(canShowMarketplaceApprove({ channel: "trendyol", order_status: "cancelled" })).toBe(false);
    expect(canApproveMarketplaceOrder({ channel: "trendyol", order_status: "pending" })).toBe(true);
    expect(canApproveMarketplaceOrder({ channel: "trendyol", order_status: "approved", marketplace_status: "Created" })).toBe(false);
    expect(canApproveMarketplaceOrder({ channel: "saha", order_status: "pending" })).toBe(true);
    expect(approveActionLabel({ channel: "trendyol" })).toBe("Pazaryeri onayla");
    expect(approveActionLabel({ channel: "saha" })).toBe("Onayla");
  });

  it("sends the selected carrier and mentions marketplace in confirm copy", () => {
    expect(cargoChangeBody("yurtici")).toEqual({ cargo_carrier: "yurtici" });
    const text = cargoChangeConfirm(
      { order_number: "11571866", channel: "trendyol", cargo_carrier: "trendyolexpress", cargo_carrier_name: "Trendyol Express" },
      "Yurtiçi Kargo",
    );
    expect(text).toContain("11571866");
    expect(text).toContain("Trendyol");
    expect(text).toContain("Trendyol Express → Yurtiçi Kargo");
    expect(text).toMatch(/pazaryeri entegrasyonuna iletilir/);
  });

  it("groups catalog and keeps the current carrier if missing", () => {
    const groups = cargoSelectGroups(
      [
        { carrier_code: "geliver", carrier_name: "Geliver", kind: "marketplace", installed: true },
        { carrier_code: "yurtici", carrier_name: "Yurtiçi Kargo", kind: "carrier" },
        { carrier_code: "navlungo", carrier_name: "Navlungo", kind: "marketplace" },
      ],
      "hepsijet",
      "HepsiJet",
    );
    expect(groups.map((g) => g.label)).toEqual(["Kayıtlı", "Pazaryeri kargo", "Kargo firmaları"]);
    expect(groups[0].options).toEqual(expect.arrayContaining([{ value: "hepsijet", label: "HepsiJet" }]));
    expect(cargoNameOf(FALLBACK_CARGO_CATALOG, "yurtici")).toBe("Yurtiçi Kargo");
  });
});
