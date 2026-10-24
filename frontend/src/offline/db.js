/** Dexie delta önbelleği. Parola, PIN, token, VKN ve IBAN yazılmaz. */

import Dexie from "dexie";

const SECRET_KEYS = new Set([
  "password", "password_hash", "b2b_password_hash", "token", "access_token", "refresh_token",
  "pin", "pin_hash", "cashier_pin_hash", "shopfloor_pin_hash", "punch_pin_hash",
  "iban", "tax_number", "tax_number_or_id", "vkn", "tckn", "api_key", "secret", "authorization",
  "credential", "credentials",
]);

export function sanitizeRecord(value) {
  if (Array.isArray(value)) return value.map((item) => sanitizeRecord(item));
  if (!value || typeof value !== "object") return value;
  const out = {};
  Object.keys(value).forEach((key) => {
    if (SECRET_KEYS.has(String(key).toLowerCase())) return;
    out[key] = sanitizeRecord(value[key]);
  });
  return out;
}

export function openOfflineDb(name = "tamkobi-offline") {
  const db = new Dexie(name);
  db.version(1).stores({
    products: "[companyId+id], companyId, updated_at",
    stock: "[companyId+id], companyId, updated_at",
    contacts: "[companyId+id], companyId, updated_at",
    priceLists: "[companyId+id], companyId, updated_at",
    queue: "++seq, idempotencyKey, companyId, status",
    meta: "key",
  });
  return db;
}

function rowId(row) {
  return String(row?.id || row?._id || "");
}

async function putRows(table, companyId, rows) {
  for (const raw of rows || []) {
    const id = rowId(raw);
    if (!id) continue;
    const clean = sanitizeRecord({ ...raw, id, companyId: companyId || raw.company_id || raw.companyId || "" });
    delete clean._id;
    clean.companyId = companyId || clean.companyId;
    await table.put(clean);
  }
}

export async function mergeDelta(db, companyId, delta = {}) {
  const cid = String(companyId || "");
  await db.transaction("rw", db.products, db.stock, db.contacts, db.priceLists, async () => {
    await putRows(db.products, cid, delta.products);
    await putRows(db.stock, cid, delta.stock);
    await putRows(db.contacts, cid, delta.contacts);
    await putRows(db.priceLists, cid, delta.price_lists || delta.priceLists);
  });
}

async function readTable(table, companyId) {
  const cid = String(companyId || "");
  const rows = await table.where("companyId").equals(cid).toArray();
  return rows.map((row) => sanitizeRecord(row));
}

export function readProducts(db, companyId) {
  return readTable(db.products, companyId);
}

export function readStock(db, companyId) {
  return readTable(db.stock, companyId);
}

export function readContacts(db, companyId) {
  return readTable(db.contacts, companyId);
}

export function readPriceLists(db, companyId) {
  return readTable(db.priceLists, companyId);
}

export async function rememberProducts(db, companyId, products) {
  await mergeDelta(db, companyId, {
    products,
    stock: (products || []).map((row) => ({
      id: row.id || row._id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      stock_quantity: row.stock_quantity,
      updated_at: row.updated_at,
    })),
    price_lists: (products || []).map((row) => ({
      id: row.id || row._id,
      name: row.name,
      sku: row.sku,
      barcode: row.barcode,
      sale_price: row.sale_price,
      list_price: row.list_price != null ? row.list_price : row.sale_price,
      vat_rate: row.vat_rate,
      updated_at: row.updated_at,
    })),
  });
}

export function idbReady() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB != null && typeof indexedDB.open === "function";
  } catch {
    return false;
  }
}

let shared;

export function sharedDb() {
  if (!idbReady()) return null;
  if (!shared) shared = openOfflineDb();
  return shared;
}

export async function safeReadProducts(companyId) {
  const db = sharedDb();
  if (!db) return [];
  try {
    return await readProducts(db, companyId);
  } catch {
    return [];
  }
}

export async function safeRememberProducts(companyId, products) {
  const db = sharedDb();
  if (!db) return;
  try {
    await rememberProducts(db, companyId, products);
  } catch {
    /* önbellek yazılamazsa satış akışı sürer */
  }
}
