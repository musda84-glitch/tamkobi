import { pickLineNote } from "../utils/pickLineNote";
import { printQtyTotalLabel } from "../utils/printFormLayout";

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
});
