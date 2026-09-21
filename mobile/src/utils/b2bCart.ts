/** Cart lines are keyed by product + normalized stock note so a different note is a new row. */
export const NOTE_SEP = "\x1f";

export type B2BCartLine = { productId: string; qty: number; note: string };
export type B2BCart = Record<string, B2BCartLine>;

export function normalizeNote(note?: string | null): string {
  return String(note || "").trim().slice(0, 500);
}

export function lineKey(productId: string, note?: string | null): string {
  return `${productId}${NOTE_SEP}${normalizeNote(note)}`;
}

function asLine(productId: unknown, qty: unknown, note?: string | null): B2BCartLine | null {
  const q = Number(qty) || 0;
  if (!productId || q <= 0) return null;
  return { productId: String(productId), qty: q, note: normalizeNote(note) };
}

/** Accepts current line-map, legacy `{ id: qty }`, or packed `{ id: { qty, note } }`. */
export function parseStoredCart(raw: unknown): B2BCart {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw || "{}");
    } catch {
      return {};
    }
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return {};
  const [, first] = entries[0];
  const next: B2BCart = {};
  const put = (productId: unknown, qty: unknown, note?: string | null) => {
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
      const rec = row as { productId?: string; product_id?: string; qty?: number; note?: string };
      const productId =
        rec.productId ||
        rec.product_id ||
        (typeof k === "string" && k.includes(NOTE_SEP) ? k.split(NOTE_SEP)[0] : k);
      put(productId, rec.qty, rec.note);
    }
  });
  return next;
}

export function addCartLine(cart: B2BCart | null | undefined, productId: string, qty: number, note?: string | null): B2BCart {
  const line = asLine(productId, qty, note);
  if (!line) return cart || {};
  const key = lineKey(line.productId, line.note);
  const cur = (cart || {})[key];
  return { ...(cart || {}), [key]: { ...line, qty: (cur?.qty || 0) + line.qty } };
}

export function setCartLineQty(cart: B2BCart | null | undefined, key: string, qty: number): B2BCart {
  const next = { ...(cart || {}) };
  const q = Number(qty) || 0;
  if (q <= 0) {
    delete next[key];
    return next;
  }
  if (next[key]) next[key] = { ...next[key], qty: q };
  return next;
}

export function formatOrderItemLabel(item: { quantity?: number; qty?: number; product_name?: string; name?: string; note?: string } | null | undefined): string {
  const qty = item?.quantity ?? item?.qty ?? 0;
  const name = item?.product_name || item?.name || "";
  const note = normalizeNote(item?.note);
  return note ? `${qty}× ${name} (${note})` : `${qty}× ${name}`;
}

export function cartCount(cart: B2BCart | null | undefined): number {
  return Object.values(cart || {}).reduce((s, line) => s + (Number(line.qty) || 0), 0);
}

export function productCartQty(cart: B2BCart | null | undefined, productId: string): number {
  const id = String(productId || "");
  if (!id) return 0;
  return Object.values(cart || {}).reduce((s, line) => s + (line.productId === id ? Number(line.qty) || 0 : 0), 0);
}
