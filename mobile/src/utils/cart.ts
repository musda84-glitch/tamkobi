export type CartLine = {
  product_id: string;
  product_name: string;
  sku: string;
  barcode?: string;
  quantity: number;
  unit_price: number;
  unit_price_incl: number;
  vat_rate: number;
  total: number;
  vat_amount: number;
  total_incl: number;
  stock_quantity?: number;
};

function num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function computeLine(item: CartLine): CartLine {
  const qty = num(item.quantity, 1);
  const vat = num(item.vat_rate, 20);
  let excl = num(item.unit_price);
  let incl = num(item.unit_price_incl);
  if (!excl && incl) excl = vat === -100 ? incl : incl / (1 + vat / 100);
  if (!incl && excl) incl = excl * (1 + vat / 100);
  const total = Math.round(qty * excl * 100) / 100;
  const vat_amount = Math.round((total * vat) / 100 * 100) / 100;
  return {
    ...item,
    quantity: qty,
    vat_rate: vat,
    unit_price: Math.round(excl * 10000) / 10000,
    unit_price_incl: Math.round(incl * 10000) / 10000,
    total,
    vat_amount,
    total_incl: Math.round((total + vat_amount) * 100) / 100,
  };
}

export function lineFromProduct(prod: Record<string, unknown>, quantity = 1): CartLine {
  const vatRate = num(prod.vat_rate, 20);
  const includesVat = !!prod.price_includes_vat;
  const price = num(prod.sale_price);
  return computeLine({
    product_id: String(prod.id || prod._id || ""),
    product_name: String(prod.name || ""),
    sku: String(prod.sku || ""),
    barcode: prod.barcode ? String(prod.barcode) : undefined,
    quantity,
    unit_price: includesVat ? 0 : price,
    unit_price_incl: includesVat ? price : 0,
    vat_rate: vatRate,
    total: 0,
    vat_amount: 0,
    total_incl: 0,
    stock_quantity: num(prod.stock_quantity),
  });
}

export function addOrBump(cart: CartLine[], line: CartLine, qty = 1): CartLine[] {
  const idx = cart.findIndex((x) => x.product_id && x.product_id === line.product_id);
  if (idx < 0) return [...cart, computeLine({ ...line, quantity: qty })];
  const next = [...cart];
  next[idx] = computeLine({ ...next[idx], quantity: num(next[idx].quantity) + qty });
  return next;
}

export function removeCartLine(cart: CartLine[], index: number): CartLine[] {
  return cart.filter((_, i) => i !== index);
}

export function cartTotals(cart: CartLine[]): { count: number; totalIncl: number } {
  return {
    count: cart.reduce((s, it) => s + num(it.quantity), 0),
    totalIncl: Math.round(cart.reduce((s, it) => s + num(it.total_incl), 0) * 100) / 100,
  };
}
