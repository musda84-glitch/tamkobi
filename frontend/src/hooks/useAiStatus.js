import { useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../context/AuthContext";

/** Arayüzde sağlayıcı veya model adı gösterilmez. */
export const AI_PUBLIC_LABEL = "Yapay zekâ";

/**
 * Platform AI ayarlarından genel durum (GET /ai/status).
 * Rozet her zaman genel etikettir; yanıtta model adı gelse bile kullanılmaz.
 * ready=false → yapılandırılmış görünse bile son test başarısız / anahtar kullanılamıyor.
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

  const readyObj = status && typeof status === "object";
  const lastTest = readyObj ? status.last_test || null : null;
  const configured = readyObj ? !!status.configured : false;
  const enabled = readyObj ? !!status.enabled : false;
  const ready = readyObj
    ? (typeof status.ready === "boolean" ? !!status.ready : configured && enabled && !(lastTest && lastTest.ok === false))
    : false;
  return {
    status: readyObj ? status : null,
    loading: status === undefined,
    enabled,
    configured,
    ready,
    lastTest,
    decryptFailed: readyObj ? !!status.decrypt_failed : false,
    extractLabel: ready ? AI_PUBLIC_LABEL : "",
    advisorLabel: ready ? AI_PUBLIC_LABEL : "",
    badge: ready ? AI_PUBLIC_LABEL : "",
    providerLabel: ready ? AI_PUBLIC_LABEL : "",
  };
}
