import React, { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { API_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PlatformNoticeModal } from "./PlatformNoticeModal";
import {
  UPDATE_DONE_NOTICE,
  dismissNotice,
  isUpdateTransportError,
  makeTransportNotice,
  pickVisibleNotice,
} from "../utils/platformNotices";

const POLL_MS = 60_000;
const POLL_ACTIVE_MS = 8_000;

/**
 * Şirket panellerinde bakım / duyuru pop-up'ı.
 * 502–504 veya ağ hatasında hata yerine güncelleme bilgilendirmesi gösterir.
 * Güncelleme bitince (API yeniden yanıt verince) tamamlandı bildirimi çıkar.
 */
export function PlatformNoticesHost({ disabled = false }) {
  const { activeCompany } = useAuth() || {};
  const companyId = activeCompany?.id || activeCompany?._id || "";
  const [payload, setPayload] = useState(null);
  const [transportNotice, setTransportNotice] = useState(null);
  const [doneNotice, setDoneNotice] = useState(null);
  const [closedIds, setClosedIds] = useState(() => new Set());
  const sawActiveRef = useRef(false);
  const transportRef = useRef(null);

  const showTransport = useCallback((notice) => {
    transportRef.current = notice;
    setTransportNotice(notice);
  }, []);

  const clearTransport = useCallback(() => {
    const had = !!transportRef.current;
    transportRef.current = null;
    setTransportNotice(null);
    return had;
  }, []);

  const refresh = useCallback(async () => {
    if (disabled) return;
    try {
      const r = await axios.get(`${API_URL}/platform/notices`, {
        timeout: 12_000,
        params: companyId ? { company_id: companyId } : {},
      });
      const next = r.data;
      const visible = pickVisibleNotice(next);
      const stillActive = !!(visible && visible.activeUpdate);
      const recoveredTransport = clearTransport();

      if (stillActive) {
        sawActiveRef.current = true;
      } else if (sawActiveRef.current || recoveredTransport) {
        sawActiveRef.current = false;
        setDoneNotice({ ...UPDATE_DONE_NOTICE });
      }

      setPayload(next);
    } catch (err) {
      if (isUpdateTransportError(err)) {
        sawActiveRef.current = true;
        setDoneNotice(null);
        if (!transportRef.current) showTransport(makeTransportNotice());
      }
    }
  }, [disabled, companyId, clearTransport, showTransport]);

  const fromApi = pickVisibleNotice(payload);
  const showingActive = !!(transportNotice || (fromApi && fromApi.activeUpdate));

  useEffect(() => {
    if (disabled) return undefined;
    refresh();
    const ms = showingActive || transportNotice ? POLL_ACTIVE_MS : POLL_MS;
    const t = setInterval(refresh, ms);
    return () => clearInterval(t);
  }, [disabled, refresh, showingActive, transportNotice]);

  useEffect(() => {
    if (disabled) return undefined;
    const onErr = (ev) => {
      const err = ev?.detail || ev;
      if (isUpdateTransportError(err)) {
        sawActiveRef.current = true;
        setDoneNotice(null);
        if (!transportRef.current) showTransport(makeTransportNotice());
      }
    };
    const onChunk = (ev) => {
      const msg = String(ev?.reason?.message || ev?.message || "");
      if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported/i.test(msg)) {
        setDoneNotice({
          ...UPDATE_DONE_NOTICE,
          title: "Yeni Sürüm Yayınlandı",
          body:
            "Değerli Kullanıcımız,\n\n" +
            "Uygulamanın yeni bir sürümü yayınlandı. Sayfayı yenileyerek güncel arayüze geçebilirsiniz.\n\n" +
            "İyi çalışmalar dileriz.",
        });
      }
    };
    window.addEventListener("tamkobi:api-error", onErr);
    window.addEventListener("unhandledrejection", onChunk);
    return () => {
      window.removeEventListener("tamkobi:api-error", onErr);
      window.removeEventListener("unhandledrejection", onChunk);
    };
  }, [disabled, showTransport]);

  if (disabled) return null;

  const notice =
    doneNotice ||
    transportNotice ||
    (fromApi && !closedIds.has(fromApi.id) ? fromApi : null);
  if (!notice) return null;

  const close = () => {
    if (notice.activeUpdate) return;
    if (doneNotice?.id === notice.id) setDoneNotice(null);
    setClosedIds((prev) => new Set(prev).add(notice.id));
    if (transportNotice?.id === notice.id) clearTransport();
  };

  const dontShow = () => {
    dismissNotice(notice.id);
    setClosedIds((prev) => new Set(prev).add(notice.id));
    if (doneNotice?.id === notice.id) setDoneNotice(null);
  };

  const reload = () => window.location.reload();

  return (
    <PlatformNoticeModal
      notice={notice}
      onClose={close}
      onDontShowAgain={notice.dismissible || notice.updateDone ? dontShow : undefined}
      onReload={notice.activeUpdate || notice.updateDone ? reload : undefined}
    />
  );
}
