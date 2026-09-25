export const PUNCH_IN_COLOR = "#047857";
export const PUNCH_OUT_COLOR = "#BE123C";

/** Giriş yeşil, çıkış kırmızı; diğer etiketler nötr. */
export function punchLabelTone(label) {
  const s = String(label || "").toLocaleLowerCase("tr-TR");
  if (s.includes("çıkış") || s.includes("cikis")) return "out";
  if (s.includes("giriş") || s.includes("giris")) return "in";
  return null;
}

export function punchLabelColor(label, fallback = "#64748B") {
  const tone = punchLabelTone(label);
  if (tone === "out") return PUNCH_OUT_COLOR;
  if (tone === "in") return PUNCH_IN_COLOR;
  return fallback;
}

export function punchLabelClass(label, fallback = "text-slate-500") {
  const tone = punchLabelTone(label);
  if (tone === "out") return "text-rose-700";
  if (tone === "in") return "text-emerald-700";
  return fallback;
}
