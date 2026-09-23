import React from "react";
import { X } from "lucide-react";

/**
 * Bizim Hesap tarzı bilgilendirme pop-up'ı:
 * başlık + metin + "Bir Daha Gösterme" / "Kapat".
 */
export function PlatformNoticeModal({
  notice,
  onClose,
  onDontShowAgain,
  onReload,
}) {
  if (!notice) return null;
  const activeUpdate = !!notice.activeUpdate;
  const dismissible = notice.dismissible !== false && !activeUpdate;

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
          {activeUpdate && (
            <p className="mt-4 text-xs text-teal-800 bg-teal-50 border border-teal-100 rounded-xl px-3 py-2" data-testid="platform-notice-update-hint">
              Güncelleme sürerken hata sayfası yerine bu bilgilendirme gösterilir. İşlem bitince sayfayı yenileyin.
            </p>
          )}
        </div>

        <div className="px-5 sm:px-6 py-4 border-t border-slate-100 flex flex-wrap items-center justify-end gap-2 bg-slate-50/60">
          {dismissible && onDontShowAgain && (
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
