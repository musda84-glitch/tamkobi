import { barcodeFormatFor, isEan13 } from "./barcodeFormat";
import { barcodeSvgForLabel, LABEL_PX_PER_MM } from "./barcodeSvg";
import { ean13Bits, ean13Svg } from "./ean13";
import { templateLabelCardHtml } from "./labelTemplateHtml";

describe("barcodeFormat", () => {
  test("accepts valid EAN-13 like web", () => {
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const check = String((10 - (sum % 10)) % 10);
    const ean = base + check;
    expect(isEan13(ean)).toBe(true);
    expect(barcodeFormatFor(ean)).toBe("EAN13");
  });

  test("falls back to CODE128 for SKU / bad check", () => {
    expect(isEan13("8680001234560")).toBe(false);
    expect(barcodeFormatFor("NX202600000104")).toBe("CODE128");
  });
});

describe("ean13", () => {
  test("encodes start, left, center, right, stop", () => {
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const ean = base + String((10 - (sum % 10)) % 10);
    const bits = ean13Bits(ean);
    expect(bits.startsWith("101")).toBe(true);
    expect(bits.endsWith("101")).toBe(true);
    expect(bits.includes("01010")).toBe(true);
    expect(bits.length).toBe(95);
  });

  test("renders svg for valid ean", () => {
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const ean = base + String((10 - (sum % 10)) % 10);
    const svg = ean13Svg(ean, { height: 40, moduleWidth: 2, margin: 8, displayValue: true, fontSize: 10 });
    expect(svg).toContain("<svg");
    expect(svg).toContain(ean);
    expect(svg).toContain("<rect");
  });
});

describe("barcodeSvgForLabel", () => {
  test("sizes like LabelCanvas and uses EAN13 for retail codes", () => {
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const ean = base + String((10 - (sum % 10)) % 10);
    const el = { w: 46, h: 18, showText: true };
    const svg = barcodeSvgForLabel(ean, el);
    expect(svg).toContain(ean);
    const expectedH = Math.max(10, el.h * LABEL_PX_PER_MM - 14);
    expect(svg).toContain(`height="${expectedH}"`);
  });

  test("template barcode element uses sized EAN not tiny CODE128", () => {
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const ean = base + String((10 - (sum % 10)) % 10);
    const html = templateLabelCardHtml(
      {
        width_mm: 50,
        height_mm: 30,
        elements: [{ id: "bc", type: "barcode", x: 2, y: 9, w: 46, h: 18, showText: true }],
      },
      { name: "Test", barcode: ean, sku: "SKU1" },
    );
    expect(html).toContain(ean);
    expect(html).toContain("<svg");
    // EAN-13 is 95 modules — CODE128 of same digits is much longer
    const bits = ean13Bits(ean);
    expect(bits.length).toBe(95);
  });
});
