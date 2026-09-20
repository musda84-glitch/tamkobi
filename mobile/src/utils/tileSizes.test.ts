import { TILE_SIZES } from "./tileSizes";

describe("TILE_SIZES", () => {
  it("gives every size a fixed card height and a two-line label slot", () => {
    for (const size of ["xs", "sm", "md"] as const) {
      const s = TILE_SIZES[size];
      expect(s.labelHeight).toBeGreaterThanOrEqual(s.font * 2);
      expect(s.height).toBeGreaterThanOrEqual(s.padding * 2 + s.badge + s.gap + s.labelHeight);
    }
  });

  it("keeps the Özet md tiles at the two-line height so Barkod and Depo match", () => {
    expect(TILE_SIZES.md.height).toBe(116);
    expect(TILE_SIZES.md.labelHeight).toBe(32);
  });
});
