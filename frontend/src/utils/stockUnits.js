/** Firma Ayarları → Birimler. Yeni stok kartında varsayılan Adet. */

export const DEFAULT_STOCK_UNIT = "Adet";

export const FALLBACK_STOCK_UNITS = [
  "Adet", "Kg", "Gr", "Lt", "Ml", "Mt", "Cm", "M2", "M3",
  "Paket", "Koli", "Kutu", "Çift", "Takım", "Saat", "Gün", "Ton",
];

function unitNameOf(row) {
  if (typeof row === "string") return row.trim();
  if (row && typeof row === "object") return String(row.name || "").trim();
  return "";
}

export function unitNamesFromApi(rows) {
  if (!Array.isArray(rows)) return [];
  return rows.map(unitNameOf).filter(Boolean);
}

function addUnique(out, name) {
  const n = String(name || "").trim();
  if (!n) return;
  if (out.some((x) => x.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"))) return;
  out.push(n);
}

export function mergeUnitOptions(saved, current) {
  const out = [];
  addUnique(out, DEFAULT_STOCK_UNIT);
  const list = saved && saved.length ? saved : FALLBACK_STOCK_UNITS;
  for (const name of list) addUnique(out, name);
  addUnique(out, current);
  return out;
}
