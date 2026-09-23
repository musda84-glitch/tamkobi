export type AssignedDuty = {
  id?: string;
  title?: string;
  done?: boolean;
  kind?: string;
  park_name?: string;
  project_name?: string;
  project_number?: string;
  due_date?: string;
};

export function dutySubtitle(t: AssignedDuty): string {
  if (t.kind === "office") {
    return [t.park_name || t.project_name, t.due_date ? `son ${t.due_date}` : null].filter(Boolean).join(" · ");
  }
  return [t.project_number, t.project_name || t.park_name, t.due_date ? `son ${t.due_date}` : null].filter(Boolean).join(" · ");
}

export function openAssignedDuties(tasks: AssignedDuty[] | null | undefined): AssignedDuty[] {
  return (tasks || []).filter((t) => !t.done);
}

export function dutyStatusLabel(t: AssignedDuty): string {
  return t.done ? "Tamam" : "Açık";
}
