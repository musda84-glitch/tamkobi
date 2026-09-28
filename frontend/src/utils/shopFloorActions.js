/** Atölye kartı aksiyonları — durum → hangi butonlar. */
export function shopFloorCardActions(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "ready") return { start: true, pause: false, resume: false, finish: false };
  if (s === "in_progress" || s === "running" || s === "active") {
    return { start: false, pause: true, resume: false, finish: true };
  }
  if (s === "paused" || s === "pause") {
    return { start: false, pause: false, resume: true, finish: true };
  }
  return { start: false, pause: false, resume: false, finish: false };
}

export function shopFloorCardBorder(status) {
  const s = String(status || "").trim().toLowerCase();
  if (s === "in_progress" || s === "running" || s === "active") {
    return "border-amber-400 shadow-lg shadow-amber-100";
  }
  if (s === "paused" || s === "pause") return "border-orange-300";
  if (s === "ready") return "border-blue-200";
  return "border-slate-200";
}
