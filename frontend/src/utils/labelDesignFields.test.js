import { LABEL_DESIGN_FIELDS, labelFieldValue, productTagSlots } from "./labelDesignFields";

describe("labelDesignFields", () => {
  test("exposes three tag-based label slots for the designer", () => {
    const keys = LABEL_DESIGN_FIELDS.map(([k]) => k);
    expect(keys).toEqual(expect.arrayContaining(["label_1", "label_2", "label_3"]));
    expect(keys.indexOf("label_1")).toBeLessThan(keys.indexOf("label_2"));
    expect(keys.indexOf("label_2")).toBeLessThan(keys.indexOf("label_3"));
  });

  test("productTagSlots takes the first three tags", () => {
    expect(productTagSlots({ tags: ["Menşei TR", "Gri", "2026", "fazla"] })).toEqual([
      "Menşei TR",
      "Gri",
      "2026",
    ]);
    expect(productTagSlots({ tags: ["tek"] })).toEqual(["tek", "", ""]);
    expect(productTagSlots({})).toEqual(["", "", ""]);
  });

  test("label fields read from product.tags[0..2]", () => {
    const p = { name: "Koltuk", tags: ["Menşei TR", "Gri", "2026"] };
    expect(labelFieldValue({ field: "label_1" }, p)).toBe("Menşei TR");
    expect(labelFieldValue({ field: "label_2" }, p)).toBe("Gri");
    expect(labelFieldValue({ field: "label_3" }, p)).toBe("2026");
    expect(labelFieldValue({ field: "name" }, p)).toBe("Koltuk");
  });
});
