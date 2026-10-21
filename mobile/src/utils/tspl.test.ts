import {
  barcodeSymbology,
  buildProductLabel,
  buildShipmentBatch,
  buildShipmentLabel,
  buildTemplateLabel,
  buildTestLabel,
  buildWorkOrderLabel,
  ean13CheckDigit,
  encodeWindows1254,
  formatMeasure,
  isValidEan13,
  mmToDots,
  renderTextBitmap,
  workOrderQr,
} from "./tspl";

const size = { widthMm: 100, heightMm: 50, gapMm: 2, dpi: 203 as const };

describe("tspl geometry and barcode", () => {
  it("converts millimetres to 203 dpi dots", () => {
    expect(mmToDots(25.4, 203)).toBe(203);
    expect(mmToDots(25.4, 300)).toBe(300);
  });

  it("detects EAN13 and CODE128", () => {
    const body = "869012345678";
    const ean = body + ean13CheckDigit(body);
    expect(isValidEan13(ean)).toBe(true);
    expect(barcodeSymbology(ean)).toEqual({ kind: "EAN13", data: ean });
    expect(barcodeSymbology(body)?.kind).toBe("EAN13");
    expect(barcodeSymbology("DL-120")?.kind).toBe("128");
    expect(barcodeSymbology("8690123456780")).toMatchObject({ kind: "128" });
  });
});

describe("product label", () => {
  it("prints name, sku, CODE128 and optional price", () => {
    const job = buildProductLabel({
      name: "Profil",
      sku: "DL120",
      barcode: "DL-120",
      price: 12.5,
      copies: 2,
      size,
    });
    expect(job.source).toContain("SIZE 100 mm,50 mm");
    expect(job.source).toContain("GAP 2 mm,0 mm");
    expect(job.source).toContain("CODEPAGE 1254");
    expect(job.source).toContain("Profil");
    expect(job.source).toContain("DL120");
    expect(job.source).toContain('"128"');
    expect(job.source).toContain("12.50 TL");
    expect(job.source).toContain("PRINT 2,1");
  });

  it("uses EAN13 and omits price when asked", () => {
    const body = "400638133393";
    const ean = body + ean13CheckDigit(body);
    const job = buildProductLabel({
      name: "Cam",
      sku: "C1",
      barcode: ean,
      price: 9,
      includePrice: false,
      size,
    });
    expect(job.source).toContain('"EAN13"');
    expect(job.source).toContain(ean);
    expect(job.source).not.toContain("9.00 TL");
  });

  it("encodes Turkish text as Windows-1254", () => {
    const job = buildProductLabel({
      name: "Şişe",
      sku: "S1",
      barcode: "ABC",
      size,
    });
    expect(job.source).toContain("Şişe");
    const encoded = encodeWindows1254("Şişe");
    expect(Array.from(encoded || [])).toEqual([0xde, 0x69, 0xfe, 0x65]);
    expect(Array.from(job.bytes)).toEqual(expect.arrayContaining([0xde, 0xfe]));
    expect(job.bytes.includes(0xc3)).toBe(false);
  });

  it("can draw text as BITMAP", () => {
    const job = buildProductLabel({
      name: "ÇĞİÖŞÜ",
      sku: "TR",
      barcode: "ABC",
      size,
      textMode: "bitmap",
    });
    expect(job.source).toContain("BITMAP");
    expect(job.source).not.toContain('TEXT ');
    const bmp = renderTextBitmap("A");
    expect(bmp.data.some((b) => b !== 0)).toBe(true);
    expect(job.bytes.length).toBeGreaterThan(job.source.length / 2);
  });
});

