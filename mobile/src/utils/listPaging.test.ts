import { LIST_INITIAL_ROWS, nextRowLimit, visibleRows } from "./listPaging";

describe("listPaging", () => {
  it("caps at total and grows by step", () => {
    expect(nextRowLimit(0, 12)).toBe(12);
    expect(nextRowLimit(0, 200)).toBe(LIST_INITIAL_ROWS + 40);
    expect(nextRowLimit(50, 200)).toBe(90);
    expect(nextRowLimit(190, 200)).toBe(200);
  });

  it("slices visible rows", () => {
    expect(visibleRows(["a", "b", "c"], 2)).toEqual(["a", "b"]);
    expect(visibleRows(null, 5)).toEqual([]);
  });
});
