import AsyncStorage from "@react-native-async-storage/async-storage";

export type CachedRows<T> = { rows: T[]; savedAt: number };

const PREFIX = "tk-list-v1:";
const mem = new Map<string, CachedRows<unknown>>();

export function listCacheKey(collection: string, companyId: string): string {
  return `${PREFIX}${companyId}:${collection}`;
}

export function cacheIsFresh(savedAt?: number, ttlMs = 90_000): boolean {
  if (!savedAt) return false;
  return Date.now() - savedAt < ttlMs;
}

export async function readCachedRows<T>(collection: string, companyId: string): Promise<CachedRows<T> | null> {
  const key = listCacheKey(collection, companyId);
  const hit = mem.get(key) as CachedRows<T> | undefined;
  if (hit?.rows) return hit;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedRows<T>;
    if (!parsed || !Array.isArray(parsed.rows)) return null;
    mem.set(key, parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function writeCachedRows<T>(collection: string, companyId: string, rows: T[]): Promise<void> {
  const key = listCacheKey(collection, companyId);
  const next: CachedRows<T> = { rows, savedAt: Date.now() };
  mem.set(key, next);
  try {
    await AsyncStorage.setItem(key, JSON.stringify(next));
  } catch {
    /* kota / private mode */
  }
}

export function peekCachedRows<T>(collection: string, companyId: string): CachedRows<T> | null {
  return (mem.get(listCacheKey(collection, companyId)) as CachedRows<T> | undefined) || null;
}
