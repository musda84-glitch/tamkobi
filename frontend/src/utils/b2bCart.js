/** Cart lines are keyed by product + normalized stock note so a different note is a new row. */
export const NOTE_SEP = "\x1f";

export function normalizeNote(note) {
  return String(note || "").trim().slice(0, 500);
}

export function lineKey(productId, note) {
  return `${productId}${NOTE_SEP}${normalizeNote(note)}`;
}

function asLine(productId, qty, note) {
  const q = Number(qty) || 0;
  if (!productId || q <= 0) return null;
  const n = normalizeNote(note);
  return { productId: String(productId), qty: q, note: n };
}

/** Accepts current line-map, legacy `{ id: qty }`, or packed `{ id: { qty, note } }`. */
export function parseStoredCart(raw) {
  let v = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw || "{}"); } catch { return {}; }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries = Object.entries(v);
  if (!entries.length) return {};
  const [, first] = entries[0];
  const next = {};
  const put = (productId, qty, note) => {
    const line = asLine(productId, qty, note);
    if (!line) return;
    const key = lineKey(line.productId, line.note);
    const cur = next[key];
    next[key] = cur ? { ...line, qty: cur.qty + line.qty } : line;
  };
  if (typeof first === "number") {
    entries.forEach(([id, qty]) => put(id, qty, ""));
    return next;
  }
  entries.forEach(([k, row]) => {
    if (row && typeof row === "object") {
      const productId = row.productId || row.product_id || (typeof k === "string" && k.includes(NOTE_SEP) ? k.split(NOTE_SEP)[0] : k);
      put(productId, row.qty, row.note);
    }
  });
  return next;
}

export function addCartLine(cart, productId, qty, note) {
  const line = asLine(productId, qty, note);
  if (!line) return cart || {};
  const key = lineKey(line.productId, line.note);
  const cur = (cart || {})[key];
  return { ...(cart || {}), [key]: { ...line, qty: (cur?.qty || 0) + line.qty } };
}

export function setCartLineQty(cart, key, qty) {
  const next = { ...(cart || {}) };
  const q = Number(qty) || 0;
  if (q <= 0) {
    delete next[key];
    return next;
  }
  if (next[key]) next[key] = { ...next[key], qty: q };
  return next;
}

export function formatOrderItemLabel(item) {
  const qty = item?.quantity ?? item?.qty ?? 0;
  const name = item?.product_name || item?.name || "";
  const note = normalizeNote(item?.note);
  return note ? `${qty}× ${name} (${note})` : `${qty}× ${name}`;
}
