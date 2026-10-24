import { isOnline, moduleOfflineBlock, newIdempotencyKey, onlineOnlyBlock } from "./policy";
import { enqueue, flushQueue } from "./queue";
import { createDexieQueue } from "./dexieQueue";
import { idbReady, sharedDb } from "./db";

const META_SINCE = "offlineSince";
const META_MAX = "offlineMaxMinutes";
const META_POLICY = "offlinePolicy";
const META_DEVICE = "offlineDeviceId";
const MODULE_BY_KIND = { pos_checkout: "pos", pick_scan: "pick", order_create: "order" };

async function metaGet(key) {
  const db = sharedDb();
  if (!db) return undefined;
  try {
    const row = await db.meta.get(key);
    return row ? row.value : undefined;
  } catch {
    return undefined;
  }
}

async function metaSet(key, value) {
  const db = sharedDb();
  if (!db) return;
  try {
    await db.meta.put({ key, value });
  } catch {
    /* meta yazılamazsa kuyruk kararı bellekten sürer */
  }
}

export async function markOfflineWindow(maxMinutes) {
  const since = await metaGet(META_SINCE);
  if (!since) await metaSet(META_SINCE, Date.now());
  if (maxMinutes) await metaSet(META_MAX, maxMinutes);
}

export async function clearOfflineWindow() {
  const db = sharedDb();
  if (!db) return;
  try {
    await db.meta.delete(META_SINCE);
  } catch {
    /* ignore */
  }
}

export async function readOfflineClock() {
  const offlineSince = await metaGet(META_SINCE);
  const maxMinutes = await metaGet(META_MAX);
  return { offlineSince: offlineSince || null, maxMinutes: maxMinutes || 10 };
}

export async function rememberOfflinePolicy(policy) {
  if (!policy) return;
  await metaSet(META_POLICY, {
    enabled: policy.enabled !== false,
    maxMinutes: policy.maxMinutes,
    modules: policy.modules || null,
    ttlHours: policy.ttlHours,
  });
  if (policy.maxMinutes) await metaSet(META_MAX, policy.maxMinutes);
}

export async function readOfflinePolicy() {
  const value = await metaGet(META_POLICY);
  return value && typeof value === "object" ? value : null;
}

export async function ensureDeviceId() {
  const current = await metaGet(META_DEVICE);
  if (current && /^[A-Za-z0-9_-]{8,80}$/.test(String(current))) return String(current);
  const id = newIdempotencyKey();
  await metaSet(META_DEVICE, id);
  return id;
}

function offlineError(block, status = 503) {
  const err = new Error(block.message);
  err.code = block.code;
  err.response = { status, data: { detail: block.message, code: block.code } };
  return err;
}

let queueStore;

function store() {
  if (!queueStore) queueStore = createDexieQueue();
  return queueStore;
}

export async function postOrQueue(axios, {
  url,
  body,
  config,
  companyId,
  kind = "write",
  module,
  critical = false,
  expected,
  optimistic,
  queue = store(),
} = {}) {
  const blocked = onlineOnlyBlock(url, { online: isOnline() });
  if (blocked) throw offlineError(blocked, 503);
  const key = newIdempotencyKey();
  const headers = { ...(config?.headers || {}), "Idempotency-Key": key };
  if (!isOnline()) {
    const policy = await readOfflinePolicy();
    const moduleName = module || MODULE_BY_KIND[kind];
    const blockedModule = moduleOfflineBlock({ online: false, policy, module: moduleName });
    if (blockedModule) throw offlineError(blockedModule, 403);
    await markOfflineWindow();
    const clock = await readOfflineClock();
    const queuedBody = { ...(body || {}) };
    if (expected?.stock) queuedBody.expected_stock = expected.stock;
    if (expected?.grandTotal != null) {
      queuedBody.expected_grand_total = expected.grandTotal;
      headers["X-Offline-Expected-Total"] = String(expected.grandTotal);
    }
    const row = await enqueue(queue, {
      idempotencyKey: key,
      companyId,
      url,
      body: queuedBody,
      headers,
      kind,
      critical,
      rollback: expected?.rollback || null,
    }, { online: false, offlineSince: clock.offlineSince, maxMinutes: clock.maxMinutes, now: Date.now() });
    return {
      queued: true,
      data: {
        ...(optimistic || {}),
        queued: true,
        offline: true,
        idempotency_key: key,
        message: "Çevrimdışı kaydedildi. Bağlantı gelince gönderilecek.",
      },
      item: row,
    };
  }
  return axios.post(url, body, { ...(config || {}), headers });
}

export async function flushOfflineQueue({ axios, onReject } = {}) {
  if (!isOnline() || !axios) return [];
  try {
    return await flushQueue(store(), {
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    onReject,
    send: async (item) => {
      const res = await axios.post(item.url, item.body, { headers: item.headers || {} });
      const conflicts = res?.data?.conflicts || [];
      const rejected = conflicts.find((row) => row.decision === "rejected" || row.code === "stock_conflict" || row.code === "document_conflict");
      if (rejected) return { rejected: true, detail: rejected };
      return res;
    },
  });
  } catch {
    return [];
  }
}

export async function pendingCount() {
  try {
    const rows = await store().pending();
    return rows.length;
  } catch {
    return 0;
  }
}
