import React, { useState } from "react";
import { Eye, EyeOff } from "lucide-react";

export function ProjectStepsVisibility({ project }) {
  const visible = !!project?.show_production_steps;
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-semibold ${visible ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
      title={visible ? "Müşteri takip linkinde görünür" : "Sadece iç ekranda"}
    >
      {visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
      {visible ? "Müşteri görür" : "Gizli"}
    </span>
  );
}

export function ProjectStepList({ steps = [], limit }) {
  const shown = limit ? steps.slice(0, limit) : steps;
  return (
    <ol className="space-y-0.5">
      {shown.map((step, index) => (
        <li key={`${step.no || index}-${step.name}`} className="flex gap-1.5 text-[11px] text-slate-700">
          <span className="shrink-0 font-mono text-slate-400">{step.no || index + 1}.</span>
          <span className="min-w-0 truncate">
            <span className="font-semibold">{step.name}</span>
            {step.station ? <span className="text-slate-400">{` · ${step.station}`}</span> : null}
          </span>
        </li>
      ))}
      {limit && steps.length > limit ? (
        <li className="text-[10px] font-semibold text-slate-400">{`+${steps.length - limit} adım daha`}</li>
      ) : null}
    </ol>
  );
}

export function ProjectProductionSummary({ project }) {
  const steps = project?.production_steps || [];
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const number = project?.project_number;
  const ref = project?.production_order_code || project?.recipe_name;
  const first = steps[0];
  const parts = ["Üretim adımları"];
  if (ref) parts.push(ref);
  parts.push(`${steps.length} adım`);
  if (first?.name) parts.push(`1. ${first.name}`);

  return (
    <div className="space-y-1 rounded-xl border border-slate-100 bg-slate-50/80 px-2.5 py-2" data-testid={`project-recipe-steps-${number}`}>
      <div className="flex min-w-0 items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-[11px] text-slate-700">{`🏭 ${parts.join(" · ")}`}</p>
        <ProjectStepsVisibility project={project} />
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="shrink-0 font-semibold text-emerald-700"
          data-testid={`project-steps-toggle-${number}`}
        >
          {open ? "Adımları gizle ▴" : "Adımları göster ▾"}
        </button>
      </div>
      {open ? <ProjectStepList steps={steps} limit={6} /> : null}
    </div>
  );
}
