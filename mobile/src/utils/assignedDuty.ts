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
export const DUTY_COMPLETE_APPROVED = "Onaylı";
export const DUTY_COMPLETE_CONFIRM = "Görevi onaylayıp tamamlandı işaretlensin mi?";

export function dutyCompleteTitle(opts?: { done?: boolean; busy?: boolean }): string {
  if (opts?.done) return DUTY_COMPLETE_APPROVED;
  return opts?.busy ? DUTY_COMPLETE_BUSY : DUTY_COMPLETE_ACTION;
}

export function matchAssignedDuty<T extends { id?: string; title?: string; project_number?: string; project_name?: string }>(
  tasks: T[] | null | undefined,
  current?: { id?: string; title?: string; project?: string } | null,
): T | null {
  if (!current) return null;
  const id = String(current.id || "").trim();
  const title = String(current.title || "").trim();
  const project = String(current.project || "").trim();
  const rows = tasks || [];
  return (
    rows.find((t) => id && String(t.id || "") === id)
    || rows.find((t) => title && String(t.title || "") === title)
    || rows.find((t) => {
      if (!project) return false;
      const num = String(t.project_number || "");
      const name = String(t.project_name || "");
      return (num && project.includes(num)) || (name && project.includes(name));
    })
    || null
  );
}

export function dutyFromCurrent(opts: {
  tasks?: AssignedDuty[] | null;
  current?: { id?: string; title?: string; project?: string; done?: boolean } | null;
  workplace?: {
    kind?: string;
    task_id?: string;
    task_title?: string;
    project_id?: string;
    project_name?: string;
    project_number?: string;
    label?: string;
    address?: string | null;
    latitude?: number | string | null;
    longitude?: number | string | null;
    location_url?: string | null;
    due_date?: string | null;
  } | null;
}): AssignedDuty | null {
  const matched = matchAssignedDuty(opts.tasks, opts.current);
  const wp = opts.workplace?.kind === "task" ? opts.workplace : null;
  if (!matched && !opts.current && !wp) return null;
  const projectBits = String(opts.current?.project || "").split(" · ").map((s) => s.trim()).filter(Boolean);
  return {
    ...(matched || {}),
    id: matched?.id || opts.current?.id || wp?.task_id,
    title: matched?.title || opts.current?.title || wp?.task_title || "Görev",
    kind: matched?.kind || "field",
    project_id: matched?.project_id || wp?.project_id,
    project_name: matched?.project_name || wp?.project_name || wp?.label || projectBits[1],
    project_number: matched?.project_number || wp?.project_number || projectBits[0],
    address: matched?.address || wp?.address,
    latitude: matched?.latitude ?? wp?.latitude,
    longitude: matched?.longitude ?? wp?.longitude,
    location_url: matched?.location_url || wp?.location_url,
    due_date: matched?.due_date || wp?.due_date || undefined,
    done: matched?.done ?? opts.current?.done ?? false,
    photos: matched?.photos,
    workflow: matched?.workflow,
    park_name: matched?.park_name,
  };
}
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
