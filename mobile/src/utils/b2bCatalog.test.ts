import { canAddProduct, catalogCategories, categorySelectGroups, filterCatalog, hasListDiscount, normalizeScanText, parseDraftQty, qtyDraftOnBlur, qtyDraftOnFocus, qtyDraftShown } from "./b2bCatalog";

const p = (over: Record<string, unknown> = {}) => ({
  id: "1",
  name: "Kiler Rafı",
  sku: "KLM",
  barcode: "869",
  category: "Raf",
  tags: ["beyaz"],
  in_stock: true,
  price: 100,
  list_price: 120,
  vat_rate: 20,
  price_includes_vat: true,
  ...over,
});

describe("catalogCategories", () => {
  it("prefixes Tümü and drops blanks", () => {
    expect(catalogCategories([p(), p({ category: "Masa" }), p({ category: "  " })])).toEqual(["all", "Raf", "Masa"]);
  });
});

describe("categorySelectGroups", () => {
  it("groups Tümü separately from named categories", () => {
    const groups = categorySelectGroups([p(), p({ category: "Masa" })]);
    expect(groups[0]).toEqual({ label: "Filtre", options: [{ value: "all", label: "Tümü" }] });
    expect(groups[1].label).toBe("Kategoriler");
    expect(groups[1].options.map((o) => o.value)).toEqual(["Raf", "Masa"]);
  });
});

describe("normalizeScanText", () => {
  it("strips GS1 prefixes", () => {
    expect(normalizeScanText(" ]C18690001234567 ")).toBe("8690001234567");
    expect(normalizeScanText("")).toBe("");
  });
});

describe("filterCatalog", () => {
  it("filters by category and query", () => {
    const rows = [p(), p({ id: "2", name: "Masa", category: "Masa", tags: [] })];
    expect(filterCatalog(rows, "", "Raf").map((x) => x.id)).toEqual(["1"]);
    expect(filterCatalog(rows, "masa", "all").map((x) => x.id)).toEqual(["2"]);
  });
});

describe("parseDraftQty / canAddProduct", () => {
  it("keeps a minimum of 1", () => {
    expect(parseDraftQty("")).toBe(1);
    expect(parseDraftQty("3")).toBe(3);
    expect(parseDraftQty("x")).toBe(1);
  });

  it("clears the qty field on focus and restores 1 on empty blur", () => {
    expect(qtyDraftShown({}, "p1")).toBe("1");
    expect(qtyDraftShown({ p1: "" }, "p1")).toBe("");
    expect(qtyDraftShown({ p1: "12" }, "p1")).toBe("12");
    expect(qtyDraftOnFocus()).toBe("");
    expect(qtyDraftOnBlur("")).toBe("1");
    expect(qtyDraftOnBlur("8")).toBe("8");
  });

  it("blocks out-of-stock when stock is shown", () => {
    expect(canAddProduct(p({ in_stock: false }), true, true)).toBe(false);
    expect(canAddProduct(p({ in_stock: false }), false, true)).toBe(true);
    expect(canAddProduct(p(), true, false)).toBe(false);
  });
});

describe("hasListDiscount", () => {
  it("compares gross sale vs list", () => {
    expect(hasListDiscount(p())).toBe(true);
    expect(hasListDiscount(p({ list_price: 100 }))).toBe(false);
  });
});
