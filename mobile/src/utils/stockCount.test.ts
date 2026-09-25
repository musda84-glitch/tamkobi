import { countDiff, scanCountPayload } from "./stockCount";

describe("stockCount helpers", () => {
  test("scan payload uses qty multiplier", () => {
    expect(scanCountPayload(" ABC ", "5")).toEqual({ barcode: "ABC", quantity: 5 });
    expect(scanCountPayload("x", "")).toEqual({ barcode: "x", quantity: 1 });
  });

  test("diff is counted minus expected", () => {
    expect(countDiff({ counted: 3, expected: 1 })).toBe(2);
    expect(countDiff({ counted: 0, expected: 2 })).toBe(-2);
  });
});
