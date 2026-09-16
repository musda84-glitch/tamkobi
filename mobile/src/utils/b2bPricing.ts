export type B2BPriced = {
  price?: number | null;
  list_price?: number | null;
  price_gross?: number | null;
  list_price_gross?: number | null;
  vat_rate?: number | null;
  price_includes_vat?: boolean;
};

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** KDV dahil birim fiyat. price_gross yoksa vat_rate + price_includes_vat ile hesaplanır. */
export function b2bGross(p: B2BPriced | null | undefined, field: "price" | "list_price" = "price"): number {
  if (!p || p[field] == null || p[field] === ("" as unknown)) return 0;
  if (field === "price" && p.price_gross != null && p.price_gross !== ("" as unknown)) return num(p.price_gross);
  if (field === "list_price" && p.list_price_gross != null && p.list_price_gross !== ("" as unknown)) return num(p.list_price_gross);
  const n = num(p[field]);
  const r = num(p.vat_rate);
  if (p.price_includes_vat) return n;
  return Math.round(n * (1 + r / 100) * 100) / 100;
}

export function b2bNet(p: B2BPriced | null | undefined): number {
  if (!p || p.price == null || p.price === ("" as unknown)) return 0;
  const n = num(p.price);
  const r = num(p.vat_rate);
  if (p.price_includes_vat && r) return Math.round((n / (1 + r / 100)) * 100) / 100;
  return n;
}

export function b2bOrderGross(o: {
  grand_total?: number | null;
  total_amount?: number | null;
  items?: Array<{
    total_incl?: number | null;
    total?: number | null;
    unit_price?: number | null;
    quantity?: number | null;
    vat_amount?: number | null;
    vat_rate?: number | null;
  }> | null;
} | null | undefined): number {
  if (!o) return 0;
  if (o.grand_total != null && o.grand_total !== ("" as unknown)) return num(o.grand_total);
  const items = o.items || [];
  if (items.length) {
    return Math.round(
      items.reduce((s, it) => {
        const incl = Number(it.total_incl);
        if (Number.isFinite(incl)) return s + incl;
        const net =
          it.total != null && it.total !== ("" as unknown)
            ? num(it.total)
            : num(it.unit_price) * num(it.quantity);
        const vatAmt = Number(it.vat_amount);
        if (Number.isFinite(vatAmt)) return s + net + vatAmt;
        const vat = num(it.vat_rate);
        return s + (vat ? net * (1 + vat / 100) : net);
      }, 0) * 100
    ) / 100;
  }
  return num(o.total_amount);
}
