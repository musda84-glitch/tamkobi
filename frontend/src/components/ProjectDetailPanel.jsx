import React, { useEffect } from "react";
import { ProjectStagePhotos } from "./ProjectStagePhotos";
import { TrackingBadge } from "./ProjectTrackingModal";
import { ProjectMoneyLine } from "./ProjectMoneyLine";
import { projectPhotoItems } from "./ProjectPhotoStrip";
import { ProjectStepList, ProjectStepsVisibility } from "./ProjectProductionSummary";
import { ProjectPrintQuoteControl } from "./ProjectActionsMenu";
import { ProjectTaskBadge } from "./ProjectRowCard";
import { formatTrAmount } from "../utils/money";

const fmt = (n) => formatTrAmount(n || 0);

const TABS = [
  ["photos", "Fotoğraflar"],
  ["production", "Üretim"],
  ["money", "Teklif & Masraf"],
  ["tasks", "Görevler"],
  ["tracking", "Takip"],
];

export function ProjectDetailPanel({
  project,
  tab = "photos",
  onTabChange,
  onClose,
  stages = [],
  quotes = [],
  onUpdated,
  onAddQuote,
  onEdit,
  onPrintQuote,
  onExpense,
  onTeam,
  onTrack,
}) {
  useEffect(() => {
    if (!project) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") onClose?.();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [project, onClose]);

  if (!project) return null;
  const number = project.project_number;
  const photoCount = projectPhotoItems(project).length;
  const steps = project.production_steps || [];
  const counts = { photos: photoCount, production: steps.length };

  return (
    <div className="max-lg:contents lg:sticky lg:top-4 lg:z-10 lg:w-[380px] lg:shrink-0 lg:self-start">
      <button
        type="button"
        className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden"
        aria-label="Paneli kapat"
        data-testid="project-detail-backdrop"
        onClick={() => onClose?.()}
      />
      <aside
        className="fixed inset-y-0 right-0 z-50 flex w-full max-w-[380px] flex-col overflow-y-auto border-l border-slate-200 bg-white shadow-xl lg:static lg:max-h-[calc(100vh-2rem)] lg:w-full lg:overflow-y-auto lg:rounded-2xl lg:border lg:shadow-sm"
        data-testid="project-detail-panel"
      >
        <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-3 py-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] text-slate-400">{project.project_number}</div>
            <div className="truncate text-sm font-bold text-slate-900">{project.name}</div>
            <div className="truncate text-xs text-slate-500">{project.contact_name || "—"}</div>
          </div>
          <button type="button" onClick={() => onClose?.()} className="text-slate-400 hover:text-slate-700" aria-label="Kapat" data-testid="project-detail-close">
            ✕
          </button>
        </div>
        <div className="flex gap-1 overflow-x-auto border-b border-slate-100 px-2" role="tablist">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => onTabChange?.(id)}
              className={`shrink-0 border-b-2 px-2 py-2 text-[11px] font-semibold ${tab === id ? "border-emerald-600 text-emerald-700" : "border-transparent text-slate-500"}`}
              data-testid={`project-detail-tab-${id}`}
            >
              {counts[id] != null ? `${label} (${counts[id]})` : label}
            </button>
          ))}
        </div>
        <div className="space-y-3 p-3 text-xs">
          {tab === "photos" && (
            <ProjectStagePhotos project={project} stages={stages} onUpdated={onUpdated} />
          )}
          {tab === "production" && (
            steps.length ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold text-slate-800">
                    {project.production_order_code || project.recipe_name || "Üretim adımları"}
                  </div>
                  <ProjectStepsVisibility project={project} />
                </div>
                <ProjectStepList steps={steps} />
              </div>
            ) : <p className="text-slate-400">Üretim adımı yok.</p>
          )}
          {tab === "money" && (
            <div className="space-y-3">
              <ProjectMoneyLine project={project} onAddQuote={onAddQuote} onEdit={onEdit} />
              <ul className="space-y-1">
                {quotes.length ? quotes.map((quote) => (
                  <li key={quote.id || quote.quote_number} className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 px-2 py-1.5" data-testid={`project-detail-quote-${quote.quote_number}`}>
                    <span className="min-w-0 truncate font-mono font-semibold">{quote.quote_number}{quote.title ? ` · ${quote.title}` : ""}</span>
                    <span className="shrink-0 font-semibold">{fmt(quote.grand_total)} ₺</span>
                  </li>
                )) : <li className="text-slate-400">Bağlı teklif yok.</li>}
              </ul>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" onClick={() => onAddQuote?.(project)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 font-semibold text-white" data-testid={`project-detail-add-quote-${number}`}>
                  Teklif Ekle
                </button>
                <ProjectPrintQuoteControl project={project} quotes={quotes} onPrintQuote={onPrintQuote} variant="button" />
                <button type="button" onClick={() => onExpense?.(project)} className="inline-flex items-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-2.5 py-1.5 font-semibold text-rose-800" data-testid={`project-detail-expense-${number}`}>
                  Masraf Ekle
                </button>
              </div>
            </div>
          )}
          {tab === "tasks" && (
            <div className="space-y-2">
              <ProjectTaskBadge project={project} onOpen={onTeam} withTestIds={false} />
              {!project.tasks?.length ? <p className="text-slate-400">Görev yok.</p> : null}
              <button type="button" onClick={() => onTeam?.(project)} className="inline-flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50 px-2.5 py-1.5 font-semibold text-indigo-800" data-testid={`project-detail-team-${number}`}>
                Personel / Görev
              </button>
            </div>
          )}
          {tab === "tracking" && (
            <div className="space-y-2">
              <TrackingBadge project={project} />
              {!project.tracking?.token ? <p className="text-slate-400">Takip linki henüz yok.</p> : null}
              <button type="button" onClick={() => onTrack?.(project)} className="inline-flex items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-700" data-testid={`project-detail-track-${number}`}>
                Takip Linki gönder
              </button>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}
