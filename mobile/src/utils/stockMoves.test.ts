import { moveChange, parseStockMoves } from "./stockMoves";

describe("parseStockMoves", () => {
  it("reads movements or a bare array and qty aliases", () => {
    expect(parseStockMoves({ movements: [{ change: -2, reason: "Satış" }] })).toHaveLength(1);
    expect(parseStockMoves([{ quantity: 4, reason: "Alış" }])).toHaveLength(1);
    expect(moveChange({ qty: 3 })).toBe(3);
    expect(parseStockMoves({ movements: [] })).toEqual([]);
  });
});
