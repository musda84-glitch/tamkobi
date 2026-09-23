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
  task_id?: string;
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

export const DUTY_MAPS_ACTION = "Görev yerine git";
export const DUTY_SITE_ACTION = DUTY_MAPS_ACTION;
export const DUTY_ATOLYE_ACTION = "Atölyeye git";
export const DUTY_COMPLETE_ACTION = "Görev tamamlandı";
export const DUTY_COMPLETE_BUSY = "Tamamlanıyor…";
export const DUTY_PHOTOS_HINT = "İş fotoğrafları — müşteri görmesi yönetici onayına bağlı";
export const DUTY_PHOTO_SHOW = "Görsün";
export const DUTY_PHOTO_HIDE = "Görmesin";

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
  const rows = Array.isArray(t?.photos) ? t!.photos! : [];
  const tid = String(t?.id || "").trim();
  if (!tid) return rows;
  const tagged = rows.filter((p) => String(p.task_id || "").trim());
  if (!tagged.length) return rows;
  return tagged.filter((p) => String(p.task_id || "") === tid);
}

export function dutyShowAtolye(t?: AssignedDuty | null, allow = true): boolean {
  return Boolean(allow) && !dutyIsField(t);
}

export function dutyShowSite(t?: AssignedDuty | null): boolean {
  return dutyIsField(t);
}

export function dutySiteHint(t?: AssignedDuty | null): string {
  const parts = [t?.project_number, t?.project_name || t?.park_name, t?.address].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Görev yeri konumu henüz eklenmemiş.";
}

export function dutyKindLabel(t?: AssignedDuty | null): string {
  return dutyIsField(t) ? "Dış görev" : "İç görev";
}

export function pendingDutyPhotoCount(tasks?: AssignedDuty[] | null): number {
  return (tasks || []).reduce((n, t) => {
    if (!dutyIsField(t)) return n;
    return n + dutyPhotos(t).filter((p) => photoVisibility(p) === "pending").length;
  }, 0);
}

export function applyDutyPhotoVisibility(photos: DutyPhoto[] | null | undefined, url: string, visible: boolean): DutyPhoto[] {
  const target = String(url || "").trim();
  return (photos || []).map((p) => {
    if (String(p.url || "") !== target) return p;
    return {
      ...p,
      customer_visible: visible,
      visibility: visible ? "show" : "hide",
      visibility_label: visible ? "Müşteri görür" : "Müşteri görmez",
    };
  });
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
