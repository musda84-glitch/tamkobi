import { describe, expect, it } from "vitest";
import { B2B_CATALOG_PAGE, catalogGrowVisible, catalogVisibleCount } from "./b2bCatalogWindow";

describe("b2bCatalogWindow", () => {
  it("starts at page size and never exceeds total", () => {
    expect(catalogVisibleCount(10, 0)).toBe(10);
    expect(catalogVisibleCount(100, 0)).toBe(B2B_CATALOG_PAGE);
    expect(catalogVisibleCount(100, 200)).toBe(B2B_CATALOG_PAGE);
    expect(catalogVisibleCount(0, 48)).toBe(0);
  });

  it("grows by page until total", () => {
    expect(catalogGrowVisible(100, 48)).toBe(96);
    expect(catalogGrowVisible(100, 96)).toBe(100);
    expect(catalogGrowVisible(100, 100)).toBe(100);
  });
});
