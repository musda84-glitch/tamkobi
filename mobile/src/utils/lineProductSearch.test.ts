import { emptyLine } from "./documentLines";
import {
  applyLineNameDraft,
  fetchLineProductHits,
  fillInvoiceLineFromProduct,
  fillWorkItemFromProduct,
  findCatalogByScan,
  findCatalogProduct,
  findInvoiceProductByScan,
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
      { ...emptyItem(), quantity: 3, description: "Kesim", discount_rate: 10 },
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
      discount_rate: 10,
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

  it("follows invoice VAT and purchase price, including export", () => {
    const prod = {
      id: "p3",
      name: "Un",
      sale_price: 40,
      purchase_price: 20,
      last_purchase_price: 18,
      vat_rate: 1,
      unit: "Kg",
    };
    const sale = fillInvoiceLineFromProduct({ ...emptyLine(), quantity: 2 }, prod, "sales");
    expect(sale.unit_price).toBe(40);
    expect(sale.vat_rate).toBe(1);
    expect(sale.quantity).toBe(2);
    const buy = fillInvoiceLineFromProduct(emptyLine(), prod, "purchase");
    expect(buy.unit_price).toBe(18);
    expect(buy.vat_rate).toBe(1);
    const noLast = fillInvoiceLineFromProduct(emptyLine(), { id: "p6", name: "Z", sale_price: 9, purchase_price: 4 }, "purchase");
    expect(noLast.unit_price).toBe(4);
    const missingVat = fillInvoiceLineFromProduct(emptyLine(), { id: "p4", name: "Z", sale_price: 9 }, "sales");
    expect(missingVat.vat_rate).toBe(20);
    const zeroVat = fillInvoiceLineFromProduct(emptyLine(), { id: "p5", name: "Z", sale_price: 9, vat_rate: 0 }, "sales");
    expect(zeroVat.vat_rate).toBe(0);
    const exported = fillInvoiceLineFromProduct(emptyLine(), prod, "sales", { exportInvoice: true });
    expect(exported.vat_rate).toBe(0);
    expect(exported.unit_price).toBe(40);
    const variant = fillInvoiceLineFromProduct(emptyLine(), prod, "sales", {
      variant: { name: "Çuval", barcode: "868-V", sku: "UN-V", price: 22 },
    });
    expect(variant.name).toBe("Un - Çuval");
    expect(variant.unit_price).toBe(22);
    expect(variant.barcode).toBe("868-V");
    expect(variant.sku).toBe("UN-V");
    expect(variant.vat_rate).toBe(1);
  });

  it("matches a variant barcode or SKU on the invoice catalog", () => {
    const rows = [
      {
        ...catalog[0],
        variants: [
          { name: "Beyaz", barcode: "868-V", sku: "DL-V" },
        ],
      },
      catalog[1],
    ];
    expect(findInvoiceProductByScan(rows, "8680001")?.id).toBe("p1");
    expect(findInvoiceProductByScan(rows, "868-V")?.id).toBe("p1");
    expect(findInvoiceProductByScan(rows, "DL-V")?.id).toBe("p1");
    expect(findInvoiceProductByScan(rows, "111")?.id).toBe("p2");
    expect(findInvoiceProductByScan(rows, "yok")).toBeUndefined();
    expect(findCatalogByScan(rows, "868-V")).toBeUndefined();
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
