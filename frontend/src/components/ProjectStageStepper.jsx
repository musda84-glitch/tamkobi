import React from "react";
import { Check } from "lucide-react";

export function ProjectStageStepper({
  project,
  stages = [],
  statusFallback,
  onSelect,
}) {
  const number = project?.project_number;
  const list = Array.isArray(stages) ? stages : [];
  const currentIndex = list.findIndex((stage) => stage.key === project?.status);
  const known = currentIndex >= 0;
  const otherLabel = !known && project?.status
    ? (statusFallback?.[project.status]?.[0] || project.status)
    : "";

  return (
    <div
      className="flex items-center gap-1 overflow-x-auto pb-0.5"
      data-testid={`project-status-${number}`}
    >
      {otherLabel ? (
        <span
          className="shrink-0 rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500"
          data-testid={`project-stage-other-${number}`}
        >
          {`Diğer: ${otherLabel}`}
        </span>
      ) : null}
      {list.map((stage, index) => {
        const done = known && index < currentIndex;
        const current = known && index === currentIndex;
        return (
          <button
            key={stage.key}
            type="button"
            aria-current={current ? "step" : undefined}
            aria-label={`Aşama: ${stage.label}`}
            data-testid={`project-stage-step-${number}-${stage.key}`}
            onClick={() => onSelect?.(stage)}
            className="flex min-w-[4.25rem] shrink-0 flex-col items-center gap-1 rounded-lg px-1 py-0.5 hover:bg-slate-50"
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full border-2 text-[10px] font-bold ${
                done
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : current
                    ? "border-blue-600 bg-blue-600 text-white ring-2 ring-blue-200"
                    : "border-slate-300 bg-white text-slate-400"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : index + 1}
            </span>
            <span
              className={`max-w-[5.5rem] truncate text-center text-[10px] font-semibold leading-tight ${
                current ? "text-blue-700" : done ? "text-emerald-700" : "text-slate-400"
              }`}
            >
              {stage.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
