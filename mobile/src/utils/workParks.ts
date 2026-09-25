export type WorkPark = { id: string; name: string };
export type OfficeTaskType = { id: string; name: string };

export function normalizeNamedList(raw?: unknown, prefix = "item"): WorkPark[] {
  const rows = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  const out: WorkPark[] = [];
  rows.forEach((row, i) => {
    const name = String(typeof row === "string" ? row : ((row as { name?: string; label?: string })?.name || (row as { label?: string })?.label || "")).trim();
    if (!name) return;
    let id = String((typeof row === "object" && row && ((row as { id?: string }).id || (row as { key?: string }).key)) || "").trim();
    if (!id || used.has(id)) id = `${prefix}_${i}`;
    used.add(id);
    out.push({ id, name: name.slice(0, 80) });
  });
  return out.slice(0, 40);
}

export function normalizeWorkParks(raw?: unknown): WorkPark[] {
  return normalizeNamedList(raw, "park");
}

export function normalizeOfficeTaskTypes(raw?: unknown): OfficeTaskType[] {
  return normalizeNamedList(raw, "ot");
}

export function parkSelectGroups(parks?: unknown) {
  const rows = normalizeWorkParks(parks);
  if (!rows.length) return [];
  return [{ label: "Parkurlar", options: rows.map((p) => ({ value: p.id, label: p.name })) }];
}

export function officeTaskTypeSelectGroups(types?: unknown) {
  const rows = normalizeOfficeTaskTypes(types);
  if (!rows.length) return [];
  return [{ label: "İç görevler", options: rows.map((t) => ({ value: t.id, label: t.name })) }];
}

/** Atölye istasyon filtresi: parkur adları; parkur yoksa iş emri istasyonları. */
export function stationNamesFromParks(parks?: unknown, fallback?: string[]): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const p of normalizeWorkParks(parks)) {
    const name = p.name.trim();
    const key = name.toLocaleLowerCase("tr-TR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  if (names.length) return names;
  for (const s of fallback || []) {
    const name = String(s || "").trim();
    const key = name.toLocaleLowerCase("tr-TR");
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return names;
}

export function findWorkPark(parks: unknown, parkId?: string | null): WorkPark | null {
  return normalizeWorkParks(parks).find((p) => p.id === String(parkId || "")) || null;
}

export function findOfficeTaskType(types: unknown, typeId?: string | null): OfficeTaskType | null {
  return normalizeOfficeTaskTypes(types).find((t) => t.id === String(typeId || "")) || null;
}

export function validateOfficeTaskAssign(taskTypeId?: string | null): string | null {
  if (!taskTypeId) return "İç görev seçin.";
  return null;
}

export function officeTaskPayload(taskType: OfficeTaskType | WorkPark | null | undefined, title: string, park?: WorkPark | null) {
  const type = taskType || { id: "", name: "" };
  return {
    task_type_id: type.id || "",
    task_type_name: type.name || "",
    park_id: park?.id || type.id || "",
    park_name: park?.name || type.name || "",
    title: String(title || "").trim() || type.name || "İç görev",
  };
}
