import AsyncStorage from "@react-native-async-storage/async-storage";

/**
 * Ana ekran 2. sayfa kısayol sırası. Değer yalnız karo kimlikleridir.
 * Gizlenenler `homeQuickHidden` anahtarlarında kalır; bu kayıt onlara yazılmaz.
 * Kullanıcı tercih ucu (`/auth/me/preferences`) web alanlarıyla sınırlı
 * (module_order, hidden_modules, theme, dashboard_layout, radial_slots);
 * kısayol sırası için alan yok, yeni uç eklenmez.
 */
export const HOME_QUICK_ORDER_PREFIX = "tamkobi.home.quick_order.v1";

export const QUICK_ORDER_COLUMNS = 4;

export function homeQuickOrderKey(userId: string, companyId: string): string {
  return `${HOME_QUICK_ORDER_PREFIX}:${String(userId || "").trim()}:${String(companyId || "").trim()}`;
}

function hasScope(userId: string, companyId: string): boolean {
  return Boolean(String(userId || "").trim()) && Boolean(String(companyId || "").trim());
}

/** İzinli kimliklerin permütasyonu: bilinmeyen ve tekrarlar düşer, eksikler katalog sırasıyla sona eklenir. */
export function reconcileQuickOrder(input: unknown, allowedIds: readonly string[]): string[] {
  const allowedList: string[] = [];
  const allowed = new Set<string>();
  for (const raw of allowedIds) {
    const id = String(raw || "").trim();
    if (!id || allowed.has(id)) continue;
    allowed.add(id);
    allowedList.push(id);
  }
  const seen = new Set<string>();
  const out: string[] = [];
  const list = Array.isArray(input) ? input : [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  for (const id of allowedList) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/** Boş veya bozuk JSON boş listedir. Nesne, sayı ve tekrarlar düşer. */
export function parseStoredQuickOrder(raw: string | null | undefined): string[] {
  if (raw == null || !String(raw).trim()) return [];
  try {
    const parsed = JSON.parse(String(raw));
    if (!Array.isArray(parsed)) return [];
    const out: string[] = [];
    const seen = new Set<string>();
    for (const item of parsed) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  } catch {
    return [];
  }
}

export function serializeQuickOrder(order: readonly string[], allowedIds: readonly string[]): string {
  return JSON.stringify(reconcileQuickOrder(order, allowedIds));
}

export function readHomeQuickOrder(userId: string, companyId: string): Promise<string[]> {
  if (!hasScope(userId, companyId)) return Promise.resolve([]);
  return AsyncStorage.getItem(homeQuickOrderKey(userId, companyId))
    .catch(() => null)
    .then((raw) => parseStoredQuickOrder(raw));
}

export function writeHomeQuickOrder(
  userId: string,
  companyId: string,
  order: readonly string[],
  allowedIds: readonly string[],
): Promise<unknown> {
  if (!hasScope(userId, companyId)) return Promise.resolve(null);
  return AsyncStorage.setItem(
    homeQuickOrderKey(userId, companyId),
    serializeQuickOrder(order, allowedIds),
  ).catch(() => null);
}

/** "Düzeni sıfırla": kaydı siler, katalog sırasını döner. Gizli karo kaydına dokunmaz. */
export function resetHomeQuickOrder(
  userId: string,
  companyId: string,
  allowedIds: readonly string[],
): Promise<string[]> {
  const defaults = reconcileQuickOrder([], allowedIds);
  if (!hasScope(userId, companyId)) return Promise.resolve(defaults);
  return AsyncStorage.removeItem(homeQuickOrderKey(userId, companyId))
    .catch(() => null)
    .then(() => defaults);
}

export function isDefaultQuickOrder(
  order: readonly string[] | null | undefined,
  allowedIds: readonly string[],
): boolean {
  const defaults = reconcileQuickOrder([], allowedIds);
  if (!order || order.length !== defaults.length) return false;
  return defaults.every((id, index) => order[index] === id);
}

export function moveQuickTile(order: readonly string[], fromIndex: number, toIndex: number): string[] {
  if (!Number.isInteger(fromIndex) || fromIndex < 0 || fromIndex >= order.length) return [...order];
  const to = Math.max(0, Math.min(order.length - 1, Math.trunc(toIndex)));
  if (to === fromIndex) return [...order];
  const next = order.slice();
  const [item] = next.splice(fromIndex, 1);
  next.splice(to, 0, item);
  return next;
}

/** Parmak kaydırmasını ızgara hücresine çevirir. Hücre boyutu ölçülmediyse sıra değişmez. */
export function tileDropIndex(opts: {
  fromIndex: number;
  dx: number;
  dy: number;
  cellWidth: number;
  cellHeight: number;
  columns: number;
  count: number;
}): number {
  const { dx, dy, cellWidth, cellHeight, columns, count } = opts;
  if (count <= 0) return 0;
  const from = Math.max(0, Math.min(count - 1, Math.trunc(opts.fromIndex)));
  if (count === 1 || columns < 1 || cellWidth <= 0 || cellHeight <= 0) return from;
  const col = from % columns;
  const row = Math.floor(from / columns);
  const maxRow = Math.floor((count - 1) / columns);
  const nextCol = Math.max(0, Math.min(columns - 1, Math.round(col + dx / cellWidth)));
  const nextRow = Math.max(0, Math.min(maxRow, Math.round(row + dy / cellHeight)));
  return Math.max(0, Math.min(count - 1, nextRow * columns + nextCol));
}
