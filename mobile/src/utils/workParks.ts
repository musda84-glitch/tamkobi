export type WorkPark = { id: string; name: string };

export function normalizeWorkParks(raw?: unknown): WorkPark[] {
  const rows = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  const out: WorkPark[] = [];
  rows.forEach((row, i) => {
    const name = String(typeof row === "string" ? row : ((row as { name?: string; label?: string })?.name || (row as { label?: string })?.label || "")).trim();
    if (!name) return;
    let id = String((typeof row === "object" && row && ((row as { id?: string }).id || (row as { key?: string }).key)) || "").trim();
    if (!id || used.has(id)) id = `park_${i}`;
    used.add(id);
    out.push({ id, name: name.slice(0, 80) });
  });
  return out.slice(0, 40);
}

export function parkSelectGroups(parks?: unknown) {
  const rows = normalizeWorkParks(parks);
  if (!rows.length) return [];
  return [{ label: "Parkurlar", options: rows.map((p) => ({ value: p.id, label: p.name })) }];
}

export function findWorkPark(parks: unknown, parkId?: string | null): WorkPark | null {
  return normalizeWorkParks(parks).find((p) => p.id === String(parkId || "")) || null;
}

export function validateOfficeTaskAssign(parkId?: string | null): string | null {
  if (!parkId) return "Parkur seçin.";
  return null;
}

export function officeTaskPayload(park: WorkPark | null | undefined, title: string) {
  return {
    park_id: park?.id || "",
    park_name: park?.name || "",
    title: String(title || "").trim() || park?.name || "İç görev",
  };
}
