import {
  normalizeStockPrice,
  parseStockPriceInput,
  stockPriceChanged,
  stockPriceDraftValue,
} from "./stockInlinePrice";

test("parseStockPriceInput accepts TR and EN decimals", () => {
  expect(parseStockPriceInput("1.250,50")).toBeCloseTo(1250.5);
  expect(parseStockPriceInput("1,250.50")).toBeCloseTo(1250.5);
  expect(parseStockPriceInput("99,9")).toBeCloseTo(99.9);
  expect(parseStockPriceInput("")).toBe(0);
  expect(parseStockPriceInput("abc", 7)).toBe(7);
});

test("normalize and change detect", () => {
  expect(normalizeStockPrice(-3)).toBe(0);
  expect(normalizeStockPrice(10.55555)).toBeCloseTo(10.5556);
  expect(stockPriceChanged(10, "10,00")).toBe(false);
  expect(stockPriceChanged(10, "12")).toBe(true);
});

test("draft value empty for zero", () => {
  expect(stockPriceDraftValue(0)).toBe("");
  expect(stockPriceDraftValue(15.5)).toBe("15,5");
});
