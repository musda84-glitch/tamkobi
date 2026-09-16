import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

/**
 * Platform AI ayarlarından genel durum (GET /ai/status).
 * Ayrıştırma ekranlarında extract_label, danışmanda badge kullanılır.
 */
export function useAiStatus() {
  const [status, setStatus] = useState(undefined);

  useEffect(() => {
    let cancelled = false;
    axios
      .get(`${API_URL}/ai/status`)
      .then((r) => {
        if (!cancelled) setStatus(r.data || null);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = status && typeof status === "object";
  return {
    status: ready ? status : null,
    loading: status === undefined,
    enabled: ready ? !!status.enabled : false,
    configured: ready ? !!status.configured : false,
    extractLabel: ready ? status.extract_label || "" : "",
    advisorLabel: ready ? status.advisor_label || "" : "",
    badge: ready ? status.badge || "" : "",
    providerLabel: ready ? status.provider_label || "" : "",
  };
}
