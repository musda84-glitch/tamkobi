/** Gelen e-belge manuel çekim — geriye dönük pencere (API 1–90 gün). */
export const EINVOICE_INBOX_BACKFILL_DAYS = 30;

export function einvoiceInboxSyncParams(companyId, {
  days = EINVOICE_INBOX_BACKFILL_DAYS,
  autoProcess = false,
} = {}) {
  const n = Number(days);
  const raw = Number.isFinite(n) ? n : EINVOICE_INBOX_BACKFILL_DAYS;
  return {
    company_id: companyId,
    days: Math.max(1, Math.min(raw, 90)),
    auto_process: Boolean(autoProcess),
  };
}
