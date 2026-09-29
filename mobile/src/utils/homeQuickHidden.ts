/** Ana ekran hızlı menü karoları: basılı tut → gizle; Daha menüsünden geri ekle. */

export const HOME_QUICK_HIDDEN_KEY = "tamkobi.home.quick_hidden.v1";

export function parseHiddenTileIds(raw: string | null | undefined): string[] {
  if (!raw || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const x of parsed) {
      const id = String(x || "").trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeHiddenTileIds(ids: string[] | null | undefined): string {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const x of ids || []) {
    const id = String(x || "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return JSON.stringify(out);
}

export function hideQuickTile(ids: string[] | null | undefined, tileId: string): string[] {
  const id = String(tileId || "").trim();
  if (!id) return parseHiddenTileIds(serializeHiddenTileIds(ids));
  const next = parseHiddenTileIds(serializeHiddenTileIds(ids));
  if (!next.includes(id)) next.push(id);
  return next;
}

export function restoreQuickTile(ids: string[] | null | undefined, tileId: string): string[] {
  const id = String(tileId || "").trim();
  return parseHiddenTileIds(serializeHiddenTileIds(ids)).filter((x) => x !== id);
}

export function filterHiddenQuickTiles<T extends { id: string }>(
  tiles: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
): T[] {
  const hidden = new Set(parseHiddenTileIds(serializeHiddenTileIds(hiddenIds)));
  return (tiles || []).filter((t) => !hidden.has(t.id));
}

export function hiddenQuickTilesToRestore<T extends { id: string }>(
  allTiles: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
): T[] {
  const hidden = new Set(parseHiddenTileIds(serializeHiddenTileIds(hiddenIds)));
  if (!hidden.size) return [];
  return (allTiles || []).filter((t) => hidden.has(t.id));
}
