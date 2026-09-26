import { LABEL_DESIGN_FIELDS, labelFieldValue, normalizeLabelTexts } from "./labelDesignFields";

describe("labelDesignFields", () => {
  test("exposes three product label text slots for the designer", () => {
    const keys = LABEL_DESIGN_FIELDS.map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(["label_1", "label_2", "label_3"]));
    expect(keys.indexOf("label_1")).toBeLessThan(keys.indexOf("label_2"));
    expect(keys.indexOf("label_2")).toBeLessThan(keys.indexOf("label_3"));
  });

  test("reads label_text_1..3 from the product card", () => {
    const p = { name: "Koltuk", label_text_1: "Menşei TR", label_text_2: "Gri", label_text_3: "2026" };
    expect(labelFieldValue({ field: "label_1" }, p)).toBe("Menşei TR");
    expect(labelFieldValue({ field: "label_2" }, p)).toBe("Gri");
    expect(labelFieldValue({ field: "label_3" }, p)).toBe("2026");
    expect(labelFieldValue({ field: "name" }, p)).toBe("Koltuk");
  });

  test("normalizeLabelTexts trims and nulls empties", () => {
    expect(normalizeLabelTexts({ label_text_1: "  A  ", label_text_2: "", label_text_3: "   " })).toEqual({
      label_text_1: "A",
      label_text_2: null,
      label_text_3: null,
    });
  });
});
