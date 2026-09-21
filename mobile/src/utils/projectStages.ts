/** Firma ayarlarından gelen proje aşamaları (web `projectStages.js` ile aynı kural). */
export type ProjectStage = {
  key: string;
  label: string;
  tone?: string;
  is_final?: boolean;
};

export const DEFAULT_PROJECT_STAGES: ProjectStage[] = [
  { key: "planning", label: "Planlama", tone: "slate" },
  { key: "active", label: "Devam Ediyor", tone: "blue" },
  { key: "on_hold", label: "Beklemede", tone: "amber" },
  { key: "completed", label: "Tamamlandı", tone: "emerald", is_final: true },
];

export function normalizeProjectStages(raw?: ProjectStage[] | null): ProjectStage[] {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set<string>();
  const out: ProjectStage[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const key = String(row.key || "").trim();
    const label = String(row.label || "").trim();
    if (!key || !label || used.has(key)) continue;
    used.add(key);
    out.push({ key, label, tone: row.tone, is_final: !!row.is_final });
  }
  if (out.length < 2) return DEFAULT_PROJECT_STAGES.map((s) => ({ ...s }));
  if (!out.some((s) => s.is_final)) {
    out[out.length - 1] = { ...out[out.length - 1], is_final: true };
  }
  let sawFinal = false;
  return out.map((s) => {
    if (!s.is_final) return s;
    if (sawFinal) return { ...s, is_final: false };
    sawFinal = true;
    return s;
  });
}

export function finalProjectStageKey(stages?: ProjectStage[] | null): string {
  const list = normalizeProjectStages(stages);
  return (list.find((s) => s.is_final) || list[list.length - 1]).key;
}

export function isCompletedProjectStatus(status?: string | null, stages?: ProjectStage[] | null): boolean {
  const key = String(status || "").trim();
  if (!key) return false;
  const lower = key.toLocaleLowerCase("tr-TR");
  if (lower === "completed" || lower === "tamamlandı") return true;
  const list = normalizeProjectStages(stages);
  if (key === finalProjectStageKey(list)) return true;
  const row = list.find((s) => s.key === key);
  return Boolean(row?.is_final || /tamamland/i.test(row?.label || ""));
}
