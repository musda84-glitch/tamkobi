import { QUICK_TILES, QUICK_TONE_COLORS, resolveMobilePath, splitHref, visibleQuickTiles } from "./quickMenu";

describe("QUICK_TONE_COLORS", () => {
  it("gives every tile tone a full palette", () => {
    const tones = new Set(QUICK_TILES.map((t) => t.tone));
    for (const tone of tones) {
      const c = QUICK_TONE_COLORS[tone];
      expect(c).toBeDefined();
      for (const key of ["bg", "border", "solid", "fg"] as const) {
        expect(c[key]).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

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
    expect(ids).toContain("notifications");
    expect(ids).toContain("settings");
  });

  it("routes dashboard task paths that now have mobile screens", () => {
    expect(resolveMobilePath("/installments")).toBe("/installments");
    expect(resolveMobilePath("/cheques")).toBe("/cheques");
  });

  it("gates the warehouse shipping tile on the /sevk module", () => {
    const warehouse = { role: "warehouse", permissions: { "/sevk": "edit" } };
    expect(visibleQuickTiles(warehouse, null).map((t) => t.id)).toContain("sevk");
    const accountant = { role: "accountant", permissions: { "/sevk": "none" } };
    expect(visibleQuickTiles(accountant, null).map((t) => t.id)).not.toContain("sevk");
    expect(visibleQuickTiles({ role: "admin" }, { modules: { "/sevk": false } }).map((t) => t.id)).not.toContain("sevk");
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
    expect(resolveMobilePath("/sevk")).toBe("/sevk");
    expect(resolveMobilePath("/bilinmeyen")).toBeNull();
    expect(resolveMobilePath("")).toBeNull();
  });
});

describe("splitHref", () => {
  it("parses scan query for barcode tile", () => {
    expect(splitHref("/stok?scan=1")).toEqual({ pathname: "/stok", params: { scan: "1" } });
    expect(splitHref("/invoices")).toEqual({ pathname: "/invoices" });
  });
});
