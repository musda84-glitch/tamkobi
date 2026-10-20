import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  DEFAULT_OVERVIEW_SECTION_ORDER,
  type OverviewSectionKey,
} from "../components/home/overviewSections";

/** Kullanıcı + şirket bazında genel bakış bölüm sırası. Anahtar metinleri kalıcıdır. */
export const HOME_OVERVIEW_ORDER_PREFIX = "tamkobi.home.overview_order.v1";

export function homeOverviewOrderKey(userId: string, companyId: string): string {
  return `${HOME_OVERVIEW_ORDER_PREFIX}:${userId}:${companyId}`;
}

function copyDefaultOrder(): OverviewSectionKey[] {
  return [...DEFAULT_OVERVIEW_SECTION_ORDER];
}

/**
 * Sonuç her zaman defaults'un bir permütasyonu: bilinmeyen ve tekrarlar düşer,
 * eksik anahtarlar defaults sırasıyla sona eklenir.
 */
export function normalizeOverviewOrder(
  input: unknown,
  defaults: readonly string[] = DEFAULT_OVERVIEW_SECTION_ORDER,
): OverviewSectionKey[] {
  if (!Array.isArray(input)) return [...defaults] as OverviewSectionKey[];
  const allowed = new Set<string>(defaults);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of input) {
    const key = String(item).trim();
    if (!key || !allowed.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  for (const key of defaults) {
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out as OverviewSectionKey[];
}

/** Boş veya bozuk JSON varsayılan sıradır. */
export function parseOverviewOrder(raw: string | null | undefined): OverviewSectionKey[] {
  if (raw == null || !String(raw).trim()) return copyDefaultOrder();
  try {
    return normalizeOverviewOrder(JSON.parse(String(raw)));
  } catch {
    return copyDefaultOrder();
  }
}

export function serializeOverviewOrder(order: readonly string[]): string {
  return JSON.stringify(normalizeOverviewOrder(order));
}

function hasScope(userId: string, companyId: string): boolean {
  return Boolean(userId) && Boolean(companyId);
}

export function readHomeOverviewOrder(userId: string, companyId: string): Promise<OverviewSectionKey[]> {
  if (!hasScope(userId, companyId)) return Promise.resolve(copyDefaultOrder());
  return AsyncStorage.getItem(homeOverviewOrderKey(userId, companyId))
    .catch(() => null)
    .then((raw) => parseOverviewOrder(raw));
}

export function writeHomeOverviewOrder(
  userId: string,
  companyId: string,
  order: readonly string[],
): Promise<unknown> {
  if (!hasScope(userId, companyId)) return Promise.resolve(null);
  return AsyncStorage.setItem(homeOverviewOrderKey(userId, companyId), serializeOverviewOrder(order)).catch(() => null);
}

/** "Varsayılan sıralama": kaydı siler ve varsayılan sırayı döner. */
export function resetHomeOverviewOrder(userId: string, companyId: string): Promise<OverviewSectionKey[]> {
  if (!hasScope(userId, companyId)) return Promise.resolve(copyDefaultOrder());
  return AsyncStorage.removeItem(homeOverviewOrderKey(userId, companyId))
    .catch(() => null)
    .then(() => copyDefaultOrder());
}

export function isDefaultOverviewOrder(order: readonly string[] | null | undefined): boolean {
  if (!order || order.length !== DEFAULT_OVERVIEW_SECTION_ORDER.length) return false;
  return DEFAULT_OVERVIEW_SECTION_ORDER.every((key, index) => order[index] === key);
}
