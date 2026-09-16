import {
  draftFromProduct,
  emptyProductDraft,
  generateBarcode,
  productPayload,
  validateProductDraft,
} from "./productDraft";

describe("productDraft", () => {
  it("requires name and sku", () => {
    const d = emptyProductDraft();
    expect(validateProductDraft(d)).toBe("Ürün adı gerekli.");
    d.name = "KLM-86";
    expect(validateProductDraft(d)).toBe("SKU kodu gerekli.");
    d.sku = "KLM-86_SM";
    expect(validateProductDraft(d)).toBeNull();
  });

  it("builds create payload with company and numeric fields", () => {
    const d = emptyProductDraft();
    d.name = "Raf";
    d.sku = "RAF-1";
    d.sale_price = "199,5";
    d.desi = "";
    d.length = "40";
    d.package_count = "3";
    const body = productPayload(d, "comp_1");
    expect(body.company_id).toBe("comp_1");
    expect(body.sale_price).toBe(199.5);
    expect(body.desi).toBeNull();
    expect(body.length).toBe(40);
    expect(body.package_count).toBe(3);
    expect(body.show_in_b2b).toBe(true);
    expect(body.category).toBe("Genel");
  });

  it("maps an existing product into the form", () => {
    const d = draftFromProduct({
      name: "Raf",
      sku: "R1",
      sale_price: 10,
      show_in_b2b: false,
      is_active: false,
      type: "raw_material",
    });
    expect(d.name).toBe("Raf");
    expect(d.show_in_b2b).toBe(false);
    expect(d.is_active).toBe(false);
    expect(d.type).toBe("raw_material");
    expect(d.sale_price).toBe("10");
  });

  it("generates EAN-like 868 barcodes", () => {
    const code = generateBarcode();
    expect(code).toMatch(/^868\d{10}$/);
  });
});
