/** KDV dahil sipariş tutarı. grand_total varsa o kullanılır. */
export const lineGross = (it) => {
  if (!it) return 0;
  const qty = Number(it.quantity) || 0;
  const unit = Number(it.unit_price) || 0;
  const stored = it.total != null && it.total !== "" ? Number(it.total) : unit * qty;
  const vat = Number(it.vat_rate) || 0;
  if (it.price_includes_vat || !vat) return stored;
  return Math.round(stored * (1 + vat / 100) * 100) / 100;
};

export const orderGross = (o) => {
  if (!o) return 0;
  if (o.grand_total != null && o.grand_total !== "") return Number(o.grand_total) || 0;
  const items = o.items || [];
  if (items.some((it) => it.vat_rate != null || it.price_includes_vat)) {
    return Math.round(items.reduce((s, it) => s + lineGross(it), 0) * 100) / 100;
  }
  return Number(o.total_amount) || 0;
};
