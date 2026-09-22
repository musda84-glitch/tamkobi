export type Workplace = {
  kind?: "task" | "company" | string;
  label?: string;
  latitude?: number | null;
  longitude?: number | null;
  radius_m?: number;
  has_coords?: boolean;
  address?: string;
  location_url?: string;
  task_id?: string;
  task_title?: string;
  project_id?: string;
  project_name?: string;
  project_number?: string;
  due_date?: string | null;
};

export function workplaceHint(w?: Workplace | null, requireGeo = true): string {
  if (!w) return "İş yeri konumu tanımsız — konumsuz giriş";
  const place = [w.task_title, w.project_name || w.label].filter(Boolean).join(" · ");
  if (w.kind === "task") {
    if (w.has_coords) {
      const radius = w.radius_m || 300;
      return `Dış görev: ${place} · görev yeri iş yeri${requireGeo ? ` · girişte ${radius} m` : ""}`;
    }
    return `Dış görev: ${place} · görev yeri iş yeri (konum yok — konumsuz giriş)`;
  }
  const radius = w.radius_m ? ` · ${w.radius_m} m` : "";
  return `Firma konumu${radius}${requireGeo ? " (yalnızca girişte)" : ""}`;
}

export function workplaceShort(w?: Workplace | null): string {
  if (!w || w.kind !== "task") return "";
  const title = w.task_title || "Görev";
  const proj = w.project_number || w.project_name || "";
  return proj ? `${title} · ${proj}` : title;
}
