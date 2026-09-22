export function workplaceDays(w) {
  const n = Math.trunc(Number(w?.duration_days) || 0);
  return n > 0 ? n : 0;
}

export function workplaceHint(w, requireGeo = true) {
  if (!w) return "İş yeri konumu tanımsız — konumsuz giriş";
  const place = [w.task_title, w.project_name || w.label].filter(Boolean).join(" · ");
  const days = workplaceDays(w);
  const daysPart = days ? ` · ${days} gün` : "";
  if (w.kind === "task") {
    if (w.has_coords) {
      const radius = w.radius_m || 300;
      return `Dış görev: ${place}${daysPart} · görev yeri iş yeri${requireGeo ? ` · girişte ${radius} m` : ""}`;
    }
    return `Dış görev: ${place}${daysPart} · görev yeri iş yeri (konum yok — konumsuz giriş)`;
  }
  const radius = w.radius_m ? ` · ${w.radius_m} m` : "";
  return `Firma konumu${radius}${requireGeo ? " (yalnızca girişte)" : ""}`;
}

export function workplaceShort(w) {
  if (!w || w.kind !== "task") return "";
  const title = w.task_title || "Görev";
  const proj = w.project_number || w.project_name || "";
  const days = workplaceDays(w);
  const base = proj ? `${title} · ${proj}` : title;
  return days ? `${base} · ${days} gün` : base;
}
