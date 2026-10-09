import { useEffect, useRef } from "react";

/**
 * Görünürken hızlı poll; sekme tekrar görünür / pencere focus olunca hemen yenile.
 * Arka planda timer'ı durdurur (Chrome throttle + gereksiz yük).
 */
export function useLivePoll(onTick, {
  intervalMs = 5000,
  enabled = true,
  refreshOnFocus = true,
} = {}) {
  const cbRef = useRef(onTick);
  cbRef.current = onTick;

  useEffect(() => {
    if (!enabled || typeof onTick !== "function") return undefined;
    let timer = null;
    const tick = () => {
      try {
        cbRef.current?.();
      } catch {
        /* ignore */
      }
    };
    const clear = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
    };
    const arm = () => {
      clear();
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      timer = setInterval(tick, intervalMs);
    };
    const onVis = () => {
      if (document.visibilityState === "visible") {
        tick();
        arm();
      } else {
        clear();
      }
    };
    const onFocus = () => {
      if (!refreshOnFocus) return;
      if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
      tick();
    };
    tick();
    arm();
    document.addEventListener("visibilitychange", onVis);
    if (refreshOnFocus) {
      window.addEventListener("focus", onFocus);
    }
    return () => {
      clear();
      document.removeEventListener("visibilitychange", onVis);
      if (refreshOnFocus) window.removeEventListener("focus", onFocus);
    };
  }, [enabled, intervalMs, refreshOnFocus]);
}
