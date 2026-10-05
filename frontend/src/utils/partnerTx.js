/** Ortak hareket etiketleri ve işaretleri. */

export const PARTNER_TX_LABEL = {
  capital_in: "Sermaye Girişi",
  withdrawal: "Para Çekişi",
  profit_share: "Kâr Payı",
  credit: "Alacak Fişi",
  debit: "Borç Fişi",
  salary: "Aylık Maaş",
};

/** Artı: ortak alacağı artar (para koy / alacak fişi / maaş). */
export function partnerTxIncreasesBalance(type) {
  return type === "capital_in" || type === "credit" || type === "salary";
}

export function partnerTxSign(type) {
  return partnerTxIncreasesBalance(type) ? "+" : "-";
}

export function isPartnerLedgerType(type) {
  return type === "credit" || type === "debit" || type === "salary";
}

export function isPartnerCashType(type) {
  return type === "capital_in" || type === "withdrawal";
}

/** Kart üzerindeki maaş satırı: tutar yoksa «Belirle». */
export function partnerSalaryActionLabel(amount) {
  const n = Number(amount) || 0;
  return n > 0 ? null : "Belirle";
}
