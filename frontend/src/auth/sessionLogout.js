/** Tarayıcı oturumunu kapatır: sunucu iptali, depo, önbellek, diğer sekmeler.

Atölye cihaz token'ı (tamkobi.shopfloorDeviceToken) korunur; onu yalnız
"Cihazdan çık" siler. B2B sepeti ve bekleyen offline kuyruk, kullanıcı
onaylamadan silinmez.
*/

import { API_URL } from "../api/client";
import { sharedDb } from "../offline/db";

export const LOGOUT_CHANNEL = "tamkobi-auth";
export const LOGOUT_STAMP_KEY = "tamkobi.logout";

/** Cihaz eşleştirme ve sabit cihaz kimliği oturum değildir. */
export const PRESERVE_LOCAL_KEYS = ["tamkobi.shopfloorDeviceToken", "tamkobi.deviceId"];

const EXACT_AUTH_KEYS = [
  "tamkobi_remember_email",
  "tamkobi_remember_b2b_email",
  "tamkobi_remember_system_email",
  "tamkobi.deviceToken",
  "tamkobi.punchPin",
  "b2b_contact_portals",
  "b2b_session",
  "b2b_session_email",
];

const API_CACHE_RE = /api|auth|workbox-runtime|tamkobi-html/i;

export function isPreservedLocalKey(key) {
  const name = String(key || "");
  if (!name) return false;
  if (PRESERVE_LOCAL_KEYS.includes(name)) return true;
  if (name.startsWith("b2b_cart_") || name.startsWith("b2b_held_carts_")) return true;
  return false;
}

export function isAuthStorageKey(key) {
  const name = String(key || "");
  if (!name || isPreservedLocalKey(name)) return false;
  if (EXACT_AUTH_KEYS.includes(name)) return true;
  if (name.startsWith("nx_sf_op:")) return true;
  return /(?:^|[._-])(access_token|refresh_token|id_token|auth_token|sso|qr_login|qrlogin|poll_secret)(?:$|[._-])|token|jwt/i.test(name);
}

export function clearBrowserAuthStorage(storage = {}) {
  const local = storage.local || (typeof localStorage !== "undefined" ? localStorage : null);
  const session = storage.session || (typeof sessionStorage !== "undefined" ? sessionStorage : null);
  if (local) {
    const drop = [];
    try {
      for (let i = 0; i < local.length; i += 1) {
        const key = local.key(i);
        if (isAuthStorageKey(key)) drop.push(key);
      }
    } catch { /* gizli mod */ }
    drop.forEach((key) => {
      try { local.removeItem(key); } catch { /* dolu veya kilitli */ }
    });
  }
  if (session) {
    try { session.clear(); } catch { /* gizli mod */ }
  }
}

export async function countPendingOfflineWrites(db = sharedDb()) {
  if (!db?.queue?.where) return 0;
  try {
    return await db.queue.where("status").equals("pending").count();
  } catch {
    return 0;
  }
}

export async function clearOfflineData({ dropQueue = false, db = sharedDb() } = {}) {
  if (!db) return;
  const tables = [db.products, db.stock, db.contacts, db.priceLists];
  for (const table of tables) {
    try {
      if (table && typeof table.clear === "function") await table.clear();
    } catch { /* önbellek yok */ }
  }
  if (dropQueue && db.queue && typeof db.queue.clear === "function") {
    try { await db.queue.clear(); } catch { /* kuyruk yok */ }
  }
}

export async function clearAuthenticatedCaches(cacheStore) {
  const cachesApi = cacheStore || (typeof caches !== "undefined" ? caches : null);
  if (!cachesApi?.keys) return [];
  let names = [];
  try { names = await cachesApi.keys(); } catch { return []; }
  const dropped = [];
  for (const name of names) {
    if (!API_CACHE_RE.test(String(name))) continue;
    try {
      await cachesApi.delete(name);
      dropped.push(name);
    } catch { /* silinemez */ }
  }
  return dropped;
}

