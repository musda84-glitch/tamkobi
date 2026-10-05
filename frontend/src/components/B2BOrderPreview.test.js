import { pickLineNote } from "../utils/pickLineNote";
import { b2bPreviewLineMeta, b2bPreviewPrintLabel, printQtyTotalLabel } from "../utils/printFormLayout";

/** Mirrors B2BOrderPreview line note visibility for unit coverage without mounting React. */
export function previewLineStockNote(it) {
  return pickLineNote(it);
}

describe("B2B order preview stock note", () => {
  it("surfaces sipariş stok notu from line note fields", () => {
    expect(previewLineStockNote({ note: "  panel kesim  " })).toBe("panel kesim");
    expect(previewLineStockNote({ line_note: "kırmızı" })).toBe("kırmızı");
    expect(previewLineStockNote({})).toBe("");
  });

  it("shows kalem adet toplamı in footer", () => {
    expect(printQtyTotalLabel([
      { quantity: 10, unit: "Adet" },
      { quantity: 5, unit: "Adet" },
    ])).toBe("Toplam Miktar: 15 ad");
  });

  it("omits unit and line prices for fiyatsız print", () => {
    const it = { quantity: 4, unit: "Adet", unit_price: 12.5, total: 50, vat_rate: 10, total_incl: 55 };
    expect(b2bPreviewLineMeta(it, false)).toContain("13,75");
    expect(b2bPreviewLineMeta(it, true)).toBe("4 Adet");
    expect(b2bPreviewLineMeta(it, true)).not.toMatch(/₺/);
    expect(b2bPreviewPrintLabel(true)).toBe("Fiyatsız yazdır");
    expect(b2bPreviewPrintLabel(false)).toBe("Yazdır");
  });
});
