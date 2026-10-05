/** Ortak hareket etiketleri ve işaretleri. */

export const PARTNER_TX_LABEL = {
  capital_in: "Sermaye Girişi",
  withdrawal: "Para Çekişi",
  profit_share: "Kâr Payı",
  credit: "Alacak Fişi",
  debit: "Borç Fişi",
};

/** Artı: ortak alacağı artar (para koy / alacak fişi). */
export function partnerTxIncreasesBalance(type) {
  return type === "capital_in" || type === "credit";
}

export function partnerTxSign(type) {
  return partnerTxIncreasesBalance(type) ? "+" : "-";
}

export function isPartnerLedgerType(type) {
  return type === "credit" || type === "debit";
}

export function isPartnerCashType(type) {
  return type === "capital_in" || type === "withdrawal";
}
