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

export function cartHasItems(cart) {
  return Object.values(cart || {}).some((l) => (Number(l?.qty) || 0) > 0);
}

export function cartCount(cart) {
  return Object.values(cart || {}).reduce((s, line) => s + (Number(line?.qty) || 0), 0);
}

export function heldStorageKey(token) {
  return `b2b_held_carts_${String(token || "")}`;
}

export function renumberHeldCarts(held) {
  return (held || []).map((h, i) => {
    const seq = i + 1;
    return { ...h, seq, label: `Bekleyen sepet #${seq}` };
  });
}

/** Accepts array JSON or already-parsed list. */
export function parseHeldCarts(raw) {
  let v = raw;
  if (typeof raw === "string") {
    try { v = JSON.parse(raw || "[]"); } catch { return []; }
  }
  if (!Array.isArray(v)) return [];
  const out = [];
  v.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const cart = parseStoredCart(row.cart || {});
    if (!cartHasItems(cart)) return;
    const seq = Number(row.seq) || i + 1;
    out.push({
      id: String(row.id || `hold_${i + 1}`),
      seq,
      label: String(row.label || `Bekleyen sepet #${seq}`),
      cart,
      note: String(row.note || ""),
      customerOrderNo: String(row.customerOrderNo || row.customer_order_number || ""),
      heldAt: String(row.heldAt || row.held_at || new Date().toISOString()),
    });
  });
  return renumberHeldCarts(out);
}

export function holdActiveCart(held, cart, meta = {}) {
  if (!cartHasItems(cart)) return { held: renumberHeldCarts(held || []), cart: cart || {} };
  const seq = (held || []).length + 1;
  const entry = {
    id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    seq,
    label: `Bekleyen sepet #${seq}`,
    cart: { ...(cart || {}) },
    note: String(meta.note || ""),
    customerOrderNo: String(meta.customerOrderNo || ""),
    heldAt: new Date().toISOString(),
  };
  return { held: renumberHeldCarts([...(held || []), entry]), cart: {} };
}

export function discardHeldCart(held, holdId) {
  return renumberHeldCarts((held || []).filter((h) => h.id !== holdId));
}

/** Resume held cart; if active has items, park it first. */
export function resumeHeldCart(held, activeCart, holdId, meta = {}) {
  const list = held || [];
  const hold = list.find((h) => h.id === holdId);
  if (!hold) return { held: renumberHeldCarts(list), cart: activeCart || {}, meta: null };
  let next = list.filter((h) => h.id !== holdId);
  if (cartHasItems(activeCart)) {
    const seq = next.length + 1;
    next = [...next, {
      id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      seq,
      label: `Bekleyen sepet #${seq}`,
      cart: { ...(activeCart || {}) },
      note: String(meta.note || ""),
      customerOrderNo: String(meta.customerOrderNo || ""),
      heldAt: new Date().toISOString(),
    }];
  }
  return {
    held: renumberHeldCarts(next),
    cart: { ...(hold.cart || {}) },
    meta: { note: hold.note || "", customerOrderNo: hold.customerOrderNo || "" },
  };
}

/**
 * Siparişlerim için silik / view-only satırlar.
 * priceGross(product) → KDV dahil birim fiyat.
 */
