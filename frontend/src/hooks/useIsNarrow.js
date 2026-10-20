import { useEffect, useState } from "react";

/**
 * Dar ekran. Yalnız personel sipariş dalında kullanılır.
 * window.matchMedia("(max-width: Npx)") + change dinleyicisi.
 */
export function useIsNarrow(maxWidth = 768) {
  const query = `(max-width: ${Number(maxWidth) || 768}px)`;
  const [narrow, setNarrow] = useState(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const mql = window.matchMedia(query);
    const onChange = () => setNarrow(!!mql.matches);
    onChange();
    if (typeof mql.addEventListener === "function") {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    if (typeof mql.addListener === "function") {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
    return undefined;
  }, [query]);

  return narrow;
}
