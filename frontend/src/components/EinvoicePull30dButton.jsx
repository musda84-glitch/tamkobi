import React, { useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { toast } from "sonner";
import { Download, Loader2 } from "lucide-react";
import { API_URL } from "../context/AuthContext";
import { EINVOICE_INBOX_BACKFILL_DAYS, einvoiceInboxSyncParams } from "../utils/einvoiceInboxPull";

/**
 * Firma ayarları / atanan entegratör yanında: son N gün gelen e-belgeleri çek.
 * Belgeler Bekleyen'e düşer (auto_process kapalı).
 */
export function EinvoicePull30dButton({
  companyId,
  days = EINVOICE_INBOX_BACKFILL_DAYS,
  onDone,
  className = "",
}) {
  const [busy, setBusy] = useState(false);
  const [lastMsg, setLastMsg] = useState("");

  const pull = async () => {
    if (!companyId || busy) return;
    setBusy(true);
    try {
      const r = await axios.post(`${API_URL}/einvoice/incoming/sync`, null, {
        params: einvoiceInboxSyncParams(companyId, { days, autoProcess: false }),
        timeout: 180000,
      });
      const msg = r.data?.message || `Son ${days} gün gelen kutusu çekildi.`;
      setLastMsg(msg);
      toast.success(msg);
      onDone?.(r.data);
    } catch (err) {
      toast.error(err.response?.data?.detail || "Gelen kutu çekilemedi.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`space-y-1.5 ${className}`} data-testid="einvoice-pull-30d-wrap">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={pull}
          disabled={busy || !companyId}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-[11px] font-semibold disabled:opacity-60"
          data-testid="einvoice-pull-30d"
          title={`İşNet / entegratör gelen kutusundan son ${days} gün e-Fatura ve e-İrsaliye çeker; Bekleyen'e yazar.`}
        >
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Son {days} günü çek
        </button>
        <Link
          to="/edoc-inbox"
          className="text-[11px] font-semibold text-emerald-700 hover:underline"
          data-testid="einvoice-pull-30d-inbox-link"
        >
          Gelen e-Belgeler →
        </Link>
      </div>
      <p className="text-[10px] text-slate-500" data-testid="einvoice-pull-30d-hint">
        Geriye dönük {days} gün e-Fatura / e-İrsaliye alınır; belgeler otomatik işlenmez, Bekleyen&apos;de kalır.
      </p>
      {lastMsg ? (
        <p className="text-[10px] text-slate-600" data-testid="einvoice-pull-30d-result">{lastMsg}</p>
      ) : null}
    </div>
  );
}
