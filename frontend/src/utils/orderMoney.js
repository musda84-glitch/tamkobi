/** KDV dahil birim fiyat. unit_price_incl varsa o kullanılır. */
export const lineUnitGross = (it) => {
  if (!it) return 0;
  if (it.unit_price_incl != null && it.unit_price_incl !== "") return Number(it.unit_price_incl) || 0;
  const unit = Number(it.unit_price) || 0;
  const vat = Number(it.vat_rate) || 0;
  if (!vat) return unit;
  return Math.round(unit * (1 + vat / 100) * 100) / 100;
};

/** KDV dahil satır tutarı. total_incl varsa o kullanılır; aksi halde net total + KDV. */
export const lineGross = (it) => {
  if (!it) return 0;
  if (it.total_incl != null && it.total_incl !== "") return Number(it.total_incl) || 0;
  const qty = Number(it.quantity) || 0;
  const unit = Number(it.unit_price) || 0;
  const stored = it.total != null && it.total !== "" ? Number(it.total) : unit * qty;
  const vatAmt = Number(it.vat_amount);
  if (Number.isFinite(vatAmt)) return Math.round((stored + vatAmt) * 100) / 100;
  const vat = Number(it.vat_rate) || 0;
  // enrich_line sonrası unit_price/total her zaman KDV hariçtir.
  if (!vat) return stored;
  return Math.round(stored * (1 + vat / 100) * 100) / 100;
};

export const orderGross = (o) => {
  if (!o) return 0;
  if (o.grand_total != null && o.grand_total !== "") return Number(o.grand_total) || 0;
  const items = o.items || [];
  if (items.length) {
    return Math.round(items.reduce((s, it) => s + lineGross(it), 0) * 100) / 100;
  }
  return Number(o.total_amount) || 0;
};

/** Sipariş footer: kayıtlı KDV Hariç + KDV = Genel Toplam tutmuyorsa satırlardan yeniden hesapla. */
export const orderFooterTotals = (order, recomputed) => {
  const sub = Number(order?.subtotal);
  const vat = Number(order?.vat_total);
  const grand = Number(order?.grand_total);
  const storedOk =
    Number.isFinite(sub) &&
    Number.isFinite(vat) &&
    Number.isFinite(grand) &&
    Math.abs(sub + vat - grand) < 0.02;
  if (storedOk) return { subtotal: sub, vat, grandTotal: grand };
  return {
    subtotal: recomputed?.subtotal ?? 0,
    vat: recomputed?.vat ?? 0,
    grandTotal: recomputed?.grandTotal ?? (Number(order?.total_amount) || 0),
  };
};
