import {
  draftFromProduct,
  emptyProductDraft,
  generateBarcode,
  generateBarcodeConfirm,
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
    expect(body.unit).toBe("Adet");
  });

  it("maps an existing product into the form", () => {
    const d = draftFromProduct({
      name: "Raf",
      sku: "R1",
      sale_price: 10,
      show_in_b2b: false,
      is_active: false,
      type: "raw_material",
      gtip: "8471.30",
      origin_country: "TR",
      manufacturer_code: "MFR-9",
    });
    expect(d.name).toBe("Raf");
    expect(d.show_in_b2b).toBe(false);
    expect(d.is_active).toBe(false);
    expect(d.type).toBe("raw_material");
    expect(d.sale_price).toBe("10");
    expect(d.gtip).toBe("8471.30");
    expect(d.origin_country).toBe("TR");
    expect(d.manufacturer_code).toBe("MFR-9");
  });

  it("includes trade identity fields in payload", () => {
    const d = emptyProductDraft();
    d.name = "Raf";
    d.sku = "RAF-1";
    d.gtip = "8471.30.00.00.00";
    d.origin_country = "CN";
    d.manufacturer_code = " ACME-1 ";
    const body = productPayload(d);
    expect(body.gtip).toBe("8471.30.00.00.00");
    expect(body.origin_country).toBe("CN");
    expect(body.manufacturer_code).toBe("ACME-1");
  });

  it("generates EAN-like 868 barcodes", () => {
    const code = generateBarcode();
    expect(code).toMatch(/^868\d{10}$/);
  });

  it("asks before generating a barcode", () => {
    expect(generateBarcodeConfirm("")).toBe("Yeni bir barkod üretilsin mi?");
    expect(generateBarcodeConfirm("8681234567890")).toContain("8681234567890");
    expect(generateBarcodeConfirm("8681234567890")).toContain("değişecek");
  });
});
