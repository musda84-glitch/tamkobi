import React, { useCallback, useEffect, useState } from "react";
import axios from "axios";
import { API_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import { PlatformNoticeModal } from "./PlatformNoticeModal";
import {
  UPDATE_FALLBACK_NOTICE,
  dismissNotice,
  isUpdateTransportError,
  pickVisibleNotice,
} from "../utils/platformNotices";

const POLL_MS = 60_000;

/**
 * Şirket panellerinde bakım / duyuru pop-up'ı.
 * 502–504 veya ağ hatasında hata yerine güncelleme bilgilendirmesi gösterir.
 */
export function PlatformNoticesHost({ disabled = false }) {
  const { activeCompany } = useAuth() || {};
  const companyId = activeCompany?.id || activeCompany?._id || "";
  const [payload, setPayload] = useState(null);
  const [transportNotice, setTransportNotice] = useState(null);
  const [closedIds, setClosedIds] = useState(() => new Set());

  const refresh = useCallback(async () => {
    if (disabled) return;
    try {
      const r = await axios.get(`${API_URL}/platform/notices`, {
        timeout: 12_000,
        params: companyId ? { company_id: companyId } : {},
      });
      setPayload(r.data);
      setTransportNotice(null);
    } catch (err) {
      if (isUpdateTransportError(err)) {
        setTransportNotice(UPDATE_FALLBACK_NOTICE);
      }
    }
  }, [disabled, companyId]);

  useEffect(() => {
    if (disabled) return undefined;
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [disabled, refresh]);

  useEffect(() => {
    if (disabled) return undefined;
    const onErr = (ev) => {
      const err = ev?.detail || ev;
      if (isUpdateTransportError(err)) {
        setTransportNotice(UPDATE_FALLBACK_NOTICE);
      }
    };
    const onChunk = (ev) => {
      const msg = String(ev?.reason?.message || ev?.message || "");
      if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported/i.test(msg)) {
        setTransportNotice({
          ...UPDATE_FALLBACK_NOTICE,
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
  }, [disabled]);

  if (disabled) return null;

  const fromApi = pickVisibleNotice(payload);
  const notice = transportNotice || (fromApi && !closedIds.has(fromApi.id) ? fromApi : null);
  if (!notice) return null;

  const close = () => {
    if (notice.activeUpdate) return;
    setClosedIds((prev) => new Set(prev).add(notice.id));
    if (transportNotice?.id === notice.id) setTransportNotice(null);
  };

  const dontShow = () => {
    dismissNotice(notice.id);
    setClosedIds((prev) => new Set(prev).add(notice.id));
  };

  return (
    <PlatformNoticeModal
      notice={notice}
      onClose={close}
      onDontShowAgain={notice.dismissible ? dontShow : undefined}
      onReload={notice.activeUpdate ? () => window.location.reload() : undefined}
    />
  );
}
