import { pickLineNote } from "../utils/pickLineNote";

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
});
