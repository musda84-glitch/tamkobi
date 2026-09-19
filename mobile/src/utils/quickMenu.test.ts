import { QUICK_TILES, QUICK_TONE_COLORS, resolveMobilePath, splitHref, splitNotificationsTile, visibleQuickTiles } from "./quickMenu";

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

  it("hides modules the role or license blocks", () => {
    const user = { role: "sales", permissions: { "/banking": "none", "/stock": "view", "/invoices": "view" } };
    const tiles = visibleQuickTiles(user, { modules: { "/cheques": false, "/stock": true } });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain("banking");
    expect(ids).not.toContain("cheques");
    expect(ids).toContain("stock");
    expect(ids).toContain("barcode");
    expect(ids).toContain("notifications");
  });

  it("keeps tab bar and account menu entries out of the quick menu", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    for (const id of ["saha", "mesai", "personelim", "settings", "search"]) {
      expect(ids).not.toContain(id);
    }
    expect(ids).toContain("banking");
  });

  it("leaves installments to the cheques screen and the more menu", () => {
    expect(QUICK_TILES.map((t) => t.id)).not.toContain("installments");
    expect(resolveMobilePath("/installments")).toBe("/installments");
  });

  it("routes dashboard task paths that now have mobile screens", () => {
    expect(resolveMobilePath("/installments")).toBe("/installments");
    expect(resolveMobilePath("/cheques")).toBe("/cheques");
  });

  it("hides Personel & Bordro unless the role grants /personnel", () => {
    const production = { role: "production", permissions: { "/mesai": "view", "/production": "edit" } };
    expect(visibleQuickTiles(production, { modules: { "/mesai": true } }).map((t) => t.id)).not.toContain("personnel");
    const advisor = { role: "advisor", permissions: { "/personnel": "view" } };
    expect(visibleQuickTiles(advisor, null).map((t) => t.id)).toContain("personnel");
  });

  it("gates the warehouse shipping tile on the /sevk module", () => {
    const warehouse = { role: "warehouse", permissions: { "/sevk": "edit" } };
    expect(visibleQuickTiles(warehouse, null).map((t) => t.id)).toContain("sevk");
    const accountant = { role: "accountant", permissions: { "/sevk": "none" } };
    expect(visibleQuickTiles(accountant, null).map((t) => t.id)).not.toContain("sevk");
    expect(visibleQuickTiles({ role: "admin" }, { modules: { "/sevk": false } }).map((t) => t.id)).not.toContain("sevk");
  });

});

describe("splitNotificationsTile", () => {
  it("pulls the notifications tile out of the grid for the wide panel", () => {
    const all = visibleQuickTiles({ role: "admin" }, null);
    const { tiles, notifications } = splitNotificationsTile(all);
    expect(notifications?.href).toBe("/notifications");
    expect(tiles.map((t) => t.id)).not.toContain("notifications");
    expect(tiles).toHaveLength(all.length - 1);
  });

  it("returns no panel when the tile is filtered out", () => {
    expect(splitNotificationsTile([]).notifications).toBeNull();
  });
});

describe("resolveMobilePath", () => {
  it("maps dashboard task paths onto mobile routes", () => {
    expect(resolveMobilePath("/invoices")).toBe("/invoices");
    expect(resolveMobilePath("/stock")).toBe("/stok");
    expect(resolveMobilePath("/personnel")).toBe("/personnel");
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
