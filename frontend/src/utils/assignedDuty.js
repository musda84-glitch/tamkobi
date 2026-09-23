export const DUTY_MAPS_ACTION = "Görev yerine git";
export const DUTY_SITE_ACTION = DUTY_MAPS_ACTION;
export const DUTY_ATOLYE_ACTION = "Atölyeye git";
export const DUTY_COMPLETE_ACTION = "Görev tamamlandı";
export const DUTY_COMPLETE_BUSY = "Tamamlanıyor…";
export const DUTY_COMPLETE_APPROVED = "Onaylı";
export const DUTY_COMPLETE_CONFIRM = "Görevi onaylayıp tamamlandı işaretlensin mi?";

export function dutyCompleteTitle({ done, busy } = {}) {
  if (done) return DUTY_COMPLETE_APPROVED;
  return busy ? DUTY_COMPLETE_BUSY : DUTY_COMPLETE_ACTION;
}

export function matchAssignedDuty(tasks, current) {
  if (!current) return null;
  const id = String(current.id || "").trim();
  const title = String(current.title || "").trim();
  return (tasks || []).find((t) => (id && String(t.id || "") === id) || (title && String(t.title || "") === title)) || null;
}
export const DUTY_PHOTOS_HINT = "İş fotoğrafları — müşteri görmesi yönetici onayına bağlı";
export const DUTY_PHOTO_SHOW = "Görsün";
export const DUTY_PHOTO_HIDE = "Görmesin";

export function dutySubtitle(t) {
  if (!t) return "";
  if (t.kind === "office") {
    return [t.park_name || t.project_name, t.due_date ? `son ${t.due_date}` : null].filter(Boolean).join(" · ");
  }
  return [t.project_number, t.project_name || t.park_name, t.due_date ? `son ${t.due_date}` : null].filter(Boolean).join(" · ");
}

export function dutyIsField(t) {
  return (t?.kind || "field") !== "office";
}

export function dutyHasProject(t) {
  return Boolean(t?.project_id || t?.project_number || (dutyIsField(t) && t?.project_name));
}

export function dutyWorkflow(t) {
  return Array.isArray(t?.workflow) ? t.workflow : [];
}

export function dutyWorkflowProgress(t) {
  const rows = dutyWorkflow(t);
  return { done: rows.filter((s) => s.done).length, total: rows.length };
}

export function dutyPhotos(t) {
  const rows = Array.isArray(t?.photos) ? t.photos : [];
  const tid = String(t?.id || "").trim();
  if (!tid) return rows;
  const tagged = rows.filter((p) => String(p.task_id || "").trim());
  if (!tagged.length) return rows;
  return tagged.filter((p) => String(p.task_id || "") === tid);
}

export function dutyShowAtolye(t, allow = true) {
  return Boolean(allow) && !dutyIsField(t);
}

export function dutyShowSite(t) {
  return dutyIsField(t);
}

export function dutySiteHint(t) {
  const parts = [t?.project_number, t?.project_name || t?.park_name, t?.address].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Görev yeri konumu henüz eklenmemiş.";
}

export function dutyKindLabel(t) {
  return dutyIsField(t) ? "Dış görev" : "İç görev";
}

export function photoVisibility(p) {
  if (p?.visibility === "show" || p?.customer_visible === true) return "show";
  if (p?.visibility === "hide") return "hide";
  if (p?.source === "employee" || p?.customer_visible === false || p?.visibility === "pending") return "pending";
  return "show";
}

export function photoVisibilityLabel(p) {
  if (p?.visibility_label) return p.visibility_label;
  const vis = photoVisibility(p);
  return vis === "show" ? "Müşteri görür" : vis === "hide" ? "Müşteri görmez" : "Onay bekliyor";
}

export function pendingDutyPhotoCount(tasks) {
  return (tasks || []).reduce((n, t) => {
    if (!dutyIsField(t)) return n;
    return n + dutyPhotos(t).filter((p) => photoVisibility(p) === "pending").length;
  }, 0);
}

export function applyDutyPhotoVisibility(photos, url, visible) {
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
