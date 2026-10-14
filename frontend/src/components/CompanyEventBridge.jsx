import { useEffect } from "react";
import { API_URL, useAuth } from "../context/AuthContext";
import { getHostKind } from "../utils/hosts";
import { notifyDataChanged } from "../utils/dataRefresh";
import { companyEventStreamEnabled, createChangeBuffer, nextRetryDelay } from "../utils/companyEvents";

/**
 * Şirket SSE kanalı: ilgili sorguları yeniler, kopunca yeniden bağlanır,
 * sekme öne gelince de tazeler. Sık olaylar debounce edilir.
 */
export function CompanyEventBridge() {
  const { authenticated, activeCompany } = useAuth();
  const companyId = activeCompany?.id || activeCompany?._id || "";
  const streamEnabled = companyEventStreamEnabled(getHostKind());

  useEffect(() => {
    if (!streamEnabled || !authenticated || !companyId || typeof window === "undefined" || typeof EventSource === "undefined") {
      return undefined;
    }
    let closed = false;
    let source = null;
    let retryTimer = null;
    let attempt = 0;
    const buffer = createChangeBuffer({
      onFlush: (scopes) => {
        notifyDataChanged({ companyId, scopes });
      },
    });

    const connect = () => {
      if (closed) return;
      if (source && source.readyState !== EventSource.CLOSED) return;
      const url = `${API_URL}/events/stream?company_id=${encodeURIComponent(companyId)}`;
      source = new EventSource(url, { withCredentials: true });
      source.addEventListener("changed", (msg) => {
        attempt = 0;
        try {
          const data = JSON.parse(msg.data || "");
          if (data && data.type) buffer.push(data.type);
        } catch {
          /* bozuk satır yok sayılır */
        }
      });
      source.onopen = () => {
        attempt = 0;
      };
      source.onerror = () => {
        if (closed || !source) return;
        if (source.readyState === EventSource.CLOSED) {
          const wait = nextRetryDelay(attempt);
          attempt += 1;
          retryTimer = window.setTimeout(connect, wait);
        }
      };
    };

    const onVisible = () => {
      if (document.visibilityState && document.visibilityState !== "visible") return;
      buffer.flushNow(["all"]);
      if (!source || source.readyState === EventSource.CLOSED) connect();
    };

    connect();
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      closed = true;
      buffer.cancel();
      if (retryTimer) window.clearTimeout(retryTimer);
      if (source) source.close();
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [authenticated, companyId, streamEnabled]);

  return null;
}
