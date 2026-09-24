/** Firma Ayarları → Birimler. Yeni stok kartında varsayılan Adet. */

export const DEFAULT_STOCK_UNIT = "Adet";

export const FALLBACK_STOCK_UNITS = [
  "Adet", "Kg", "Gr", "Lt", "Ml", "Mt", "Cm", "M2", "M3",
  "Paket", "Koli", "Kutu", "Çift", "Takım", "Saat", "Gün", "Ton",
];

function unitNameOf(row: unknown): string {
  if (typeof row === "string") return row.trim();
  if (row && typeof row === "object" && "name" in row) {
    return String((row as { name?: unknown }).name ?? "").trim();
  }
  return "";
}

export function unitNamesFromApi(rows: unknown): string[] {
  if (!Array.isArray(rows)) return [];
  return rows.map(unitNameOf).filter(Boolean);
}

function addUnique(out: string[], name?: string | null) {
  const n = String(name || "").trim();
  if (!n) return;
  if (out.some((x) => x.toLocaleLowerCase("tr") === n.toLocaleLowerCase("tr"))) return;
  out.push(n);
}

/** Adet her zaman ilk sırada; sonra firma birimleri; kayıtlı birim listede yoksa eklenir. */
export function mergeUnitOptions(saved?: string[] | null, current?: string | null): string[] {
  const out: string[] = [];
  addUnique(out, DEFAULT_STOCK_UNIT);
  const list = saved?.length ? saved : FALLBACK_STOCK_UNITS;
  for (const name of list) addUnique(out, name);
  addUnique(out, current);
  return out;
}

export function unitSelectGroups(units: string[]) {
  return [{ label: "Birimler", options: units.map((value) => ({ value, label: value })) }];
}
