import { useEffect, useMemo, useRef, useState } from "react";

/** İlk ekranda gösterilecek satır sayısı */
export const LIST_INITIAL_ROWS = 50;
/** Kaydırıldıkça eklenecek satır adımı */
export const LIST_SCROLL_STEP = 10;

/** Bir sonraki görünür satır üst sınırı (pure; test edilir). */
export function nextRowLimit(current, total, { initial = LIST_INITIAL_ROWS, step = LIST_SCROLL_STEP } = {}) {
  const t = Math.max(0, Number(total) || 0);
  if (t <= initial) return t;
  const base = Math.max(initial, Number(current) || 0);
  return Math.min(t, base + step);
}

/**
 * Büyük listelerde DOM'u hafif tutmak için: önce `initial` satır,
 * alt sentinel görünür olunca her seferinde `step` satır daha.
 *
 * @param {Array} items filtre/sıralanmış tam liste
 * @param {{ initial?: number, step?: number, resetKey?: string|number }} [opts]
 */
export function useInfiniteRows(items, { initial = LIST_INITIAL_ROWS, step = LIST_SCROLL_STEP, resetKey } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const [limit, setLimit] = useState(initial);
  const sentinelRef = useRef(null);

  useEffect(() => {
    setLimit(initial);
  }, [initial, resetKey]);

  const visible = useMemo(() => rows.slice(0, Math.max(0, limit)), [rows, limit]);
  const hasMore = limit < rows.length;

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        setLimit((n) => nextRowLimit(n < initial ? initial : n, rows.length, { initial, step }));
      },
      { root: null, rootMargin: "240px 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, rows.length, limit, initial, step]);

  return {
    visible,
    hasMore,
    sentinelRef,
    shown: visible.length,
    total: rows.length,
  };
}
