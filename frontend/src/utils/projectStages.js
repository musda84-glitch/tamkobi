/** Varsayılan proje aşamaları (firma ayarlarından özelleştirilir). */
export const DEFAULT_PROJECT_STAGES = [
  { key: "planning", label: "Planlama", tone: "slate" },
  { key: "active", label: "Devam Ediyor", tone: "blue" },
  { key: "on_hold", label: "Beklemede", tone: "amber" },
  { key: "completed", label: "Tamamlandı", tone: "emerald", is_final: true },
];

const TONE_CLASS = {
  slate: "bg-slate-100 text-slate-600",
  blue: "bg-blue-50 text-blue-700",
  amber: "bg-amber-50 text-amber-700",
  emerald: "bg-emerald-50 text-emerald-700",
  rose: "bg-rose-50 text-rose-700",
  violet: "bg-violet-50 text-violet-700",
  indigo: "bg-indigo-50 text-indigo-700",
};

export const PROJECT_STAGE_TONES = Object.keys(TONE_CLASS);

export function stageToneClass(tone) {
  return TONE_CLASS[tone] || TONE_CLASS.slate;
}

export function slugStageKey(label, used = new Set()) {
  const base = String(label || "asama")
    .toLocaleLowerCase("tr-TR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 24) || "asama";
  let key = base;
  let i = 2;
  while (used.has(key)) {
    key = `${base}_${i}`;
    i += 1;
  }
  return key;
}

/** API / şirket kaydından gelen listeyi güvenli varsayılanlara indirger. */
export function normalizeProjectStages(raw) {
  const list = Array.isArray(raw) ? raw : [];
  const used = new Set();
  const out = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    let key = String(row.key || "").trim();
    const label = String(row.label || "").trim();
    if (!label) continue;
    if (!key) key = slugStageKey(label, used);
    if (used.has(key)) continue;
    used.add(key);
    const tone = PROJECT_STAGE_TONES.includes(row.tone) ? row.tone : "slate";
    out.push({
      key,
      label,
      tone,
      is_final: !!row.is_final,
    });
  }
  if (out.length < 2) return DEFAULT_PROJECT_STAGES.map((s) => ({ ...s }));
  if (!out.some((s) => s.is_final)) {
    out[out.length - 1] = { ...out[out.length - 1], is_final: true, tone: out[out.length - 1].tone || "emerald" };
  }
  // Tek final kalsın
  let sawFinal = false;
  return out.map((s) => {
    if (!s.is_final) return s;
    if (sawFinal) return { ...s, is_final: false };
    sawFinal = true;
    return s;
  });
}

export function projectStageMap(stages) {
  const list = normalizeProjectStages(stages);
  return Object.fromEntries(list.map((s) => [s.key, [s.label, stageToneClass(s.tone)]]));
}

export function finalProjectStageKey(stages) {
  const list = normalizeProjectStages(stages);
  return (list.find((s) => s.is_final) || list[list.length - 1]).key;
}

export function projectStageLabel(stages, key) {
  const map = projectStageMap(stages);
  return map[key]?.[0] || key || "—";
}
