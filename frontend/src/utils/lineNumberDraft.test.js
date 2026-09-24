import { lineDraftKey, lineNumberCommit, lineNumberOnFocus, lineNumberShown, parseLineNumber } from "./lineNumberDraft";

describe("lineNumberDraft", () => {
  it("clears on focus so qty 1 and price 0 can be typed over", () => {
    expect(lineNumberOnFocus()).toBe("");
    expect(lineNumberShown({ "0:quantity": "" }, "0:quantity", 1)).toBe("");
    expect(lineNumberShown({ "0:unit_price": "" }, "0:unit_price", 0)).toBe("");
  });

  it("shows stored number when the field is not being edited", () => {
    expect(lineNumberShown({}, "0:quantity", 1)).toBe("1");
    expect(lineNumberShown(undefined, "0:unit_price", 0)).toBe("0");
    expect(lineDraftKey(2, "quantity")).toBe("2:quantity");
  });

  it("parses typed decimals and keeps the previous value when left empty", () => {
    expect(parseLineNumber("12,5", 1)).toBe(12.5);
    expect(parseLineNumber("", 1)).toBe(1);
    expect(lineNumberCommit("", 1)).toBeNull();
    expect(lineNumberCommit("  ", 0)).toBeNull();
    expect(lineNumberCommit("8", 1)).toBe(8);
    expect(lineNumberCommit("0", 1)).toBe(0);
  });
});
