import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { useAuth } from "@/auth/AuthContext";
import { API_BASE_HEADER, requestTarget } from "@/api/url";
import {
  emitLiveRefresh,
  nextRetryDelay,
  parseSseChunk,
  scopesForEventType,
  shouldRefreshOnForeground,
} from "./companyEvents";

const DEBOUNCE_MS = 400;

/**
 * Mobil şirket kanalı. Kopunca yeniden bağlanır; uygulama öne gelince yeniler.
 * Sık olaylar tek yenilemede birleşir.
 */
export function CompanyEventBridge() {
  const { user, client, companyId } = useAuth();
  const scopesRef = useRef(new Set<string>());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!user || !companyId || !client?.baseUrl) return undefined;
    let closed = false;
    let attempt = 0;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let xhr: XMLHttpRequest | null = null;
    let seen = 0;
    let rest = "";

    const flush = (extra?: string[]) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      const batch = new Set(scopesRef.current);
      scopesRef.current = new Set();
      for (const scope of extra || []) batch.add(scope);
      if (batch.size) emitLiveRefresh([...batch]);
    };

    const pushType = (type: string) => {
      for (const scope of scopesForEventType(type)) scopesRef.current.add(scope);
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => flush(), DEBOUNCE_MS);
    };

    const connect = () => {
      if (closed || typeof XMLHttpRequest === "undefined") return;
      const path = `/events/stream?company_id=${encodeURIComponent(companyId)}`;
      const { url, proxiedBase } = requestTarget(client.baseUrl, path);
      const req = new XMLHttpRequest();
      xhr = req;
      seen = 0;
      rest = "";
      req.open("GET", url);
      req.setRequestHeader("Accept", "text/event-stream");
      req.setRequestHeader("X-Tamkobi-Client", "mobile");
      if (client.token) req.setRequestHeader("Authorization", `Bearer ${client.token}`);
      if (proxiedBase) req.setRequestHeader(API_BASE_HEADER, proxiedBase);
      req.onprogress = () => {
        const text = req.responseText || "";
        if (text.length <= seen) return;
        const chunk = text.slice(seen);
        seen = text.length;
        const parsed = parseSseChunk(rest + chunk);
        rest = parsed.rest;
        attempt = 0;
        for (const ev of parsed.events) {
          const type = typeof ev.data.type === "string" ? ev.data.type : "";
          if (ev.event === "changed" && type) pushType(type);
        }
      };
      const schedule = () => {
        if (closed) return;
        const wait = nextRetryDelay(attempt);
        attempt += 1;
        retryTimer = setTimeout(connect, wait);
      };
      req.onerror = schedule;
      req.onload = schedule;
      req.send();
    };

    const onAppState = (state: string) => {
      if (!shouldRefreshOnForeground(state)) return;
      flush(["all"]);
      if (!xhr || xhr.readyState === 4) connect();
    };

    connect();
    const sub = AppState.addEventListener("change", onAppState);
    return () => {
      closed = true;
      if (retryTimer) clearTimeout(retryTimer);
      if (timerRef.current) clearTimeout(timerRef.current);
      try {
        xhr?.abort();
      } catch {
        /* kapanış */
      }
      sub.remove();
    };
  }, [user, client, companyId]);

  return null;
}
