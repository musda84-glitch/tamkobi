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

/** Second line of a cart sheet row: qty × price, optional note. */
export function formatCartSheetMeta(
  qty: number,
  priceText?: string | null,
  note?: string | null
): string {
  const price = String(priceText || "").trim();
  const qtyBit = price ? `${qty} × ${price}` : `${qty} adet`;
  const extra = normalizeNote(note);
  return extra ? `${qtyBit} · ${extra}` : qtyBit;
}

/** Full cart sheet label (name + meta). */
export function formatCartSheetLine(
  name: string,
  qty: number,
  priceText?: string | null,
  note?: string | null
): string {
  return `${name}  ${formatCartSheetMeta(qty, priceText, note)}`;
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

export function cartHasItems(cart: B2BCart | null | undefined): boolean {
  return Object.values(cart || {}).some((l) => (Number(l?.qty) || 0) > 0);
}

export function productCartQty(cart: B2BCart | null | undefined, productId: string): number {
  const id = String(productId || "");
  if (!id) return 0;
  return Object.values(cart || {}).reduce((s, line) => s + (line.productId === id ? Number(line.qty) || 0 : 0), 0);
}

export type HeldCart = {
  id: string;
  seq: number;
  label: string;
  cart: B2BCart;
  note: string;
  customerOrderNo: string;
  heldAt: string;
};

export type HeldOrderView = {
  id: string;
  order_number: string;
  order_status: string;
  order_date: string;
  customer_order_number: string;
  notes: string;
  items: Array<Record<string, unknown>>;
  grand_total: number;
  total_amount: number;
  is_held_cart: true;
  is_active_cart: boolean;
  held_seq: number | null;
  view_only: true;
};

export function heldStorageKey(token: string): string {
  return `tamkobi.b2bHeldCarts.${String(token || "")}`;
}

export function renumberHeldCarts(held: HeldCart[] | null | undefined): HeldCart[] {
  return (held || []).map((h, i) => {
    const seq = i + 1;
    return { ...h, seq, label: `Bekleyen sepet #${seq}` };
  });
}

export function parseHeldCarts(raw: unknown): HeldCart[] {
  let v: unknown = raw;
  if (typeof raw === "string") {
    try {
      v = JSON.parse(raw || "[]");
    } catch {
      return [];
    }
  }
  if (!Array.isArray(v)) return [];
  const out: HeldCart[] = [];
  v.forEach((row, i) => {
    if (!row || typeof row !== "object") return;
    const rec = row as Record<string, unknown>;
    const cart = parseStoredCart(rec.cart || {});
    if (!cartHasItems(cart)) return;
    const seq = Number(rec.seq) || i + 1;
    out.push({
      id: String(rec.id || `hold_${i + 1}`),
      seq,
      label: String(rec.label || `Bekleyen sepet #${seq}`),
      cart,
      note: String(rec.note || ""),
      customerOrderNo: String(rec.customerOrderNo || rec.customer_order_number || ""),
      heldAt: String(rec.heldAt || rec.held_at || new Date().toISOString()),
    });
  });
  return renumberHeldCarts(out);
}

export function holdActiveCart(
  held: HeldCart[] | null | undefined,
  cart: B2BCart | null | undefined,
  meta: { note?: string; customerOrderNo?: string } = {}
): { held: HeldCart[]; cart: B2BCart } {
  if (!cartHasItems(cart)) return { held: renumberHeldCarts(held || []), cart: cart || {} };
  const seq = (held || []).length + 1;
  const entry: HeldCart = {
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

export function discardHeldCart(held: HeldCart[] | null | undefined, holdId: string): HeldCart[] {
  return renumberHeldCarts((held || []).filter((h) => h.id !== holdId));
}

export function resumeHeldCart(
  held: HeldCart[] | null | undefined,
  activeCart: B2BCart | null | undefined,
  holdId: string,
  meta: { note?: string; customerOrderNo?: string } = {}
): { held: HeldCart[]; cart: B2BCart; meta: { note: string; customerOrderNo: string } | null } {
  const list = held || [];
  const hold = list.find((h) => h.id === holdId);
  if (!hold) return { held: renumberHeldCarts(list), cart: activeCart || {}, meta: null };
  let next = list.filter((h) => h.id !== holdId);
  if (cartHasItems(activeCart)) {
    const seq = next.length + 1;
    next = [
      ...next,
      {
        id: `hold_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        seq,
        label: `Bekleyen sepet #${seq}`,
        cart: { ...(activeCart || {}) },
        note: String(meta.note || ""),
        customerOrderNo: String(meta.customerOrderNo || ""),
        heldAt: new Date().toISOString(),
      },
    ];
  }
  return {
    held: renumberHeldCarts(next),
    cart: { ...(hold.cart || {}) },
    meta: { note: hold.note || "", customerOrderNo: hold.customerOrderNo || "" },
  };
}

export function heldCartsAsOrders(
  held: HeldCart[] | null | undefined,
  products: Array<{ id?: string; _id?: string; name?: string; price?: number; price_gross?: number; vat_rate?: number; unit?: string; sku?: string; barcode?: string; image_url?: string }> | null | undefined,
  opts: {
    activeCart?: B2BCart | null;
    activeNote?: string;
    activeCustomerOrderNo?: string;
    priceGross?: (p: Record<string, unknown>) => number;
  } = {}
): HeldOrderView[] {
  const {
    activeCart = null,
    activeNote = "",
    activeCustomerOrderNo = "",
    priceGross = (p) => Number((p as { price_gross?: number; price?: number }).price_gross ?? (p as { price?: number }).price) || 0,
  } = opts;
  const byId: Record<string, Record<string, unknown>> = {};
  (products || []).forEach((p) => {
    const id = p?.id || p?._id;
    if (id) byId[String(id)] = p as Record<string, unknown>;
  });

  const toOrder = (entry: { id: string; cart?: B2BCart; seq?: number; customerOrderNo?: string; note?: string; heldAt?: string }, isActive = false): HeldOrderView => {
    const items = Object.values(entry.cart || {})
      .map((line) => {
        const p = byId[line.productId] || {};
        const qty = Number(line.qty) || 0;
        const unit = priceGross(p);
        return {
          product_id: line.productId,
          product_name: String(p.name || line.productId),
          quantity: qty,
          unit: String(p.unit || "Adet"),
          unit_price: unit,
          total: Math.round(unit * qty * 100) / 100,
          total_incl: Math.round(unit * qty * 100) / 100,
          vat_rate: Number(p.vat_rate) || 0,
          note: line.note || "",
          sku: String(p.sku || ""),
          barcode: String(p.barcode || ""),
          image_url: String(p.image_url || ""),
        };
      })
      .filter((it) => it.quantity > 0);
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

  const rows: HeldOrderView[] = [];
  if (cartHasItems(activeCart)) {
    rows.push(
      toOrder(
        {
          id: "active_cart",
          cart: activeCart || {},
          note: activeNote,
          customerOrderNo: activeCustomerOrderNo,
          heldAt: new Date().toISOString(),
        },
        true
      )
    );
  }
  (held || []).forEach((h) => {
    if (cartHasItems(h.cart)) rows.push(toOrder(h, false));
  });
  return rows;
}

export function asPortalHeldOrder<T extends Record<string, unknown>>(o: T | null | undefined): T | null | undefined {
  if (!o) return o;
  const active = o.is_active_cart || o.order_status === "active_cart" || o.source === "b2b_active_cart";
  if (active) {
    const label = String(o.held_label || "Aktif sepet");
    return {
      ...o,
      is_active_cart: true,
      is_held_cart: false,
      view_only: true,
      held_label: label,
      order_number: label,
      order_status: "active_cart",
    } as T;
  }
  const held = o.is_held_cart || o.order_status === "held_cart" || o.source === "b2b_held_cart";
  if (!held) return o;
  const seq = Number(o.held_seq) || 1;
  const label = String(o.held_label || `Bekleyen sepet #${seq}`);
  return {
    ...o,
    is_held_cart: true,
    is_active_cart: false,
    view_only: true,
    held_seq: seq,
    held_label: label,
    order_number: label,
    order_status: "held_cart",
  } as T;
}

function isServerCartOrder(o: Record<string, unknown> | null | undefined): boolean {
  return !!(
    o?.is_held_cart
    || o?.is_active_cart
    || o?.order_status === "held_cart"
    || o?.order_status === "active_cart"
    || o?.source === "b2b_held_cart"
    || o?.source === "b2b_active_cart"
  );
}

export function mergePortalOrderLists(opts: {
  serverOrders?: Array<Record<string, unknown>>;
  heldLocal?: HeldCart[];
  products?: Array<Record<string, unknown>>;
  activeCart?: B2BCart | null;
  activeNote?: string;
  activeCustomerOrderNo?: string;
  priceGross?: (p: Record<string, unknown>) => number;
}): Array<Record<string, unknown>> {
  const {
    serverOrders = [],
    heldLocal = [],
    products = [],
    activeCart = null,
    activeNote = "",
    activeCustomerOrderNo = "",
    priceGross,
  } = opts;
  const activeRows = heldCartsAsOrders([], products, {
    activeCart,
    activeNote,
    activeCustomerOrderNo,
    priceGross,
  }) as unknown as Array<Record<string, unknown>>;
  const serverActive = (serverOrders || [])
    .filter((o) => o?.is_active_cart || o?.order_status === "active_cart" || o?.source === "b2b_active_cart")
    .map((o) => asPortalHeldOrder(o)!)
    .filter(Boolean);
  const showServerActive = !cartHasItems(activeCart) ? serverActive : [];
  const serverHeld = (serverOrders || [])
    .filter((o) => o?.is_held_cart || o?.order_status === "held_cart" || o?.source === "b2b_held_cart")
    .map((o) => asPortalHeldOrder(o)!)
    .filter(Boolean);
  const serverHeldIds = new Set(serverHeld.map((o) => String(o.id || o._id || "")));
  const localHeld = (heldCartsAsOrders(heldLocal, products, { priceGross }) as unknown as Array<Record<string, unknown>>).filter(
    (r) => !r.is_active_cart && !serverHeldIds.has(String(r.id || "")),
  );
  const real = (serverOrders || []).filter((o) => !isServerCartOrder(o));
  return [...activeRows, ...showServerActive, ...serverHeld, ...localHeld, ...real];
}

export function heldCartTabs(heldLocal: HeldCart[] = [], serverOrders: Array<Record<string, unknown>> = []) {
  const local = (heldLocal || []).map((h) => ({
    id: h.id,
    label: h.label || `Bekleyen sepet #${h.seq || 1}`,
    seq: h.seq,
    server: false as const,
  }));
  const localIds = new Set(local.map((h) => String(h.id)));
  const server = (serverOrders || [])
    .filter((o) => o?.is_held_cart || o?.order_status === "held_cart")
    .map((o) => ({
      id: String(o.id || o._id || ""),
      label: String(o.held_label || `Bekleyen sepet #${o.held_seq || 1}`),
      seq: Number(o.held_seq) || 1,
      server: true as const,
      order: o,
    }))
    .filter((h) => h.id && !localIds.has(String(h.id)));
  return [...local, ...server];
}

/** Sepete eklenince banner açık gridan yeşile geçer; çerçeve düz çizgi. */
export function b2bFlashChrome(added: boolean) {
  return {
    borderStyle: "solid" as const,
    borderColor: added ? "#059669" : "#E2E8F0",
    backgroundColor: added ? "#ECFDF5" : "#F8FAFC",
    icon: added ? "#059669" : "#94A3B8",
    text: added ? "#047857" : "#64748B",
  };
}
