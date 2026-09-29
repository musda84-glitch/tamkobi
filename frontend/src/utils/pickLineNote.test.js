import { pickLineNote } from "./pickLineNote";

describe("pickLineNote", () => {
  it("reads B2B sipariş stok notu aliases", () => {
    expect(pickLineNote({ note: "  panel  " })).toBe("panel");
    expect(pickLineNote({ line_note: "kırmızı" })).toBe("kırmızı");
    expect(pickLineNote({ stock_note: "kesim" })).toBe("kesim");
    expect(pickLineNote({})).toBe("");
  });
});
