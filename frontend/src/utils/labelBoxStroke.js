/** Termal etiket: CSS border ~0.5px yazıcıda kırık/silik çıkar; min kalınlık + SVG stroke. */

export const LABEL_BOX_DEFAULT_STROKE_MM = 0.5;
export const LABEL_BOX_MIN_STROKE_MM = 0.5;
export const LABEL_LINE_MIN_MM = 0.5;
/** Ekran/yazdırma: 1 mm ≈ 3.78 CSS px @96dpi */
export const LABEL_PX_PER_MM = 3.78;

export function labelStrokeMm(borderMm, minMm = LABEL_BOX_MIN_STROKE_MM) {
  const n = Number(borderMm);
  const raw = Number.isFinite(n) && n > 0 ? n : LABEL_BOX_DEFAULT_STROKE_MM;
  const floor = Number.isFinite(minMm) && minMm > 0 ? minMm : LABEL_BOX_MIN_STROKE_MM;
  return Math.max(raw, floor);
}

export function labelStrokePx(borderMm, scale = 1, pxPerMm = LABEL_PX_PER_MM) {
  const s = Number(scale);
  const scaleSafe = Number.isFinite(s) && s > 0 ? s : 1;
  const ppm = Number(pxPerMm);
  const px = Number.isFinite(ppm) && ppm > 0 ? ppm : LABEL_PX_PER_MM;
  return labelStrokeMm(borderMm) * px * scaleSafe;
}

export function labelLineThicknessMm(heightMm) {
  const n = Number(heightMm);
  const raw = Number.isFinite(n) && n > 0 ? n : LABEL_LINE_MIN_MM;
  return Math.max(raw, LABEL_LINE_MIN_MM);
}
