import { emptyLine } from "./documentLines";
import {
  applyLineNameDraft,
  fetchLineProductHits,
  fillInvoiceLineFromProduct,
  fillWorkItemFromProduct,
  findCatalogByScan,
  findCatalogProduct,
  lineBarcodeLookupRequest,
  lineProductAddNewAction,
  lineProductDetailRequest,
  lineProductHitMeta,
  lineProductHitPrice,
  lineProductNeedsHydrate,
  lineProductSearchEnabled,
  lineProductSearchQuery,
  lineProductSearchRequest,
  LINE_PRODUCT_SEARCH_DEBOUNCE_MS,
  LINE_PRODUCT_SEARCH_MIN_CHARS,
  mergeLineProductHits,
  productsFromSearchPayload,
  shouldShowLineProductHits,
} from "./lineProductSearch";
import { emptyItem, quotePayload } from "./workDocs";

const catalog = [
  {
    id: "p1",
    name: "Dekorasyon Profili",
    sku: "DL120",
    barcode: "8680001",
    stock_quantity: 14,
    sale_price: 1250,
    unit: "Adet",
    vat_rate: 20,
    image_url: "/api/files/profil.jpg",
  },
  {
    id: "p2",
    name: "Kapı kolu",
    sku: "KK-1",
    barcode: "111",
    stock_quantity: 3,
    sale_price: 80,
    unit: "Adet",
    vat_rate: 10,
  },
];

describe("line product name search", () => {
  it("searches stock only for Ürün lines with at least 2 characters", () => {
    expect(LINE_PRODUCT_SEARCH_MIN_CHARS).toBe(2);
    expect(LINE_PRODUCT_SEARCH_DEBOUNCE_MS).toBe(300);
    expect(lineProductSearchEnabled(false)).toBe(true);
    expect(lineProductSearchEnabled(true)).toBe(false);
    expect(lineProductSearchQuery("D", false)).toBeNull();
    expect(lineProductSearchQuery("de", false)).toBe("de");
    expect(lineProductSearchQuery("dekor", true)).toBeNull();
    expect(lineProductSearchQuery("  DL120  ", false)).toBe("DL120");
  });

  it("calls the existing product search API by name, SKU and barcode", async () => {
    const req = lineProductSearchRequest("comp_1", "DL120");
    expect(req).toEqual({ path: "/search", query: { q: "DL120", company_id: "comp_1" } });
    expect(lineProductDetailRequest("p1").path).toBe("/products/p1");
    expect(lineBarcodeLookupRequest("comp_1", "8680001")).toEqual({
      path: "/products/barcode/8680001",
      query: { company_id: "comp_1" },
    });

    const calls: Array<{ path: string; query?: Record<string, string> }> = [];
    const hits = await fetchLineProductHits({
      companyId: "comp_1",
      query: "profil",
      catalog,
      search: async (path, query) => {
        calls.push({ path, query });
        return {
          products: [
            { id: "p1", name: "Dekorasyon Profili", sku: "DL120", stock_quantity: 14, sale_price: 1250 },
            { id: "p9", name: "Profil tapa", sku: "TP-1", stock_quantity: 40, sale_price: 5 },
          ],
        };
      },
    });
    expect(calls).toEqual([{ path: "/search", query: { q: "profil", company_id: "comp_1" } }]);
    expect(hits.map((p) => p.id)).toEqual(["p1", "p9"]);
    expect(lineProductHitMeta(hits[0])).toContain("SKU DL120");
    expect(lineProductHitMeta(hits[0])).toContain("Stok 14");
    expect(lineProductHitPrice(hits[0])).toContain("1.250,00");
    expect(shouldShowLineProductHits({ query: "profil", hits })).toBe(true);
    expect(shouldShowLineProductHits({ query: "profil", isService: true, hits })).toBe(false);
    expect(shouldShowLineProductHits({ query: "p", hits })).toBe(false);
    expect(shouldShowLineProductHits({ query: "profil", hits: [], focused: true })).toBe(false);
  });

  it("does not search when Hizmet is selected", async () => {
    const search = jest.fn();
    const hits = await fetchLineProductHits({
      companyId: "comp_1",
      query: "montaj",
      catalog,
      isService: true,
      search,
    });
    expect(search).not.toHaveBeenCalled();
    expect(hits).toEqual([]);
    expect(lineProductAddNewAction()).toBeNull();
  });

  it("fills the quote line from a selected product and persists product_id", () => {
    const row = fillWorkItemFromProduct(
      { ...emptyItem(), quantity: 3, description: "Kesim" },
      catalog[0],
    );
    expect(row).toMatchObject({
      product_id: "p1",
      name: "Dekorasyon Profili",
      unit: "Adet",
      unit_price: 1250,
      vat_rate: 20,
      quantity: 3,
      description: "Kesim",
      is_service: false,
      image_url: "/api/files/profil.jpg",
    });
    const saved = quotePayload("comp", { contact_id: "c1", contact_name: "Acme", title: "T", valid_until: "", notes: "" }, [row]);
    expect(saved.items[0].product_id).toBe("p1");
    expect(lineProductNeedsHydrate(catalog[0])).toBe(false);
    expect(lineProductNeedsHydrate({ id: "p1", name: "X", sku: "S", sale_price: 1, stock_quantity: 2 })).toBe(true);
  });

  it("fills an invoice/sales line from a selected product", () => {
    const row = fillInvoiceLineFromProduct(
      { ...emptyLine(), quantity: 2, discount_rate: 10 },
      catalog[1],
      "sales",
    );
    expect(row.product_id).toBe("p2");
    expect(row.name).toBe("Kapı kolu");
    expect(row.unit).toBe("Adet");
    expect(row.unit_price).toBe(80);
    expect(row.vat_rate).toBe(10);
    expect(row.quantity).toBe(2);
    expect(row.is_service).toBe(false);
    expect(row.discount_rate).toBe(10);
  });

  it("keeps free text when the typed name is missing from the list", () => {
    const drafted = applyLineNameDraft({ ...emptyItem(), name: "", product_id: "" }, "Özel kesim profil");
    expect(drafted.name).toBe("Özel kesim profil");
    expect(drafted.product_id).toBe("");
    const cleared = applyLineNameDraft({ ...emptyItem(), name: "Dekorasyon Profili", product_id: "p1" }, "Dekorasyon Profili özel");
    expect(cleared.product_id).toBe("");
    expect(cleared.name).toBe("Dekorasyon Profili özel");
    expect(mergeLineProductHits(catalog, [], { excludeId: "p1" }).map((p) => p.id)).toEqual(["p2"]);
    expect(productsFromSearchPayload({ products: catalog }).map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(findCatalogProduct(catalog, "p2")?.sku).toBe("KK-1");
    expect(findCatalogByScan(catalog, "8680001")?.id).toBe("p1");
    expect(findCatalogByScan(catalog, "KK-1")?.id).toBe("p2");
  });

  it("falls back to local catalog when the search API fails", async () => {
    const hits = await fetchLineProductHits({
      companyId: "comp_1",
      query: "kolu",
      catalog,
      search: async () => {
        throw new Error("offline");
      },
    });
    expect(hits.map((p) => p.id)).toEqual(["p2"]);
  });
});
