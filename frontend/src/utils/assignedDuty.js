export const DUTY_MAPS_ACTION = "Konuma Git";

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
  return Array.isArray(t?.photos) ? t.photos : [];
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
