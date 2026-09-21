import { cacheIsFresh, listCacheKey } from "./listCache";

describe("listCache", () => {
  it("builds a stable key", () => {
    expect(listCacheKey("products", "comp_1")).toBe("tk-list-v1:comp_1:products");
  });

  it("treats recent timestamps as fresh", () => {
    expect(cacheIsFresh(Date.now() - 10_000, 90_000)).toBe(true);
    expect(cacheIsFresh(Date.now() - 120_000, 90_000)).toBe(false);
    expect(cacheIsFresh(undefined)).toBe(false);
  });
});
