import { QUICK_TILES, resolveMobilePath, splitHref, visibleQuickTiles } from "./quickMenu";

describe("visibleQuickTiles", () => {
  it("shows licensed modules for admin", () => {
    const tiles = visibleQuickTiles({ role: "admin" }, null);
    expect(tiles.map((t) => t.id)).toEqual(QUICK_TILES.map((t) => t.id));
  });

  it("hides stock and saha when license or role blocks them", () => {
    const user = { role: "sales", permissions: { "/saha": "none", "/stock": "view", "/invoices": "view" } };
    const tiles = visibleQuickTiles(user, { modules: { "/saha": false, "/stock": true } });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain("saha");
    expect(ids).toContain("stock");
    expect(ids).toContain("barcode");
    expect(ids).toContain("search");
    expect(ids).toContain("settings");
  });

  it("aliases personelim to mesai license", () => {
    const tiles = visibleQuickTiles({ role: "admin" }, { modules: { "/mesai": false } });
    expect(tiles.map((t) => t.id)).not.toContain("personelim");
    expect(tiles.map((t) => t.id)).not.toContain("mesai");
  });
});

describe("resolveMobilePath", () => {
  it("maps dashboard task paths onto mobile routes", () => {
    expect(resolveMobilePath("/invoices")).toBe("/invoices");
    expect(resolveMobilePath("/stock")).toBe("/stok");
    expect(resolveMobilePath("/personnel")).toBe("/personelim");
    expect(resolveMobilePath("/sevk")).toBeNull();
    expect(resolveMobilePath("")).toBeNull();
  });
});

describe("splitHref", () => {
  it("parses scan query for barcode tile", () => {
    expect(splitHref("/stok?scan=1")).toEqual({ pathname: "/stok", params: { scan: "1" } });
    expect(splitHref("/invoices")).toEqual({ pathname: "/invoices" });
  });
});
