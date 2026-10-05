import { b2bOrderGross } from "./B2BPortalParts";

describe("b2bOrderGross", () => {
  it("uses grand_total (KDV dahil) instead of net total_amount", () => {
    expect(b2bOrderGross({ total_amount: 78124.99, grand_total: 93750 })).toBe(93750);
  });
});
