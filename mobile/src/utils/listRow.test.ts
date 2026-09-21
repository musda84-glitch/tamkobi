import { listRowText } from "./listRow";

describe("listRowText", () => {
  it("keeps strings and stringifies primitives", () => {
    expect(listRowText("Raf")).toBe("Raf");
    expect(listRowText(12)).toBe("12");
    expect(listRowText(null)).toBe("");
    expect(listRowText(undefined)).toBe("");
  });

  it("does not dump objects into a raw RN text node", () => {
    expect(listRowText({ name: "Masa" })).toBe("Masa");
    expect(listRowText({ tr: "Raf" })).toBe("");
  });
});
