/** Kayıt sonrası tahsilat/ödeme sorulsun mu? */
export function shouldAskPaymentAfterSave(inv) {
  if (!inv) return false;
  if (inv.invoice_type === "dispatch" || inv.e_type === "e_dispatch") return false;
  if (inv.invoice_type === "proforma") return false;
  const due = Number(inv.grand_total || 0) - Number(inv.paid_amount || 0);
  return due > 0.009;
}

export function paymentAskMessage(inv) {
  const isSales = inv?.invoice_type !== "purchase";
  const label = isSales ? "tahsilat" : "ödeme";
  const no = inv?.invoice_number || "Fatura";
  return `${no} kaydedildi.\nBu fatura için ${label} var mı?`;
}