export function heldCartsAsOrders(held, products, opts = {}) {
  const {
    activeCart = null,
    activeNote = "",
    activeCustomerOrderNo = "",
    priceGross = (p) => Number(p?.price_gross ?? p?.price) || 0,
  } = opts;
  const byId = {};
  (products || []).forEach((p) => {
    const id = p?.id || p?._id;
    if (id) byId[id] = p;
  });

  const toOrder = (entry, { isActive = false } = {}) => {
    const items = Object.values(entry.cart || {}).map((line) => {
      const p = byId[line.productId] || {};
      const qty = Number(line.qty) || 0;
      const unit = priceGross(p);
      const vat = Number(p.vat_rate) || 0;
      return {
        product_id: line.productId,
        product_name: p.name || line.productId,
        quantity: qty,
        unit: p.unit || "Adet",
        unit_price: unit,
        total: Math.round(unit * qty * 100) / 100,
        total_incl: Math.round(unit * qty * 100) / 100,
        vat_rate: vat,
        note: line.note || "",
        sku: p.sku || "",
        barcode: p.barcode || "",
        image_url: p.image_url || "",
      };
    }).filter((it) => it.quantity > 0);
    const total = Math.round(items.reduce((s, it) => s + (Number(it.total_incl) || 0), 0) * 100) / 100;
    const seq = Number(entry.seq) || 1;
    return {
      id: entry.id,
      order_number: isActive ? "Aktif sepet" : `Bekleyen sepet #${seq}`,
      order_status: isActive ? "active_cart" : "held_cart",
      order_date: String(entry.heldAt || new Date().toISOString()).slice(0, 10),
      customer_order_number: entry.customerOrderNo || "",
      notes: entry.note || "",
      items,
      grand_total: total,
      total_amount: total,
      is_held_cart: true,
      is_active_cart: !!isActive,
      held_seq: isActive ? null : seq,
      view_only: true,
    };
  };

  const rows = [];
  if (cartHasItems(activeCart)) {
    rows.push(toOrder({
      id: "active_cart",
      cart: activeCart,
      note: activeNote,
      customerOrderNo: activeCustomerOrderNo,
      heldAt: new Date().toISOString(),
    }, { isActive: true }));
  }
  (held || []).forEach((h) => {
    if (cartHasItems(h.cart)) rows.push(toOrder(h));
  });
  return rows;
}

/** Panel / portal: sunucudaki held_cart siparişini salt-önizleme satırına çevir. */
export function asPortalHeldOrder(o) {
  if (!o) return o;
  const held = o.is_held_cart || o.order_status === "held_cart" || o.source === "b2b_held_cart";
  if (!held) return o;
  const seq = Number(o.held_seq) || 1;
  return {
    ...o,
    is_held_cart: true,
    view_only: true,
    held_seq: seq,
    held_label: o.held_label || `Bekleyen sepet #${seq}`,
    order_number: o.held_label || o.order_number || `Bekleyen sepet #${seq}`,
    order_status: "held_cart",
  };
}

/** Aktif sepet (yerel) + sunucu bekleyen sepetler + yerel yedek + gerçek siparişler. */
export function mergePortalOrderLists({ serverOrders = [], heldLocal = [], products = [], activeCart, activeNote, activeCustomerOrderNo, priceGross } = {}) {
  const activeRows = heldCartsAsOrders([], products, {
    activeCart,
    activeNote,
    activeCustomerOrderNo,
    priceGross,
  });
  const serverHeld = (serverOrders || [])
    .filter((o) => o?.is_held_cart || o?.order_status === "held_cart" || o?.source === "b2b_held_cart")
    .map(asPortalHeldOrder);
  const serverHeldIds = new Set(serverHeld.map((o) => String(o.id || o._id || "")));
  const localHeld = heldCartsAsOrders(heldLocal, products, { priceGross }).filter(
    (r) => !r.is_active_cart && !serverHeldIds.has(String(r.id || "")),
  );
  const real = (serverOrders || []).filter(
    (o) => !(o?.is_held_cart || o?.order_status === "held_cart" || o?.source === "b2b_held_cart"),
  );
  return [...activeRows, ...serverHeld, ...localHeld, ...real];
}

/** Sepet sekmeleri: yerel + sunucu bekleyenler. */
export function heldCartTabs(heldLocal = [], serverOrders = []) {
  const local = (heldLocal || []).map((h) => ({
    id: h.id,
    label: h.label || `Bekleyen sepet #${h.seq || 1}`,
    seq: h.seq,
    server: false,
  }));
  const localIds = new Set(local.map((h) => String(h.id)));
  const server = (serverOrders || [])
    .filter((o) => o?.is_held_cart || o?.order_status === "held_cart")
    .map((o) => ({
      id: o.id || o._id,
      label: o.held_label || `Bekleyen sepet #${o.held_seq || 1}`,
      seq: o.held_seq,
      server: true,
      order: o,
    }))
    .filter((h) => h.id && !localIds.has(String(h.id)));
  return [...local, ...server];
}
