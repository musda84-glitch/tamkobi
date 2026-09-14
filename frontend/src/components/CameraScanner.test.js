import { Html5QrcodeSupportedFormats } from "html5-qrcode";
import { SCAN_FORMATS, normalizeScanText } from "./CameraScanner";

describe("CameraScanner helpers", () => {
  test("normalizeScanText trims and strips GS1 prefixes", () => {
    expect(normalizeScanText("  8690123456789  ")).toBe("8690123456789");
    expect(normalizeScanText("]C18690123456789")).toBe("8690123456789");
    expect(normalizeScanText(null)).toBe("");
    expect(normalizeScanText(undefined)).toBe("");
  });

  test("SCAN_FORMATS includes retail 1D barcodes and QR family", () => {
    const set = new Set(SCAN_FORMATS);
    expect(set.has(Html5QrcodeSupportedFormats.EAN_13)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.EAN_8)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.CODE_128)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.CODE_39)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.UPC_A)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.QR_CODE)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.DATA_MATRIX)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.PDF_417)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.AZTEC)).toBe(true);
    expect(set.has(Html5QrcodeSupportedFormats.CODABAR)).toBe(true);
    expect(SCAN_FORMATS.length).toBeGreaterThanOrEqual(12);
  });
});
