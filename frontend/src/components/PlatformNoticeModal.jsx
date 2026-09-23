import React, { useEffect, useState } from "react";
import { CheckCircle2, X } from "lucide-react";
import { formatCountdown, remainingMs } from "../utils/platformNotices";

/**
 * Bizim Hesap tarzı bilgilendirme pop-up'ı:
 * başlık + metin + "Bir Daha Gösterme" / "Kapat".
 * Aktif güncellemede tahmini süre sayacı; bitince yeşil tamamlandı durumu.
 */
export function PlatformNoticeModal({
  notice,
  onClose,
  onDontShowAgain,
  onReload,
}) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    if (!notice?.activeUpdate || !notice?.ends_at) return undefined;
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [notice?.activeUpdate, notice?.ends_at, notice?.id]);

  if (!notice) return null;
  const activeUpdate = !!notice.activeUpdate;
  const updateDone = !!notice.updateDone;
  const dismissible = notice.dismissible !== false && !activeUpdate;
  const left = activeUpdate ? remainingMs(notice.ends_at, nowMs) : null;
  const countdown = left != null ? formatCountdown(left) : null;
  const etaPast = left != null && left <= 0;

  return (
    <div
      className="fixed inset-0 z-[80] bg-slate-900/55 backdrop-blur-[2px] flex items-center justify-center p-4 sm:p-6"
      data-testid="platform-notice-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="platform-notice-title"
    >
      <div
        className="bg-white w-full max-w-xl rounded-2xl shadow-2xl border border-slate-200/80 overflow-hidden"
        data-testid="platform-notice-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 px-5 sm:px-6 pt-5 pb-3 border-b border-slate-100">
          <h2 id="platform-notice-title" className="text-base sm:text-lg font-bold text-slate-800 leading-snug pr-2">
            {notice.title}
          </h2>
          {!activeUpdate && (
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-50"
              aria-label="Kapat"
              data-testid="platform-notice-x"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 max-h-[min(60vh,420px)] overflow-y-auto">
          <div
            className="text-sm text-slate-600 leading-relaxed whitespace-pre-wrap"
            data-testid="platform-notice-body"
          >
            {notice.body}
          </div>
          {(notice.support_email || notice.support_phone) && (
            <div className="mt-4 text-xs text-slate-500 space-y-0.5" data-testid="platform-notice-support">
              {notice.support_email ? <div>E-posta: <a className="text-teal-700 font-semibold" href={`mailto:${notice.support_email}`}>{notice.support_email}</a></div> : null}
              {notice.support_phone ? <div>Telefon: <span className="font-semibold text-slate-700">{notice.support_phone}</span></div> : null}
            </div>
          )}

          {activeUpdate && countdown && (
            <div
              className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-center"
              data-testid="platform-notice-eta"
            >
              <div className="text-[10px] uppercase tracking-wide font-bold text-slate-400">
                {notice.etaEstimated ? "Tahmini kalan süre" : "Kalan süre"}
              </div>
              <div className={`mt-1 font-mono text-2xl font-black tabular-nums ${etaPast ? "text-amber-700" : "text-slate-900"}`} data-testid="platform-notice-eta-value">
                {countdown}
              </div>
              {etaPast ? (
                <p className="mt-1 text-[11px] text-amber-800">Tahmini süre doldu; sistem hazır olunca otomatik bildirilir.</p>
              ) : (
                <p className="mt-1 text-[11px] text-slate-500">İşlem bitince bu pencere güncellenir.</p>
              )}
            </div>
          )}

          {activeUpdate && (
            <p className="mt-4 text-xs text-teal-800 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2" data-testid="platform-notice-update-hint">
              Güncelleme sürerken hata sayfası yerine bu bilgilendirme gösterilir. İşlem bitince sayfayı yenileyin.
            </p>
          )}

          {updateDone && (
            <p className="mt-4 text-xs text-emerald-900 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 flex items-start gap-2" data-testid="platform-notice-done-hint">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
              <span>Güncelleme tamamlandı. Güncel arayüz için sayfayı yenileyebilirsiniz.</span>
            </p>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 bg-slate-50/60">
          {dismissible && onDontShowAgain && !updateDone && (
            <button
              type="button"
              onClick={onDontShowAgain}
              className="px-4 py-2 text-sm font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50"
              data-testid="platform-notice-dont-show"
            >
              Bir Daha Gösterme
            </button>
          )}
          {activeUpdate && onReload ? (
            <button
              type="button"
              onClick={onReload}
              className="px-5 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-sm"
              data-testid="platform-notice-reload"
            >
              Sayfayı Yenile
            </button>
          ) : updateDone && onReload ? (
            <button
              type="button"
              onClick={onReload}
              className="px-5 py-2 text-sm font-bold text-white bg-emerald-600 hover:bg-emerald-700 rounded-xl shadow-sm animate-pulse"
              data-testid="platform-notice-reload-done"
            >
              Sayfayı Yenile
            </button>
          ) : (
            <button
              type="button"
              onClick={onClose}
              className="px-5 py-2 text-sm font-bold text-white bg-teal-600 hover:bg-teal-700 rounded-xl shadow-sm"
              data-testid="platform-notice-close"
            >
              Kapat
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
