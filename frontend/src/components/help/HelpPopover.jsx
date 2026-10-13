import React from "react";
import { BookOpen, Map, Sparkles, Wand2, X } from "lucide-react";
import { useHelp } from "../../context/HelpContext";

export function HelpPopover({ tone = "app" }) {
  const {
    pageHelp,
    closeHelp,
    startTour,
    openHelpCenter,
    openWizard,
    articles,
    assistantContext,
    onboarding,
  } = useHelp();
  const panel =
    tone === "system"
      ? "bg-[#121a2b] border-white/10 text-slate-100"
      : "bg-white border-slate-200 text-slate-800";
  return (
    <div
      className={`absolute right-0 mt-2 w-[22rem] max-w-[90vw] rounded-2xl border shadow-xl z-[80] p-3 ${panel}`}
      data-testid="help-popover"
      role="dialog"
      aria-label="Sayfa yardımı"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">Bu sayfa</div>
          <div className="text-sm font-bold" data-testid="help-page-title">{pageHelp.title}</div>
        </div>
        <button type="button" className="p-1 rounded-lg hover:bg-black/5" onClick={closeHelp} data-testid="help-popover-close" aria-label="Kapat">
          <X className="w-4 h-4" />
        </button>
      </div>
      <p className="text-xs leading-relaxed text-slate-500 dark:text-slate-400" data-testid="help-page-intro">
        {pageHelp.intro}
      </p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        <button
          type="button"
          onClick={startTour}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-indigo-50 text-indigo-800 hover:bg-indigo-100"
          data-testid="help-start-tour-btn"
        >
          <Map className="w-3.5 h-3.5" /> Sayfa turu
        </button>
        <button
          type="button"
          onClick={() => openHelpCenter()}
          className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-emerald-50 text-emerald-800 hover:bg-emerald-100"
          data-testid="help-open-center-btn"
        >
          <BookOpen className="w-3.5 h-3.5" /> Nasıl yapılır?
        </button>
        {onboarding && (
          <button
            type="button"
            onClick={openWizard}
            className="flex items-center gap-1.5 px-2.5 py-2 rounded-xl text-[11px] font-semibold bg-amber-50 text-amber-900 hover:bg-amber-100 col-span-2"
            data-testid="help-open-wizard-btn"
          >
            <Wand2 className="w-3.5 h-3.5" /> Kurulum sihirbazı
            <span className="ml-auto text-[10px] opacity-70">%{onboarding.progress_percent || 0}</span>
          </button>
        )}
      </div>
      {articles.length > 0 && (
        <div className="mt-3 space-y-1" data-testid="help-related-articles">
          <div className="text-[10px] uppercase tracking-wider text-slate-400 font-semibold">İlgili makaleler</div>
          {articles.slice(0, 3).map((a) => (
            <button
              key={a.slug}
              type="button"
              className="block w-full text-left text-xs px-2 py-1.5 rounded-lg hover:bg-slate-50"
              onClick={() => openHelpCenter(a.title)}
            >
              <span className="font-semibold">{a.title}</span>
              {a.content_type === "video" && <span className="ml-1 text-[10px] text-rose-600">video</span>}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-xl border border-dashed border-indigo-200 bg-indigo-50/50 p-2.5" data-testid="help-ai-slot">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-800">
          <Sparkles className="w-3.5 h-3.5" /> Yapay zeka asistanı
        </div>
        <p className="text-[11px] text-indigo-900/70 mt-1">
          {assistantContext.chat_ready
            ? "Bu sayfanın özeti ve makaleleri asistan bağlamına eklendi."
            : "Sayfa özeti ve makaleler asistan bağlamına hazır; sohbet uç noktası henüz bağlı değil."}
        </p>
        {(assistantContext.suggested_prompts || []).slice(0, 2).map((p) => (
          <button
            key={p}
            type="button"
            className="mt-1 block w-full text-left text-[11px] text-indigo-700 hover:underline"
            onClick={() => openHelpCenter(p)}
          >
            “{p}”
          </button>
        ))}
      </div>
    </div>
  );
}
