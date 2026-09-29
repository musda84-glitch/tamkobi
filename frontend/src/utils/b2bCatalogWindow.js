/** Katalog ızgarasında bir seferde çizilen ürün adımı (web performans). */
export const B2B_CATALOG_PAGE = 48;

/** Filtre değişince veya mevcut sayı geçersizse ilk pencere boyutu. */
export function catalogVisibleCount(total, current, page = B2B_CATALOG_PAGE) {
  const n = Math.max(0, Number(total) || 0);
  const cur = Math.max(0, Number(current) || 0);
  if (!n) return 0;
  if (!cur || cur > n) return Math.min(page, n);
  return Math.min(cur, n);
}

/** Sentinel / "daha fazla" ile bir sonraki pencere. */
export function catalogGrowVisible(total, current, page = B2B_CATALOG_PAGE) {
  const n = Math.max(0, Number(total) || 0);
  const cur = catalogVisibleCount(n, current, page);
  return Math.min(n, cur + page);
}
