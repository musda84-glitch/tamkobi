import { describe, expect, it } from "vitest";
import {
  MARKETPLACE_CARGO_OPTIONS,
  cargoChangeBody,
  cargoChangeConfirm,
  marketplaceCargoOptions,
} from "./marketplaceCargo";

describe("marketplaceCargo", () => {
  it("lists trendyol-compatible carriers", () => {
    expect(MARKETPLACE_CARGO_OPTIONS.some((o) => o.carrier_code === "yurtici")).toBe(true);
    expect(MARKETPLACE_CARGO_OPTIONS.some((o) => o.carrier_code === "trendyolexpress")).toBe(true);
  });

  it("keeps unknown marketplace carrier from order at top", () => {
    const rows = marketplaceCargoOptions({
      cargo_carrier: "CustomProviderX",
      cargo_carrier_name: "Özel Kargo Marketplace",
    });
    expect(rows[0].carrier_code).toBe("customproviderx");
    expect(rows[0].carrier_name).toBe("Özel Kargo Marketplace");
    expect(rows[0].from_marketplace).toBe(true);
  });

  it("cargoChangeBody and confirm text", () => {
    expect(cargoChangeBody("yurtici", "Yurtiçi Kargo")).toEqual({
      cargo_carrier: "yurtici",
      cargo_carrier_name: "Yurtiçi Kargo",
    });
    const msg = cargoChangeConfirm(
      { order_number: "11626987372", cargo_carrier_name: "Trendyol Express" },
      "Yurtiçi Kargo",
    );
    expect(msg).toContain("11626987372");
    expect(msg).toContain("Trendyol Express → Yurtiçi Kargo");
    expect(msg).toContain("pazaryeri");
  });
});
