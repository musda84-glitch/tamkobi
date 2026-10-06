import { GIB_SEAL_JPEG_DATA_URL, gibSealAlt, gibSealCaption } from "./einvoiceGibSeal";

test("official GIB seal is a JPEG data URL", () => {
  expect(GIB_SEAL_JPEG_DATA_URL.startsWith("data:image/jpeg;base64,/9j/")).toBe(true);
  expect(GIB_SEAL_JPEG_DATA_URL.length).toBeGreaterThan(1000);
});

test("seal caption and alt follow document kind", () => {
  expect(gibSealCaption("e_invoice")).toBe("e-FATURA");
  expect(gibSealCaption("e_archive")).toBe("e-Arşiv Fatura");
  expect(gibSealAlt("e_invoice")).toBe("E-Fatura Logo");
  expect(gibSealAlt("e_archive")).toBe("E-Arşiv Logo");
});
