import React from "react";
import { Users } from "lucide-react";
import { HoverImageThumb } from "../utils/HoverImageThumb";
import { PROJECT_STAFF_WORK_EMPTY, PROJECT_STAFF_WORK_TITLE, projectStaffWork } from "../utils/projectStaffWork";

export function ProjectStaffWork({ project, testId = "project-staff-work" }) {
  const people = projectStaffWork(project?.tasks, project?.stage_photos);
  return (
    <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-2.5 space-y-2" data-testid={testId}>
      <div className="text-[11px] font-bold text-indigo-900 flex items-center gap-1.5">
        <Users className="w-3.5 h-3.5" /> {PROJECT_STAFF_WORK_TITLE}
      </div>
      <p className="text-[10px] text-indigo-800/80">Görevli personelin yaptığı işler ve yüklediği fotoğraflar</p>
      {!people.length ? (
        <div className="text-[10px] text-slate-500" data-testid={`${testId}-empty`}>{PROJECT_STAFF_WORK_EMPTY}</div>
      ) : null}
      {people.map((person) => (
        <div key={person.key} className="bg-white border border-indigo-100 rounded-lg p-2 space-y-1.5" data-testid={`${testId}-person-${person.key}`}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-[11px] font-bold text-slate-900">{person.name}</div>
              <div className="text-[10px] text-slate-500">{person.label}</div>
            </div>
            <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${person.done === person.total && person.total ? "bg-emerald-50 text-emerald-700" : "bg-indigo-50 text-indigo-700"}`}>
              {person.done === person.total && person.total ? "Tamam" : "Açık"}
            </span>
          </div>
          {person.tasks.map((task) => (
            <div key={task.id || task.title} data-testid={`${testId}-task-${task.id}`}>
              <div className={`text-[11px] font-semibold ${task.done ? "text-emerald-700" : "text-slate-800"}`}>
                {task.done ? "✓" : "○"} {task.title}{task.due_date ? ` · ${task.due_date}` : ""}
              </div>
              {task.photos.length ? (
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {task.photos.map((p) => (
                    <HoverImageThumb
                      key={p.url}
                      src={p.url}
                      alt={task.title}
                      className="w-12 h-12 rounded-md object-cover border"
                      testId={`${testId}-photo`}
                    />
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
