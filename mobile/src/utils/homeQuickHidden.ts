/** Ana ekran hızlı menü: gizlenenler + Daha’dan eklenen opt-in karolar. */

export const HOME_QUICK_HIDDEN_KEY = "tamkobi.home.quick_hidden.v1";
export const HOME_QUICK_EXTRA_KEY = "tamkobi.home.quick_extra.v1";

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

export const parseExtraTileIds = parseHiddenTileIds;
export const serializeExtraTileIds = serializeHiddenTileIds;

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

export function addExtraTile(ids: string[] | null | undefined, tileId: string): string[] {
  return hideQuickTile(ids, tileId);
}

export function removeExtraTile(ids: string[] | null | undefined, tileId: string): string[] {
  return restoreQuickTile(ids, tileId);
}

type HomeTile = { id: string; optIn?: boolean };

/** Varsayılan karolar: gizlenmemişse; opt-in karolar: extras’ta ise. */
export function isTileOnHome(
  tile: HomeTile | null | undefined,
  hiddenIds: string[] | null | undefined,
  extraIds: string[] | null | undefined,
): boolean {
  const id = String(tile?.id || "").trim();
  if (!id) return false;
  const hidden = new Set(parseHiddenTileIds(serializeHiddenTileIds(hiddenIds)));
  const extras = new Set(parseExtraTileIds(serializeExtraTileIds(extraIds)));
  if (tile?.optIn) return extras.has(id);
  return !hidden.has(id);
}

export function filterHomeQuickTiles<T extends HomeTile>(
  tiles: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
  extraIds: string[] | null | undefined,
): T[] {
  return (tiles || []).filter((t) => isTileOnHome(t, hiddenIds, extraIds));
}

/** @deprecated use filterHomeQuickTiles */
export function filterHiddenQuickTiles<T extends { id: string }>(
  tiles: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
): T[] {
  return filterHomeQuickTiles(tiles, hiddenIds, []);
}

export function hiddenQuickTilesToRestore<T extends HomeTile>(
  allTiles: T[] | null | undefined,
  hiddenIds: string[] | null | undefined,
  extraIds: string[] | null | undefined = [],
): T[] {
  return (allTiles || []).filter((t) => !isTileOnHome(t, hiddenIds, extraIds));
}

/** Daha menüsü ekran adı → hızlı karo id. */
export const MORE_SCREEN_TO_TILE: Record<string, string> = {
  Personnel: "personnel",
  Contacts: "contacts",
  Invoices: "invoices",
  EdocInbox: "edoc",
  Orders: "orders",
  Sevk: "sevk",
  Vehicles: "vehicles",
  StockCount: "sayim",
  Atolye: "atolye",
  Production: "production",
  Banking: "banking",
  Pay: "pay",
  Expenses: "expenses",
  Installments: "installments",
  Cheques: "cheques",
  Quotes: "quotes",
  Surveys: "surveys",
  Projects: "projects",
  Settings: "settings",
};
