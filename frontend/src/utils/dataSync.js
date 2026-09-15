
import { API_URL } from "../context/AuthContext";
import axios from "axios";

const DB_NAME = "tamkobi-sync-v1";
const STORE = "collections";

export const invoiceTypeFilter = (type) => (inv) => {
  if (type === "export") return inv.trade_kind === "export" && inv.invoice_type !== "dispatch";
  if (type === "import") return inv.trade_kind === "import" && inv.invoice_type !== "dispatch";
  if (!type || type === "all") return inv.invoice_type !== "dispatch";
  // Vade farkı faturaları satış listesinde görünsün
  if (type === "sales") return inv.invoice_type === "sales" || inv.invoice_type === "late_fee";
  return inv.invoice_type === type;
};

export const contactTypeFilter = (type) => (c) => !type || type === "all" || c.type === type;

export const productFilter = ({ category, b2bOnly } = {}) => (p) => {
  if (category && category !== "all" && p.category !== category) return false;
  if (b2bOnly) {
    if (p.show_in_b2b === false || p.is_active === false) return false;
    if (p.type === "raw_material" || p.type === "service") return false;
    if (!(Number(p.sale_price) > 0)) return false;
  }
  return true;
};

const openDb = () => new Promise((resolve, reject) => {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

const cacheKey = (collection, companyId) => `${companyId}:${collection}`;

async function readCache(collection, companyId) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const r = tx.objectStore(STORE).get(cacheKey(collection, companyId));
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => reject(r.error);
    });
  } catch {
    return null;
  }
}

async function writeCache(collection, companyId, state) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const r = tx.objectStore(STORE).put(state, cacheKey(collection, companyId));
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* private mode / quota */ }
}

export function mergeDelta(items, changed, deleted, replace) {
  const next = replace ? {} : { ...items };
  for (const d of changed || []) {
    const id = d.id || d._id;
    if (id) next[id] = d;
  }
  for (const id of deleted || []) delete next[id];
  return next;
}

function apply(items, filter) {
  const rows = Object.values(items);
  return filter ? rows.filter(filter) : rows;
}

/**
 * Load a company collection: first paint from IndexedDB, then pull only rows
 * changed since the last cursor via GET /api/sync.
 */
export async function cachedList(collection, companyId, { filter, onCached } = {}) {
  const cached = await readCache(collection, companyId);
  if (cached?.items && onCached) onCached(apply(cached.items, filter));
  try {
    let items = cached?.items ? { ...cached.items } : {};
    let cursor = cached?.cursor || null;
    let more = true;
    let loops = 0;
    while (more && loops < 8) {
      loops += 1;
      const q = { company_id: companyId, collections: collection };
      if (cursor) q.since = cursor;
      const { data } = await axios.get(`${API_URL}/sync`, { params: q });
      const delta = data.collections?.[collection] || { changed: [], deleted: [], complete: true, cursor: data.server_time };
      items = mergeDelta(items, delta.changed, delta.deleted, delta.complete && loops === 1);
      cursor = delta.cursor || data.server_time;
      more = !!delta.more;
    }
    await writeCache(collection, companyId, { items, cursor, savedAt: new Date().toISOString() });
    const rows = apply(items, filter);
    if (onCached) onCached(rows);
    return rows;
  } catch (err) {
    if (cached?.items) return apply(cached.items, filter);
    throw err;
  }
}


/**
 * Patch rows already stored in IndexedDB (e.g. after a local PUT / bulk update)
 * so the next paint from cache does not revert UI changes.
 */
export async function patchCached(collection, companyId, patchById) {
  if (!companyId || !patchById) return null;
  const cached = await readCache(collection, companyId);
  if (!cached?.items) return null;
  const items = { ...cached.items };
  let touched = 0;
  for (const [id, patch] of Object.entries(patchById)) {
    if (!id || !patch) continue;
    const cur = items[id];
    if (!cur) continue;
    items[id] = { ...cur, ...patch, id: cur.id || id };
    touched += 1;
  }
  if (!touched) return cached;
  const next = { ...cached, items, savedAt: new Date().toISOString() };
  await writeCache(collection, companyId, next);
  return next;
}

export async function dropCached(collection, companyId) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const r = tx.objectStore(STORE).delete(cacheKey(collection, companyId));
      r.onsuccess = () => resolve();
      r.onerror = () => reject(r.error);
    });
  } catch { /* ignore */ }
}
