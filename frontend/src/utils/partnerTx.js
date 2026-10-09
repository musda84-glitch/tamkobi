/** Ortak hareket etiketleri ve işaretleri.
 * Bakiye = ortağın cebindeki para (yazma).
 * İşlem sütunu Giriş/Çıkış = kasa / işlem yönü:
 *   tahsilat → Giriş, masraf / virman çıkışı → Çıkış
 * (ortak bakiyesi artışı ile aynı olmayabilir).
 */

export const PARTNER_TX_LABEL = {
  capital_in: "Giriş",
  withdrawal: "Çıkış",
  profit_share: "Giriş",
  credit: "Giriş",
  debit: "Çıkış",
  salary: "Giriş",
};

export function isPartnerExpenseTx(tx) {
  return Boolean(tx?.expense_id || tx?.source === "expense");
}

/**
 * İşlem sütunu yönü (kasa bakışı):
 * - Masraf (ortak ödedi) → Çıkış (harcama)
 * - Cari tahsilat → ortak → Giriş (tahsilat)
 * - Cari ödeme ← ortak → Çıkış
 * - Virman / para çek → Çıkış; sermaye / maaş → Giriş
 */
export function partnerTxIsCashInflow(tx) {
  if (!tx) return false;
  if (isPartnerExpenseTx(tx)) return false;
  if (tx.contact_id && tx.type === "withdrawal") return true;
  if (tx.contact_id && tx.type === "capital_in") return false;
  return partnerTxIncreasesBalance(tx.type, tx);
}

/** İşlem sütunu: yalnızca Giriş / Çıkış (kasa yönü). */
export function partnerTxLabel(tx) {
  if (!tx) return "";
  return partnerTxIsCashInflow(tx) ? "Giriş" : "Çıkış";
}

/**
 * Ortak bakiyesi = cebindeki para (yazma):
 *   artı → Alacaklı (ortağa yazılan / çekilebilir)
 *   eksi → Borçlu (fazla çekmiş)
 * Kartta yalnızca Alacaklı / Borçlu gösterilir (ek etiket/hint yok).
 */
export function partnerBalanceMeta(balance) {
  const n = Number(balance);
  const amount = Number.isFinite(n) ? n : 0;
  if (amount > 0) {
    return {
      amount,
      abs: amount,
      label: "Alacaklı",
      badge: "Alacaklı",
      hint: "",
      amountCls: "text-amber-700",
      badgeCls: "bg-amber-100 text-amber-800 border-amber-200",
      side: "credit",
    };
  }
  if (amount < 0) {
    return {
      amount,
      abs: Math.abs(amount),
      label: "Borçlu",
      badge: "Borçlu",
      hint: "",
      amountCls: "text-rose-700",
      badgeCls: "bg-rose-100 text-rose-800 border-rose-200",
      side: "debit",
    };
  }
  return {
    amount: 0,
    abs: 0,
    label: "Denk",
    badge: "Denk",
    hint: "",
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
  // Tablo işareti kasa yönüyle aynı (Giriş +, Çıkış −)
  if (tx && typeof tx === "object") {
    return partnerTxIsCashInflow({ ...tx, type: type || tx.type }) ? "+" : "-";
  }
  return partnerTxIncreasesBalance(type, tx) ? "+" : "-";
}

/** Tek hareketin ortak bakiyesine net etkisi. */
export function partnerTxBalanceDelta(tx) {
  if (!tx) return 0;
  const amt = Number(tx.amount);
  if (!Number.isFinite(amt)) return 0;
  if (partnerTxIncreasesBalance(tx.type, tx)) return amt;
  if (tx.type === "withdrawal" || tx.type === "debit") return -amt;
  return 0;
}

/**
 * Seçili ortağın hareketlerinden bakiye mutabakatı.
 * Kart bakiyesi ile hareket toplamı sapıyorsa drift=true.
 */
export function partnerLedgerBreakdown(txs, storedBalance) {
  const rows = Array.isArray(txs) ? txs : [];
  const buckets = {
    capital_in: 0,
    withdrawal: 0,
    credit: 0,
    debit: 0,
    salary: 0,
    profit_accrual: 0,
    profit_paid: 0,
    other: 0,
  };
  let ledger = 0;
  for (const tx of rows) {
    const amt = Number(tx.amount);
    const n = Number.isFinite(amt) ? amt : 0;
    const delta = partnerTxBalanceDelta(tx);
    ledger += delta;
    if (tx.type === "capital_in") buckets.capital_in += n;
    else if (tx.type === "withdrawal") buckets.withdrawal += n;
    else if (tx.type === "credit") buckets.credit += n;
    else if (tx.type === "debit") buckets.debit += n;
    else if (tx.type === "salary") buckets.salary += n;
    else if (tx.type === "profit_share" && !tx.is_paid) buckets.profit_accrual += n;
    else if (tx.type === "profit_share" && tx.is_paid) buckets.profit_paid += n;
    else buckets.other += n;
  }
  ledger = Math.round(ledger * 100) / 100;
  const stored = Number(storedBalance);
  const storedN = Number.isFinite(stored) ? Math.round(stored * 100) / 100 : 0;
  // Cebindeki para algoritması: Giriş yazıları − Çıkış yazıları
  const inflow = Math.round((
    buckets.capital_in + buckets.credit + buckets.salary + buckets.profit_accrual
  ) * 100) / 100;
  const outflow = Math.round((
    buckets.withdrawal + buckets.debit + buckets.profit_paid
  ) * 100) / 100;
  return {
    count: rows.length,
    ledger,
    stored: storedN,
    drift: Math.abs(ledger - storedN) > 0.005,
    buckets,
    inflow,
    outflow,
  };
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

/** Kaydet sonrası: vadesi gelmemişse tarihi söyle, gelmişse cebine yazıldı. */
export function partnerSalarySaveMessage(accrual, startDate) {
  if (Number(accrual?.posted_count) > 0) {
    const raw = accrual.message || "Aylık maaş cebine yazıldı.";
    return String(raw).replace(/ortak alacağına/gi, "cebine").replace(/alacağa/gi, "cebine");
  }
  const due = accrual?.scheduled_date
    || (accrual?.skipped || []).find((s) => s.reason === "not_due")?.due_date
    || (!accrual ? startDate : "");
  if (due) {
    const [y, m, d] = String(due).slice(0, 10).split("-");
    const label = d && m && y ? `${d}.${m}.${y}` : due;
    return `Kaydedildi. ${label} tarihinde cebine yazılacak.`;
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
