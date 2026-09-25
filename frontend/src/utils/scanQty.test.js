import { parseScanQtyInput, scanQtyOnBlur, scanQtyOnFocus, scanQtyShown, parseBarcodeWithQty } from "./scanQty";

describe("scanQty draft", () => {
  test("clears on focus and restores 1 on empty blur", () => {
    expect(scanQtyShown(undefined)).toBe("1");
    expect(scanQtyShown("")).toBe("");
    expect(scanQtyShown("12")).toBe("12");
    expect(scanQtyOnFocus()).toBe("");
    expect(scanQtyOnBlur("")).toBe("1");
    expect(scanQtyOnBlur("8")).toBe("8");
    expect(parseScanQtyInput("")).toBe(1);
  });
});

describe("parseBarcodeWithQty", () => {
  test("parses multiplier prefixes", () => {
    expect(parseBarcodeWithQty("5*8690123456789")).toEqual({ barcode: "8690123456789", quantity: 5 });
    expect(parseBarcodeWithQty("3xSKU-1")).toEqual({ barcode: "SKU-1", quantity: 3 });
    expect(parseBarcodeWithQty("12×abc")).toEqual({ barcode: "abc", quantity: 12 });
    expect(parseBarcodeWithQty("2 * 8690")).toEqual({ barcode: "8690", quantity: 2 });
  });

  test("falls back to scan qty when no multiplier", () => {
    expect(parseBarcodeWithQty("8690123", "4")).toEqual({ barcode: "8690123", quantity: 4 });
    expect(parseBarcodeWithQty("  name  ", "")).toEqual({ barcode: "name", quantity: 1 });
  });
});