function defaultConfirm(message) {
  if (typeof window !== "undefined" && typeof window.confirm === "function") return window.confirm(message);
  return false;
}

let loggingOut = false;

export function subscribeLogout(handler) {
  if (typeof window === "undefined" || typeof handler !== "function") return () => {};
  const onStorage = (event) => {
    if (!event || event.key !== LOGOUT_STAMP_KEY || !event.newValue) return;
    let payload = { dropQueue: true };
    try { payload = JSON.parse(event.newValue); } catch { /* damga bozuk */ }
    handler(payload);
  };
  window.addEventListener("storage", onStorage);
  let channel = null;
  try {
    channel = new BroadcastChannel(LOGOUT_CHANNEL);
    channel.onmessage = (event) => handler(event?.data || {});
  } catch { /* eski tarayıcı */ }
  return () => {
    window.removeEventListener("storage", onStorage);
    try { channel?.close(); } catch { /* kapalı */ }
  };
}

function publishLogout(payload) {
  try {
    localStorage.setItem(LOGOUT_STAMP_KEY, JSON.stringify(payload));
  } catch { /* gizli mod */ }
  try {
    const channel = new BroadcastChannel(LOGOUT_CHANNEL);
    channel.postMessage(payload);
    channel.close();
  } catch { /* kanal yok */ }
}

/**
 * @returns {Promise<{ok: boolean, pending: number, dropQueue: boolean}>}
 */
export async function logoutEverywhere({
  apiUrl = API_URL,
  to = "/login",
  request,
  confirm = defaultConfirm,
  navigate,
  onCleared,
  readB2BSession = () => "",
  remote = false,
  dropQueue,
  force = false,
  broadcast = !remote,
  db,
  caches: cacheStore,
} = {}) {
  if (loggingOut) return { ok: false, pending: 0, dropQueue: false, skipped: true };
  loggingOut = true;
  try {
    const pending = remote ? 0 : await countPendingOfflineWrites(db);
    let drop = dropQueue;
    if (drop == null) {
      if (pending > 0 && !force && !remote) {
        const ok = confirm(
          `Çevrimdışı bekleyen ${pending} kayıt var. Çıkış bu kayıtları siler; sunucuya gitmemiş değişiklikler kaybolur. Yine de çıkılsın mı?`,
        );
        if (!ok) return { ok: false, pending, dropQueue: false };
        drop = true;
      } else if (pending > 0 && force) {
        drop = false;
      } else {
        drop = remote ? dropQueue !== false : true;
      }
    }
    if (!remote && typeof request === "function") {
      try { await request(`${apiUrl}/auth/logout`, {}); } catch { /* ağ yoksa yerel çıkış sürer */ }
      let b2b = "";
      try { b2b = String(readB2BSession() || "").trim(); } catch { b2b = ""; }
      if (b2b) {
        try {
          await request(`${apiUrl}/public/b2b/logout`, { select_token: b2b }, {
            headers: { Authorization: `B2BSession ${b2b}` },
          });
        } catch { /* b2b uç hata verse de yerel çıkış sürer */ }
      }
    }
    clearBrowserAuthStorage();
    await clearOfflineData({ dropQueue: !!drop, db });
    await clearAuthenticatedCaches(cacheStore);
    if (typeof onCleared === "function") {
      try { onCleared(); } catch { /* durum sıfırlanamazsa yönlendirme sürer */ }
    }
    const payload = { type: "logout", at: Date.now(), dropQueue: !!drop, to: to || "/login" };
    if (broadcast) publishLogout(payload);
    if (to) {
      if (typeof navigate === "function") navigate(to);
      else if (typeof window !== "undefined") window.location.href = to;
    }
    return { ok: true, pending, dropQueue: !!drop };
  } finally {
    loggingOut = false;
  }
}
