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
  duration_days?: number | null;
};

export function workplaceDays(w?: Workplace | null): number {
  const n = Math.trunc(Number(w?.duration_days) || 0);
  return n > 0 ? n : 0;
}

export function workplaceHint(w?: Workplace | null, requireGeo = true): string {
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

export function workplaceShort(w?: Workplace | null): string {
  if (!w || w.kind !== "task") return "";
  const title = w.task_title || "Görev";
  const proj = w.project_number || w.project_name || "";
  const days = workplaceDays(w);
  const base = proj ? `${title} · ${proj}` : title;
  return days ? `${base} · ${days} gün` : base;
}

type ProjectForWorkplace = {
  id?: string;
  _id?: string;
  name?: string;
  project_number?: string;
  status?: string;
  latitude?: number | null;
  longitude?: number | null;
  address?: string;
  location_url?: string;
  tasks?: Array<{
    id?: string;
    title?: string;
    name?: string;
    done?: boolean;
    status?: string;
    assignee_id?: string | null;
    due_date?: string | null;
    duration_days?: number | null;
  }>;
  radius_m?: number | null;
};

/** Açık dış görev atamasından kart iş yeri (API workplace yoksa). */
export function fieldWorkplaceFromProjects(
  projects: ProjectForWorkplace[] | null | undefined,
  employeeId: string,
): Workplace | null {
  const eid = String(employeeId || "");
  if (!eid) return null;
  for (const p of projects || []) {
    if ((p.status || "") === "completed") continue;
    for (const t of p.tasks || []) {
      if (String(t.assignee_id || "") !== eid) continue;
      if (t.done || ["done", "completed", "tamamlandi"].includes(String(t.status || ""))) continue;
      const lat = p.latitude;
      const lng = p.longitude;
      const has = lat != null && lng != null && !(Number(lat) === 0 && Number(lng) === 0);
      return {
        kind: "task",
        label: p.name || t.title || "Dış görev",
        task_id: t.id,
        task_title: t.title || t.name || "Görev",
        project_id: p.id || p._id,
        project_name: p.name,
        project_number: p.project_number,
        due_date: t.due_date,
        duration_days: workplaceDays({ duration_days: t.duration_days, kind: "task" }) || undefined,
        latitude: has ? Number(lat) : null,
        longitude: has ? Number(lng) : null,
        has_coords: !!has,
        address: p.address,
        location_url: p.location_url,
        radius_m: p.radius_m != null ? Number(p.radius_m) : undefined,
      };
    }
  }
  return null;
}