describe("template label", () => {
  const stock = {
    width_mm: 60,
    height_mm: 40,
    elements: [
      { type: "field", field: "name", x: 2, y: 1.5, font: 10 },
      { type: "field", field: "price", x: 30, y: 2, font: 12 },
      { type: "barcode", x: 2, y: 9, h: 12, showText: true },
      { type: "qr", x: 40, y: 4 },
    ],
  };

  it("places template elements at the template size", () => {
    const job = buildTemplateLabel({
      product: {
        name: "Şişe",
        sku: "S1",
        barcode: "DL-120",
        sale_price: 12.5,
        vat_rate: 20,
        price_includes_vat: false,
      },
      tpl: stock,
      copies: 2,
      size: { widthMm: 100, heightMm: 50, gapMm: 2, dpi: 203 },
      textMode: "codepage",
    });
    expect(job.source).toContain("SIZE 60 mm,40 mm");
    expect(job.source).not.toContain("SIZE 100 mm,50 mm");
    expect(job.source).toContain("CODEPAGE 1254");
    expect(job.source).toContain("Şişe");
    expect(job.source).toContain("15.00 TL");
    expect(job.source).toContain('"128"');
    expect(job.source).toContain("DL-120");
    expect(job.source).toContain("QRCODE ");
    expect(job.source).toContain("PRINT 2,1");
    const encoded = encodeWindows1254("Şişe");
    expect(Array.from(job.bytes)).toEqual(expect.arrayContaining(Array.from(encoded || [])));
  });

  it("draws template text as BITMAP when textMode is bitmap", () => {
    const job = buildTemplateLabel({
      product: { name: "ÇĞİÖŞÜ", sku: "TR", barcode: "ABC" },
      tpl: { width_mm: 50, height_mm: 30, elements: [{ type: "field", field: "name", x: 2, y: 2, font: 10 }] },
      size,
      textMode: "bitmap",
    });
    expect(job.source).toContain("SIZE 50 mm,30 mm");
    expect(job.source).toContain("BITMAP");
    expect(job.source).not.toContain("TEXT ");
  });
});

describe("work order and shipment labels", () => {
  it("prints work order fields and a QR", () => {
    const job = buildWorkOrderLabel({
      workOrderNo: "URT-14",
      customer: "Ayşe Yılmaz",
      partName: "Kapak",
      measure: "720 × 400 mm",
      qr: workOrderQr("URT-14", "wo1"),
      copies: 1,
      size,
    });
    expect(job.source).toContain("URT-14");
    expect(job.source).toContain("Ayşe Yılmaz");
    expect(job.source).toContain("Kapak");
    expect(job.source).toContain("720 × 400 mm");
    expect(job.source).toContain('QRCODE ');
    expect(job.source).toContain("WO:URT-14:wo1");
    expect(job.source).toContain("PRINT 1,1");
  });

  it("prints shipment package x/y and a QR for each box", () => {
    const one = buildShipmentLabel({
      orderNo: "SIP-9",
      customer: "Demir Ltd",
      address: "Atatürk Cad. No:5 Çankaya",
      packageIndex: 2,
      packageTotal: 4,
      qr: "SEVK:SIP-9:2/4",
      size,
    });
    expect(one.source).toContain("SIP-9");
    expect(one.source).toContain("Demir Ltd");
    expect(one.source).toContain("Çankaya");
    expect(one.source).toContain("Koli 2/4");
    expect(one.source).toContain("QRCODE ");
    const batch = buildShipmentBatch({
      orderNo: "SIP-9",
      customer: "Demir Ltd",
      address: "Atatürk Cad.",
      packageTotal: 2,
      size,
    });
    expect(batch.source).toContain("Koli 1/2");
    expect(batch.source).toContain("Koli 2/2");
    expect(batch.source.match(/PRINT 1,1/g)?.length).toBe(2);
  });

  it("test label includes printer identity and Turkish sample", () => {
    const job = buildTestLabel({
      name: "Depo XP-490B",
      host: "192.168.1.117",
      port: 9100,
      size,
    });
    expect(job.source).toContain("TEST");
    expect(job.source).toContain("192.168.1.117:9100");
    expect(job.source).toContain("ÇĞİÖŞÜ çğıöşü");
    expect(job.source).toContain("CODEPAGE 1254");
    const sample = encodeWindows1254("ÇĞİÖŞÜçğıöşü");
    expect(sample).not.toBeNull();
    expect(Array.from(sample || [])).toEqual([
      0xc7, 0xd0, 0xdd, 0xd6, 0xde, 0xdc, 0xe7, 0xf0, 0xfd, 0xf6, 0xfe, 0xfc,
    ]);
  });
});

describe("formatMeasure", () => {
  it("prefers an explicit size, then dimensions, then a measured note", () => {
    expect(formatMeasure({ dimensions: "80x40", length: 1 })).toBe("80x40");
    expect(formatMeasure({ length: 72, width: 40, height: 1.8 })).toBe("72 × 40 × 1.8");
    expect(formatMeasure({ step_note: "Kesim 720 x 400 mm" })).toBe("Kesim 720 x 400 mm");
    expect(formatMeasure({ step_note: "Kenar bant beyaz" })).toBe("");
  });
});
