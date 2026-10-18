import React, { useState } from "react";
import { CheckCircle2, Users } from "lucide-react";
import { addressToggleLabel, shouldCollapseAddress } from "../utils/addressToggle";
import { TrackingBadge } from "./ProjectTrackingModal";
import { ProjectStageStepper } from "./ProjectStageStepper";
import { ProjectMoneyLine } from "./ProjectMoneyLine";
import { ProjectPhotoStrip } from "./ProjectPhotoStrip";
import { ProjectProductionSummary } from "./ProjectProductionSummary";
import { ProjectActionsMenu } from "./ProjectActionsMenu";

export function projectCompleteMessage(project) {
  return `${project?.name || project?.project_number} projesi tamamlandı olarak işaretlensin mi?`;
}

function statusParts(status, statusMap, statusFallback) {
  return (statusMap && statusMap[status]) || (statusFallback && statusFallback[status]) || [status, "bg-slate-100"];
}

export function ProjectTaskBadge({ project, onOpen, withTestIds = true }) {
  const tasks = project?.tasks || [];
  if (!tasks.length) return null;
  const assigned = tasks.filter((task) => task.assignee_name || task.assignee_id);
  const done = tasks.filter((task) => task.done || task.status === "done" || task.status === "completed").length;
  const number = project.project_number;
  return (
    <div className="flex flex-wrap gap-1.5 text-[10px]" data-testid={withTestIds ? `project-summary-${number}` : undefined}>
      <button
        type="button"
        onClick={() => onOpen?.(project)}
        className="inline-flex items-center gap-1 rounded-md border border-indigo-100 bg-indigo-50 px-2 py-0.5 font-semibold text-indigo-700 hover:bg-indigo-100"
        data-testid={withTestIds ? `project-tasks-${project.id || number}` : undefined}
        title="Görev ve atamaları aç"
      >
        <Users className="h-3 w-3" /> {done}/{tasks.length} görev{assigned.length ? ` · ${assigned.length} atanmış` : ""}
      </button>
    </div>
  );
}

export function ProjectRowCard({
  project,
  stages,
  finalStage,
  statusMap,
  statusFallback,
  quotes,
  completed = false,
  flashed = false,
  selected = false,
  onSetStatus,
  onAddQuote,
  onEdit,
  onPrintQuote,
  onExpense,
  onTeam,
  onTrack,
  onDelete,
  onOpenDetail,
}) {
  const [addrOpen, setAddrOpen] = useState(false);
  const number = project?.project_number;
  const [statusLabel, statusClass] = statusParts(project?.status, statusMap, statusFallback);
  const showAddress = project?.address && (!shouldCollapseAddress(project.address) || addrOpen);
  const finished = project?.status === finalStage;

  const selectStage = (stage) => {
    if (!stage?.key) return;
    if (stage.key === finalStage && !window.confirm(projectCompleteMessage(project))) return;
    onSetStatus?.("projects", project.id, stage.key);
  };

  const completeProject = () => {
    if (!window.confirm(projectCompleteMessage(project))) return;
    onSetStatus?.("projects", project.id, finalStage);
  };

  return (
    <div
      className={`flex w-full flex-col gap-2 rounded-2xl border bg-white p-4 text-xs ring-offset-2 transition [content-visibility:auto] [contain-intrinsic-size:auto_280px] ${completed ? "border-emerald-200" : "border-slate-200"} ${flashed ? "border-emerald-400 shadow-md ring-2 ring-emerald-500" : selected ? "ring-2 ring-emerald-500" : ""}`}
      data-testid={`project-card-${number}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="min-w-0 md:w-[34%] md:shrink-0">
          <div className="font-mono text-[10px] text-slate-400">
            {project.project_number}{project.quote_number ? ` · ${project.quote_number}` : ""}
          </div>
          <div className="truncate text-sm font-bold text-slate-900">{project.name}</div>
          <div className="text-slate-500">
            {project.contact_name || "—"}
            {showAddress ? ` • ${project.address}` : ""}
            {shouldCollapseAddress(project.address) ? (
              <button
                type="button"
                onClick={() => setAddrOpen((open) => !open)}
                className="ml-1 font-semibold text-emerald-700"
                data-testid={`project-addr-toggle-${project.id}`}
              >
                {addressToggleLabel(addrOpen)}
              </button>
            ) : null}
          </div>
        </div>
        <span className={`w-fit shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${statusClass}`}>{statusLabel}</span>
        <div className="min-w-0 flex-1">
          <ProjectStageStepper
            project={project}
            stages={stages}
            statusFallback={statusFallback}
            onSelect={selectStage}
          />
        </div>
      </div>

      <ProjectMoneyLine project={project} onAddQuote={onAddQuote} onEdit={onEdit} />
      {project.description ? <p className="truncate text-slate-500">{project.description}</p> : null}
      <ProjectProductionSummary project={project} />
      <ProjectTaskBadge project={project} onOpen={onTeam} />

      <div className="mt-auto flex flex-col gap-2 border-t border-slate-100 pt-2 md:flex-row md:items-center md:justify-between">
        <ProjectPhotoStrip project={project} stages={stages} onOpenPhotos={() => onOpenDetail?.("photos")} />
        <div className="flex flex-wrap items-center justify-end gap-1.5" data-testid={`project-quick-actions-${number}`}>
          <TrackingBadge project={project} />
          <button
            type="button"
            onClick={() => onAddQuote?.(project)}
            className="inline-flex items-center gap-1 rounded-xl bg-emerald-600 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-700"
            data-testid={`project-add-quote-${number}`}
            title="Bu projeye yeni teklif ekle"
          >
            ＋ Teklif Ekle
          </button>
          {finished ? (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 font-semibold text-emerald-800" data-testid={`project-completed-${number}`}>
              <CheckCircle2 className="h-3.5 w-3.5" /> {statusMap?.[finalStage]?.[0] || "Proje Tamamlandı"}
            </span>
          ) : (
            <button
              type="button"
              onClick={completeProject}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-700 px-2.5 py-1.5 font-semibold text-white hover:bg-emerald-800"
              data-testid={`project-complete-${number}`}
              title="Projeyi tamamlandı yap"
            >
              <CheckCircle2 className="h-3.5 w-3.5" /> Projeyi Tamamla
            </button>
          )}
          <ProjectActionsMenu
            project={project}
            quotes={quotes}
            onEdit={onEdit}
            onPrintQuote={onPrintQuote}
            onExpense={onExpense}
            onTeam={onTeam}
            onTrack={onTrack}
            onOpenDetail={onOpenDetail}
            onDelete={onDelete}
          />
        </div>
      </div>
    </div>
  );
}
