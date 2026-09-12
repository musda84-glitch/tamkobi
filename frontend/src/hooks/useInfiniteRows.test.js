import { LIST_INITIAL_ROWS, LIST_SCROLL_STEP, nextRowLimit } from "./useInfiniteRows";

test("liste sabitleri: ilk 50, adım 10", () => {
  expect(LIST_INITIAL_ROWS).toBe(50);
  expect(LIST_SCROLL_STEP).toBe(10);
});

test("nextRowLimit: 50 sonrası +10, üst sınırı aşmaz", () => {
  expect(nextRowLimit(0, 200)).toBe(60);
  expect(nextRowLimit(50, 200)).toBe(60);
  expect(nextRowLimit(50, 55)).toBe(55);
  expect(nextRowLimit(50, 40)).toBe(40);
  expect(nextRowLimit(190, 200)).toBe(200);
});
