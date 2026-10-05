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

export function salaryDayOf(partner) {
  const fromField = Number(partner?.salary_day);
  if (fromField >= 1 && fromField <= 31) return fromField;
  const day = Number(String(partner?.salary_start_date || "").slice(8, 10));
  return day >= 1 && day <= 31 ? day : 1;
}

export function todayIsoDate() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Kartta tutar + her ayın hak ediş günü. */
export function partnerSalaryCardText(partner, formatAmount) {
  const n = Number(partner?.monthly_salary) || 0;
  if (n <= 0) return "Belirle";
  const amt = formatAmount ? formatAmount(n) : String(n);
  if (partner?.salary_recurring === false) return `${amt} ₺`;
  return `${amt} ₺ · her ayın ${salaryDayOf(partner)}'i`;
}
