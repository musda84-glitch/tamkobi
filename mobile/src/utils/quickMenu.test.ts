import { hrefNav, QUICK_TILES, QUICK_TONE_COLORS, resolveMobilePath, splitHref, splitNotificationsTile, visibleQuickTiles } from "./quickMenu";

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
    expect(tiles.map((t) => t.id)).toEqual(QUICK_TILES.filter((t) => !t.self).map((t) => t.id));
  });

  it("hides modules the role or license blocks", () => {
    const user = { role: "sales", permissions: { "/banking": "none", "/stock": "view", "/invoices": "view" } };
    const tiles = visibleQuickTiles(user, { modules: { "/cheques": false, "/stock": true } });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain("banking");
    expect(ids).not.toContain("pay");
    expect(ids).not.toContain("cheques");
    expect(ids).toContain("stock");
    expect(ids).toContain("barcode");
    expect(ids).toContain("notifications");
  });

  it("keeps tab bar entries out of the quick menu; settings is opt-in only", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    for (const id of ["saha", "mesai", "personelim", "search"]) {
      expect(ids).not.toContain(id);
    }
    expect(QUICK_TILES.find((t) => t.id === "settings")).toMatchObject({ optIn: true });
    expect(ids).toContain("banking");
    expect(ids).toContain("pay");
  });

  it("places Tahsilat & Ödeme after Banka & Kasa and requires banking edit", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    expect(ids.indexOf("pay")).toBe(ids.indexOf("banking") + 1);
    expect(QUICK_TILES.find((t) => t.id === "pay")).toMatchObject({
      label: "Tahsilat & Ödeme",
      href: "/pay",
      path: "/banking",
      needsEdit: true,
    });
    const viewer = { role: "accountant", permissions: { "/banking": "view" } };
    expect(visibleQuickTiles(viewer, null).map((t) => t.id)).toContain("banking");
    expect(visibleQuickTiles(viewer, null).map((t) => t.id)).not.toContain("pay");
    const cashier = { role: "accountant", permissions: { "/banking": "edit" } };
    expect(visibleQuickTiles(cashier, null).map((t) => t.id)).toContain("pay");
  });

  it("offers installments / stock count / production as opt-in home tiles", () => {
    const byId = Object.fromEntries(QUICK_TILES.map((t) => [t.id, t]));
    expect(byId.installments).toMatchObject({ optIn: true, href: "/installments" });
    expect(byId.sayim).toMatchObject({ optIn: true, href: "/sayim" });
    expect(byId.production).toMatchObject({ optIn: true, href: "/production" });
    expect(byId.settings).toMatchObject({ optIn: true, href: "/settings" });
    expect(resolveMobilePath("/installments")).toBe("/installments");
    expect(resolveMobilePath("/sayim")).toBe("/sayim");
  });

  it("routes dashboard task paths that now have mobile screens", () => {
    expect(resolveMobilePath("/installments")).toBe("/installments");
    expect(resolveMobilePath("/cheques")).toBe("/cheques");
  });

  it("hides Personel & Bordro unless the role grants /personnel", () => {
    const production = { role: "production", permissions: { "/mesai": "view", "/production": "edit", "/stock": "none" } };
    expect(visibleQuickTiles(production, { modules: { "/mesai": true } }).map((t) => t.id)).not.toContain("personnel");
    expect(visibleQuickTiles(production, { modules: { "/mesai": true } }).map((t) => t.id)).not.toContain("stock");
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

  it("keeps Özet labels short enough for the equal-height 4-column grid", () => {
    const labels = Object.fromEntries(QUICK_TILES.map((t) => [t.id, t.label]));
    expect(labels).toMatchObject({
      banking: "Banka & Kasa",
      pay: "Tahsilat & Ödeme",
      cheques: "Çek",
      sevk: "Sipariş Hazırla",
      vehicles: "Araçlarım",
      atolye: "Atölye Ekranı",
      personnel: "Personel",
      edoc: "Gelen e-Fatura",
    });
  });

  it("places Gelen e-Fatura after Faturalar and gates it on /edoc-inbox", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    expect(ids.indexOf("edoc")).toBe(ids.indexOf("invoices") + 1);
    expect(QUICK_TILES.find((t) => t.id === "edoc")).toMatchObject({
      label: "Gelen e-Fatura",
      path: "/edoc-inbox",
      href: "/edoc-inbox",
    });
    const accountant = { role: "accountant", permissions: { "/edoc-inbox": "edit", "/invoices": "edit" } };
    expect(visibleQuickTiles(accountant, null).map((t) => t.id)).toContain("edoc");
    const warehouse = { role: "warehouse", permissions: { "/edoc-inbox": "none", "/invoices": "none" } };
    expect(visibleQuickTiles(warehouse, null).map((t) => t.id)).not.toContain("edoc");
    expect(visibleQuickTiles({ role: "admin" }, { modules: { "/edoc-inbox": false } }).map((t) => t.id)).not.toContain("edoc");
  });

  it("places Görevlerim after opt-in production tiles for linked staff", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    expect(ids.indexOf("my_tasks")).toBe(ids.indexOf("installments") + 1);
    expect(QUICK_TILES.find((t) => t.id === "my_tasks")).toMatchObject({
      label: "Görevlerim",
      href: "/personelim?tab=gorevler",
      self: true,
    });
    const staff = { role: "personel", employee_id: "e1", permissions: { "/mesai": "edit", "/atolye": "edit" } };
    expect(visibleQuickTiles(staff, { modules: { "/mesai": true } }).map((t) => t.id)).toContain("my_tasks");
    expect(visibleQuickTiles({ role: "personel", permissions: { "/mesai": "edit" } }, null).map((t) => t.id)).not.toContain("my_tasks");
    expect(visibleQuickTiles({ role: "admin" }, null).map((t) => t.id)).not.toContain("my_tasks");
  });

  it("places Araçlarım after Sevkiyat and Atölye after vehicles", () => {
    const ids = QUICK_TILES.map((t) => t.id);
    expect(ids.indexOf("vehicles")).toBe(ids.indexOf("sevk") + 1);
    expect(ids.indexOf("atolye")).toBe(ids.indexOf("vehicles") + 1);
    expect(QUICK_TILES.find((t) => t.id === "vehicles")).toMatchObject({
      label: "Araçlarım",
      path: "/vehicles",
      href: "/vehicles",
    });
    expect(QUICK_TILES.find((t) => t.id === "atolye")).toMatchObject({
      label: "Atölye Ekranı",
      path: "/atolye",
      href: "/atolye",
    });
    const production = { role: "production", permissions: { "/atolye": "edit", "/production": "edit", "/stock": "none" } };
    expect(visibleQuickTiles(production, null).map((t) => t.id)).toContain("atolye");
    expect(visibleQuickTiles(production, null).map((t) => t.id)).not.toContain("stock");
    expect(visibleQuickTiles(production, null).map((t) => t.id)).not.toContain("barcode");
    const personel = { role: "personel", permissions: { "/mesai": "edit", "/atolye": "edit", "/stock": "none" } };
    expect(visibleQuickTiles(personel, null).map((t) => t.id)).toContain("atolye");
    expect(visibleQuickTiles(personel, null).map((t) => t.id)).not.toContain("stock");
    const accountant = { role: "accountant", permissions: { "/atolye": "none" } };
    expect(visibleQuickTiles(accountant, null).map((t) => t.id)).not.toContain("atolye");
    expect(visibleQuickTiles({ role: "admin" }, { modules: { "/atolye": false } }).map((t) => t.id)).not.toContain("atolye");
  });

  it("gates Araçlarım on the /vehicles module", () => {
    const warehouse = { role: "warehouse", permissions: { "/vehicles": "edit" } };
    expect(visibleQuickTiles(warehouse, null).map((t) => t.id)).toContain("vehicles");
    expect(visibleQuickTiles({ role: "admin" }, { modules: { "/vehicles": false } }).map((t) => t.id)).not.toContain("vehicles");
    expect(resolveMobilePath("/vehicles")).toBe("/vehicles");
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
    expect(resolveMobilePath("/edoc-inbox")).toBe("/edoc-inbox");
    expect(resolveMobilePath("/stock")).toBe("/stok");
    expect(resolveMobilePath("/sayim")).toBe("/sayim");
    expect(resolveMobilePath("/personnel")).toBe("/personnel");
    expect(resolveMobilePath("/sevk")).toBe("/sevk");
    expect(resolveMobilePath("/atolye")).toBe("/atolye");
    expect(resolveMobilePath("/production")).toBe("/production");
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

describe("hrefNav", () => {
  it("switches the Stok tab instead of pushing a new stack screen", () => {
    expect(hrefNav("/stok")).toEqual({ method: "navigate", target: "/stok" });
    expect(hrefNav("/stok?scan=1")).toEqual({ method: "navigate", target: { pathname: "/stok", params: { scan: "1" } } });
  });

  it("still pushes stack modules", () => {
    expect(hrefNav("/invoices")).toEqual({ method: "push", target: "/invoices" });
    expect(hrefNav("/stock/new")).toEqual({ method: "push", target: "/stock/new" });
  });
});
