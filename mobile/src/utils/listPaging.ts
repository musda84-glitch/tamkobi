/** Web `useInfiniteRows` ile aynı: ilk ekran 50, sonra adım adım. */
export const LIST_INITIAL_ROWS = 50;
export const LIST_SCROLL_STEP = 40;

export function nextRowLimit(
  current: number,
  total: number,
  { initial = LIST_INITIAL_ROWS, step = LIST_SCROLL_STEP } = {},
): number {
  const t = Math.max(0, Number(total) || 0);
  if (t <= initial) return t;
  const base = Math.max(initial, Number(current) || 0);
  return Math.min(t, base + step);
}

export function visibleRows<T>(rows: T[] | null | undefined, limit: number): T[] {
  return (rows || []).slice(0, Math.max(0, limit));
}
