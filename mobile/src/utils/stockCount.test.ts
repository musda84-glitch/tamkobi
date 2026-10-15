import { countDiff, scanCountPayload, stockCountCreatePayload, warehouseSelectGroups } from "./stockCount";

describe("stockCount helpers", () => {
  test("scan payload uses qty multiplier", () => {
    expect(scanCountPayload(" ABC ", "5")).toEqual({ barcode: "ABC", quantity: 5 });
    expect(scanCountPayload("x", "")).toEqual({ barcode: "x", quantity: 1 });
  });

  test("diff is counted minus expected", () => {
    expect(countDiff({ counted: 3, expected: 1 })).toBe(2);
    expect(countDiff({ counted: 0, expected: 2 })).toBe(-2);
  });

  test("create payload keeps an optional warehouse like the web kiosk", () => {
    expect(stockCountCreatePayload("co", "  Akşam ", "w1")).toEqual({
      company_id: "co",
      name: "Akşam",
      warehouse_id: "w1",
      preload_all: false,
    });
    expect(stockCountCreatePayload("co", "  ", "").warehouse_id).toBeNull();
    expect(warehouseSelectGroups([{ id: "w1", name: "Depo A" }, { name: "boş" }])).toEqual([
      { label: "Depolar", options: [{ value: "w1", label: "Depo A" }] },
    ]);
  });
});
