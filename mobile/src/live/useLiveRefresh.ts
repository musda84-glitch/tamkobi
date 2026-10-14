import { useEffect, useRef } from "react";
import { scopesOverlap, subscribeLiveRefresh } from "./companyEvents";

/** Şirket olayında (ve ön plana dönüşte) ilgili ekranı yeniden çeker. */
export function useLiveRefresh(onRefresh: () => void, scopes: string[] = ["cash"]): void {
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const key = scopes.join(",");
  useEffect(() => {
    const want = key ? key.split(",") : ["cash"];
    return subscribeLiveRefresh((got) => {
      if (!scopesOverlap(want, got)) return;
      refreshRef.current();
    });
  }, [key]);
}
