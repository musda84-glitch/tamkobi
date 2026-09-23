export type DutyWorkflowStep = {
  id?: string;
  title?: string;
  done?: boolean;
  assignee_name?: string;
  kind?: string;
};

export type DutyPhoto = {
  url: string;
  stage?: string;
  stage_label?: string;
  created_at?: string;
  visibility?: "pending" | "show" | "hide" | string;
  visibility_label?: string;
  customer_visible?: boolean;
  source?: string;
};

export type AssignedDuty = {
  id?: string;
  title?: string;
  done?: boolean;
  kind?: string;
  park_name?: string;
  project_id?: string;
  project_name?: string;
  project_number?: string;
  due_date?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
  address?: string | null;
  location_url?: string | null;
  workflow?: DutyWorkflowStep[];
  photos?: DutyPhoto[];
};

export const DUTY_MAPS_ACTION = "Konuma Git";

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

export function dutyIsField(t?: AssignedDuty | null): boolean {
  return (t?.kind || "field") !== "office";
}

export function dutyHasProject(t?: AssignedDuty | null): boolean {
  return Boolean(t?.project_id || t?.project_number || (dutyIsField(t) && t?.project_name));
}

export function dutyWorkflow(t?: AssignedDuty | null): DutyWorkflowStep[] {
  return Array.isArray(t?.workflow) ? t!.workflow! : [];
}

export function dutyWorkflowProgress(t?: AssignedDuty | null): { done: number; total: number } {
  const rows = dutyWorkflow(t);
  return { done: rows.filter((s) => s.done).length, total: rows.length };
}

export function dutyPhotos(t?: AssignedDuty | null): DutyPhoto[] {
  return Array.isArray(t?.photos) ? t!.photos! : [];
}

export function photoVisibility(p?: DutyPhoto | null): "pending" | "show" | "hide" {
  if (p?.visibility === "show" || p?.customer_visible === true) return "show";
  if (p?.visibility === "hide") return "hide";
  if (p?.source === "employee" || p?.customer_visible === false || p?.visibility === "pending") return "pending";
  return "show";
}

export function photoVisibilityLabel(p?: DutyPhoto | null): string {
  if (p?.visibility_label) return p.visibility_label;
  const vis = photoVisibility(p);
  return vis === "show" ? "Müşteri görür" : vis === "hide" ? "Müşteri görmez" : "Onay bekliyor";
}
