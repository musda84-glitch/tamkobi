import { normalizeProjectStages, type ProjectStage } from "./projectStages";

export type StagePhoto = {
  url: string;
  stage: string;
  stage_label?: string;
  created_at?: string;
};

export type StagePhotoGroup = {
  stage: string;
  label: string;
  images: string[];
};

export type StagePhotoRow = {
  key: string;
  label: string;
  current: boolean;
  done: boolean;
  items: StagePhoto[];
};

export function cleanStageKey(value: unknown): string {
  return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
}

export function sanitizeStagePhotos(raw: unknown): StagePhoto[] {
  if (!Array.isArray(raw)) return [];
  const out: StagePhoto[] = [];
  for (const row of raw.slice(0, 80)) {
    if (!row || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const url = String(rec.url || "").trim().slice(0, 500);
    if (!url.startsWith("/api/files/")) continue;
    out.push({
      url,
      stage: cleanStageKey(rec.stage) || "other",
      stage_label: String(rec.stage_label || "").slice(0, 60),
      created_at: String(rec.created_at || "").slice(0, 40),
    });
  }
  return out;
}

export function appendStagePhoto(
  photos: StagePhoto[] | undefined,
  images: string[] | undefined,
  next: StagePhoto,
): { stage_photos: StagePhoto[]; images: string[] } {
  const stage_photos = [...sanitizeStagePhotos(photos), next];
  const imagesNext = [...(images || [])];
  if (next.url && !imagesNext.includes(next.url)) imagesNext.push(next.url);
  return { stage_photos, images: imagesNext };
}

export function removeStagePhoto(
  photos: StagePhoto[] | undefined,
  images: string[] | undefined,
  url: string,
): { stage_photos: StagePhoto[]; images: string[] } {
  return {
    stage_photos: sanitizeStagePhotos(photos).filter((p) => p.url !== url),
    images: (images || []).filter((u) => u !== url),
  };
}

/** Web `group_stage_photos` ile aynı sıra: aşama listesi, sonra eşlenmemişler. */
export function groupStagePhotos(
  stagePhotos: unknown,
  images: unknown,
  stages: { key: string; label: string }[],
): StagePhotoGroup[] {
  const labelBy: Record<string, string> = {};
  const order: string[] = [];
  for (const stage of stages || []) {
    const key = String(stage?.key || "");
    if (!key || labelBy[key]) continue;
    labelBy[key] = stage.label || key;
    order.push(key);
  }
  const groups: Record<string, string[]> = {};
  const seen: string[] = [];
  const add = (key: string, url: string) => {
    if (!groups[key]) {
      groups[key] = [];
      seen.push(key);
    }
    if (!groups[key].includes(url)) groups[key].push(url);
  };
  const tagged = new Set<string>();
  for (const row of sanitizeStagePhotos(stagePhotos)) {
    if (row.stage_label && !labelBy[row.stage]) labelBy[row.stage] = row.stage_label;
    add(row.stage, row.url);
    tagged.add(row.url);
  }
  for (const url of Array.isArray(images) ? images : []) {
    const href = String(url || "");
    if (href && !tagged.has(href)) add("other", href);
  }
  if (!seen.length) return [];
  const rank: Record<string, number> = Object.fromEntries(order.map((key, i) => [key, i]));
  rank.other = 10_000;
  return seen
    .slice()
    .sort((a, b) => (rank[a] ?? 9_000) - (rank[b] ?? 9_000) || seen.indexOf(a) - seen.indexOf(b))
    .map((key) => ({
      stage: key,
      label: key === "other" ? "Keşif fotoğrafı" : (labelBy[key] || key),
      images: groups[key],
    }));
}

export function stagePhotoRows(
  project: { status?: string; stage_photos?: StagePhoto[]; images?: string[] } | null | undefined,
  stages?: ProjectStage[] | null,
): StagePhotoRow[] {
  const list = normalizeProjectStages(stages);
  const photos = sanitizeStagePhotos(project?.stage_photos);
  const by: Record<string, StagePhoto[]> = {};
  for (const p of photos) (by[p.stage] ||= []).push(p);
  const tagged = new Set(photos.map((p) => p.url));
  const loose = (project?.images || []).filter((u) => u && !tagged.has(u)).map((url) => ({ url, stage: "other" }));
  const status = String(project?.status || "planning");
  const idx = list.findIndex((s) => s.key === status);
  const rows: StagePhotoRow[] = list.map((s, i) => ({
    key: s.key,
    label: s.label,
    current: s.key === status,
    done: idx >= 0 ? i < idx : false,
    items: by[s.key] || [],
  }));
  for (const key of Object.keys(by)) {
    if (key === "other" || list.some((s) => s.key === key)) continue;
    rows.push({
      key,
      label: by[key][0]?.stage_label || key,
      current: key === status,
      done: false,
      items: by[key],
    });
  }
  rows.push({
    key: "other",
    label: "Keşif fotoğrafı",
    current: false,
    done: false,
    items: [...(by.other || []), ...loose],
  });
  return rows;
}

export function stagePhotoCount(project: { stage_photos?: StagePhoto[]; images?: string[] } | null | undefined): number {
  const tagged = sanitizeStagePhotos(project?.stage_photos);
  const urls = new Set(tagged.map((p) => p.url));
  for (const url of project?.images || []) if (url) urls.add(url);
  return urls.size;
}
