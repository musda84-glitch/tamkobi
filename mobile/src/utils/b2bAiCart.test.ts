import { learnMappings, mapUnmatched, normalizeAiCart, rejectLegacyXls, selectedAiLines, setAiQty, toggleAiItem } from "./b2bAiCart";

describe("rejectLegacyXls", () => {
  it("blocks .xls but keeps .xlsx", () => {
    expect(rejectLegacyXls("liste.xls")).toMatch(/xlsx/);
    expect(rejectLegacyXls("liste.xlsx")).toBeNull();
  });
});

describe("ai cart helpers", () => {
  it("selects checked lines and builds learn mappings", () => {
    let res = normalizeAiCart({
      items: [
        { requested: "raf", quantity: 2, product_id: "p1", matched_name: "Kiler Rafı", confidence: 0.9 },
        { requested: "masa", quantity: 1, product_id: "p2", matched_name: "masa", confidence: 1, on: false },
      ],
      unmatched: [{ requested: "vida", quantity: 10 }],
    });
    expect(res.items[0].on).toBe(true);
    res = toggleAiItem(res, 0, false);
    expect(selectedAiLines(res)).toEqual([]);
    res = toggleAiItem(res, 0, true);
    res = setAiQty(res, 0, 5);
    expect(selectedAiLines(res)).toEqual([{ product_id: "p1", quantity: 5 }]);
    expect(learnMappings(res)).toEqual([{ alias: "raf", product_id: "p1" }]);
    res = mapUnmatched(res, 0, { id: "p3", name: "Vida" });
    expect(res.unmatched).toHaveLength(0);
    expect(res.items.at(-1)?.learned).toBe(true);
  });
});
