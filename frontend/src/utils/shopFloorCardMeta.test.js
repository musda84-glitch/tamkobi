import {
  PROJECT_NEUTRAL,
  PROJECT_PALETTE,
  STATION_PALETTE,
  cardTags,
  cardTitle,
  matchesLinkFilter,
  normalizeShopfloorFilters,
  projectColor,
  projectFilterLabel,
  recipeFilterLabel,
  stationBannerColor,
  stationColor,
  workOrderListQuery,
} from "./shopFloorCardMeta";

const COOL_IDS = STATION_PALETTE.map((item) => item.id);
const WARM_IDS = PROJECT_PALETTE.map((item) => item.id);

describe("stationColor", () => {
  test("mockup paleti: Kesim mor, Montaj yeşil, proje sıcak ton", () => {
    expect(stationColor("Kesim istasyonu").bg).toBe("#6d28d9");
    expect(stationColor("Montaj istasyonu").bg).toBe("#0f766e");
    expect(stationColor("Kesim istasyonu").fg).toBe("#ffffff");
    expect(projectColor("prj-0001").stripe).toBe("hsl(330 70% 38%)");
    expect(projectColor("prj-0002").stripe).toBe("hsl(80 70% 38%)");
    expect(projectColor("prj-0001").id).not.toBe(stationColor("Kesim istasyonu").id);
  });

  test("aynı istasyon adı her zaman aynı soğuk rengi verir", () => {
    const names = ["CNC", "Montaj", "Kesim", "Delik", "Kenar Bant", "Paketleme", "HOLZHER", ""];
    names.forEach((name) => {
      const color = stationColor(name);
      expect(stationColor(name)).toEqual(color);
      expect(COOL_IDS).toContain(color.id);
      expect(STATION_PALETTE).toContainEqual(color);
      expect(color.className).toMatch(/^bg-/);
      expect(color.bg).toMatch(/^#/);
    });
    expect(stationColor("  CNC  ")).toEqual(stationColor("cnc"));
  });

  test("soğuk palet sıcak paletle çakışmaz", () => {
    const cool = new Set(STATION_PALETTE.flatMap((item) => [item.id, item.bg, item.fg]));
    PROJECT_PALETTE.forEach((item) => {
      expect(cool.has(item.id)).toBe(false);
      expect(cool.has(item.stripe)).toBe(false);
    });
    expect(cool.has(PROJECT_NEUTRAL.stripe)).toBe(false);
  });
});

describe("projectColor", () => {
  test("aynı proje kimliği sabit sıcak renk, projesiz nötr gri", () => {
    const color = projectColor("prj-14");
    expect(projectColor("prj-14")).toEqual(color);
    expect(WARM_IDS).toContain(color.id);
    expect(PROJECT_PALETTE).toContainEqual(color);
    expect(projectColor("")).toEqual(PROJECT_NEUTRAL);
    expect(projectColor(null)).toEqual(PROJECT_NEUTRAL);
    expect(projectColor("none")).toEqual(PROJECT_NEUTRAL);
    expect(projectColor(" NONE ")).toEqual(PROJECT_NEUTRAL);
    expect(PROJECT_NEUTRAL.stripe).toBe("#cbd5e1");
    expect(WARM_IDS).not.toContain(PROJECT_NEUTRAL.id);
  });
});

describe("stationBannerColor", () => {
  test("istasyon bandı istasyon rengidir, istasyonsuz nötrdür", () => {
    expect(stationBannerColor("CNC", "cnc")).toEqual(stationColor("CNC"));
    expect(stationBannerColor("İstasyonsuz", "_none").id).toBe("neutral");
    expect(stationBannerColor("", "_none").className).toMatch(/bg-slate-100/);
  });
});

describe("cardTitle", () => {
  test("reçete adı büyük başlık olur, yoksa adım sonra ürün adına düşer", () => {
    expect(cardTitle({ recipe_name: "Mutfak Dolabı", product_name: "Gövde", step_name: "Kesim" })).toMatchObject({
      text: "Mutfak Dolabı",
      source: "recipe",
    });
    expect(cardTitle({ product_name: "Safir meşe kapak takımı", step_name: "Panel kenar" })).toMatchObject({
      text: "Panel kenar",
      source: "step",
    });
    expect(cardTitle({ product_name: "Gardrop", step_name: "  " })).toMatchObject({
      text: "Gardrop",
      source: "product",
    });
  });
});

describe("cardTags", () => {
  test("proje, sipariş ve müşteri etiketlerini üretir", () => {
    expect(cardTags({
      project_number: "PRJ-014",
      project_name: "Villa Mutfak",
      sales_order_no: "SIP-1042",
      customer_name: "Ahmet Yılmaz",
    })).toEqual([
      { kind: "project", label: "PRJ-014 · Villa Mutfak" },
      { kind: "order", label: "SIP-1042" },
      { kind: "customer", label: "Ahmet Yılmaz" },
    ]);
  });

  test("boş alanları atlar, proje adı yoksa numaraya düşer", () => {
    expect(cardTags({
      project_number: "PRJ-008",
      project_name: "",
      sales_order_no: "  ",
      customer_name: null,
    })).toEqual([{ kind: "project", label: "PRJ-008" }]);
    expect(cardTags({ project_name: "Ofis", project_number: "" })).toEqual([{ kind: "project", label: "Ofis" }]);
    expect(cardTags({})).toEqual([]);
    expect(JSON.stringify(cardTags({ project_number: "", sales_order_no: "", customer_name: " " }))).not.toContain("—");
  });
});

describe("shopfloor filter labels", () => {
  test("iş sayısını gösterir, projesiz seçeneği none kimliğidir", () => {
    expect(projectFilterLabel({
      project_id: "p14",
      project_number: "PRJ-014",
      project_name: "Villa Mutfak",
      job_count: 3,
    })).toBe("PRJ-014 · Villa Mutfak (3)");
    expect(projectFilterLabel({ project_id: "none", job_count: 1 })).toBe("Projesiz (1)");
    expect(recipeFilterLabel({ recipe_id: "r1", recipe_name: "Mutfak Dolabı", job_count: 2 })).toBe("Mutfak Dolabı (2)");
    expect(normalizeShopfloorFilters([{ project_id: "x" }])).toEqual({ projects: [], recipes: [] });
    expect(normalizeShopfloorFilters({
      projects: [{ project_id: "none", job_count: 1 }, { project_id: "" }],
      recipes: [{ recipe_id: "r1", recipe_name: "Gardrop", job_count: 2 }],
    }).projects.map((row) => row.project_id)).toEqual(["none"]);
  });

  test("liste sorgusu proje ve reçeteyi taşır", () => {
    expect(workOrderListQuery({
      companyId: "c1",
      station: "CNC",
      projectId: "none",
      recipeId: "r 1",
      bust: "_=1",
    })).toBe("company_id=c1&station=CNC&project_id=none&recipe_id=r%201&_=1");
    expect(matchesLinkFilter({ project_id: "", recipe_id: "r1" }, "none", "r1")).toBe(true);
    expect(matchesLinkFilter({ project_id: "p1" }, "none", "")).toBe(false);
    expect(matchesLinkFilter({ project_id: "p1", recipe_id: "r2" }, "p1", "r1")).toBe(false);
    expect(matchesLinkFilter({ project_id: "p1", recipe_id: "r1" }, "", "")).toBe(true);
  });
});
