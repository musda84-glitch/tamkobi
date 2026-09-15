import { isEan13, barcodeFormatFor } from "./barcodeFormat";

describe("barcodeFormat", () => {
  test("accepts valid EAN-13", () => {
    // 8680001234011 — check digit for 868000123401 is 1? verify with algorithm
    const base = "868000123456";
    const sum = base.split("").reduce((s, d, i) => s + Number(d) * (i % 2 ? 3 : 1), 0);
    const check = String((10 - (sum % 10)) % 10);
    const ean = base + check;
    expect(isEan13(ean)).toBe(true);
    expect(barcodeFormatFor(ean)).toBe("EAN13");
  });

  test("rejects bad check digit and non-digit codes", () => {
    expect(isEan13("8680001234560")).toBe(false);
    expect(barcodeFormatFor("NX202600000104")).toBe("CODE128");
    expect(barcodeFormatFor("ABC-123")).toBe("CODE128");
  });
});
