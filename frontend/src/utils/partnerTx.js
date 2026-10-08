/** Ortak hareket etiketleri ve işaretleri. */

export const PARTNER_TX_LABEL = {
  capital_in: "Sermaye Girişi",
  withdrawal: "Para Çekişi",
  profit_share: "Kâr Payı",
  credit: "Alacak Fişi",
  debit: "Borç Fişi",
  salary: "Aylık Maaş",
};

/** Şirket masrafını ortak ödedi → ortak alacak (credit); etiket Masraf Ödemesi. */
export function partnerTxLabel(tx) {
  if (!tx) return "";
  if (tx.expense_id || tx.source === "expense") return "Masraf Ödemesi";
  return PARTNER_TX_LABEL[tx.type] || tx.type || "";
}

export function isPartnerExpenseTx(tx) {
  return Boolean(tx?.expense_id || tx?.source === "expense");
}

/**
 * Ortak bakiyesi (şirket defteri):
 *   artı → şirket ortağa borçlu (ortak alacaklı / kasa borçlu)
 *   eksi → ortak şirkete borçlu (şirket alacaklı / kasa alacaklı)
 */
export function partnerBalanceMeta(balance) {
  const n = Number(balance);
  const amount = Number.isFinite(n) ? n : 0;
  if (amount > 0) {
    return {
      amount,
      abs: amount,
      label: "Ortak alacağı",
      badge: "Ortak alacaklı",
      hint: "Şirket (kasa) bu ortağa borçlu",
      amountCls: "text-amber-700",
      badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
      side: "credit",
    };
  }
  if (amount < 0) {
    return {
      amount,
      abs: Math.abs(amount),
      label: "Ortak borcu",
      badge: "Ortak borçlu",
      hint: "Ortak şirkete / kasaya borçlu — kasa alacaklı",
      amountCls: "text-rose-700",
      badgeCls: "bg-rose-100 text-rose-800 border-rose-200",
      side: "debit",
    };
  }
  return {
    amount: 0,
    abs: 0,
    label: "Ortak bakiyesi",
    badge: "Denk",
    hint: "Borç / alacak yok",
    amountCls: "text-slate-800",
    badgeCls: "bg-slate-100 text-slate-600 border-slate-200",
    side: "zero",
  };
}

/** Artı: ortak alacağı artar (para koy / alacak fişi / maaş / tahakkuk kâr payı). */
export function partnerTxIncreasesBalance(type, tx) {
  if (type === "capital_in" || type === "credit" || type === "salary") return true;
  // Tahakkuk kâr payı bakiyeyi artırır; peşin ödeme yalnızca kasadan çıkar.
  if (type === "profit_share") return !(tx && tx.is_paid);
  return false;
}

export function partnerTxSign(type, tx) {
  return partnerTxIncreasesBalance(type, tx) ? "+" : "-";
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

/** Kaydet sonrası: vadesi gelmemişse tarihi söyle, gelmişse alacağa yazıldı. */
export function partnerSalarySaveMessage(accrual, startDate) {
  if (Number(accrual?.posted_count) > 0) return accrual.message || "Aylık maaş alacağa yazıldı.";
  const due = accrual?.scheduled_date
    || (accrual?.skipped || []).find((s) => s.reason === "not_due")?.due_date
    || (!accrual ? startDate : "");
  if (due) {
    const [y, m, d] = String(due).slice(0, 10).split("-");
    const label = d && m && y ? `${d}.${m}.${y}` : due;
    return `Kaydedildi. ${label} tarihinde alacağa yazılacak.`;
  }
  return accrual?.message || "Aylık maaş kaydedildi.";
}

/** Kartta tutar + her ayın hak ediş günü. */
export function partnerSalaryCardText(partner, formatAmount) {
  const n = Number(partner?.monthly_salary) || 0;
  if (n <= 0) return "Belirle";
  const amt = formatAmount ? formatAmount(n) : String(n);
  if (partner?.salary_recurring === false) return `${amt} ₺`;
  return `${amt} ₺ · her ayın ${salaryDayOf(partner)}'i`;
}
